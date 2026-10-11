import { z } from 'zod';
import type { AssistantMessage, LLMProvider, Message, ToolCall } from './provider';

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

interface OpenAIMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | null;
  readonly tool_calls?: readonly ToolCall[];
  readonly tool_call_id?: string;
}

/**
 * OpenAI-compatible chat provider (OpenAI, DeepSeek, and other compatible APIs).
 *
 * This is the only place that knows the wire format. It converts the core
 * `Message`/`ToolCall` model to and from the HTTP JSON shape, so `core` never
 * learns about `chat/completions` or `tool_calls`.
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
        throw new Error(`LLM request failed (${response.status} ${response.statusText}): ${truncate(detail)}`);
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

function truncate(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
