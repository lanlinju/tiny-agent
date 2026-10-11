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

/**
 * Render one protocol event to the terminal.
 *
 * Shared by the live CLI and the replay command so both present the exact same
 * reasoning chain. Clients only render; they never derive business state.
 */
export function renderEvent(event: AgentEvent): void {
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

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
