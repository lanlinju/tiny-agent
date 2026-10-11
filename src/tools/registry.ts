import type { JsonValue } from '../protocols/events';
import type { ToolSchema } from '../llm/provider';
import type { ToolContext, ToolDef } from './types';

/**
 * Heterogeneous tool definition accepted by the registry.
 *
 * `ToolDef` is contravariant in its argument type, so a registry holding many
 * tools cannot use `ToolDef<unknown>`; it must widen the argument position.
 */
export type AnyToolDef = ToolDef<any, JsonValue>;

/** Registry used by core to list schemas and invoke tools by name. */
export interface ToolRegistry {
  readonly schemas: () => readonly ToolSchema[];
  readonly call: (name: string, args: JsonValue, ctx: ToolContext) => Promise<JsonValue>;
}

/** Create an immutable tool registry from tool definitions. */
export function createToolRegistry(tools: readonly AnyToolDef[]): ToolRegistry {
  const byName = new Map<string, AnyToolDef>();

  for (const tool of tools) {
    if (byName.has(tool.name)) {
      throw new Error(`Duplicate tool registered: ${tool.name}`);
    }
    byName.set(tool.name, tool);
  }

  return {
    schemas: () => tools.map(toToolSchema),
    call: async (name, args, ctx) => {
      const tool = byName.get(name);
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }
      return tool.fn(args, ctx);
    },
  };
}

function toToolSchema(tool: AnyToolDef): ToolSchema {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
