import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Application configuration.
 *
 * This is a composition-time module: only entry points (`server/main`) read it.
 * It depends on `zod` and `node:fs` only — never on business layers — so it can
 * be tested in isolation.
 *
 * Precedence (low to high): defaults < config file < environment < overrides.
 */

const RawConfigSchema = z.object({
  agentId: z.string().min(1).optional(),
  llm: z
    .object({
      apiKey: z.string().min(1).optional(),
      baseUrl: z.string().url().optional(),
      model: z.string().min(1).optional(),
      reasoningEffort: z.enum(['none', 'low', 'high', 'max']).optional(),
      temperature: z.number().min(0).max(2).optional(),
    })
    .optional(),
  server: z
    .object({
      port: z.number().int().positive().optional(),
      owner: z.string().min(1).optional(),
      sessionDir: z.string().min(1).optional(),
      workspaceDir: z.string().min(1).optional(),
      webDir: z.string().min(1).optional(),
      pluginDir: z.string().min(1).optional(),
      plugins: z
        .object({
          enabled: z.boolean().optional(),
          allow: z.array(z.string().min(1)).optional(),
          deny: z.array(z.string().min(1)).optional(),
        })
        .optional(),
      maxSteps: z.number().int().positive().optional(),
    })
    .optional(),
});

/** Raw, all-optional config accepted from files, env and callers. */
export type RawConfig = z.infer<typeof RawConfigSchema>;

const AppConfigSchema = z.object({
  agentId: z.string().min(1).default('agent-1'),
  llm: z.object({
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().url().default('https://api.openai.com/v1'),
    model: z.string().min(1).default('gpt-4o-mini'),
    reasoningEffort: z.enum(['none', 'low', 'high', 'max']).default('high'),
    temperature: z.number().min(0).max(2).optional(),
  }),
  server: z.object({
    port: z.number().int().positive().default(3987),
    owner: z.string().min(1).default('local'),
    sessionDir: z.string().min(1).default('sessions'),
    workspaceDir: z.string().min(1).default('.'),
    webDir: z.string().min(1).default('dist/clients/web'),
    pluginDir: z.string().min(1).default('plugins'),
    plugins: z
      .object({
        enabled: z.boolean().default(true),
        allow: z.array(z.string().min(1)).default([]),
        deny: z.array(z.string().min(1)).default([]),
      })
      .default({}),
    maxSteps: z.number().int().positive().default(8),
  }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

/** Load and validate the effective configuration. */
export function loadConfig(overrides: RawConfig = {}, env: NodeJS.ProcessEnv = process.env): AppConfig {
  const fileConfig = loadConfigFile(env);
  const envConfig = readEnvConfig(env);
  const merged = mergeConfig(mergeConfig(fileConfig, envConfig), overrides);
  return AppConfigSchema.parse(merged);
}

function readEnvConfig(env: NodeJS.ProcessEnv): RawConfig {
  const llm: NonNullable<RawConfig['llm']> = {};
  if (env.OPENAI_API_KEY?.trim()) {
    llm.apiKey = env.OPENAI_API_KEY.trim();
  }
  if (env.OPENAI_BASE_URL?.trim()) {
    llm.baseUrl = env.OPENAI_BASE_URL.trim();
  }
  if (env.OPENAI_MODEL?.trim()) {
    llm.model = env.OPENAI_MODEL.trim();
  }
  if (env.OPENAI_REASONING_EFFORT?.trim()) {
    llm.reasoningEffort = env.OPENAI_REASONING_EFFORT.trim() as 'none' | 'low' | 'high' | 'max';
  }
  const temperature = readNumber(env.OPENAI_TEMPERATURE, 'OPENAI_TEMPERATURE');
  if (temperature !== undefined) {
    llm.temperature = temperature;
  }

  const server: NonNullable<RawConfig['server']> = {};
  const port = readNumber(env.AGENT_PORT, 'AGENT_PORT');
  if (port !== undefined) {
    server.port = port;
  }
  if (env.AGENT_OWNER?.trim()) {
    server.owner = env.AGENT_OWNER.trim();
  }
  if (env.AGENT_SESSION_DIR?.trim()) {
    server.sessionDir = env.AGENT_SESSION_DIR.trim();
  }
  if (env.AGENT_WORKSPACE_DIR?.trim()) {
    server.workspaceDir = env.AGENT_WORKSPACE_DIR.trim();
  }
  if (env.AGENT_WEB_DIR?.trim()) {
    server.webDir = env.AGENT_WEB_DIR.trim();
  }
  if (env.AGENT_PLUGIN_DIR?.trim()) {
    server.pluginDir = env.AGENT_PLUGIN_DIR.trim();
  }

  const plugins: NonNullable<NonNullable<RawConfig['server']>['plugins']> = {};
  const pluginsEnabled = readBoolean(env.AGENT_PLUGINS_ENABLED, 'AGENT_PLUGINS_ENABLED');
  if (pluginsEnabled !== undefined) {
    plugins.enabled = pluginsEnabled;
  }
  const pluginsAllow = readList(env.AGENT_PLUGINS_ALLOW);
  if (pluginsAllow !== undefined) {
    plugins.allow = pluginsAllow;
  }
  const pluginsDeny = readList(env.AGENT_PLUGINS_DENY);
  if (pluginsDeny !== undefined) {
    plugins.deny = pluginsDeny;
  }
  if (Object.keys(plugins).length > 0) {
    server.plugins = plugins;
  }
  const maxSteps = readNumber(env.AGENT_MAX_STEPS, 'AGENT_MAX_STEPS');
  if (maxSteps !== undefined) {
    server.maxSteps = maxSteps;
  }

  const config: RawConfig = { llm, server };
  if (env.AGENT_ID?.trim()) {
    config.agentId = env.AGENT_ID.trim();
  }
  return config;
}

function loadConfigFile(env: NodeJS.ProcessEnv): RawConfig {
  const explicit = env.AGENT_CONFIG?.trim();
  const path = resolve(explicit || 'agent.config.json');
  if (!existsSync(path)) {
    if (explicit) {
      throw new Error(`Config file not found: ${path}`);
    }
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid config file ${path}: ${formatError(error)}`);
  }

  const result = RawConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid config file ${path}: ${result.error.message}`);
  }

  console.log(`[config] loaded ${path}`);
  return result.data;
}

function mergeConfig(base: RawConfig, override: RawConfig): RawConfig {
  return {
    ...base,
    ...override,
    llm: { ...base.llm, ...override.llm },
    server: {
      ...base.server,
      ...override.server,
      plugins: { ...base.server?.plugins, ...override.server?.plugins },
    },
  };
}

function readNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${name}: expected a number, received "${value}"`);
  }
  return parsed;
}

function readBoolean(value: string | undefined, name: string): boolean | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid ${name}: expected a boolean, received "${value}"`);
}

function readList(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return items.length > 0 ? items : undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
