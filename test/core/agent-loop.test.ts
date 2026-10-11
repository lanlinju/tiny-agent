import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runLoop } from '../../src/core/agent-loop';
import type { RunContext } from '../../src/core/types';
import type { AssistantMessage, Message } from '../../src/llm/provider';
import type { AnyToolDef } from '../../src/tools/registry';
import { createToolRegistry } from '../../src/tools/registry';
import type { AgentEvent } from '../../src/protocols/events';

const imageTool: AnyToolDef = {
  name: 'image',
  description: 'Return a fixed image block.',
  parameters: { type: 'object', properties: {} },
  fn: async () => ({
    type: 'image',
    path: '/tmp/x.png',
    mimeType: 'image/png',
    bytes: 3,
    resized: false,
    image: { type: 'image', data: 'QUJD', mimeType: 'image/png' },
  }),
};

test('tool image results reach the model as a user message and stay out of events', async () => {
  const events: AgentEvent[] = [];
  const seen: Message[][] = [];
  let calls = 0;

  const ctx: RunContext = {
    sessionId: 's',
    agentId: 'a',
    owner: 'local',
    cwd: process.cwd(),
    maxSteps: 4,
    reasoning: false,
    llm: {
      async chat({ messages }): Promise<AssistantMessage> {
        seen.push([...messages]);
        calls += 1;
        if (calls === 1) {
          return {
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'c1', type: 'function', function: { name: 'image', arguments: '{}' } },
            ],
          };
        }
        return { role: 'assistant', content: 'seen', toolCalls: [] };
      },
    },
    tools: createToolRegistry([imageTool]),
    systemPrompt: () => 'sys',
    history: () => [],
    shouldCompact: () => false,
    compact: async (messages) => messages,
    drainSteering: () => [],
    needsApproval: () => false,
    requestApproval: async () => true,
    emit: (event) => {
      events.push(event);
    },
    now: () => 0,
    nextId: (prefix) => `${prefix}-1`,
  };

  const answer = await runLoop(ctx, 'look at the image');
  assert.equal(answer, 'seen');

  const secondCall = seen[1] ?? [];
  const imageMessage = secondCall.find(
    (message) => message.role === 'user' && Array.isArray(message.content),
  );
  assert.ok(imageMessage, 'expected an image user message before the second LLM call');
  if (imageMessage && Array.isArray(imageMessage.content)) {
    assert.deepEqual(imageMessage.content, [
      { type: 'image', data: 'QUJD', mimeType: 'image/png' },
    ]);
  }

  const toolFinished = events.find((event) => event.type === 'tool.finished');
  assert.ok(toolFinished && toolFinished.type === 'tool.finished');
  if (toolFinished && toolFinished.type === 'tool.finished') {
    // Base64 must be stripped from the persisted event payload.
    assert.equal(JSON.stringify(toolFinished.payload).includes('QUJD'), false);
  }
});
