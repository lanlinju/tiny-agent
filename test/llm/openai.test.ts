import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOpenAICompatibleLLM } from '../../src/llm/openai';
import type { Message } from '../../src/llm/provider';

interface WireBody {
  readonly model: string;
  readonly messages: Array<Record<string, unknown>>;
  readonly tool_choice?: string;
}

test('sends OpenAI-compatible payload and parses tool calls', async () => {
  let url = '';
  let body: WireBody | undefined;
  let authorization = '';

  const fetchImpl: typeof fetch = async (input, init) => {
    url = String(input);
    body = JSON.parse(String(init?.body)) as WireBody;
    authorization = String((init?.headers as Record<string, string> | undefined)?.authorization);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: 'call-1', type: 'function', function: { name: 'time', arguments: '{}' } },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const llm = createOpenAICompatibleLLM({
    apiKey: 'test-key',
    model: 'deepseek-chat',
    baseUrl: 'https://api.example.com/v1/',
    fetchImpl,
  });

  const messages: Message[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ];
  const reply = await llm.chat({
    messages,
    tools: [
      {
        type: 'function',
        function: { name: 'time', description: 'now', parameters: { type: 'object' } },
      },
    ],
  });

  assert.equal(reply.role, 'assistant');
  assert.equal(reply.content, '');
  assert.equal(reply.toolCalls.length, 1);
  assert.equal(reply.toolCalls[0]?.function.name, 'time');

  assert.equal(url, 'https://api.example.com/v1/chat/completions');
  assert.equal(authorization, 'Bearer test-key');
  assert.ok(body);
  assert.equal(body.model, 'deepseek-chat');
  assert.equal(body.tool_choice, 'auto');
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ]);
});

test('maps assistant tool calls and tool results back to the wire format', async () => {
  let body: WireBody | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as WireBody;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'done' } }] }), {
      status: 200,
    });
  };

  const llm = createOpenAICompatibleLLM({ apiKey: 'k', model: 'm', fetchImpl });
  const reply = await llm.chat({
    messages: [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', type: 'function', function: { name: 'time', arguments: '{}' } }],
      },
      { role: 'tool', toolCallId: 'c1', content: '{"iso":"x"}' },
    ],
  });

  assert.equal(reply.content, 'done');
  assert.deepEqual(reply.toolCalls, []);
  assert.ok(body);
  assert.equal(body.messages[0]?.content, null);
  assert.equal(
    (body.messages[0]?.tool_calls as Array<{ id: string }> | undefined)?.[0]?.id,
    'c1',
  );
  assert.equal(body.messages[1]?.tool_call_id, 'c1');
});

test('throws with status and body when the API returns an error', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response('bad key', { status: 401, statusText: 'Unauthorized' });

  const llm = createOpenAICompatibleLLM({ apiKey: 'k', model: 'm', fetchImpl });
  await assert.rejects(
    () => llm.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    /401 Unauthorized.*bad key/,
  );
});
