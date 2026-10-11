import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../src/config';

function withConfigFile(content: unknown): { dir: string; env: NodeJS.ProcessEnv } {
  const dir = mkdtempSync(join(tmpdir(), 'ta-config-'));
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(content), 'utf8');
  return { dir, env: { AGENT_CONFIG: path } };
}

test('loadConfig applies defaults', () => {
  const { dir, env } = withConfigFile({});
  try {
    const config = loadConfig({}, env);
    assert.equal(config.agentId, 'agent-1');
    assert.equal(config.llm.baseUrl, 'https://api.openai.com/v1');
    assert.equal(config.llm.model, 'gpt-4o-mini');
    assert.equal(config.server.port, 3987);
    assert.equal(config.server.workspaceDir, '.');
    assert.equal(config.server.maxSteps, 8);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('environment overrides config file, overrides win over environment', () => {
  const { dir, env } = withConfigFile({
    llm: { model: 'file-model' },
    server: { port: 1111, owner: 'file-owner' },
  });
  try {
    const config = loadConfig(
      { llm: { model: 'override-model' } },
      { ...env, OPENAI_MODEL: 'env-model', AGENT_PORT: '2222' },
    );
    assert.equal(config.llm.model, 'override-model');
    assert.equal(config.server.port, 2222);
    assert.equal(config.server.owner, 'file-owner');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig rejects invalid numeric env values', () => {
  const { dir, env } = withConfigFile({});
  try {
    assert.throws(() => loadConfig({}, { ...env, AGENT_PORT: 'not-a-number' }), /Invalid AGENT_PORT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
