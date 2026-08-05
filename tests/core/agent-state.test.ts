import assert from 'node:assert/strict';
import test from 'node:test';
import { initialAgentState, reduceAgentEvent } from '../../src/core/agent/state';

test('Core/Agent state follows the authoritative Thinking event', () => {
  const enabled = reduceAgentEvent(initialAgentState, {
    type: 'thinking_updated',
    sessionId: 'test',
    thinking: true,
  });

  assert.deepEqual(enabled, { thinking: true });
});

test('Core/Agent state adds a generated Goal report to the session files', () => {
  const report = {
    type: 'goal_report' as const,
    sessionId: 'test',
    goalId: 'goal-1',
    file: { name: 'goal-budget-report-goal1.md', path: 'goal-budget-report-goal1.md', type: 'md' as const },
    content: '# Goal 预算终止报告',
  };
  const patch = reduceAgentEvent(initialAgentState, report);

  assert.deepEqual(patch, {
    fileList: [report.file],
    contents: { 'goal-budget-report-goal1.md': report.content },
  });
});

test('Core-originated Contract confirmation appears as a user turn', () => {
  const message = { role: 'user' as const, text: '确认并开始目标', when: '刚刚' };
  const patch = reduceAgentEvent(initialAgentState, {
    type: 'turn_started',
    sessionId: 'test',
    message,
  });
  assert.deepEqual(patch, {
    messages: [message],
    streaming: { text: '', thinking: '', steps: [], blocks: [] },
    loading: true,
    error: null,
    steerQueue: [],
  });
});

test('Goal initialization does not interrupt the first optimistic Agent turn', () => {
  const streaming = { text: '', thinking: '', steps: [], blocks: [] };
  const state = {
    ...initialAgentState,
    messages: [{ role: 'user' as const, text: '检查项目', when: '刚刚' }],
    streaming,
    loading: true,
  };

  assert.deepEqual(reduceAgentEvent(state, {
    type: 'goal_updated',
    sessionId: 'test',
    goal: null,
  }), { goal: null });
  assert.deepEqual(reduceAgentEvent(state, {
    type: 'goal_updated',
    sessionId: 'test',
    goal: null,
    settleTurn: true,
  }), { goal: null, loading: false, streaming: null });
});
