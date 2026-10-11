import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ToolDef } from '../types';

const EditArgsSchema = z.object({
  path: z.string().min(1),
  oldText: z.string().min(1),
  newText: z.string(),
  replaceAll: z.boolean().optional(),
});

type EditArgs = z.infer<typeof EditArgsSchema>;

type EditResult = {
  readonly path: string;
  readonly replacements: number;
};

/** Replace text in a file, requiring a unique match unless `replaceAll` is set. */
export const editTool: ToolDef<EditArgs, EditResult> = {
  name: 'edit',
  description:
    'Replace oldText with newText in a file. Fails if oldText is missing, or is ambiguous unless replaceAll is true.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, absolute or relative to the working directory.' },
      oldText: { type: 'string', description: 'Exact text to find.' },
      newText: { type: 'string', description: 'Replacement text.' },
      replaceAll: { type: 'boolean', description: 'Replace every occurrence instead of requiring exactly one.' },
    },
    required: ['path', 'oldText', 'newText'],
    additionalProperties: false,
  },
  fn: async (args, ctx) => {
    const parsed = EditArgsSchema.parse(args);
    const path = resolve(ctx.cwd, parsed.path);
    const content = await readFile(path, 'utf8');
    const replacements = countOccurrences(content, parsed.oldText);

    if (replacements === 0) {
      throw new Error(`oldText not found in ${path}`);
    }
    if (!parsed.replaceAll && replacements > 1) {
      throw new Error(
        `oldText appears ${replacements} times in ${path}; include more context or set replaceAll`,
      );
    }

    const next = parsed.replaceAll
      ? content.split(parsed.oldText).join(parsed.newText)
      : content.replace(parsed.oldText, parsed.newText);

    await writeFile(path, next, 'utf8');
    return { path, replacements: parsed.replaceAll ? replacements : 1 };
  },
};

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}
