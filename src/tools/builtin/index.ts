import type { AnyToolDef } from '../registry';
import { editTool } from './edit';
import { readTool } from './read';
import { shellTool } from './shell';
import { writeTool } from './write';

/**
 * The four MVP built-in tools.
 *
 * They express real-world actions only; approval policy lives in the server
 * layer (phase 6). The demo-only `time` tool is intentionally excluded.
 */
export const builtinTools: readonly AnyToolDef[] = [readTool, writeTool, editTool, shellTool];
