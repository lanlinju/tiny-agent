import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { loadConfig } from '../src/config';

/**
 * CLI launcher (composition root, phase 7/8 convenience).
 *
 * Starts a local server on demand and then runs the CLI client against it. The
 * client itself never imports `server`; only this entry point wires the two
 * processes together. If a server is already listening, it is reused and left
 * running; otherwise a child server is started and stopped when the CLI exits.
 *
 * Usage: `npm run cli [-- <sessionId>]`
 */
const serverEntry = join(__dirname, '..', 'src', 'server', 'main.js');
const clientEntry = join(__dirname, '..', 'clients', 'cli', 'index.js');
const HOST = '127.0.0.1';
const STARTUP_TIMEOUT_MS = 10_000;

let serverProcess: ChildProcess | undefined;

async function main(): Promise<void> {
  // A custom endpoint means the client is not targeting this machine; never
  // start a local server in that case.
  if (process.env.AGENT_WS_URL?.trim()) {
    process.exitCode = await runClient();
    return;
  }

  const { port } = loadConfig().server;

  if (await isPortOpen(HOST, port)) {
    console.log(`[cli] reusing server on ${HOST}:${port}`);
  } else {
    console.log(`[cli] starting server on ${HOST}:${port}`);
    serverProcess = spawn(process.execPath, [serverEntry], { stdio: 'inherit' });
    try {
      await waitForPort(HOST, port, STARTUP_TIMEOUT_MS);
    } catch (error) {
      stopServer();
      throw error;
    }
  }

  const exitCode = await runClient();
  stopServer();
  process.exitCode = exitCode;
}

function runClient(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [clientEntry, ...process.argv.slice(2)], {
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 0));
  });
}

function stopServer(): void {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = undefined;
  }
}

function isPortOpen(host: string, port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForPort(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await isPortOpen(host, port)) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`server did not start on ${host}:${port} within ${timeoutMs}ms`);
    }
    await delay(100);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

process.on('SIGINT', () => {
  stopServer();
  process.exit(130);
});
process.on('SIGTERM', () => {
  stopServer();
  process.exit(143);
});

main().catch((error: unknown) => {
  console.error(`[cli] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
