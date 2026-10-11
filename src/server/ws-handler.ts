import type { WebSocket, WebSocketServer } from 'ws';
import type { AgentConnection, AgentServer } from './agent-server';

/**
 * Transport adapter: WebSocket in, commands to the server, events back out.
 *
 * Each socket is represented to the server as an `AgentConnection`. The server
 * decides which sessions that connection is subscribed to; this file carries no
 * business logic and does not validate commands.
 */
export function attachWebSocketServer(wss: WebSocketServer, server: AgentServer): void {
  wss.on('connection', (socket) => {
    const connection: AgentConnection = {
      send(event) {
        sendEvent(socket, event);
      },
    };

    socket.on('message', (data) => {
      void handleMessage(server, connection, data.toString());
    });
    socket.on('close', () => {
      server.removeConnection(connection);
    });
    socket.on('error', (error) => {
      console.error(`[ws] socket error: ${formatError(error)}`);
    });
  });
}

async function handleMessage(
  server: AgentServer,
  connection: AgentConnection,
  raw: string,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(`[ws] dropped non-JSON message: ${formatError(error)}`);
    return;
  }
  await server.handleRawCommand(parsed, connection);
}

function sendEvent(socket: WebSocket, event: unknown): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(event));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
