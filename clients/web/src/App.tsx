import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAgent } from './useAgent';
import type { AgentController, AssistantItem, Item, ToolItem } from './useAgent';
import type { JsonValue } from './protocol';

export function App() {
  const requestedSession = useMemo(
    () => new URLSearchParams(window.location.search).get('session') ?? '',
    [],
  );
  const agent = useAgent(requestedSession);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [agent.items]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  return (
    <div className="app">
      <Header agent={agent} />
      <div className="scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="thread">
          {agent.items.length === 0 ? (
            <EmptyState />
          ) : (
            agent.items.map((item) => <Row key={item.id} item={item} />)
          )}
        </div>
      </div>
      <Composer busy={agent.busy} queued={agent.queued} onSubmit={agent.submit} />
    </div>
  );
}

function Header({ agent }: { agent: AgentController }) {
  const bad = agent.status === 'disconnected';
  return (
    <header className="topbar">
      <span className="brand">tiny-agent</span>
      <span className={`badge ${agent.status === 'connected' ? 'ok' : bad ? 'bad' : ''}`}>
        {agent.status}
      </span>
      {agent.sessionId ? (
        <button
          className="ghost"
          title={`复制 ${agent.sessionId}`}
          onClick={() => {
            void navigator.clipboard?.writeText(agent.sessionId);
          }}
        >
          {agent.sessionId.slice(0, 20)}…
        </button>
      ) : null}
      <span className="spacer" />
      <button className="ghost" onClick={agent.newSession}>
        新会话
      </button>
    </header>
  );
}

function Row({ item }: { item: Item }) {
  switch (item.kind) {
    case 'user':
      return <div className="msg-user">{item.text}</div>;
    case 'assistant':
      return <AssistantRow item={item} />;
    case 'tool':
      return <ToolCard item={item} />;
    case 'error':
      return <div className="msg-error">✗ {item.text}</div>;
    case 'lifecycle':
      return <div className="msg-lifecycle">{item.text}</div>;
  }
}

function AssistantRow({ item }: { item: AssistantItem }) {
  return (
    <div className="msg-assistant">
      {item.reasoning ? (
        <ThinkingBlock reasoning={item.reasoning} done={item.reasoningDone} />
      ) : null}
      {item.text ? (
        <div className="md">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
        </div>
      ) : null}
    </div>
  );
}

/** DeepSeek-style collapsible reasoning block; collapsed by default. */
function ThinkingBlock({ reasoning, done }: { reasoning: string; done: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`thinking ${done ? '' : 'thinking--live'}`}>
      <button className="thinking-head" onClick={() => setOpen((value) => !value)}>
        <span className="chev">{open ? '▾' : '▸'}</span>
        <span className="thinking-label">{done ? '已深度思考' : '深度思考中…'}</span>
      </button>
      {open ? <div className="thinking-body">{reasoning}</div> : null}
    </div>
  );
}

function ToolCard({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (item.error) {
      setOpen(true);
    }
  }, [item.error]);

  const statusLabel = item.status === 'running' ? 'running' : item.error ? 'error' : 'done';
  const statusClass = item.error ? 'err' : item.status === 'done' ? 'ok' : '';

  return (
    <div className="tool">
      <div
        className="tool-head"
        onClick={() => setOpen((value) => !value)}
        role="button"
        tabIndex={0}
      >
        <span className="chev">{open ? '▾' : '▸'}</span>
        <span className="name">{item.tool}</span>
        <span className="args">{summarizeArgs(item.tool, item.args)}</span>
        <span className="spacer" />
        <span className={`status ${statusClass}`}>{statusLabel}</span>
      </div>
      {open ? <div className="tool-body">{describeResult(item)}</div> : null}
    </div>
  );
}

function Composer({
  busy,
  queued,
  onSubmit,
}: {
  busy: boolean;
  queued: number;
  onSubmit: (text: string, thinking: boolean) => void;
}) {
  const [value, setValue] = useState('');
  const [thinking, setThinking] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text) {
      return;
    }
    onSubmit(text, thinking);
    setValue('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          placeholder={busy ? '运行中，输入将作为 steering…' : '给 tiny-agent 发送消息…'}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="composer-toolbar">
          <button
            type="button"
            className={`chip ${thinking ? 'chip--on' : ''}`}
            onClick={() => setThinking((value2) => !value2)}
            aria-pressed={thinking}
            title="使用推理模型（deepseek-reasoner）"
          >
            <span className="chip-icon">✦</span>
            深度思考
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="send"
            onClick={submit}
            disabled={value.trim() === ''}
            aria-label={busy ? '发送 steering' : '发送'}
          >
            ↑
          </button>
        </div>
      </div>
      <div className="composer-meta">
        <span>{busy ? '运行中 · Enter 作为 steering' : 'Enter 发送 · Shift+Enter 换行'}</span>
        {queued > 0 ? <span className="queued">· {queued} 条排队</span> : null}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <h2>tiny-agent</h2>
      <p>本地编码 agent：读写文件、运行命令，并可在运行中 steer。</p>
      <p className="dim">试试 “看一下这个项目的结构” 或 “修复 npm test 的报错”。</p>
    </div>
  );
}

function asRecord(value: JsonValue | undefined): { [key: string]: JsonValue } | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return undefined;
}

function summarizeArgs(tool: string, args: JsonValue): string {
  const record = asRecord(args);
  if (record) {
    if (tool === 'shell' && typeof record.command === 'string') {
      return record.command;
    }
    if ((tool === 'read' || tool === 'write' || tool === 'edit') && typeof record.path === 'string') {
      return record.path;
    }
    if (typeof record.path === 'string' && Object.keys(record).length === 1) {
      return record.path;
    }
  }
  return JSON.stringify(args);
}

function describeResult(item: ToolItem): string {
  if (item.error) {
    return `error: ${item.error}`;
  }
  const record = asRecord(item.result);
  if (!record) {
    return item.result === undefined ? '(no output)' : JSON.stringify(item.result, null, 2);
  }

  if (item.tool === 'shell') {
    const exit = typeof record.exitCode === 'number' ? record.exitCode : '?';
    const stdout = typeof record.stdout === 'string' ? record.stdout : '';
    const stderr = typeof record.stderr === 'string' ? record.stderr : '';
    return [`exit ${exit}`, stdout.trimEnd(), stderr ? `stderr:\n${stderr.trimEnd()}` : '']
      .filter((part) => part !== '')
      .join('\n');
  }

  if (item.tool === 'read' && typeof record.content === 'string') {
    return record.content;
  }

  return JSON.stringify(record, null, 2);
}
