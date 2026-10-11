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
          placeholder={busy ? '运行中，输入将作为 steering' : '给 tiny-agent 发送消息'}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="composer-toolbar">
          <button
            type="button"
            className={`chip ${thinking ? 'chip--on' : ''}`}
            onClick={() => setThinking((current) => !current)}
            aria-pressed={thinking}
            title="使用推理模型（deepseek-reasoner）"
          >
            <IconThink />
            深度思考
          </button>
          <span className="spacer" />
          <button type="button" className="icon-btn" disabled title="附件暂未实现" aria-label="附件">
            <IconClip />
          </button>
          <button
            type="button"
            className="send"
            onClick={submit}
            disabled={value.trim() === ''}
            aria-label={busy ? '发送 steering' : '发送'}
          >
            <IconArrow />
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

function IconThink() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="2.4" />
      <ellipse cx="12" cy="12" rx="9" ry="3.8" />
      <ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(-60 12 12)" />
    </svg>
  );
}

function IconClip() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M21 11.5l-8.4 8.4a5 5 0 0 1-7.1-7.1l8.5-8.5a3.4 3.4 0 0 1 4.8 4.8l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" />
    </svg>
  );
}

function IconArrow() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
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
