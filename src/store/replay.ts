import type { AgentEvent } from '../protocols/events';
import type { SessionStore } from './session-store';

/**
 * Session replay, owned by the `store` layer.
 *
 * Replay is a purely passive read: it validates history through the store and
 * never re-runs the LLM, re-executes tools, or appends new events.
 */

/** Control events that describe plumbing, not the reasoning chain. */
const CONTROL_EVENT_TYPES = new Set<AgentEvent['type']>(['session.created', 'session.attached']);

/**
 * Select the reasoning history to replay from an ordered event list.
 *
 * `since` is an index into the raw stored events (matching `replayFrom`), so it
 * stays stable even as later events are appended.
 */
export function selectReplayEvents(
  events: readonly AgentEvent[],
  since = 0,
): AgentEvent[] {
  return events
    .slice(since)
    .filter((event) => !CONTROL_EVENT_TYPES.has(event.type));
}

/** Read and select a session's reasoning history for replay. */
export async function replaySession(
  store: SessionStore,
  sessionId: string,
  since = 0,
): Promise<AgentEvent[]> {
  return selectReplayEvents(await store.read(sessionId), since);
}
