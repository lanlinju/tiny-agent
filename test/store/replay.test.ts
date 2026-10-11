import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemorySessionStore } from '../../src/store/session-store';
import { replaySession, selectReplayEvents } from '../../src/store/replay';
import type { AgentEvent } from '../../src/protocols/events';
import { parseAgentEvent } from '../../src/protocols/events';

function makeEvent(type: string, payload: unknown): AgentEvent {
  return parseAgentEvent({ type, sessionId: 's1', ts: 0, agentId: 'a', owner: 'o', payload });
}

function sampleHistory(): AgentEvent[] {
  return [
    makeEvent('session.created', { sessionId: 's1' }),
    makeEvent('session.attached', { sessionId: 's1' }),
    makeEvent('user.message', { text: 'hi' }),
    makeEvent('turn.started', { goal: 'hi' }),
    makeEvent('turn.completed', { answer: 'done' }),
  ];
}

test('selectReplayEvents drops control events and honors since', () => {
  const events = sampleHistory();
  assert.deepEqual(
    selectReplayEvents(events).map((event) => event.type),
    ['user.message', 'turn.started', 'turn.completed'],
  );
  assert.deepEqual(
    selectReplayEvents(events, 2).map((event) => event.type),
    ['user.message', 'turn.started', 'turn.completed'],
  );
  assert.deepEqual(selectReplayEvents(events, 3).map((event) => event.type), [
    'turn.started',
    'turn.completed',
  ]);
});

test('replaySession reads, validates and does not mutate the store', async () => {
  const store = createMemorySessionStore();
  for (const event of sampleHistory()) {
    await store.append(event);
  }

  const replayed = await replaySession(store, 's1');
  assert.deepEqual(
    replayed.map((event) => event.type),
    ['user.message', 'turn.started', 'turn.completed'],
  );

  const stored = await store.read('s1');
  assert.equal(stored.length, 5);
  assert.deepEqual(await replaySession(store, 'missing'), []);
});
