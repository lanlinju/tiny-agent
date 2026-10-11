import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { formatError } from './render';

/** Append-only sink for the CLI's rendered transcript. */
export interface Transcript {
  write(line: string): void;
  close(): void;
}

/**
 * Optional human-readable transcript for the CLI.
 *
 * It mirrors the rendered event lines to a file so a session can be read back
 * outside the terminal. It is not the source of truth: the server still records
 * structured events in `sessions/<id>/events.jsonl`.
 */
export function createTranscript(path: string | undefined): Transcript | undefined {
  const trimmed = path?.trim();
  if (!trimmed) {
    return undefined;
  }

  const target = resolve(trimmed);
  mkdirSync(dirname(target), { recursive: true });

  let failed = false;
  return {
    write(line) {
      if (failed) {
        return;
      }
      try {
        appendFileSync(target, line.endsWith('\n') ? line : `${line}\n`, 'utf8');
      } catch (error) {
        failed = true;
        console.error(`[cli] transcript write failed for ${target}: ${formatError(error)}`);
      }
    },
    close() {
      // appendFileSync keeps no handle open; nothing to flush.
    },
  };
}
