import { WebSocketServer } from 'ws';
import type { LLMProvider } from '../llm/provider';
import { createMockLLM } from '../llm/mock';
import { createOpenAICompatibleLLM } from '../llm/openai';
import { createToolRegistry } from '../tools/registry';
import { timeTool } from '../tools/builtin/time';
import { createFileSessionStore } from '../store/session-store';
import { createAgentServer } from './agent-server';
import { attachWebSocketServer } from './ws-handler';

/**
 * Pick the LLM provider from the environment.
 *
 * Real OpenAI-compatible providers are used when `OPENAI_API_KEY` is present;
 * otherwise the deterministic mock keeps the loop runnable offline.
 */
function createProvider(): LLMProvider {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.warn('[server] OPENAI_API_KEY not set; using deterministic mock LLM');
    return createMockLLM();
  }

  const baseUrl = process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1';
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  console.log(`[server] using OpenAI-compatible LLM baseUrl=${baseUrl} model=${model}`);
  return createOpenAICompatibleLLM({ apiKey, baseUrl, model });
}

/**
 * Local server composition root.
 *
 * Wires concrete `llm`, `tools` and `store` implementations into the
 * transport-agnostic `AgentServer`, then exposes it over WebSocket. Phase 4
 * swaps the mock provider for a real one here.
 */
function main(): void {
  const port = Number(process.env.AGENT_PORT ?? 3987);
  const owner = process.env.AGENT_OWNER ?? 'local';
  const sessionDir = process.env.AGENT_SESSION_DIR ?? 'sessions';

  const server = createAgentServer({
    llm: createProvider(),
    tools: createToolRegistry([timeTool]),
    store: createFileSessionStore(sessionDir),
    owner,
  });

  const wss = new WebSocketServer({ port });
  attachWebSocketServer(wss, server);

  wss.on('listening', () => {
    console.log(`ready ws://localhost:${port} sessions=${sessionDir}`);
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
