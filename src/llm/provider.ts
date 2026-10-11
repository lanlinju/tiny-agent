import type { JsonValue } from '../protocols/events';

/** Role used by messages exchanged with an LLM provider. */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** JSON Schema object sent to LLM-compatible tool calling APIs. */
export type JsonSchema = { readonly [key: string]: JsonValue };

/** Function tool schema exposed to an LLM provider. */
export interface ToolSchema {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: JsonSchema;
  };
}

/** Tool call requested by an assistant message. */
export interface ToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

/** Message representation used inside the core loop. */
export interface Message {
  readonly role: MessageRole;
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly ToolCall[];
}

/** Assistant message returned by an LLM provider. */
export interface AssistantMessage extends Message {
  readonly role: 'assistant';
  readonly toolCalls: readonly ToolCall[];
  /** Reasoning/thinking text, when the provider exposes it. */
  readonly reasoning?: string;
}

/** Incremental assistant text callback used by streaming providers. */
export type ChatDeltaHandler = (text: string) => void | Promise<void>;

/** Request passed to a provider's `chat`. */
export interface ChatRequest {
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolSchema[];
  /** When provided, the provider may stream assistant text incrementally. */
  readonly onDelta?: ChatDeltaHandler;
  /** When provided, the provider may stream reasoning/thinking text. */
  readonly onReasoningDelta?: ChatDeltaHandler;
  /** Ask the provider to use its reasoning model. */
  readonly reasoning?: boolean;
}

/** Replaceable LLM provider boundary. */
export interface LLMProvider {
  chat(req: ChatRequest): Promise<AssistantMessage>;
}
