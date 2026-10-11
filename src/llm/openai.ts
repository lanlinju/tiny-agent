import { z } from 'zod';
import type {
  AssistantMessage,
  ChatDeltaHandler,
  LLMProvider,
  Message,
  ToolCall,
} from './provider';

export interface OpenAICompatibleOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly temperature?: number;
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

const OpenAICompatibleToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

const ChatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z.array(OpenAICompatibleToolCallSchema).optional(),
        }),
      }),
    )
    .min(1),
});

const StreamChunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullable().optional(),
            tool_calls: z
              .array(
                z.object({
                  index: z.number().int().nonnegative(),
                  id: z.string().optional(),
                  type: z.string().optional(),
                  function: z
                    .object({
                      name: z.string().optional(),
                      arguments: z.string().optional(),
                    })
                    .optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

interface OpenAIMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | null;
  readonly tool_calls?: readonly ToolCall[];
  readonly tool_call_id?: string;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  args: string;
}

/**
 * OpenAI-compatible chat provider (OpenAI, DeepSeek, and other compatible APIs).
 *
 * This is the only place that knows the wire format. When `onDelta` is present
 * it uses the upstream SSE stream (`stream: true`) and forwards text
 * incrementally; otherwise it uses a single non-streaming response.
 */
export function createOpenAICompatibleLLM(options: OpenAICompatibleOptions): LLMProvider {
  const baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return {
    async chat(request) {
      const body: Record<string, unknown> = {
        model: options.model,
        messages: request.messages.map(toOpenAIMessage),
      };

      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools;
        body.tool_choice = 'auto';
      }
      if (options.temperature !== undefined) {
        body.temperature = options.temperature;
      }

      const streaming = request.onDelta !== undefined;
      if (streaming) {
        body.stream = true;
      }

      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(
          `LLM request failed (${response.status} ${response.statusText}): ${truncate(detail)}`,
        );
      }

      if (streaming && request.onDelta) {
        return readStreamingCompletion(response, request.onDelta);
      }

      return parseChatCompletion(await response.json());
    },
  };
}

function toOpenAIMessage(message: Message): OpenAIMessage {
  switch (message.role) {
    case 'tool':
      return {
        role: 'tool',
        content: message.content,
        tool_call_id: message.toolCallId ?? '',
      };
    case 'assistant':
      if (message.toolCalls && message.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: message.content === '' ? null : message.content,
          tool_calls: message.toolCalls,
        };
      }
      return { role: 'assistant', content: message.content };
    case 'system':
    case 'user':
      return { role: message.role, content: message.content };
  }
}

function parseChatCompletion(json: unknown): AssistantMessage {
  const { choices } = ChatCompletionSchema.parse(json);
  const [choice] = choices;
  if (!choice) {
    throw new Error('LLM response contained no choices');
  }

  return {
    role: 'assistant',
    content: choice.message.content ?? '',
    toolCalls: choice.message.tool_calls ?? [],
  };
}

/** Read an OpenAI-compatible SSE stream, forwarding text deltas as they arrive. */
async function readStreamingCompletion(
  response: Response,
  onDelta: ChatDeltaHandler,
): Promise<AssistantMessage> {
  const body = response.body;
  if (!body) {
    throw new Error('LLM streaming response had no body');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const toolCalls = new Map<number, ToolCallAccumulator>();
  let buffer = '';
  let content = '';

  const consume = async (line: string): Promise<void> => {
    const text = handleStreamLine(line, toolCalls);
    if (text !== undefined && text !== '') {
      content += text;
      await onDelta(text);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
      buffer = buffer.slice(newlineIndex + 1);
      await consume(line);
    }
  }
  if (buffer !== '') {
    await consume(buffer.replace(/\r$/, ''));
  }

  return {
    role: 'assistant',
    content,
    toolCalls: buildToolCalls(toolCalls),
  };
}

function handleStreamLine(
  line: string,
  toolCalls: Map<number, ToolCallAccumulator>,
): string | undefined {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith(':')) {
    return undefined; // blank line or SSE comment/keepalive
  }
  if (!trimmed.startsWith('data:')) {
    return undefined;
  }

  const payload = trimmed.slice('data:'.length).trim();
  if (payload === '' || payload === '[DONE]') {
    return undefined;
  }

  const { choices } = StreamChunkSchema.parse(JSON.parse(payload));
  const delta = choices?.[0]?.delta;
  if (!delta) {
    return undefined;
  }

  for (const fragment of delta.tool_calls ?? []) {
    const current = toolCalls.get(fragment.index) ?? { id: '', name: '', args: '' };
    if (fragment.id !== undefined) {
      current.id = fragment.id;
    }
    if (fragment.function?.name !== undefined) {
      current.name = fragment.function.name;
    }
    if (fragment.function?.arguments !== undefined) {
      current.args += fragment.function.arguments;
    }
    toolCalls.set(fragment.index, current);
  }

  return delta.content ?? undefined;
}

function buildToolCalls(toolCalls: Map<number, ToolCallAccumulator>): ToolCall[] {
  return [...toolCalls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, call]) => ({
      id: call.id === '' ? `tool-call-${index}` : call.id,
      type: 'function',
      function: {
        name: call.name,
        arguments: call.args === '' ? '{}' : call.args,
      },
    }));
}

function truncate(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
