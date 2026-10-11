import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentCommand, AgentEvent, JsonValue } from './protocol';

export type ToolItem = {
  id: string;
  kind: 'tool';
  toolCallId: string;
  tool: string;
  args: JsonValue;
  result?: JsonValue;
  error?: string;
  status: 'running' | 'done';
};

export type Item =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; messageId: string; text: string }
  | ToolItem
  | { id: string; kind: 'error'; text: string }
  | { id: string; kind: 'lifecycle'; text: string };

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface AgentController {
  readonly items: Item[];
  readonly status: ConnectionStatus;
  readonly sessionId: string;
  readonly busy: boolean;
  readonly queued: number;
  readonly submit: (text: string) => void;
  readonly newSession: () => void;
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

/** Connect to the agent server and expose its event stream as UI items. */
export function useAgent(requestedSession: string): AgentController {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [sessionId, setSessionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);
  const busyRef = useRef(false);
  const sessionRef = useRef('');

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    sessionRef.current = sessionId;
  }, [sessionId]);

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case 'session.created':
      case 'session.attached':
        setSessionId(event.payload.sessionId);
        break;
      case 'user.message':
        setItems((prev) => [...prev, { id: uid(), kind: 'user', text: event.payload.text }]);
        break;
      case 'turn.started':
        setBusy(true);
        break;
      case 'turn.completed':
      case 'turn.interrupted':
        setBusy(false);
        setQueued(0);
        break;
      case 'message.delta':
        setItems((prev) => mergeAssistant(prev, event.payload.messageId, event.payload.text, false));
        break;
      case 'message.completed':
        setItems((prev) =>
          mergeAssistant(prev, event.payload.messageId, event.payload.content, true),
        );
        break;
      case 'tool.started':
        setItems((prev) => [
          ...prev,
          {
            id: event.payload.toolCallId,
            kind: 'tool',
            toolCallId: event.payload.toolCallId,
            tool: event.payload.tool,
            args: event.payload.args,
            status: 'running',
          },
        ]);
        break;
      case 'tool.finished':
        setItems((prev) =>
          prev.map((item) =>
            item.kind === 'tool' && item.toolCallId === event.payload.toolCallId
              ? {
                  ...item,
                  result: event.payload.result,
                  error: event.payload.error,
                  status: 'done',
                }
              : item,
          ),
        );
        break;
      case 'queue_update':
        setQueued(event.payload.steering.length);
        break;
      case 'error':
        setItems((prev) => [
          ...prev,
          {
            id: uid(),
            kind: 'error',
            text: `${event.payload.message}${event.payload.code ? ` (${event.payload.code})` : ''}`,
          },
        ]);
        setBusy(false);
        break;
      default:
        break;
    }
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    let disposed = false;

    const connect = () => {
      setStatus('connecting');
      const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${scheme}//${window.location.host}`);
      socketRef.current = socket;

      socket.onopen = () => {
        setStatus('connected');
        if (requestedSession) {
          socket.send(
            JSON.stringify({ type: 'session.attach', payload: { sessionId: requestedSession } }),
          );
        } else {
          socket.send(JSON.stringify({ type: 'session.create', payload: {} }));
        }
      };

      socket.onmessage = (message) => {
        let event: AgentEvent;
        try {
          event = JSON.parse(message.data as string) as AgentEvent;
        } catch {
          return;
        }
        handleEvent(event);
      };

      socket.onerror = () => setStatus('disconnected');
      socket.onclose = () => {
        setStatus('disconnected');
        if (!disposed) {
          timer = window.setTimeout(connect, 1000);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
      socketRef.current?.close();
    };
  }, [requestedSession, handleEvent]);

  const submit = useCallback((text: string) => {
    const value = text.trim();
    const socket = socketRef.current;
    if (!value || !sessionRef.current || !socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const command: AgentCommand = busyRef.current
      ? { type: 'steer', payload: { sessionId: sessionRef.current, text: value } }
      : { type: 'message.send', payload: { sessionId: sessionRef.current, text: value } };
    socket.send(JSON.stringify(command));
  }, []);

  const newSession = useCallback(() => {
    window.location.assign(window.location.pathname);
  }, []);

  return { items, status, sessionId, busy, queued, submit, newSession };
}

function mergeAssistant(
  items: Item[],
  messageId: string,
  text: string,
  replace: boolean,
): Item[] {
  const index = items.findIndex((item) => item.kind === 'assistant' && item.messageId === messageId);

  if (index === -1) {
    if (text === '') {
      return items;
    }
    return [...items, { id: messageId, kind: 'assistant', messageId, text }];
  }

  const current = items[index];
  if (current === undefined || current.kind !== 'assistant') {
    return items;
  }
  const next = replace ? text : current.text + text;
  if (next === current.text) {
    return items;
  }
  const copy = [...items];
  copy[index] = { ...current, text: next };
  return copy;
}
