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
