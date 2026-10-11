import type { AgentEvent } from '../protocols/events';

export type EventListener = (event: AgentEvent) => void;

/**
 * In-process, session-scoped fan-out for server events.
 *
 * Events are delivered only to listeners subscribed to the event's session
 * (plus optional global listeners). This is what lets the CLI and Web client
 * share one session without receiving other sessions' traffic.
 */
export interface EventBus {
  publish(event: AgentEvent): void;
  subscribe(sessionId: string, listener: EventListener): () => void;
  subscribeAll(listener: EventListener): () => void;
}

export function createEventBus(): EventBus {
  const globalListeners = new Set<EventListener>();
  const bySession = new Map<string, Set<EventListener>>();

  return {
    publish(event) {
      for (const listener of globalListeners) {
        listener(event);
      }
      const listeners = bySession.get(event.sessionId);
      if (!listeners) {
        return;
      }
      for (const listener of listeners) {
        listener(event);
      }
    },

    subscribe(sessionId, listener) {
      let listeners = bySession.get(sessionId);
      if (!listeners) {
        listeners = new Set();
        bySession.set(sessionId, listeners);
      }
      listeners.add(listener);
      return () => {
        listeners?.delete(listener);
        if (listeners && listeners.size === 0) {
          bySession.delete(sessionId);
        }
      };
    },

    subscribeAll(listener) {
      globalListeners.add(listener);
      return () => {
        globalListeners.delete(listener);
      };
    },
  };
}
