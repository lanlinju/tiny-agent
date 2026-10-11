import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createPluginManager } from '../../src/plugins/manager';

const TOOL_ENTRY = `
module.exports = {
  tools: [
    {
      name: 'wordcount',
      description: 'Count words.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      fn: async () => ({ words: 3 }),
    },
  ],
};
`;

const LIFECYCLE_ENTRY = `
module.exports = {
  tools: [],
  onLoad: () => { globalThis.__taOnLoad = (globalThis.__taOnLoad || 0) + 1; },
  onUnload: () => { globalThis.__taOnUnload = (globalThis.__taOnUnload || 0) + 1; },
};
`;

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'ta-plugins-'));
}

function writePlugin(root: string, name: string, manifest: unknown, entry: string): void {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest), 'utf8');
  writeFileSync(join(dir, 'index.js'), entry, 'utf8');
}

test('loads a plugin manifest and exposes its tools', async () => {
  const root = makeRoot();
  try {
    writePlugin(
      root,
      'wordcount',
      { name: 'wordcount', version: '0.1.0', permissions: ['fs.read'] },
      TOOL_ENTRY,
    );

    const manager = createPluginManager({ dir: root });
    const loaded = await manager.load();

    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]?.name, 'wordcount');
    assert.deepEqual(loaded[0]?.permissions, ['fs.read']);
    assert.deepEqual(loaded[0]?.toolNames, ['wordcount']);
    assert.equal(manager.tools().length, 1);
    assert.equal(manager.tools()[0]?.name, 'wordcount');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('skips a plugin whose tool name collides with a reserved built-in', async () => {
  const root = makeRoot();
  try {
    writePlugin(root, 'wordcount', { name: 'wordcount', version: '0.1.0' }, TOOL_ENTRY);

    const messages: string[] = [];
    const manager = createPluginManager({
      dir: root,
      reservedToolNames: ['wordcount'],
      logger: (message) => messages.push(message),
    });

    const loaded = await manager.load();
    assert.equal(loaded.length, 0);
    assert.equal(manager.tools().length, 0);
    assert.ok(messages.some((message) => message.includes('collides with a built-in')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('skips invalid plugins but keeps loading valid ones', async () => {
  const root = makeRoot();
  try {
    writePlugin(root, 'broken', { name: 'Bad Name', version: '1' }, TOOL_ENTRY);
    writePlugin(root, 'good', { name: 'good', version: '1.0.0' }, TOOL_ENTRY);

    const messages: string[] = [];
    const manager = createPluginManager({ dir: root, logger: (message) => messages.push(message) });
    const loaded = await manager.load();

    assert.deepEqual(loaded.map((plugin) => plugin.name), ['good']);
    assert.ok(messages.some((message) => message.includes('failed to load plugin "broken"')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runs onLoad and onUnload hooks', async () => {
  const root = makeRoot();
  const globals = globalThis as Record<string, unknown>;
  globals.__taOnLoad = 0;
  globals.__taOnUnload = 0;
  try {
    writePlugin(root, 'lifecycle', { name: 'lifecycle', version: '0.1.0' }, LIFECYCLE_ENTRY);

    const manager = createPluginManager({ dir: root });
    await manager.load();
    assert.equal(globals.__taOnLoad, 1);

    await manager.unloadAll();
    assert.equal(globals.__taOnUnload, 1);
    assert.equal(manager.tools().length, 0);
    assert.equal(manager.list().length, 0);
  } finally {
    delete globals.__taOnLoad;
    delete globals.__taOnUnload;
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns no plugins when the directory is missing', async () => {
  const manager = createPluginManager({ dir: join(tmpdir(), 'ta-plugins-does-not-exist') });
  assert.deepEqual(await manager.load(), []);
});

function toolEntry(name: string): string {
  return `
module.exports = {
  tools: [
    {
      name: '${name}',
      description: 'x',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      fn: async () => ({}),
    },
  ],
};
`;
}

test('respects the global enabled switch', async () => {
  const root = makeRoot();
  try {
    writePlugin(root, 'alpha', { name: 'alpha', version: '1.0.0' }, toolEntry('alpha-tool'));
    const manager = createPluginManager({ dir: root, enabled: false });
    assert.deepEqual(await manager.load(), []);
    assert.equal(manager.tools().length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('respects the host allow list', async () => {
  const root = makeRoot();
  try {
    writePlugin(root, 'alpha', { name: 'alpha', version: '1.0.0' }, toolEntry('alpha-tool'));
    writePlugin(root, 'beta', { name: 'beta', version: '1.0.0' }, toolEntry('beta-tool'));

    const manager = createPluginManager({ dir: root, allow: ['beta'] });
    const loaded = await manager.load();
    assert.deepEqual(loaded.map((plugin) => plugin.name), ['beta']);
    assert.deepEqual(manager.tools().map((tool) => tool.name), ['beta-tool']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('respects the host deny list', async () => {
  const root = makeRoot();
  try {
    writePlugin(root, 'alpha', { name: 'alpha', version: '1.0.0' }, toolEntry('alpha-tool'));
    writePlugin(root, 'beta', { name: 'beta', version: '1.0.0' }, toolEntry('beta-tool'));

    const manager = createPluginManager({ dir: root, deny: ['alpha'] });
    const loaded = await manager.load();
    assert.deepEqual(loaded.map((plugin) => plugin.name), ['beta']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('honors enabled=false in the plugin manifest', async () => {
  const root = makeRoot();
  try {
    writePlugin(
      root,
      'alpha',
      { name: 'alpha', version: '1.0.0', enabled: false },
      toolEntry('alpha-tool'),
    );
    writePlugin(root, 'beta', { name: 'beta', version: '1.0.0' }, toolEntry('beta-tool'));

    const messages: string[] = [];
    const manager = createPluginManager({ dir: root, logger: (message) => messages.push(message) });
    const loaded = await manager.load();
    assert.deepEqual(loaded.map((plugin) => plugin.name), ['beta']);
    assert.ok(messages.some((message) => message.includes('disabled by plugin manifest')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
