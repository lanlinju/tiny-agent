import type { AgentEvent } from '../protocols/events';

export type EventListener = (event: AgentEvent) => void;

/**
 * In-process fan-out for server events.
 *
 * The bus is transport-agnostic: WebSocket handlers and future clients
 * subscribe, while core-driven server logic only publishes.
 */
export interface EventBus {
  publish(event: AgentEvent): void;
  subscribe(listener: EventListener): () => void;
}

export function createEventBus(): EventBus {
  const listeners = new Set<EventListener>();

  return {
    publish(event) {
      for (const listener of listeners) {
        listener(event);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
