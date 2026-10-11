import { z } from 'zod';

/** JSON-compatible value allowed inside protocol payloads. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Runtime schema for JSON-compatible values. */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

const EventMetaSchema = z.object({
  sessionId: z.string().min(1),
  ts: z.number().int().nonnegative(),
  agentId: z.string().min(1),
  owner: z.string().min(1),
});

const MessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);

export const SessionCreatedEventSchema = EventMetaSchema.extend({
  type: z.literal('session.created'),
  payload: z.object({ sessionId: z.string().min(1) }).strict(),
}).strict();

export const SessionAttachedEventSchema = EventMetaSchema.extend({
  type: z.literal('session.attached'),
  payload: z.object({
    sessionId: z.string().min(1),
    replayFrom: z.number().int().nonnegative().optional(),
  }).strict(),
}).strict();

export const UserMessageEventSchema = EventMetaSchema.extend({
  type: z.literal('user.message'),
  payload: z.object({ text: z.string() }).strict(),
}).strict();

export const TurnStartedEventSchema = EventMetaSchema.extend({
  type: z.literal('turn.started'),
  payload: z.object({ goal: z.string() }).strict(),
}).strict();

export const TurnCompletedEventSchema = EventMetaSchema.extend({
  type: z.literal('turn.completed'),
  payload: z.object({ answer: z.string() }).strict(),
}).strict();

export const TurnInterruptedEventSchema = EventMetaSchema.extend({
  type: z.literal('turn.interrupted'),
  payload: z.object({}).strict(),
}).strict();

export const MessageDeltaEventSchema = EventMetaSchema.extend({
  type: z.literal('message.delta'),
  payload: z.object({
    messageId: z.string().min(1),
    text: z.string(),
  }).strict(),
}).strict();

export const MessageCompletedEventSchema = EventMetaSchema.extend({
  type: z.literal('message.completed'),
  payload: z.object({
    messageId: z.string().min(1),
    role: MessageRoleSchema,
    content: z.string(),
  }).strict(),
}).strict();

export const ToolStartedEventSchema = EventMetaSchema.extend({
  type: z.literal('tool.started'),
  payload: z.object({
    toolCallId: z.string().min(1),
    tool: z.string().min(1),
    args: JsonValueSchema,
  }).strict(),
}).strict();

export const ToolFinishedEventSchema = EventMetaSchema.extend({
  type: z.literal('tool.finished'),
  payload: z.object({
    toolCallId: z.string().min(1),
    tool: z.string().min(1),
    result: JsonValueSchema.optional(),
    error: z.string().optional(),
  }).strict(),
}).strict();

export const ApprovalRequestedEventSchema = EventMetaSchema.extend({
  type: z.literal('approval.requested'),
  payload: z.object({
    approvalId: z.string().min(1),
    tool: z.string().min(1),
    args: JsonValueSchema,
    timeoutMs: z.number().int().positive(),
  }).strict(),
}).strict();

export const ApprovalResolvedEventSchema = EventMetaSchema.extend({
  type: z.literal('approval.resolved'),
  payload: z.object({
    approvalId: z.string().min(1),
    approved: z.boolean(),
  }).strict(),
}).strict();

export const ErrorEventSchema = EventMetaSchema.extend({
  type: z.literal('error'),
  payload: z.object({
    message: z.string(),
    code: z.string().optional(),
  }).strict(),
}).strict();

/** Server-to-client event schema shared by server, clients and store. */
export const AgentEventSchema = z.discriminatedUnion('type', [
  SessionCreatedEventSchema,
  SessionAttachedEventSchema,
  UserMessageEventSchema,
  TurnStartedEventSchema,
  TurnCompletedEventSchema,
  TurnInterruptedEventSchema,
  MessageDeltaEventSchema,
  MessageCompletedEventSchema,
  ToolStartedEventSchema,
  ToolFinishedEventSchema,
  ApprovalRequestedEventSchema,
  ApprovalResolvedEventSchema,
  ErrorEventSchema,
]);

/** Server-to-client event type inferred from the zod schema. */
export type AgentEvent = z.infer<typeof AgentEventSchema>;

/** Validate unknown input as an Agent event. */
export function parseAgentEvent(input: unknown): AgentEvent {
  return AgentEventSchema.parse(input);
}

/** Return whether unknown input is a valid Agent event. */
export function isAgentEvent(input: unknown): input is AgentEvent {
  return AgentEventSchema.safeParse(input).success;
}
