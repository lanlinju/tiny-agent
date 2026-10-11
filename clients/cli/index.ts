import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import { WebSocket } from 'ws';
import type { AgentCommand } from '../../src/protocols/commands';
import { parseAgentCommand } from '../../src/protocols/commands';
import type { AgentEvent } from '../../src/protocols/events';
import { colorize, formatError, formatEvent, parseEvent, presentEvent } from './render';
import type { LineKind, RenderOptions } from './render';
import { createTranscript } from './transcript';

/**
 * CLI client.
 *
 * It only depends on `protocols` and the WebSocket transport: it sends commands
 * and renders events. It never imports `core`, `server` or `store`.
 */
const port = Number(process.env.AGENT_PORT ?? 3987);
const url = process.env.AGENT_WS_URL ?? `ws://localhost:${port}`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const transcript = createTranscript(args.logFile);

  const renderOptions: RenderOptions = {
    verbose: args.verbose,
    maxOutputLines: args.maxOutputLines,
  };
  const colorEnabled =
    args.color ?? (process.stdout.isTTY === true && process.env.NO_COLOR === undefined);
  // In a real terminal the input is echoed by readline, so we suppress the
  // rendered user line and rely on the prompt. When piped, show it explicitly.
  const interactive = process.stdin.isTTY === true;
  const suppressUser = interactive;
  let lastKind: LineKind | undefined;

  const render = (event: AgentEvent): void => {
    // The transcript is always complete and uncolored (source: formatEvent).
    transcript?.write(formatEvent(event));

    for (const line of presentEvent(event, renderOptions)) {
      if (suppressUser && line.kind === 'user') {
        continue;
      }
      if (line.kind === 'assistant' && lastKind !== 'assistant') {
        process.stdout.write('\n');
      }
      const stamp = args.timestamps ? `${timestamp()} ` : '';
      process.stdout.write(`${stamp}${colorize(line.kind, line.text, colorEnabled)}\n`);
      lastKind = line.kind;
    }
  };

  const socket = new WebSocket(url);
  await once(socket, 'open');

  socket.on('message', (data) => {
    const event = parseEvent(String(data));
    if (event) {
      render(event);
    }
  });

  const requestedSession = args.sessionId || process.env.AGENT_SESSION?.trim() || '';
  const ready = nextEvent(
    socket,
    (event) =>
      event.type === 'session.created' ||
      event.type === 'session.attached' ||
      event.type === 'error',
  );

  if (requestedSession) {
    sendCommand(socket, { type: 'session.attach', payload: { sessionId: requestedSession } });
  } else {
    sendCommand(socket, { type: 'session.create', payload: {} });
  }

  const readyEvent = await ready;
  if (readyEvent.type === 'error') {
    throw new Error(readyEvent.payload.message);
  }
  if (readyEvent.type !== 'session.created' && readyEvent.type !== 'session.attached') {
    throw new Error('Expected a session event from server');
  }
  const sessionId = readyEvent.payload.sessionId;

  console.log(`connected ${url} session=${sessionId}`);
  console.log(`web GUI: http://localhost:${port}/?session=${sessionId}`);
  if (args.logFile) {
    console.log(`transcript: ${args.logFile}`);
  }
  transcript?.write(`# session=${sessionId} started ${new Date().toISOString()}`);
  console.log('type a message, /quit to exit');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let rlClosed = false;
  rl.on('close', () => {
    rlClosed = true;
  });
  if (interactive) {
    rl.setPrompt('you> ');
    rl.prompt();
  }
  try {
    for await (const line of lines(rl)) {
      const text = line.trim();
      if (text === '/quit' || text === '/exit') {
        break;
      }
      if (text !== '') {
        // Register before sending so an in-process reply cannot be missed.
        const finished = nextEvent(
          socket,
          (event) => event.type === 'turn.completed' || event.type === 'error',
        );
        sendCommand(socket, { type: 'message.send', payload: { sessionId, text } });
        await finished;
      }
      if (interactive && !rlClosed) {
        rl.prompt();
      }
    }
  } finally {
    rl.close();
    socket.close();
    transcript?.close();
  }
}

/** CLI arguments; positional is the session id. */
interface CliArgs {
  readonly sessionId: string;
  readonly logFile: string;
  readonly verbose: boolean;
  readonly color: boolean | undefined;
  readonly timestamps: boolean;
  readonly maxOutputLines: number;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let sessionId = '';
  let logFile = process.env.AGENT_LOG_FILE?.trim() ?? '';
  let verbose = false;
  let color: boolean | undefined;
  let timestamps = false;
  let maxOutputLines = 40;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--log') {
      logFile = argv[index + 1]?.trim() ?? '';
      index += 1;
    } else if (arg.startsWith('--log=')) {
      logFile = arg.slice('--log='.length).trim();
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--color') {
      color = true;
    } else if (arg === '--no-color') {
      color = false;
    } else if (arg === '--timestamps') {
      timestamps = true;
    } else if (arg === '--max-output') {
      maxOutputLines = parsePositiveInt(argv[index + 1], maxOutputLines);
      index += 1;
    } else if (arg.startsWith('--max-output=')) {
      maxOutputLines = parsePositiveInt(arg.slice('--max-output='.length), maxOutputLines);
    } else if (!arg.startsWith('-') && sessionId === '') {
      sessionId = arg;
    }
  }

  return { sessionId, logFile, verbose, color, timestamps, maxOutputLines };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

function once(socket: WebSocket, event: 'open'): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once(event, () => resolve());
    socket.once('error', reject);
  });
}

/**
 * Adapt the readline interface to an async line iterator.
 *
 * Lines arriving while a turn is in flight are buffered instead of dropped,
 * and EOF closes the stream cleanly (no throw from a closed interface).
 */
async function* lines(rl: Interface): AsyncGenerator<string> {
  const buffered: string[] = [];
  let resolveNext: ((line: string | null) => void) | undefined;
  let closed = false;

  rl.on('line', (line) => {
    if (resolveNext) {
      const resolve = resolveNext;
      resolveNext = undefined;
      resolve(line);
    } else {
      buffered.push(line);
    }
  });
  rl.on('close', () => {
    closed = true;
    if (resolveNext) {
      const resolve = resolveNext;
      resolveNext = undefined;
      resolve(null);
    }
  });

  for (;;) {
    const next = buffered.shift();
    if (next !== undefined) {
      yield next;
      continue;
    }
    if (closed) {
      return;
    }
    const line = await new Promise<string | null>((resolve) => {
      resolveNext = resolve;
    });
    if (line === null) {
      return;
    }
    yield line;
  }
}

function nextEvent(
  socket: WebSocket,
  predicate: (event: AgentEvent) => boolean,
  timeoutMs = 30_000,
): Promise<AgentEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('Timed out waiting for a server event'));
    }, timeoutMs);

    const onMessage = (data: unknown) => {
      const event = parseEvent(String(data));
      if (!event || !predicate(event)) {
        return;
      }
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(event);
    };

    socket.on('message', onMessage);
  });
}

function sendCommand(socket: WebSocket, command: AgentCommand): void {
  // Validation boundary: clients validate before sending.
  const validated = parseAgentCommand(command);
  socket.send(JSON.stringify(validated));
}

main().catch((error: unknown) => {
  console.error(`[cli] ${formatError(error)}`);
  process.exitCode = 1;
});
