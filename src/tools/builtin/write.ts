import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { ToolDef } from '../types';

const WriteArgsSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

type WriteArgs = z.infer<typeof WriteArgsSchema>;

type WriteResult = {
  readonly path: string;
  readonly bytes: number;
  readonly created: boolean;
};

/** Write UTF-8 content, creating parent directories. No approval policy here. */
export const writeTool: ToolDef<WriteArgs, WriteResult> = {
  name: 'write',
  description: 'Write UTF-8 content to a file, creating parent directories as needed.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, absolute or relative to the working directory.' },
      content: { type: 'string', description: 'Full file content to write.' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  fn: async (args, ctx) => {
    const parsed = WriteArgsSchema.parse(args);
    const path = resolve(ctx.cwd, parsed.path);
    const existed = await exists(path);

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, parsed.content, 'utf8');

    return {
      path,
      bytes: Buffer.byteLength(parsed.content, 'utf8'),
      created: !existed,
    };
  },
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
