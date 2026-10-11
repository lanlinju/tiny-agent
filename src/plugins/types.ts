import type { JsonValue } from '../protocols/events';
import type { AnyToolDef } from '../tools/registry';

/** A tool contributed by a plugin. Same shape as built-in tools. */
export type PluginTool = AnyToolDef;

/**
 * Declarative plugin manifest, read from `<pluginDir>/<name>/plugin.json`.
 *
 * `permissions` is a placeholder declaration: it is surfaced and validated but
 * not enforced yet (enforcement belongs to the server approval policy).
 */
export interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly description?: string | undefined;
  readonly permissions?: readonly string[] | undefined;
  readonly entry?: string | undefined;
}

/** Passed to a plugin's `onLoad` hook. */
export interface PluginContext {
  readonly logger: (message: string) => void;
}

/** Runtime contract exported by a plugin entry module (CommonJS). */
export interface PluginModule {
  readonly tools?: readonly PluginTool[];
  readonly onLoad?: (context: PluginContext) => void | Promise<void>;
  readonly onUnload?: () => void | Promise<void>;
}

/** Metadata about a successfully loaded plugin. */
export interface LoadedPlugin {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly permissions: readonly string[];
  readonly toolNames: readonly string[];
  readonly source: string;
}
