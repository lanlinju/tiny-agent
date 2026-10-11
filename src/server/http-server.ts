import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * Minimal static HTTP server for the Web GUI.
 *
 * The same `http.Server` is later upgraded to WebSocket by the transport, so
 * the GUI and the event stream share one port.
 */
export function createAgentHttpServer(webDir: string): Server {
  const root = resolve(webDir);

  return createServer((request, response) => {
    void handleRequest(root, request.url ?? '/', response);
  });
}

async function handleRequest(root: string, rawUrl: string, response: ServerResponse): Promise<void> {
  const pathname = new URL(rawUrl, 'http://localhost').pathname;
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const target = resolve(root, relative);

  // Path-traversal guard: stay inside the web root.
  if (target !== root && !target.startsWith(root + sep)) {
    respond(response, 403, 'text/plain; charset=utf-8', 'Forbidden');
    return;
  }

  try {
    const content = await readFile(target);
    respond(response, 200, CONTENT_TYPES[extname(target)] ?? 'application/octet-stream', content);
  } catch {
    respond(response, 404, 'text/plain; charset=utf-8', 'Not found');
  }
}

function respond(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string | Buffer,
): void {
  response.writeHead(status, { 'content-type': contentType });
  response.end(body);
}
