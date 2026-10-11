import { WebSocketServer } from 'ws';
import { createMockLLM } from '../llm/mock';
import { createToolRegistry } from '../tools/registry';
import { timeTool } from '../tools/builtin/time';
import { createFileSessionStore } from '../store/session-store';
import { createAgentServer } from './agent-server';
import { attachWebSocketServer } from './ws-handler';

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
    llm: createMockLLM(),
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
