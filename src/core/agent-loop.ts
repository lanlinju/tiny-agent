import type { AgentEvent, JsonValue } from '../protocols/events';
import { JsonValueSchema } from '../protocols/events';
import type { Message, ToolCall } from '../llm/provider';
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

    const response = await ctx.llm.chat({
      messages,
      tools: ctx.tools.schemas(),
    });

    messages.push(response);
    await emitMessageCompleted(ctx, response.content);

    if (response.toolCalls.length === 0) {
      await emitTurnCompleted(ctx, response.content);
      return response.content;
    }

    for (const call of response.toolCalls) {
      await handleToolCall(ctx, messages, call);
    }
  }

  await emitError(ctx, '超过最大步数', 'max_steps_exceeded');
  throw new MaxStepsExceededError(ctx.maxSteps);
}

async function handleToolCall(
  ctx: RunContext,
  messages: Message[],
  call: ToolCall,
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
    const result = await ctx.tools.call(tool, argsResult.value, { now: ctx.now });
    messages.push({
      role: 'tool',
      toolCallId: call.id,
      content: JSON.stringify(result),
    });
    await emitToolFinished(ctx, call.id, tool, result);
  } catch (error) {
    await finishToolWithError(ctx, messages, call.id, tool, formatError(error));
  }
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

async function emitMessageCompleted(ctx: RunContext, content: string): Promise<void> {
  await ctx.emit({
    type: 'message.completed',
    ...meta(ctx),
    payload: { messageId: ctx.nextId('message'), role: 'assistant', content },
  });
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
