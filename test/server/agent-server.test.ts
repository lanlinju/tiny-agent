import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAgentServer } from '../../src/server/agent-server';
import type { AgentConnection } from '../../src/server/agent-server';
import { createMemorySessionStore } from '../../src/store/session-store';
import { createMockLLM } from '../../src/llm/mock';
import { createToolRegistry } from '../../src/tools/registry';
import { timeTool } from '../../src/tools/builtin/time';
import type { AgentEvent } from '../../src/protocols/events';

type FakeConnection = AgentConnection & { readonly events: AgentEvent[] };

function makeConnection(): FakeConnection {
  const events: AgentEvent[] = [];
  return {
    events,
    send(event) {
      events.push(event);
    },
  };
}

function firstSessionId(events: readonly AgentEvent[]): string {
  for (const event of events) {
    if (event.type === 'session.created') {
      return event.payload.sessionId;
    }
  }
  throw new Error('no session.created event received');
}

function createTestServer() {
  return createAgentServer({
    llm: createMockLLM(),
    tools: createToolRegistry([timeTool]),
    store: createMemorySessionStore(),
    owner: 'test',
  });
}

test('routes events only to connections subscribed to the session', async () => {
  const server = createTestServer();
  const a = makeConnection();
  const b = makeConnection();
  const c = makeConnection();

  await server.handleRawCommand({ type: 'session.create', payload: {} }, a);
  const sessionId = firstSessionId(a.events);

  await server.handleRawCommand({ type: 'session.attach', payload: { sessionId } }, b);
  await server.handleRawCommand({ type: 'message.send', payload: { sessionId, text: 'hi' } }, a);

  // A and B share the session and both see the full reasoning chain.
  for (const connection of [a, b]) {
    assert.ok(connection.events.some((event) => event.type === 'tool.finished'));
    assert.ok(connection.events.some((event) => event.type === 'turn.completed'));
  }

  // C has its own session and must not receive A/B traffic.
  await server.handleRawCommand({ type: 'session.create', payload: {} }, c);
  assert.equal(c.events.filter((event) => event.type === 'session.created').length, 1);
  assert.equal(c.events.some((event) => event.type === 'user.message'), false);
  assert.equal(a.events.filter((event) => event.type === 'session.created').length, 1);

  // After removal, B stops receiving events for the shared session.
  server.removeConnection(b);
  await server.handleRawCommand({ type: 'message.send', payload: { sessionId, text: 'again' } }, a);
  assert.equal(
    b.events.some((event) => event.type === 'user.message' && event.payload.text === 'again'),
    false,
  );
});

test('reports invalid commands directly to the offending connection', async () => {
  const server = createTestServer();
  const connection = makeConnection();

  await server.handleRawCommand({ type: 'not-a-command' }, connection);

  const error = connection.events.find((event) => event.type === 'error');
  assert.ok(error);
  if (error.type !== 'error') {
    throw new Error('expected an error event');
  }
  assert.equal(error.payload.code, 'invalid_command');
});
