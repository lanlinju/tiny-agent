import type { AgentEvent, JsonValue } from '../../src/protocols/events';
import { parseAgentEvent } from '../../src/protocols/events';

/** Parse and validate a raw server frame into an `AgentEvent`, or `undefined`. */
export function parseEvent(raw: string): AgentEvent | undefined {
  try {
    return parseAgentEvent(JSON.parse(raw));
  } catch (error) {
    console.error(`[cli] invalid event: ${formatError(error)}`);
    return undefined;
  }
}

/**
 * Plain, complete, prefixed one-liner for the transcript / replay.
 *
 * This is intentionally stable and uncolored: it is what gets written to a log
 * file, so it must never contain ANSI codes and must not hide events.
 */
export function formatEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'session.created':
      return `[session] created ${event.payload.sessionId}`;
    case 'session.attached':
      return `[session] attached ${event.payload.sessionId}`;
    case 'user.message':
      return `[user] ${event.payload.text}`;
    case 'turn.started':
      return `[turn] started: ${event.payload.goal}`;
    case 'turn.completed':
      return '[turn] completed';
    case 'turn.interrupted':
      return '[turn] interrupted';
    case 'message.delta':
      return event.payload.text;
    case 'message.completed':
      return `[assistant] ${event.payload.content}`;
    case 'tool.started':
      return `[tool] ${event.payload.tool} args=${JSON.stringify(event.payload.args)}`;
    case 'tool.finished':
      return event.payload.error !== undefined
        ? `[tool] ${event.payload.tool} error=${event.payload.error}`
        : `[tool] ${event.payload.tool} result=${JSON.stringify(event.payload.result)}`;
    case 'approval.requested':
      return `[approval] requested tool=${event.payload.tool}`;
    case 'approval.resolved':
      return `[approval] ${event.payload.approved ? 'approved' : 'denied'}`;
    case 'error':
      return `[error] ${event.payload.message}${event.payload.code ? ` (${event.payload.code})` : ''}`;
  }
}

/** Print one event as a plain prefixed line (used by the replay command). */
export function renderEvent(event: AgentEvent): void {
  if (event.type === 'message.delta') {
    process.stdout.write(event.payload.text);
    return;
  }
  console.log(formatEvent(event));
}

export type LineKind =
  | 'user'
  | 'assistant'
  | 'tool'
  | 'tool-result'
  | 'lifecycle'
  | 'error'
  | 'delta';

export interface RenderLine {
  readonly kind: LineKind;
  readonly text: string;
}

export interface RenderOptions {
  /** Show lifecycle events and full tool arguments. */
  readonly verbose: boolean;
  /** Maximum result body lines to show before truncating. */
  readonly maxOutputLines: number;
}

/**
 * Terminal-oriented presentation. Returns structured lines (no ANSI); the caller
 * applies color and layout. Noisy internal events are dropped unless verbose.
 */
export function presentEvent(event: AgentEvent, options: RenderOptions): RenderLine[] {
  switch (event.type) {
    case 'session.created':
      return options.verbose
        ? [{ kind: 'lifecycle', text: `· session created ${event.payload.sessionId}` }]
        : [];
    case 'session.attached':
      return options.verbose
        ? [{ kind: 'lifecycle', text: `· session attached ${event.payload.sessionId}` }]
        : [];
    case 'user.message':
      return [{ kind: 'user', text: `you> ${event.payload.text}` }];
    case 'turn.started':
      return options.verbose ? [{ kind: 'lifecycle', text: '· turn started' }] : [];
    case 'turn.completed':
      return options.verbose ? [{ kind: 'lifecycle', text: '· turn completed' }] : [];
    case 'turn.interrupted':
      return [{ kind: 'lifecycle', text: '· turn interrupted' }];
    case 'message.delta':
      return [{ kind: 'delta', text: event.payload.text }];
    case 'message.completed': {
      const content = event.payload.content.replace(/\n+$/, '');
      if (content === '') {
        return [];
      }
      return splitLines(content).map((line) => ({ kind: 'assistant' as const, text: line }));
    }
    case 'tool.started': {
      const lines: RenderLine[] = [
        {
          kind: 'tool',
          text: `  ⚙ ${event.payload.tool}: ${summarizeToolArgs(event.payload.tool, event.payload.args)}`,
        },
      ];
      if (options.verbose) {
        lines.push({ kind: 'tool', text: `    args=${compact(event.payload.args)}` });
      }
      return lines;
    }
    case 'tool.finished': {
      const isError = event.payload.error !== undefined;
      const described = describeToolResult(event.payload.tool, event.payload.result);
      const summary = isError ? `error: ${event.payload.error}` : described.summary;
      const body = isError ? [] : truncateLines(described.body, options.maxOutputLines);
      const lines: RenderLine[] = [{ kind: 'tool-result', text: `    ↳ ${summary}` }];
      for (const line of body) {
        lines.push({ kind: 'tool-result', text: `    ${line}` });
      }
      if (options.verbose && !isError && event.payload.result !== undefined) {
        lines.push({ kind: 'tool-result', text: `    result=${compact(event.payload.result)}` });
      }
      return lines;
    }
    case 'approval.requested':
      return [{ kind: 'lifecycle', text: `· approval requested: ${event.payload.tool}` }];
    case 'approval.resolved':
      return [{ kind: 'lifecycle', text: `· approval ${event.payload.approved ? 'approved' : 'denied'}` }];
    case 'error':
      return [
        {
          kind: 'error',
          text: `  ✗ ${event.payload.message}${event.payload.code ? ` (${event.payload.code})` : ''}`,
        },
      ];
  }
}

const ANSI_CODES: Partial<Record<LineKind, string>> = {
  user: '1;36',
  tool: '33',
  'tool-result': '2',
  lifecycle: '2',
  error: '31',
};

/** Wrap text in an ANSI color for the given line kind, when enabled. */
export function colorize(kind: LineKind, text: string, enabled: boolean): string {
  if (!enabled) {
    return text;
  }
  const code = ANSI_CODES[kind];
  return code === undefined ? text : `\x1b[${code}m${text}\x1b[0m`;
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Tracks messages typed in this CLI so their server echo is not rendered twice.
 *
 * The terminal already echoes typed input, but the server also broadcasts the
 * resulting `user.message` to every session subscriber, including us. Messages
 * from other clients (Web, another CLI) are not tracked, so they still render.
 */
export function createLocalEchoTracker(): {
  remember(text: string): void;
  consume(text: string): boolean;
} {
  const pending: string[] = [];
  return {
    remember(text) {
      pending.push(text);
    },
    consume(text) {
      const index = pending.indexOf(text);
      if (index === -1) {
        return false;
      }
      pending.splice(index, 1);
      return true;
    },
  };
}

function summarizeToolArgs(tool: string, args: JsonValue): string {
  const record = asRecord(args);
  if (record) {
    if (tool === 'shell' && typeof record.command === 'string') {
      return record.command;
    }
    if ((tool === 'read' || tool === 'write' || tool === 'edit') && typeof record.path === 'string') {
      return record.path;
    }
    if (typeof record.path === 'string' && Object.keys(record).length === 1) {
      return record.path;
    }
  }
  return compact(args);
}

function describeToolResult(
  tool: string,
  result: JsonValue | undefined,
): { summary: string; body: string[] } {
  const record = asRecord(result);
  if (!record) {
    return { summary: result === undefined ? 'ok' : compact(result), body: [] };
  }

  if (typeof record.error === 'string') {
    return { summary: `error: ${record.error}`, body: [] };
  }

  if (tool === 'shell') {
    const exitCode = typeof record.exitCode === 'number' ? record.exitCode : '?';
    const timedOut = record.timedOut === true ? ' (timed out)' : '';
    const body: string[] = [];
    if (typeof record.stdout === 'string' && record.stdout !== '') {
      body.push(...splitLines(record.stdout));
    }
    if (typeof record.stderr === 'string' && record.stderr !== '') {
      body.push(...splitLines(record.stderr));
    }
    return { summary: `exit ${exitCode}${timedOut}`, body };
  }

  if (tool === 'read') {
    const total = typeof record.totalLines === 'number' ? record.totalLines : undefined;
    const content = typeof record.content === 'string' ? record.content : '';
    return {
      summary: total === undefined ? `${content.length} chars` : `${total} lines`,
      body: splitLines(content),
    };
  }

  if (tool === 'write') {
    const created = record.created === true;
    const bytes = typeof record.bytes === 'number' ? ` · ${record.bytes} bytes` : '';
    return { summary: `${created ? 'created' : 'updated'}${bytes}`, body: [] };
  }

  if (tool === 'edit') {
    const replacements = typeof record.replacements === 'number' ? record.replacements : 1;
    return { summary: `${replacements} replacement${replacements === 1 ? '' : 's'}`, body: [] };
  }

  return { summary: compact(result), body: [] };
}

function asRecord(value: JsonValue | undefined): { readonly [key: string]: JsonValue } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value;
}

function compact(value: JsonValue | undefined): string {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

function splitLines(text: string): string[] {
  const normalized = text.replace(/\n+$/, '');
  return normalized === '' ? [] : normalized.split('\n');
}

function truncateLines(lines: string[], max: number): string[] {
  if (max <= 0 || lines.length <= max) {
    return lines;
  }
  return [...lines.slice(0, max), `… +${lines.length - max} more lines`];
}
