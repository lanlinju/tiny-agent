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
      temperature: z.number().min(0).max(2).optional(),
    })
    .optional(),
  server: z
    .object({
      port: z.number().int().positive().optional(),
      owner: z.string().min(1).optional(),
      sessionDir: z.string().min(1).optional(),
      workspaceDir: z.string().min(1).optional(),
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
    temperature: z.number().min(0).max(2).optional(),
  }),
  server: z.object({
    port: z.number().int().positive().default(3987),
    owner: z.string().min(1).default('local'),
    sessionDir: z.string().min(1).default('sessions'),
    workspaceDir: z.string().min(1).default('.'),
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
    server: { ...base.server, ...override.server },
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
