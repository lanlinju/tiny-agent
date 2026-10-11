import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ToolContext, ToolDef } from '../types';

const ShellArgsSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(1).max(300_000).optional(),
});

type ShellArgs = z.infer<typeof ShellArgsSchema>;

type ShellResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 200_000;

/** Run a shell command and capture output. No approval policy here. */
export const shellTool: ToolDef<ShellArgs, ShellResult> = {
  name: 'shell',
  description: 'Run a shell command and return its stdout, stderr and exit code.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute.' },
      cwd: {
        type: 'string',
        description: 'Working directory; defaults to the agent working directory.',
      },
      timeoutMs: {
        type: 'integer',
        description: 'Timeout in milliseconds.',
        minimum: 1,
        maximum: 300000,
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
  fn: async (args, ctx) => {
    const parsed = ShellArgsSchema.parse(args);
    return runShell(parsed, ctx);
  },
};

function runShell(args: ShellArgs, ctx: ToolContext): Promise<ShellResult> {
  const cwd = args.cwd ? resolve(ctx.cwd, args.cwd) : ctx.cwd;
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolvePromise, reject) => {
    const child = spawn(args.command, { shell: true, cwd });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk.toString());
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk.toString());
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, exitCode: code ?? -1, timedOut });
    });
  });
}

function appendCapped(current: string, chunk: string): string {
  if (current.length >= MAX_OUTPUT_CHARS) {
    return current;
  }
  const next = current + chunk;
  return next.length > MAX_OUTPUT_CHARS ? next.slice(0, MAX_OUTPUT_CHARS) : next;
}
