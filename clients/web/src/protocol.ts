/** Wire protocol types mirrored from `src/protocols` (client-side, no imports). */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface AgentCommand {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export type AgentEvent =
  | { type: 'session.created' | 'session.attached'; payload: { sessionId: string } }
  | { type: 'user.message'; payload: { text: string } }
  | { type: 'turn.started'; payload: { goal: string } }
  | { type: 'turn.completed'; payload: { answer: string } }
  | { type: 'turn.interrupted'; payload: Record<string, never> }
  | { type: 'message.delta'; payload: { messageId: string; text: string } }
  | { type: 'message.completed'; payload: { messageId: string; role: string; content: string } }
  | { type: 'tool.started'; payload: { toolCallId: string; tool: string; args: JsonValue } }
  | {
      type: 'tool.finished';
      payload: { toolCallId: string; tool: string; result?: JsonValue; error?: string };
    }
  | { type: 'queue_update'; payload: { steering: string[] } }
  | { type: 'error'; payload: { message: string; code?: string } }
  | { type: 'approval.requested'; payload: { approvalId: string; tool: string; args: JsonValue } }
  | { type: 'approval.resolved'; payload: { approvalId: string; approved: boolean } };
