import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionSummary } from '../../src/core/agent';
import { matchesSessionSearch } from '../../src/workspace/sessions/search';

const session: SessionSummary = {
  id: '01JZ8ABC-DeepSeek-42',
  sourceId: '019fa7ca-0005-7830-b28e-b4eb17c7cc2d',
  title: '讨论发布流程',
  group: '今天',
  time: '16:30',
  live: false,
  status: 'idle',
};

test('session search matches title and complete or partial sessid', () => {
  assert.equal(matchesSessionSearch(session, '发布'), true);
  assert.equal(matchesSessionSearch(session, '01jz8abc'), true);
  assert.equal(matchesSessionSearch(session, 'deepseek-42'), true);
  assert.equal(matchesSessionSearch(session, '019fa7ca-0005'), true);
  assert.equal(matchesSessionSearch(session, 'missing'), false);
});

test('session search accepts an explicit sessid prefix', () => {
  assert.equal(matchesSessionSearch(session, 'sessid: 01JZ8ABC'), true);
  assert.equal(matchesSessionSearch(session, 'sessid: 019fa7ca-0005-7830-b28e-b4eb17c7cc2d'), true);
  assert.equal(matchesSessionSearch(session, 'sessionid：deepseek'), true);
});
