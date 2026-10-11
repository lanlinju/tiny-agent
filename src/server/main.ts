import { WebSocketServer } from 'ws';
import type { AppConfig } from '../config';
import { loadConfig } from '../config';
import type { LLMProvider } from '../llm/provider';
import { createMockLLM } from '../llm/mock';
import { createOpenAICompatibleLLM } from '../llm/openai';
import { createToolRegistry } from '../tools/registry';
import { builtinTools } from '../tools/builtin';
import { createFileSessionStore } from '../store/session-store';
import { createAgentServer } from './agent-server';
import { attachWebSocketServer } from './ws-handler';

/**
 * Pick the LLM provider from configuration.
 *
 * Real OpenAI-compatible providers are used when an api key is configured;
 * otherwise the deterministic mock keeps the loop runnable offline.
 */
function createProvider(config: AppConfig): LLMProvider {
  const { apiKey, baseUrl, model, temperature } = config.llm;
  if (!apiKey) {
    console.warn('[server] no llm.apiKey configured; using deterministic mock LLM');
    return createMockLLM();
  }

  console.log(`[server] using OpenAI-compatible LLM baseUrl=${baseUrl} model=${model}`);
  return temperature === undefined
    ? createOpenAICompatibleLLM({ apiKey, baseUrl, model })
    : createOpenAICompatibleLLM({ apiKey, baseUrl, model, temperature });
}

/**
 * Local server composition root.
 *
 * Configuration comes from `src/config` (defaults < file < env < overrides).
 * Concrete `llm`, `tools` and `store` implementations are wired into the
 * transport-agnostic `AgentServer`, then exposed over WebSocket.
 */
function main(): void {
  const config = loadConfig();
  const { port, owner, sessionDir, workspaceDir, maxSteps } = config.server;

  const server = createAgentServer({
    llm: createProvider(config),
    tools: createToolRegistry(builtinTools),
    store: createFileSessionStore(sessionDir),
    owner,
    agentId: config.agentId,
    cwd: workspaceDir,
    maxSteps,
  });

  const wss = new WebSocketServer({ port });
  attachWebSocketServer(wss, server);

  wss.on('listening', () => {
    console.log(
      `ready ws://localhost:${port} agent=${config.agentId} cwd=${workspaceDir} sessions=${sessionDir} tools=${builtinTools.length}`,
    );
  });
  wss.on('error', (error) => {
    console.error(`[server] ${error.message}`);
    process.exitCode = 1;
  });

  process.on('SIGINT', () => {
    wss.close(() => {
      process.exit(0);
    });
  });
}

main();
