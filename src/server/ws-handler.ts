import type { WebSocket, WebSocketServer } from 'ws';
import type { AgentEvent } from '../protocols/events';
import type { AgentServer } from './agent-server';

/**
 * Transport adapter: WebSocket in, commands to the server, events back out.
 *
 * It carries no business logic; raw frames are handed to the server, which
 * performs runtime validation.
 */
export function attachWebSocketServer(wss: WebSocketServer, server: AgentServer): void {
  wss.on('connection', (socket) => {
    const unsubscribe = server.bus.subscribe((event) => {
      sendEvent(socket, event);
    });

    socket.on('message', (data) => {
      void handleMessage(server, data.toString());
    });
    socket.on('close', () => {
      unsubscribe();
    });
    socket.on('error', (error) => {
      console.error(`[ws] socket error: ${formatError(error)}`);
    });
  });
}

async function handleMessage(server: AgentServer, raw: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(`[ws] dropped non-JSON message: ${formatError(error)}`);
    return;
  }
  await server.handleRawCommand(parsed);
}

function sendEvent(socket: WebSocket, event: AgentEvent): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(event));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
