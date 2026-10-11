import type { AgentEvent, JsonValue } from '../protocols/events';
import type { LLMProvider, Message } from '../llm/provider';
import type { ToolRegistry } from '../tools/registry';

/** Approval request emitted by core and resolved by an outer layer. */
export interface ApprovalRequest {
  readonly tool: string;
  readonly args: JsonValue;
}

/** Runtime context injected into the agent loop. */
export interface RunContext {
  readonly sessionId: string;
  readonly agentId: string;
  readonly owner: string;
  readonly cwd: string;
  readonly maxSteps: number;
  readonly llm: LLMProvider;
  readonly tools: ToolRegistry;
  readonly systemPrompt: () => string;
  readonly history: () => readonly Message[];
  readonly shouldCompact: (messages: readonly Message[]) => boolean;
  readonly compact: (messages: readonly Message[]) => Promise<readonly Message[]>;
  /** Remove and return steering messages queued since the last drain. */
  readonly drainSteering: () => readonly string[];
  readonly needsApproval: (tool: string) => boolean;
  readonly requestApproval: (request: ApprovalRequest) => Promise<boolean>;
  readonly emit: (event: AgentEvent) => void | Promise<void>;
  readonly now: () => number;
  readonly nextId: (prefix: string) => string;
}
