import assert from 'node:assert/strict';
import { test } from 'node:test';
import { colorize, formatEvent, presentEvent } from '../../clients/cli/render';
import { parseAgentEvent } from '../../src/protocols/events';

const PLAIN = { verbose: false, maxOutputLines: 40 };

function event(type: string, payload: unknown) {
  return parseAgentEvent({ type, sessionId: 's', ts: 0, agentId: 'a', owner: 'o', payload });
}

test('formatEvent renders core reasoning lines', () => {
  assert.equal(formatEvent(event('turn.completed', { answer: 'x' })), '[turn] completed');
  assert.equal(formatEvent(event('user.message', { text: 'hi' })), '[user] hi');
  assert.equal(
    formatEvent(event('tool.finished', { toolCallId: 'c', tool: 'read', result: { bytes: 1 } })),
    '[tool] read result={"bytes":1}',
  );
  assert.equal(
    formatEvent(event('tool.finished', { toolCallId: 'c', tool: 'shell', error: 'boom' })),
    '[tool] shell error=boom',
  );
  assert.equal(
    formatEvent(event('error', { message: 'nope', code: 'turn_failed' })),
    '[error] nope (turn_failed)',
  );
});

test('presentEvent hides lifecycle by default and shows it when verbose', () => {
  assert.deepEqual(presentEvent(event('turn.completed', { answer: 'x' }), PLAIN), []);
  assert.equal(
    presentEvent(event('turn.completed', { answer: 'x' }), { ...PLAIN, verbose: true })[0]?.text,
    '· turn completed',
  );
  assert.equal(
    presentEvent(event('session.attached', { sessionId: 's' }), PLAIN).length,
    0,
  );
});

test('presentEvent renders a shell call and its result', () => {
  const started = presentEvent(
    event('tool.started', { toolCallId: 'c', tool: 'shell', args: { command: 'date' } }),
    PLAIN,
  );
  assert.deepEqual(started, [{ kind: 'tool', text: '  ⚙ shell: date' }]);

  const finished = presentEvent(
    event('tool.finished', {
      toolCallId: 'c',
      tool: 'shell',
      result: { stdout: 'hello\n', stderr: '', exitCode: 0, timedOut: false },
    }),
    PLAIN,
  );
  assert.deepEqual(
    finished.map((line) => line.text),
    ['    ↳ exit 0', '    hello'],
  );
});

test('presentEvent skips empty assistant content and splits lines', () => {
  assert.deepEqual(
    presentEvent(event('message.completed', { messageId: 'm', role: 'assistant', content: '' }), PLAIN),
    [],
  );
  const lines = presentEvent(
    event('message.completed', { messageId: 'm', role: 'assistant', content: 'a\nb\n' }),
    PLAIN,
  );
  assert.deepEqual(
    lines.map((line) => line.text),
    ['a', 'b'],
  );
});

test('presentEvent truncates long tool output', () => {
  const stdout = Array.from({ length: 5 }, (_value, index) => `line${index}`).join('\n');
  const lines = presentEvent(
    event('tool.finished', {
      toolCallId: 'c',
      tool: 'shell',
      result: { stdout, stderr: '', exitCode: 0, timedOut: false },
    }),
    { verbose: false, maxOutputLines: 2 },
  );
  assert.deepEqual(
    lines.map((line) => line.text),
    ['    ↳ exit 0', '    line0', '    line1', '    … +3 more lines'],
  );
});

test('colorize only applies ANSI when enabled', () => {
  assert.equal(colorize('error', 'x', false), 'x');
  assert.equal(colorize('error', 'x', true), '\x1b[31mx\x1b[0m');
  assert.equal(colorize('assistant', 'x', true), 'x');
});
