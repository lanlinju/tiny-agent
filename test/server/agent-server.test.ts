import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAgentServer } from '../../src/server/agent-server';
import type { AgentConnection, AgentServer } from '../../src/server/agent-server';
import { createMemorySessionStore } from '../../src/store/session-store';
import { createMockLLM } from '../../src/llm/mock';
import type { LLMProvider } from '../../src/llm/provider';
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

test('broadcasts streaming deltas but does not persist them', async () => {
  const streamingLlm: LLMProvider = {
    async chat({ onDelta }) {
      await onDelta?.('Hel');
      await onDelta?.('lo');
      return { role: 'assistant', content: 'Hello', toolCalls: [] };
    },
  };
  const store = createMemorySessionStore();
  const server = createAgentServer({
    llm: streamingLlm,
    tools: createToolRegistry([]),
    store,
    owner: 'test',
  });

  const connection = makeConnection();
  await server.handleRawCommand({ type: 'session.create', payload: {} }, connection);
  const sessionId = firstSessionId(connection.events);
  await server.handleRawCommand({ type: 'message.send', payload: { sessionId, text: 'hi' } }, connection);

  const deltaTexts: string[] = [];
  const deltaIds: string[] = [];
  let completedContent: string | undefined;
  for (const event of connection.events) {
    if (event.type === 'message.delta') {
      deltaTexts.push(event.payload.text);
      deltaIds.push(event.payload.messageId);
    }
    if (event.type === 'message.completed') {
      completedContent = event.payload.content;
    }
  }

  assert.deepEqual(deltaTexts, ['Hel', 'lo']);
  assert.equal(new Set(deltaIds).size, 1);
  assert.equal(completedContent, 'Hello');

  const stored = await store.read(sessionId);
  assert.equal(stored.some((event) => event.type === 'message.delta'), false);
  assert.ok(stored.some((event) => event.type === 'message.completed'));
});

test('injects steering messages before the next LLM call', async () => {
  const seenUserMessages: string[][] = [];
  const store = createMemorySessionStore();
  let server: AgentServer | undefined;
  let sessionId = '';
  let steered = false;

  const llm: LLMProvider = {
    async chat({ messages }) {
      seenUserMessages.push(
        messages.filter((message) => message.role === 'user').map((message) => message.content),
      );
      if (!steered) {
        steered = true;
        // A user steers while the run is in flight.
        await server?.handleRawCommand(
          { type: 'steer', payload: { sessionId, text: 'also add tests' } },
          makeConnection(),
        );
        return { role: 'assistant', content: 'working', toolCalls: [] };
      }
      return { role: 'assistant', content: 'done', toolCalls: [] };
    },
  };

  server = createAgentServer({ llm, tools: createToolRegistry([]), store, owner: 'test' });
  const connection = makeConnection();
  await server.handleRawCommand({ type: 'session.create', payload: {} }, connection);
  sessionId = firstSessionId(connection.events);
  await server.handleRawCommand(
    { type: 'message.send', payload: { sessionId, text: 'do the task' } },
    connection,
  );

  // Two LLM calls: the first turn, then the steering-forced continuation.
  assert.deepEqual(seenUserMessages[0], ['do the task']);
  assert.deepEqual(seenUserMessages[1], ['do the task', 'also add tests']);

  assert.ok(
    connection.events.some(
      (event) => event.type === 'user.message' && event.payload.text === 'also add tests',
    ),
  );
  assert.ok(connection.events.some((event) => event.type === 'queue_update'));

  const stored = await store.read(sessionId);
  assert.equal(stored.some((event) => event.type === 'queue_update'), false);
  assert.ok(stored.some((event) => event.type === 'user.message'));
});

test('queues a steer sent immediately after a message', async () => {
  let chatCount = 0;
  const llm: LLMProvider = {
    async chat() {
      chatCount += 1;
      return { role: 'assistant', content: 'ok', toolCalls: [] };
    },
  };
  const server = createAgentServer({
    llm,
    tools: createToolRegistry([]),
    store: createMemorySessionStore(),
    owner: 'test',
  });
  const connection = makeConnection();
  await server.handleRawCommand({ type: 'session.create', payload: {} }, connection);
  const sessionId = firstSessionId(connection.events);

  // Do not await the send: the steer must already be seen as running.
  const sending = server.handleRawCommand(
    { type: 'message.send', payload: { sessionId, text: 'one' } },
    connection,
  );
  await server.handleRawCommand(
    { type: 'steer', payload: { sessionId, text: 'two' } },
    connection,
  );
  await sending;

  assert.equal(chatCount, 2);
  assert.ok(
    connection.events.some(
      (event) => event.type === 'queue_update' && event.payload.steering.length === 1,
    ),
  );
});

test('thinking mode streams reasoning on a separate channel', async () => {
  let sawReasoningFlag = false;
  const llm: LLMProvider = {
    async chat({ reasoning, onDelta, onReasoningDelta }) {
      sawReasoningFlag = reasoning === true;
      await onReasoningDelta?.('plan ');
      await onReasoningDelta?.('carefully');
      await onDelta?.('answer');
      return { role: 'assistant', content: 'answer', toolCalls: [] };
    },
  };
  const store = createMemorySessionStore();
  const server = createAgentServer({ llm, tools: createToolRegistry([]), store, owner: 'test' });
  const connection = makeConnection();
  await server.handleRawCommand({ type: 'session.create', payload: {} }, connection);
  const sessionId = firstSessionId(connection.events);
  await server.handleRawCommand(
    { type: 'message.send', payload: { sessionId, text: 'hi', thinking: true } },
    connection,
  );

  assert.equal(sawReasoningFlag, true);

  const reasoningDeltas: string[] = [];
  const contentDeltas: string[] = [];
  for (const event of connection.events) {
    if (event.type === 'message.delta') {
      if (event.payload.channel === 'reasoning') {
        reasoningDeltas.push(event.payload.text);
      } else {
        contentDeltas.push(event.payload.text);
      }
    }
  }
  assert.deepEqual(reasoningDeltas, ['plan ', 'carefully']);
  assert.deepEqual(contentDeltas, ['answer']);

  const stored = await store.read(sessionId);
  assert.equal(stored.some((event) => event.type === 'message.delta'), false);
});

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

test('attach replays persisted history to the attaching connection only', async () => {
  const server = createTestServer();
  const a = makeConnection();

  await server.handleRawCommand({ type: 'session.create', payload: {} }, a);
  const sessionId = firstSessionId(a.events);
  await server.handleRawCommand({ type: 'message.send', payload: { sessionId, text: 'first' } }, a);
  const aTurnCount = a.events.filter((event) => event.type === 'turn.completed').length;

  const b = makeConnection();
  await server.handleRawCommand({ type: 'session.attach', payload: { sessionId } }, b);

  // B receives the replayed reasoning chain, without control events.
  assert.ok(b.events.some((event) => event.type === 'user.message' && event.payload.text === 'first'));
  assert.ok(b.events.some((event) => event.type === 'tool.finished'));
  assert.ok(b.events.some((event) => event.type === 'turn.completed'));
  assert.equal(b.events.some((event) => event.type === 'session.created'), false);
  // The attach boundary is the last event B receives.
  assert.equal(b.events[b.events.length - 1]?.type, 'session.attached');
  // A must not receive duplicated history.
  assert.equal(a.events.filter((event) => event.type === 'turn.completed').length, aTurnCount);
});
