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
import { selectReplayEvents } from '../store/replay';
import { createEventBus } from './event-bus';

export interface AgentServerOptions {
  readonly llm: LLMProvider;
  readonly tools: ToolRegistry;
  readonly store: SessionStore;
  readonly owner: string;
  readonly agentId?: string;
  readonly cwd?: string;
  readonly maxSteps?: number;
  readonly now?: () => number;
}

/** A client connection that can receive events; implemented by the transport. */
export interface AgentConnection {
  send(event: AgentEvent): void;
}

export interface AgentServer {
  /** Validate and dispatch a raw client command for a given connection. */
  handleRawCommand(raw: unknown, connection: AgentConnection): Promise<void>;
  /** Drop a connection and all of its session subscriptions. */
  removeConnection(connection: AgentConnection): void;
}

/** Per-session runtime state owned by the server. */
interface SessionState {
  running: boolean;
  steering: string[];
}

/** Events that are broadcast but never written to events.jsonl. */
const TRANSIENT_EVENT_TYPES = new Set<AgentEvent['type']>(['message.delta', 'queue_update']);

/**
 * The only translation layer between clients and core.
 *
 * It owns sessions, command dispatch, per-session event routing, store
 * coordination and (from phase 6) approval policy. It never implements LLM or
 * tool internals, and it does not know about WebSocket or HTTP.
 */
export function createAgentServer(options: AgentServerOptions): AgentServer {
  const bus = createEventBus();
  const agentId = options.agentId ?? 'agent-1';
  const owner = options.owner;
  const cwd = options.cwd ?? process.cwd();
  const maxSteps = options.maxSteps ?? 8;
  const now = options.now ?? (() => Date.now());
  const sessions = new Map<string, SessionState>();
  const subscriptions = new Map<AgentConnection, Set<() => void>>();

  function meta(sessionId: string): Pick<AgentEvent, 'sessionId' | 'ts' | 'agentId' | 'owner'> {
    return { sessionId, ts: now(), agentId, owner };
  }

  async function emit(event: AgentEvent): Promise<void> {
    // Validation boundary: broadcast only validated events.
    const validated = parseAgentEvent(event);
    // Transient events are broadcast but kept out of events.jsonl.
    if (!TRANSIENT_EVENT_TYPES.has(validated.type)) {
      await options.store.append(validated);
    }
    bus.publish(validated);
  }

  function sendTo(connection: AgentConnection, event: AgentEvent): void {
    connection.send(parseAgentEvent(event));
  }

  function serviceError(sessionId: string, message: string, code: string): AgentEvent {
    return { type: 'error', ...meta(sessionId), payload: { message, code } };
  }

  function subscribe(connection: AgentConnection, sessionId: string): void {
    const unsubscribe = bus.subscribe(sessionId, (event) => connection.send(event));
    let owned = subscriptions.get(connection);
    if (!owned) {
      owned = new Set();
      subscriptions.set(connection, owned);
    }
    owned.add(unsubscribe);
  }

  function removeConnection(connection: AgentConnection): void {
    const owned = subscriptions.get(connection);
    if (!owned) {
      return;
    }
    for (const unsubscribe of owned) {
      unsubscribe();
    }
    subscriptions.delete(connection);
  }

  function ensureSession(sessionId: string): SessionState {
    let state = sessions.get(sessionId);
    if (!state) {
      state = { running: false, steering: [] };
      sessions.set(sessionId, state);
    }
    return state;
  }

  function takeSteering(state: SessionState, sessionId: string): string[] {
    if (state.steering.length === 0) {
      return [];
    }
    const drained = [...state.steering];
    state.steering.length = 0;
    // Transient: let clients clear their queue indicator.
    void emit({ type: 'queue_update', ...meta(sessionId), payload: { steering: [] } });
    return drained;
  }

  async function createSession(connection: AgentConnection): Promise<void> {
    const sessionId = `session-${randomUUID()}`;
    ensureSession(sessionId);
    subscribe(connection, sessionId);
    await emit({ type: 'session.created', ...meta(sessionId), payload: { sessionId } });
    await emit({ type: 'session.attached', ...meta(sessionId), payload: { sessionId } });
  }

  async function attachSession(
    connection: AgentConnection,
    sessionId: string,
    since: number,
  ): Promise<void> {
    const stored = await options.store.read(sessionId);
    if (!sessions.has(sessionId) && stored.length === 0) {
      sendTo(connection, serviceError(sessionId, `Unknown session: ${sessionId}`, 'unknown_session'));
      return;
    }
    // Rehydrate the session from the store so attach survives a server restart.
    ensureSession(sessionId);
    subscribe(connection, sessionId);

    // Replay persisted reasoning to this connection only: it is already stored,
    // so it must not be re-appended or re-broadcast to other clients.
    for (const event of selectReplayEvents(stored, since)) {
      sendTo(connection, event);
    }

    await emit({
      type: 'session.attached',
      ...meta(sessionId),
      payload: since > 0 ? { sessionId, replayFrom: since } : { sessionId },
    });
  }

  async function sendMessage(
    connection: AgentConnection,
    sessionId: string,
    text: string,
  ): Promise<void> {
    const state = sessions.get(sessionId);
    if (!state) {
      sendTo(connection, serviceError(sessionId, `Unknown session: ${sessionId}`, 'unknown_session'));
      return;
    }

    // Mark running before any await so a steer arriving right after send is queued.
    state.running = true;
    try {
      await emit({ type: 'user.message', ...meta(sessionId), payload: { text } });

      const ctx: RunContext = {
        sessionId,
        agentId,
        owner,
        cwd,
        maxSteps,
        llm: options.llm,
        tools: options.tools,
        systemPrompt: defaultSystemPrompt,
        // Session memory/compaction is a later concern; each turn runs from its goal.
        history: () => [],
        shouldCompact: () => false,
        compact: async (messages) => messages,
        drainSteering: () => takeSteering(state, sessionId),
        // Approval policy is server-owned but lands in phase 6; tools run directly for now.
        needsApproval: () => false,
        requestApproval: async () => false,
        emit,
        now,
        nextId: (prefix) => `${prefix}-${randomUUID()}`,
      };

      await runLoop(ctx, text);
    } catch (error) {
      if (error instanceof MaxStepsExceededError) {
        // core already emitted an error event before throwing; avoid duplicating it.
        return;
      }
      await emit(serviceError(sessionId, formatError(error), 'turn_failed'));
    } finally {
      state.running = false;
    }
  }

  async function steer(
    connection: AgentConnection,
    sessionId: string,
    text: string,
  ): Promise<void> {
    const state = sessions.get(sessionId);
    if (!state) {
      sendTo(connection, serviceError(sessionId, `Unknown session: ${sessionId}`, 'unknown_session'));
      return;
    }
    if (!state.running) {
      // Idle: treat steering like an ordinary message so it still works.
      await sendMessage(connection, sessionId, text);
      return;
    }
    state.steering.push(text);
    await emit({ type: 'user.message', ...meta(sessionId), payload: { text } });
    await emit({
      type: 'queue_update',
      ...meta(sessionId),
      payload: { steering: [...state.steering] },
    });
  }

  async function handleCommand(command: AgentCommand, connection: AgentConnection): Promise<void> {
    switch (command.type) {
      case 'session.create':
        await createSession(connection);
        return;
      case 'session.attach':
        await attachSession(connection, command.payload.sessionId, command.payload.since ?? 0);
        return;
      case 'message.send':
        await sendMessage(connection, command.payload.sessionId, command.payload.text);
        return;
      case 'steer':
        await steer(connection, command.payload.sessionId, command.payload.text);
        return;
      case 'approval.respond':
      case 'interrupt':
        // Reserved: approval (phase 6) and interrupt handling arrive in later phases.
        return;
    }
  }

  return {
    async handleRawCommand(raw, connection) {
      let command: AgentCommand;
      try {
        command = parseAgentCommand(raw);
      } catch (error) {
        sendTo(
          connection,
          serviceError('invalid-command', `Invalid command: ${formatError(error)}`, 'invalid_command'),
        );
        return;
      }
      await handleCommand(command, connection);
    },
    removeConnection,
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
