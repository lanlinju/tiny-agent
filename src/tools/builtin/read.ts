import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ToolDef } from '../types';

const ReadArgsSchema = z.object({
  path: z.string().min(1),
  offset: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).optional(),
});

type ReadArgs = z.infer<typeof ReadArgsSchema>;

type ReadResult = {
  readonly path: string;
  readonly content: string;
  readonly totalLines: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly truncated: boolean;
};

/** Read UTF-8 text, optionally sliced by 1-based line window. No approval policy here. */
export const readTool: ToolDef<ReadArgs, ReadResult> = {
  name: 'read',
  description: 'Read a UTF-8 text file, optionally sliced by 1-based line offset and limit.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, absolute or relative to the working directory.' },
      offset: { type: 'integer', description: '1-based first line to return.', minimum: 1 },
      limit: { type: 'integer', description: 'Maximum number of lines to return.', minimum: 1 },
    },
    required: ['path'],
    additionalProperties: false,
  },
  fn: async (args, ctx) => {
    const parsed = ReadArgsSchema.parse(args);
    const path = resolve(ctx.cwd, parsed.path);
    const content = await readFile(path, 'utf8');
    const lines = content.split('\n');

    const startIndex = Math.max(0, (parsed.offset ?? 1) - 1);
    const endIndex =
      parsed.limit === undefined ? lines.length : Math.min(lines.length, startIndex + parsed.limit);

    return {
      path,
      content: lines.slice(startIndex, endIndex).join('\n'),
      totalLines: lines.length,
      startLine: startIndex + 1,
      endLine: endIndex,
      truncated: startIndex > 0 || endIndex < lines.length,
    };
  },
};
