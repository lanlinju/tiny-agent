// Example plugin (phase 9).
//
// A plugin is plain external code: it exports `tools` (and optional
// `onLoad`/`onUnload`). It never decides approval and never talks to clients;
// it just contributes a ToolDef that the server registers.
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');

const wordcountTool = {
  name: 'wordcount',
  description: 'Count words, lines and bytes in a UTF-8 file.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, absolute or relative to the working directory.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  fn: async (args, ctx) => {
    const path = resolve(ctx.cwd, String(args.path));
    const content = await readFile(path, 'utf8');
    const words = content.split(/\s+/).filter((token) => token.length > 0).length;
    return {
      path,
      words,
      lines: content.split('\n').length,
      bytes: Buffer.byteLength(content, 'utf8'),
    };
  },
};

module.exports = { tools: [wordcountTool] };
