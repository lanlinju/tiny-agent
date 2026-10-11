import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parsePluginManifest } from './manifest';
import { describePermission } from './permissions';
import type { LoadedPlugin, PluginContext, PluginManifest, PluginModule, PluginTool } from './types';

export interface PluginManagerOptions {
  /** Directory whose immediate subdirectories are plugins. */
  readonly dir: string;
  /** Tool names the manager must not shadow (e.g. built-ins). */
  readonly reservedToolNames?: readonly string[];
  readonly logger?: (message: string) => void;
  /** Master switch; when false, no plugin is loaded. Defaults to true. */
  readonly enabled?: boolean;
  /** When non-empty, only these plugin names may load. */
  readonly allow?: readonly string[];
  /** These plugin names never load, regardless of manifest or allow list. */
  readonly deny?: readonly string[];
}

export interface PluginManager {
  /** Discover, validate and load plugins. Bad plugins are skipped, not fatal. */
  load(): Promise<readonly LoadedPlugin[]>;
  /** Run each plugin's `onUnload` and forget all loaded state. */
  unloadAll(): Promise<void>;
  /** All tools contributed by loaded plugins. */
  tools(): readonly PluginTool[];
  /** Metadata for the loaded plugins. */
  list(): readonly LoadedPlugin[];
}

/**
 * Controlled extension point owned by the `plugins` layer.
 *
 * The manager only loads plugins and collects their tools. It never decides
 * approval, never talks to clients, and never writes storage. The server merges
 * the resulting tools into its registry.
 */
export function createPluginManager(options: PluginManagerOptions): PluginManager {
  const logger = options.logger ?? (() => {});
  const reserved = new Set(options.reservedToolNames ?? []);
  const allow = new Set(options.allow ?? []);
  const deny = new Set(options.deny ?? []);
  const loaded: LoadedPlugin[] = [];
  const tools: PluginTool[] = [];
  const modules: PluginModule[] = [];

  async function load(): Promise<readonly LoadedPlugin[]> {
    if (options.enabled === false) {
      logger('plugins disabled by configuration');
      return loaded;
    }

    const root = resolve(options.dir);
    const entries = await readPluginDirs(root, logger);

    for (const entry of entries) {
      try {
        await loadOne(join(root, entry));
      } catch (error) {
        logger(`failed to load plugin "${entry}": ${formatError(error)}`);
      }
    }
    return loaded;
  }

  async function loadOne(dir: string): Promise<void> {
    const manifest = await readManifest(dir);

    const skipReason = skipReasonFor(manifest);
    if (skipReason !== undefined) {
      logger(`skipped ${manifest.name}@${manifest.version}: ${skipReason}`);
      return;
    }

    const entry = manifest.entry ?? 'index.js';
    const source = join(dir, entry);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const imported: unknown = require(source);
    const plugin = normalizeModule(imported, source);
    const pluginTools = plugin.tools ?? [];

    const toolNames: string[] = [];
    for (const tool of pluginTools) {
      validateTool(tool, source);
      if (reserved.has(tool.name)) {
        throw new Error(`tool "${tool.name}" collides with a built-in tool`);
      }
      if (toolNames.includes(tool.name)) {
        throw new Error(`duplicate tool "${tool.name}" within plugin`);
      }
      if (tools.some((existing) => existing.name === tool.name)) {
        throw new Error(`tool "${tool.name}" is already provided by another plugin`);
      }
      toolNames.push(tool.name);
    }

    const permissions = manifest.permissions ?? [];
    const context: PluginContext = { logger };
    await plugin.onLoad?.(context);

    tools.push(...pluginTools);
    modules.push(plugin);
    loaded.push({
      name: manifest.name,
      version: manifest.version,
      ...(manifest.description !== undefined ? { description: manifest.description } : {}),
      permissions,
      toolNames,
      source,
    });

    const permissionSummary = permissions
      .map((permission) => (describePermission(permission).known ? permission : `${permission}?`))
      .join(', ');
    logger(
      `loaded ${manifest.name}@${manifest.version} tools=[${toolNames.join(', ')}] permissions=[${permissionSummary}]`,
    );
  }

  function skipReasonFor(manifest: PluginManifest): string | undefined {
    if (deny.has(manifest.name)) {
      return 'disabled by host config (deny list)';
    }
    if (allow.size > 0 && !allow.has(manifest.name)) {
      return 'not in host config allow list';
    }
    if (manifest.enabled === false) {
      return 'disabled by plugin manifest';
    }
    return undefined;
  }

  async function unloadAll(): Promise<void> {
    for (const plugin of [...modules].reverse()) {
      try {
        await plugin.onUnload?.();
      } catch (error) {
        logger(`onUnload failed: ${formatError(error)}`);
      }
    }
    modules.length = 0;
    tools.length = 0;
    loaded.length = 0;
  }

  return {
    load,
    unloadAll,
    tools: () => [...tools],
    list: () => [...loaded],
  };
}

async function readPluginDirs(root: string, logger: (message: string) => void): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) {
      logger(`plugin directory not found: ${root}`);
      return [];
    }
    throw error;
  }

  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function readManifest(dir: string): Promise<PluginManifest> {
  const raw: unknown = JSON.parse(await readFile(join(dir, 'plugin.json'), 'utf8'));
  return parsePluginManifest(raw);
}

function normalizeModule(imported: unknown, source: string): PluginModule {
  if (typeof imported !== 'object' || imported === null) {
    throw new Error(`plugin module must export an object: ${source}`);
  }
  const record = imported as Record<string, unknown>;
  const module = (record.default ?? record) as Record<string, unknown>;
  if (module.tools !== undefined && !Array.isArray(module.tools)) {
    throw new Error(`plugin "tools" must be an array: ${source}`);
  }
  return module as PluginModule;
}

function validateTool(tool: unknown, source: string): asserts tool is PluginTool {
  if (typeof tool !== 'object' || tool === null) {
    throw new Error(`invalid tool export in ${source}`);
  }
  const candidate = tool as Record<string, unknown>;
  if (typeof candidate.name !== 'string' || candidate.name === '') {
    throw new Error(`tool is missing a name in ${source}`);
  }
  if (typeof candidate.description !== 'string') {
    throw new Error(`tool "${candidate.name}" is missing a description in ${source}`);
  }
  if (typeof candidate.parameters !== 'object' || candidate.parameters === null) {
    throw new Error(`tool "${candidate.name}" is missing parameters in ${source}`);
  }
  if (typeof candidate.fn !== 'function') {
    throw new Error(`tool "${candidate.name}" is missing fn in ${source}`);
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
