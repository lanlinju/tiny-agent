import { z } from 'zod';

const CommandMetaSchema = z.object({
  requestId: z.string().min(1).optional(),
});

export const SessionCreateCommandSchema = CommandMetaSchema.extend({
  type: z.literal('session.create'),
  payload: z.object({}).strict(),
}).strict();

export const SessionAttachCommandSchema = CommandMetaSchema.extend({
  type: z.literal('session.attach'),
  payload: z.object({
    sessionId: z.string().min(1),
    since: z.number().int().nonnegative().optional(),
  }).strict(),
}).strict();

export const MessageSendCommandSchema = CommandMetaSchema.extend({
  type: z.literal('message.send'),
  payload: z.object({
    sessionId: z.string().min(1),
    text: z.string().min(1),
    thinking: z.boolean().optional(),
  }).strict(),
}).strict();

export const ApprovalRespondCommandSchema = CommandMetaSchema.extend({
  type: z.literal('approval.respond'),
  payload: z.object({
    approvalId: z.string().min(1),
    approved: z.boolean(),
  }).strict(),
}).strict();

export const InterruptCommandSchema = CommandMetaSchema.extend({
  type: z.literal('interrupt'),
  payload: z.object({
    sessionId: z.string().min(1),
  }).strict(),
}).strict();

/** Queue a steering message for a running session; injected before the next LLM call. */
export const SteerCommandSchema = CommandMetaSchema.extend({
  type: z.literal('steer'),
  payload: z.object({
    sessionId: z.string().min(1),
    text: z.string().min(1),
  }).strict(),
}).strict();

/** Client-to-server command schema shared by clients and server. */
export const AgentCommandSchema = z.discriminatedUnion('type', [
  SessionCreateCommandSchema,
  SessionAttachCommandSchema,
  MessageSendCommandSchema,
  ApprovalRespondCommandSchema,
  InterruptCommandSchema,
  SteerCommandSchema,
]);

/** Client-to-server command type inferred from the zod schema. */
export type AgentCommand = z.infer<typeof AgentCommandSchema>;

/** Validate unknown input as an Agent command. */
export function parseAgentCommand(input: unknown): AgentCommand {
  return AgentCommandSchema.parse(input);
}

/** Return whether unknown input is a valid Agent command. */
export function isAgentCommand(input: unknown): input is AgentCommand {
  return AgentCommandSchema.safeParse(input).success;
}
