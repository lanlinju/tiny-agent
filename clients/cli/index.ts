import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import { WebSocket } from 'ws';
import type { AgentCommand } from '../../src/protocols/commands';
import { parseAgentCommand } from '../../src/protocols/commands';
import type { AgentEvent } from '../../src/protocols/events';
import { parseAgentEvent } from '../../src/protocols/events';

/**
 * CLI client.
 *
 * It only depends on `protocols` and the WebSocket transport: it sends commands
 * and renders events. It never imports `core`, `server` or `store`.
 */
const port = Number(process.env.AGENT_PORT ?? 3987);
const url = process.env.AGENT_WS_URL ?? `ws://localhost:${port}`;

async function main(): Promise<void> {
  const socket = new WebSocket(url);
  await once(socket, 'open');

  socket.on('message', (data) => {
    const event = parseEvent(String(data));
    if (event) {
      renderEvent(event);
    }
  });

  const requestedSession =
    process.argv[2]?.trim() || process.env.AGENT_SESSION?.trim() || '';
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
  console.log('type a message, /quit to exit');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let rlClosed = false;
  rl.on('close', () => {
    rlClosed = true;
  });
  rl.setPrompt('you> ');
  rl.prompt();
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
      if (!rlClosed) {
        rl.prompt();
      }
    }
  } finally {
    rl.close();
    socket.close();
  }
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

function parseEvent(raw: string): AgentEvent | undefined {
  try {
    return parseAgentEvent(JSON.parse(raw));
  } catch (error) {
    console.error(`[cli] invalid event: ${formatError(error)}`);
    return undefined;
  }
}

function renderEvent(event: AgentEvent): void {
  switch (event.type) {
    case 'session.created':
      console.log(`[session] created ${event.payload.sessionId}`);
      break;
    case 'session.attached':
      console.log(`[session] attached ${event.payload.sessionId}`);
      break;
    case 'user.message':
      console.log(`[user] ${event.payload.text}`);
      break;
    case 'turn.started':
      console.log(`[turn] started: ${event.payload.goal}`);
      break;
    case 'turn.completed':
      console.log('[turn] completed');
      break;
    case 'turn.interrupted':
      console.log('[turn] interrupted');
      break;
    case 'message.delta':
      process.stdout.write(event.payload.text);
      break;
    case 'message.completed':
      console.log(`[assistant] ${event.payload.content}`);
      break;
    case 'tool.started':
      console.log(`[tool] ${event.payload.tool} args=${JSON.stringify(event.payload.args)}`);
      break;
    case 'tool.finished':
      if (event.payload.error !== undefined) {
        console.log(`[tool] ${event.payload.tool} error=${event.payload.error}`);
      } else {
        console.log(`[tool] ${event.payload.tool} result=${JSON.stringify(event.payload.result)}`);
      }
      break;
    case 'approval.requested':
      console.log(`[approval] requested tool=${event.payload.tool}`);
      break;
    case 'approval.resolved':
      console.log(`[approval] ${event.payload.approved ? 'approved' : 'denied'}`);
      break;
    case 'error':
      console.log(
        `[error] ${event.payload.message}${event.payload.code ? ` (${event.payload.code})` : ''}`,
      );
      break;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error: unknown) => {
  console.error(`[cli] ${formatError(error)}`);
  process.exitCode = 1;
});
