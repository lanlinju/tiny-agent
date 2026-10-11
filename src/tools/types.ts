import type { JsonValue } from '../protocols/events';
import type { JsonSchema } from '../llm/provider';

/** Context available to a tool execution. */
export interface ToolContext {
  readonly now: () => number;
  /** Working directory used to resolve relative paths and shell commands. */
  readonly cwd: string;
}

/** Tool definition registered in the tool registry. */
export interface ToolDef<A = unknown, R extends JsonValue = JsonValue> {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly fn: (args: A, ctx: ToolContext) => Promise<R>;
}
