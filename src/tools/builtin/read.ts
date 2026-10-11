import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ImagePart } from '../../protocols/content';
import { loadImagePart } from '../image';
import type { ToolDef } from '../types';

const ReadArgsSchema = z.object({
  path: z.string().min(1),
  offset: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).optional(),
});

type ReadArgs = z.infer<typeof ReadArgsSchema>;

/** Text read result, optionally sliced by a 1-based line window. */
export type ReadTextResult = {
  readonly type: 'text';
  readonly path: string;
  readonly content: string;
  readonly totalLines: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly truncated: boolean;
};

/**
 * Image read result. `image` carries the base64 payload consumed by the model;
 * the surrounding fields are safe to persist and render in clients.
 */
export type ReadImageResult = {
  readonly type: 'image';
  readonly path: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly resized: boolean;
  readonly image: ImagePart;
};

export type ReadResult = ReadTextResult | ReadImageResult;

/**
 * Read a local file.
 *
 * Images are detected by magic bytes and returned as an image content block;
 * every other file is returned as UTF-8 text, optionally sliced by a 1-based
 * line offset and limit. No approval policy here.
 */
export const readTool: ToolDef<ReadArgs, ReadResult> = {
  name: 'read',
  description:
    'Read a local file. Images (png/jpeg/gif/webp/bmp) are returned as image content; ' +
    'other files are returned as UTF-8 text, optionally sliced by 1-based line offset and limit.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, absolute or relative to the working directory.' },
      offset: { type: 'integer', description: '1-based first line to return (text files only).', minimum: 1 },
      limit: { type: 'integer', description: 'Maximum number of lines to return (text files only).', minimum: 1 },
    },
    required: ['path'],
    additionalProperties: false,
  },
  fn: async (args, ctx) => {
    const parsed = ReadArgsSchema.parse(args);
    const path = resolve(ctx.cwd, parsed.path);
    const buffer = await readFile(path);

    const image = await loadImagePart(buffer);
    if (image) {
      return {
        type: 'image',
        path,
        mimeType: image.mimeType,
        bytes: image.bytes,
        resized: image.resized,
        image: { type: 'image', data: image.data, mimeType: image.mimeType },
      };
    }

    const content = buffer.toString('utf8');
    const lines = content.split('\n');

    const startIndex = Math.max(0, (parsed.offset ?? 1) - 1);
    const endIndex =
      parsed.limit === undefined ? lines.length : Math.min(lines.length, startIndex + parsed.limit);

    return {
      type: 'text',
      path,
      content: lines.slice(startIndex, endIndex).join('\n'),
      totalLines: lines.length,
      startLine: startIndex + 1,
      endLine: endIndex,
      truncated: startIndex > 0 || endIndex < lines.length,
    };
  },
};
