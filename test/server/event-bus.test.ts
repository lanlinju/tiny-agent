import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEventBus } from '../../src/server/event-bus';
import type { AgentEvent } from '../../src/protocols/events';

function eventFor(sessionId: string): AgentEvent {
  return {
    type: 'turn.completed',
    sessionId,
    ts: 0,
    agentId: 'agent-1',
    owner: 'test',
    payload: { answer: 'done' },
  };
}

test('event bus delivers only to listeners of the matching session', () => {
  const bus = createEventBus();
  const received: string[] = [];
  const unsubscribe = bus.subscribe('s1', (event) => {
    received.push(`${event.sessionId}:${event.type}`);
  });

  bus.publish(eventFor('s1'));
  bus.publish(eventFor('s2'));
  assert.deepEqual(received, ['s1:turn.completed']);

  unsubscribe();
  bus.publish(eventFor('s1'));
  assert.deepEqual(received, ['s1:turn.completed']);
});
