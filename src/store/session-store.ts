import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentEvent } from '../protocols/events';
import { parseAgentEvent } from '../protocols/events';

/**
 * Passive event recorder owned by the `store` layer.
 *
 * The store never drives the agent loop: it only validates and appends events,
 * and can read them back for replay. Events are immutable.
 */
export interface SessionStore {
  append(event: AgentEvent): Promise<void>;
  read(sessionId: string): Promise<AgentEvent[]>;
}

/** File-backed store writing `<dir>/<sessionId>/events.jsonl`. */
export function createFileSessionStore(dir: string): SessionStore {
  return {
    async append(event) {
      // Validation boundary: never persist an unvalidated event.
      const validated = parseAgentEvent(event);
      const sessionDir = join(dir, validated.sessionId);
      await mkdir(sessionDir, { recursive: true });
      await appendFile(join(sessionDir, 'events.jsonl'), `${JSON.stringify(validated)}\n`, 'utf8');
    },

    async read(sessionId) {
      const file = join(dir, sessionId, 'events.jsonl');
      let content: string;
      try {
        content = await readFile(file, 'utf8');
      } catch (error) {
        if (isNotFound(error)) {
          return [];
        }
        throw error;
      }

      return content
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line, index) => {
          try {
            return parseAgentEvent(JSON.parse(line));
          } catch (error) {
            throw new Error(`Invalid event in ${sessionId} line ${index + 1}: ${formatError(error)}`);
          }
        });
    },
  };
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** In-memory store used by tests and ephemeral runs. */
export function createMemorySessionStore(): SessionStore {
  const sessions = new Map<string, AgentEvent[]>();

  return {
    async append(event) {
      const validated = parseAgentEvent(event);
      const events = sessions.get(validated.sessionId) ?? [];
      events.push(validated);
      sessions.set(validated.sessionId, events);
    },

    async read(sessionId) {
      return [...(sessions.get(sessionId) ?? [])];
    },
  };
}
