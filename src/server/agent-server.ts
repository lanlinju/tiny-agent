import { randomUUID } from 'node:crypto';
import { MaxStepsExceededError, runLoop } from '../core/agent-loop';
import { defaultSystemPrompt } from '../core/prompt';
import type { RunContext } from '../core/types';
import type { LLMProvider } from '../llm/provider';
import type { ToolRegistry } from '../tools/registry';
import type { AgentCommand } from '../protocols/commands';
import { parseAgentCommand } from '../protocols/commands';
import type { AgentEvent } from '../protocols/events';
import { parseAgentEvent } from '../protocols/events';
import type { SessionStore } from '../store/session-store';
import type { EventBus } from './event-bus';
import { createEventBus } from './event-bus';

export interface AgentServerOptions {
  readonly llm: LLMProvider;
  readonly tools: ToolRegistry;
  readonly store: SessionStore;
  readonly owner: string;
  readonly agentId?: string;
  readonly maxSteps?: number;
  readonly now?: () => number;
}

export interface AgentServer {
  readonly bus: EventBus;
  /** Validate and dispatch a raw client command; invalid input becomes an error event. */
  handleRawCommand(raw: unknown): Promise<void>;
}

/**
 * The only translation layer between clients and core.
 *
 * It owns sessions, command dispatch, event emission, store coordination and
 * (from phase 6) approval policy. It never implements LLM or tool internals.
 */
export function createAgentServer(options: AgentServerOptions): AgentServer {
  const bus = createEventBus();
  const agentId = options.agentId ?? 'agent-1';
  const owner = options.owner;
  const maxSteps = options.maxSteps ?? 8;
  const now = options.now ?? (() => Date.now());
  const sessions = new Set<string>();

  function meta(sessionId: string): Pick<AgentEvent, 'sessionId' | 'ts' | 'agentId' | 'owner'> {
    return { sessionId, ts: now(), agentId, owner };
  }

  async function emit(event: AgentEvent): Promise<void> {
    // Validation boundary: broadcast only validated events, and persist the same bytes.
    const validated = parseAgentEvent(event);
    await options.store.append(validated);
    bus.publish(validated);
  }

  async function emitError(sessionId: string, message: string, code: string): Promise<void> {
    await emit({ type: 'error', ...meta(sessionId), payload: { message, code } });
  }

  async function createSession(): Promise<void> {
    const sessionId = `session-${randomUUID()}`;
    sessions.add(sessionId);
    await emit({ type: 'session.created', ...meta(sessionId), payload: { sessionId } });
    await emit({ type: 'session.attached', ...meta(sessionId), payload: { sessionId } });
  }

  async function attachSession(sessionId: string): Promise<void> {
    if (!sessions.has(sessionId)) {
      await emitError(sessionId, `Unknown session: ${sessionId}`, 'unknown_session');
      return;
    }
    await emit({ type: 'session.attached', ...meta(sessionId), payload: { sessionId } });
  }

  async function sendMessage(sessionId: string, text: string): Promise<void> {
    if (!sessions.has(sessionId)) {
      await emitError(sessionId, `Unknown session: ${sessionId}`, 'unknown_session');
      return;
    }

    await emit({ type: 'user.message', ...meta(sessionId), payload: { text } });

    const ctx: RunContext = {
      sessionId,
      agentId,
      owner,
      maxSteps,
      llm: options.llm,
      tools: options.tools,
      systemPrompt: defaultSystemPrompt,
      // Session memory/compaction is a later concern; phase 3 runs each turn from its goal.
      history: () => [],
      shouldCompact: () => false,
      compact: async (messages) => messages,
      // Approval policy is server-owned but lands in phase 6; the demo time tool never asks.
      needsApproval: () => false,
      requestApproval: async () => false,
      emit,
      now,
      nextId: (prefix) => `${prefix}-${randomUUID()}`,
    };

    try {
      await runLoop(ctx, text);
    } catch (error) {
      if (error instanceof MaxStepsExceededError) {
        // core already emitted an error event before throwing; avoid duplicating it.
        return;
      }
      await emitError(sessionId, formatError(error), 'turn_failed');
    }
  }

  async function handleCommand(command: AgentCommand): Promise<void> {
    switch (command.type) {
      case 'session.create':
        await createSession();
        return;
      case 'session.attach':
        await attachSession(command.payload.sessionId);
        return;
      case 'message.send':
        await sendMessage(command.payload.sessionId, command.payload.text);
        return;
      case 'approval.respond':
      case 'interrupt':
        // Reserved: approval (phase 6) and interrupt handling arrive in later phases.
        return;
    }
  }

  return {
    bus,
    async handleRawCommand(raw) {
      let command: AgentCommand;
      try {
        command = parseAgentCommand(raw);
      } catch (error) {
        await emitError(
          'invalid-command',
          `Invalid command: ${formatError(error)}`,
          'invalid_command',
        );
        return;
      }
      await handleCommand(command);
    },
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
