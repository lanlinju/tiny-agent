import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatEvent } from '../../clients/cli/render';
import { parseAgentEvent } from '../../src/protocols/events';

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
