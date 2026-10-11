import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createTranscript } from '../../clients/cli/transcript';

test('createTranscript appends lines and creates parent directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ta-transcript-'));
  try {
    const target = join(dir, 'nested', 'cli.log');
    const transcript = createTranscript(target);
    assert.ok(transcript);

    transcript.write('[turn] completed');
    transcript.write('line\n');
    transcript.close();

    assert.equal(readFileSync(target, 'utf8'), '[turn] completed\nline\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createTranscript is disabled for empty paths', () => {
  assert.equal(createTranscript(undefined), undefined);
  assert.equal(createTranscript(''), undefined);
  assert.equal(createTranscript('   '), undefined);
});
