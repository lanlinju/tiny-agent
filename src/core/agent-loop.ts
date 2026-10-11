import type { AgentEvent, JsonValue } from '../protocols/events';
import { JsonValueSchema } from '../protocols/events';
import type { ImagePart } from '../protocols/content';
import { ImagePartSchema } from '../protocols/content';
import type { Message, ToolCall } from '../llm/provider';
import { contentText } from '../llm/provider';
import type { RunContext } from './types';

/** Thrown when the loop exceeds RunContext.maxSteps after emitting an error event. */
export class MaxStepsExceededError extends Error {
  constructor(maxSteps: number) {
    super(`Agent exceeded max steps (${maxSteps})`);
    this.name = 'MaxStepsExceededError';
  }
}

/** Run the minimal ReAct-style agent loop until no tool call remains. */
export async function runLoop(ctx: RunContext, goal: string): Promise<string> {
  let messages: Message[] = [
    { role: 'system', content: ctx.systemPrompt() },
    ...ctx.history(),
    { role: 'user', content: goal },
  ];

  await emitTurnStarted(ctx, goal);

  for (let step = 0; step < ctx.maxSteps; step += 1) {
    if (ctx.shouldCompact(messages)) {
      messages = [...await ctx.compact(messages)];
    }

    const messageId = ctx.nextId('message');
    const response = await ctx.llm.chat({
      messages,
      tools: ctx.tools.schemas(),
      reasoning: ctx.reasoning,
      onDelta: (text) => emitMessageDelta(ctx, messageId, text),
      onReasoningDelta: (text) => emitReasoningDelta(ctx, messageId, text),
    });

    if (response.reasoning !== undefined && response.reasoning !== '') {
      await emitReasoningCompleted(ctx, messageId, response.reasoning);
    }

    messages.push(response);
    await emitMessageCompleted(ctx, messageId, contentText(response.content));

    const images: ImagePart[] = [];
    for (const call of response.toolCalls) {
      await handleToolCall(ctx, messages, call, images);
    }

    // Images returned by tools travel as a user message so any vision-capable
    // provider sees them, without depending on tool-result content support.
    if (images.length > 0) {
      messages.push({ role: 'user', content: images });
    }

    // Steering messages enter after this turn's tool calls, before the next LLM call.
    const steering = ctx.drainSteering();
    if (response.toolCalls.length === 0 && steering.length === 0) {
      const answer = contentText(response.content);
      await emitTurnCompleted(ctx, answer);
      return answer;
    }
    for (const text of steering) {
      messages.push({ role: 'user', content: text });
    }
  }

  await emitError(ctx, '超过最大步数', 'max_steps_exceeded');
  throw new MaxStepsExceededError(ctx.maxSteps);
}

async function handleToolCall(
  ctx: RunContext,
  messages: Message[],
  call: ToolCall,
  images: ImagePart[],
): Promise<void> {
  const tool = call.function.name;
  const argsResult = parseToolArguments(call.function.arguments);

  await emitToolStarted(ctx, call.id, tool, argsResult.value);

  if (!argsResult.ok) {
    await finishToolWithError(ctx, messages, call.id, tool, argsResult.error);
    return;
  }

  if (ctx.needsApproval(tool)) {
    const approved = await ctx.requestApproval({ tool, args: argsResult.value });
    if (!approved) {
      await finishToolWithError(ctx, messages, call.id, tool, '用户拒绝');
      return;
    }
  }

  try {
    const result = await ctx.tools.call(tool, argsResult.value, { now: ctx.now, cwd: ctx.cwd });
    const { images: resultImages, rest } = extractImages(result);
    images.push(...resultImages);
    messages.push({
      role: 'tool',
      toolCallId: call.id,
      content: JSON.stringify(rest),
    });
    await emitToolFinished(ctx, call.id, tool, rest);
  } catch (error) {
    await finishToolWithError(ctx, messages, call.id, tool, formatError(error));
  }
}

/**
 * Split a tool result into model-facing image parts and the JSON-safe remainder.
 *
 * Tools advertise an image by returning an `image` block with `data` and
 * `mimeType`. The block is sent to the model but stripped from the event and
 * tool message so base64 never reaches `events.jsonl`.
 */
function extractImages(result: JsonValue): { images: ImagePart[]; rest: JsonValue } {
  if (isRecord(result) && 'image' in result) {
    const { image, ...rest } = result;
    const parsed = ImagePartSchema.safeParse(image);
    if (parsed.success) {
      return { images: [parsed.data], rest };
    }
  }
  return { images: [], rest: result };
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type ParseResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly value: JsonValue; readonly error: string };

function parseToolArguments(raw: string): ParseResult {
  try {
    const parsed: unknown = raw.trim() === '' ? {} : JSON.parse(raw);
    return { ok: true, value: JsonValueSchema.parse(parsed) };
  } catch (error) {
    return { ok: false, value: raw, error: formatError(error) };
  }
}

async function finishToolWithError(
  ctx: RunContext,
  messages: Message[],
  toolCallId: string,
  tool: string,
  error: string,
): Promise<void> {
  messages.push({
    role: 'tool',
    toolCallId,
    content: `Error: ${error}`,
  });
  await emitToolError(ctx, toolCallId, tool, error);
}

function meta(ctx: RunContext): Pick<AgentEvent, 'sessionId' | 'ts' | 'agentId' | 'owner'> {
  return {
    sessionId: ctx.sessionId,
    ts: ctx.now(),
    agentId: ctx.agentId,
    owner: ctx.owner,
  };
}

async function emitTurnStarted(ctx: RunContext, goal: string): Promise<void> {
  await ctx.emit({ type: 'turn.started', ...meta(ctx), payload: { goal } });
}

async function emitTurnCompleted(ctx: RunContext, answer: string): Promise<void> {
  await ctx.emit({ type: 'turn.completed', ...meta(ctx), payload: { answer } });
}

async function emitMessageCompleted(
  ctx: RunContext,
  messageId: string,
  content: string,
): Promise<void> {
  await ctx.emit({
    type: 'message.completed',
    ...meta(ctx),
    payload: { messageId, role: 'assistant', content },
  });
}

async function emitMessageDelta(ctx: RunContext, messageId: string, text: string): Promise<void> {
  await ctx.emit({ type: 'message.delta', ...meta(ctx), payload: { messageId, text } });
}

async function emitReasoningDelta(ctx: RunContext, messageId: string, text: string): Promise<void> {
  await ctx.emit({ type: 'reasoning.delta', ...meta(ctx), payload: { messageId, text } });
}

async function emitReasoningCompleted(
  ctx: RunContext,
  messageId: string,
  content: string,
): Promise<void> {
  await ctx.emit({ type: 'reasoning.completed', ...meta(ctx), payload: { messageId, content } });
}

async function emitToolStarted(
  ctx: RunContext,
  toolCallId: string,
  tool: string,
  args: JsonValue,
): Promise<void> {
  await ctx.emit({ type: 'tool.started', ...meta(ctx), payload: { toolCallId, tool, args } });
}

async function emitToolFinished(
  ctx: RunContext,
  toolCallId: string,
  tool: string,
  result: JsonValue,
): Promise<void> {
  await ctx.emit({
    type: 'tool.finished',
    ...meta(ctx),
    payload: { toolCallId, tool, result },
  });
}

async function emitToolError(
  ctx: RunContext,
  toolCallId: string,
  tool: string,
  error: string,
): Promise<void> {
  await ctx.emit({ type: 'tool.finished', ...meta(ctx), payload: { toolCallId, tool, error } });
}

async function emitError(ctx: RunContext, message: string, code: string): Promise<void> {
  await ctx.emit({ type: 'error', ...meta(ctx), payload: { message, code } });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
