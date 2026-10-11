import { z } from 'zod';
import type { ToolContext, ToolDef } from '../types';

const TimeArgsSchema = z.object({}).strict();

type TimeArgs = z.infer<typeof TimeArgsSchema>;

type TimeResult = {
  readonly iso: string;
  readonly epochMs: number;
};

/** Demo-only time tool used to prove the phase 2 ReAct loop. */
export const timeTool: ToolDef<TimeArgs, TimeResult> = {
  name: 'time',
  description: 'Return the current local time as ISO string and epoch milliseconds.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  fn: async (args, ctx) => {
    TimeArgsSchema.parse(args);
    const epochMs = ctx.now();
    return {
      iso: new Date(epochMs).toISOString(),
      epochMs,
    };
  },
};
