import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { editTool } from '../../src/tools/builtin/edit';
import { readTool } from '../../src/tools/builtin/read';
import { shellTool } from '../../src/tools/builtin/shell';
import { writeTool } from '../../src/tools/builtin/write';
import type { ToolContext } from '../../src/tools/types';

function makeCtx(cwd: string): ToolContext {
  return { now: () => 0, cwd };
}

async function withTempDir(run: (dir: string, ctx: ToolContext) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'ta-tools-'));
  try {
    await run(dir, makeCtx(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('write then read round-trips content and supports line windows', async () => {
  await withTempDir(async (dir, ctx) => {
    const written = await writeTool.fn({ path: 'sub/a.txt', content: 'hello\nworld' }, ctx);
    assert.equal(written.created, true);
    assert.equal(written.bytes, 11);

    const read = await readTool.fn({ path: 'sub/a.txt' }, ctx);
    if (read.type !== 'text') throw new Error('expected text result');
    assert.equal(read.content, 'hello\nworld');
    assert.equal(read.totalLines, 2);
    assert.equal(read.truncated, false);

    const sliced = await readTool.fn({ path: 'sub/a.txt', offset: 2, limit: 1 }, ctx);
    if (sliced.type !== 'text') throw new Error('expected text result');
    assert.equal(sliced.content, 'world');
    assert.equal(sliced.truncated, true);
    assert.equal(dir.length > 0, true);
  });
});

// 1x1 transparent PNG, used to exercise magic-byte detection.
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('read detects images by magic bytes and returns an image content block', async () => {
  await withTempDir(async (dir, ctx) => {
    // Deliberately wrong extension: detection must rely on content, not name.
    await writeFile(join(dir, 'photo.txt'), ONE_PIXEL_PNG);

    const result = await readTool.fn({ path: 'photo.txt' }, ctx);
    if (result.type !== 'image') throw new Error('expected image result');
    assert.equal(result.mimeType, 'image/png');
    assert.equal(result.image.type, 'image');
    assert.equal(result.image.mimeType, 'image/png');
    assert.ok(result.image.data.length > 0);
    assert.ok(result.bytes > 0);
    assert.equal(typeof result.resized, 'boolean');
  });
});

test('edit requires a unique match unless replaceAll is set', async () => {
  await withTempDir(async (dir, ctx) => {
    await writeTool.fn({ path: 'e.txt', content: 'foo bar foo' }, ctx);

    await assert.rejects(
      () => editTool.fn({ path: 'e.txt', oldText: 'foo', newText: 'x' }, ctx),
      /appears 2 times/,
    );
    await assert.rejects(
      () => editTool.fn({ path: 'e.txt', oldText: 'zzz', newText: 'y' }, ctx),
      /not found/,
    );

    const replaced = await editTool.fn(
      { path: 'e.txt', oldText: 'foo', newText: 'x', replaceAll: true },
      ctx,
    );
    assert.equal(replaced.replacements, 2);
    assert.equal(await readFile(join(dir, 'e.txt'), 'utf8'), 'x bar x');
  });
});

test('shell captures stdout and non-zero exit codes', async () => {
  await withTempDir(async (_dir, ctx) => {
    const ok = await shellTool.fn({ command: 'echo hello' }, ctx);
    assert.equal(ok.exitCode, 0);
    assert.equal(ok.stdout.trim(), 'hello');

    const failed = await shellTool.fn({ command: 'exit 3' }, ctx);
    assert.equal(failed.exitCode, 3);
  });
});
