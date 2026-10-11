import { WebSocketServer } from 'ws';
import type { AppConfig } from '../config';
import { loadConfig } from '../config';
import type { LLMProvider } from '../llm/provider';
import { createMockLLM } from '../llm/mock';
import { createOpenAICompatibleLLM } from '../llm/openai';
import { createToolRegistry } from '../tools/registry';
import { builtinTools } from '../tools/builtin';
import { createPluginManager } from '../plugins/manager';
import { createFileSessionStore } from '../store/session-store';
import { createAgentServer } from './agent-server';
import { attachWebSocketServer } from './ws-handler';
import { createAgentHttpServer } from './http-server';

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
async function main(): Promise<void> {
  const config = loadConfig();
  const { port, owner, sessionDir, workspaceDir, webDir, pluginDir, maxSteps } = config.server;

  // Plugins contribute extra tools; the server is the only layer that loads them.
  const pluginManager = createPluginManager({
    dir: pluginDir,
    reservedToolNames: builtinTools.map((tool) => tool.name),
    logger: (message) => console.log(`[plugins] ${message}`),
    enabled: config.server.plugins.enabled,
    allow: config.server.plugins.allow,
    deny: config.server.plugins.deny,
  });
  const plugins = await pluginManager.load();
  const tools = [...builtinTools, ...pluginManager.tools()];

  const server = createAgentServer({
    llm: createProvider(config),
    tools: createToolRegistry(tools),
    store: createFileSessionStore(sessionDir),
    owner,
    agentId: config.agentId,
    cwd: workspaceDir,
    maxSteps,
  });

  const httpServer = createAgentHttpServer(webDir);
  const wss = new WebSocketServer({ server: httpServer });
  attachWebSocketServer(wss, server);

  httpServer.on('listening', () => {
    console.log(
      `ready ws://localhost:${port} web=http://localhost:${port} agent=${config.agentId} cwd=${workspaceDir} sessions=${sessionDir} tools=${tools.length} plugins=${plugins.length}`,
    );
  });
  httpServer.on('error', (error) => {
    console.error(`[server] ${error.message}`);
    process.exitCode = 1;
  });

  const shutdown = () => {
    void pluginManager.unloadAll();
    wss.close();
    httpServer.close(() => {
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  httpServer.listen(port);
}

main().catch((error: unknown) => {
  console.error(`[server] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
