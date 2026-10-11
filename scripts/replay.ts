import { loadConfig } from '../src/config';
import { createFileSessionStore } from '../src/store/session-store';
import { replaySession } from '../src/store/replay';
import { formatError, renderEvent } from '../clients/cli/render';

/**
 * Offline replay entry point (phase 8).
 *
 * Composition root, not a client layer: it wires the `store` replay reader to
 * the `clients` renderer. It never imports `core`, `llm`, `tools` or `server`,
 * and it has no side effects beyond printing.
 *
 * Usage: `npm run replay <sessionId>`
 */
async function main(): Promise<void> {
  const sessionId = process.argv[2]?.trim();
  if (!sessionId) {
    console.error('usage: npm run replay -- <sessionId>');
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const store = createFileSessionStore(config.server.sessionDir);
  const events = await replaySession(store, sessionId);

  if (events.length === 0) {
    console.error(`no events found for session "${sessionId}" in ${config.server.sessionDir}`);
    process.exitCode = 1;
    return;
  }

  console.log(`replay ${sessionId} (${events.length} events)`);
  for (const event of events) {
    renderEvent(event);
  }
}

main().catch((error: unknown) => {
  console.error(`[replay] ${formatError(error)}`);
  process.exitCode = 1;
});
