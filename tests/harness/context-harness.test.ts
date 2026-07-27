import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTEXT_SYSTEM_PROMPT,
  CONTEXT_WORKSPACE_LINE,
  ContextHarness,
} from '../../src/harness/context';

const tools = [
  {
    name: 'read',
    description: 'Read a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'write',
    description: 'Write a file',
    parameters: { type: 'object', properties: { path: { type: 'string' } } },
  },
];

test('Harness/Context stabilizes the system prompt across session workspaces', () => {
  const harness = new ContextHarness();
  const first = `Pi base\n${CONTEXT_SYSTEM_PROMPT}\n\nCurrent working directory: C:\\work\\.workspace\\session-a`;
  const second = `Pi base\n${CONTEXT_SYSTEM_PROMPT}\n\nCurrent working directory: C:\\work\\.workspace\\session-b`;

  assert.equal(harness.stabilizeSystemPrompt(first), harness.stabilizeSystemPrompt(second));
  assert.match(harness.stabilizeSystemPrompt(first), new RegExp(CONTEXT_WORKSPACE_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(
    harness.prefixSnapshot(first, tools).fingerprint,
    harness.prefixSnapshot(second, tools).fingerprint,
  );
});

test('Harness/Context keeps tool order fixed and hashes schemas deterministically', () => {
  const harness = new ContextHarness();
  assert.deepEqual(
    harness.stableToolNames(['read', 'write'], ['goal_create', 'read', 'goal_update']),
    ['read', 'write', 'goal_create', 'goal_update'],
  );

  const reorderedObjectKeys = [{
    name: 'read',
    parameters: {
      properties: {
        limit: { type: 'number' },
        path: { type: 'string' },
      },
      type: 'object',
    },
    description: 'Read a file',
  }, tools[1]];
  const baseline = harness.prefixSnapshot('Stable system prompt', tools);
  const same = harness.prefixSnapshot('Stable system prompt', reorderedObjectKeys);
  const changed = harness.prefixSnapshot('Stable system prompt', [
    { ...tools[0], parameters: { type: 'object', properties: { file: { type: 'string' } } } },
    tools[1],
  ]);

  assert.equal(same.fingerprint, baseline.fingerprint);
  assert.notEqual(changed.fingerprint, baseline.fingerprint);
});

test('Harness/Context reports provider cache usage and static-prefix drift', () => {
  const harness = new ContextHarness();
  const baseline = harness.prefixSnapshot('Stable system prompt', tools);
  const current = harness.prefixSnapshot('Stable system prompt', tools);
  const metrics = harness.turnMetrics(
    { input: 200, cacheRead: 800, cacheWrite: 0 },
    current,
    baseline,
  );

  assert.deepEqual(metrics, {
    cacheRead: 800,
    cacheWrite: 0,
    cacheHitRate: 0.8,
    contextPrefix: current.fingerprint.slice(0, 12),
    contextPrefixStable: true,
  });
  assert.equal(
    harness.turnMetrics(
      { input: 100, cacheRead: 0, cacheWrite: 50 },
      harness.prefixSnapshot('Changed system prompt', tools),
      baseline,
    ).contextPrefixStable,
    false,
  );
  assert.equal(harness.assembleUserTurn('task\r\n\r\n<activated_skill />'), 'task\n\n<activated_skill />');
});

test('Harness/Context aggregates only SDK assistant response usage metadata', () => {
  const harness = new ContextHarness();
  const usage = harness.responseUsage([
    {
      role: 'assistant',
      usage: {
        input: 256,
        output: 8,
        cacheRead: 1536,
        cacheWrite: 256,
        cacheWrite1h: 128,
        totalTokens: 2056,
      },
    },
    {
      role: 'toolResult',
      usage: { input: 9999, output: 9999, cacheRead: 9999, totalTokens: 39996 },
    },
    {
      role: 'assistant',
      usage: { input: 100, output: 4, cacheRead: 400, cacheWrite: 0 },
    },
  ]);

  assert.deepEqual(usage, {
    input: 356,
    output: 12,
    cacheRead: 1936,
    cacheWrite: 256,
    cacheWrite1h: 128,
    totalTokens: 2560,
  });
});
