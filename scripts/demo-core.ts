import { runLoop } from '../src/core/agent-loop';
import { defaultSystemPrompt } from '../src/core/prompt';
import type { RunContext } from '../src/core/types';
import { createMockLLM } from '../src/llm/mock';
import { createToolRegistry } from '../src/tools/registry';
import { timeTool } from '../src/tools/builtin/time';
import type { AgentEvent } from '../src/protocols/events';

/**
 * Local-only phase 2 demo.
 *
 * This file is a composition root, not a production entry point: it wires the
 * `core` loop to the deterministic `llm/mock` provider and the demo-only
 * `tools/builtin/time` tool, then prints the events the loop emits. No
 * server, store, client or approval policy is involved yet.
 */
async function main(): Promise<void> {
  const registry = createToolRegistry([timeTool]);
  const llm = createMockLLM();
  let idCounter = 0;

  const ctx: RunContext = {
    sessionId: 'demo-session',
    agentId: 'demo-agent',
    owner: 'local',
    cwd: process.cwd(),
    maxSteps: 8,
    reasoning: false,
    llm,
    tools: registry,
    systemPrompt: defaultSystemPrompt,
    history: () => [],
    shouldCompact: () => false,
    compact: async (messages) => messages,
    drainSteering: () => [],
    // Approval policy belongs to the server layer (phase 6); the demo tool never needs it.
    needsApproval: () => false,
    requestApproval: async () => true,
    emit: (event) => {
      console.log(`[${event.type}] ${formatEvent(event)}`);
    },
    now: () => Date.now(),
    nextId: (prefix) => {
      idCounter += 1;
      return `${prefix}-${idCounter}`;
    },
  };

  const goal = 'What time is it right now?';
  console.log(`demo:core goal=${JSON.stringify(goal)}`);

  const answer = await runLoop(ctx, goal);
  console.log(`final answer: ${answer}`);
}

function formatEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'turn.started':
      return `goal=${JSON.stringify(event.payload.goal)}`;
    case 'message.completed':
      return `role=${event.payload.role} content=${JSON.stringify(event.payload.content)}`;
    case 'tool.started':
      return `tool=${event.payload.tool} args=${JSON.stringify(event.payload.args)}`;
    case 'tool.finished':
      return [
        `tool=${event.payload.tool}`,
        `result=${event.payload.result === undefined ? 'none' : JSON.stringify(event.payload.result)}`,
        `error=${event.payload.error ?? 'none'}`,
      ].join(' ');
    case 'turn.completed':
      return `answer=${JSON.stringify(event.payload.answer)}`;
    case 'error':
      return `message=${JSON.stringify(event.payload.message)} code=${event.payload.code ?? 'none'}`;
    default:
      return JSON.stringify(event.payload);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`demo:core failed: ${message}`);
  process.exitCode = 1;
});
