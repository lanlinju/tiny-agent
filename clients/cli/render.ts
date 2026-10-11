import type { AgentEvent } from '../../src/protocols/events';
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

/** Format one protocol event as a single human-readable line. */
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

/**
 * Render one protocol event to the terminal.
 *
 * Shared by the live CLI and the replay command so both present the exact same
 * reasoning chain. Clients only render; they never derive business state.
 */
export function renderEvent(event: AgentEvent): void {
  if (event.type === 'message.delta') {
    process.stdout.write(event.payload.text);
    return;
  }
  console.log(formatEvent(event));
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
