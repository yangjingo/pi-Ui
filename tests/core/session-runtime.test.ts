import assert from 'node:assert/strict';
import test from 'node:test';
import { PiRuntime } from '../../src/core/pi/runtime';

test('Core/PiRuntime keeps two addressed Session executions resident and independent', async () => {
  const subject = new PiRuntime() as any;
  subject.persistSessions = () => {};
  subject.persistSessionRecord = () => {};
  subject.executions.clear();
  subject.sessions = [
    { id: 'session-a', title: 'A', group: '今天', time: '刚刚', live: false, status: 'idle' },
    { id: 'session-b', title: 'B', group: '今天', time: '刚刚', live: false, status: 'idle' },
  ];

  const calls: string[] = [];
  for (const id of ['session-a', 'session-b']) {
    const execution = subject.executionFor(id);
    execution.session = {
      isStreaming: false,
      sessionManager: {
        getLeafId: () => `${id}-leaf`,
        buildContextEntries: () => [],
      },
      async prompt(text: string) {
        calls.push(`${id}:${text}`);
      },
    };
    execution.skillHarness = { inject: (text: string) => text };
  }

  const firstExecution = subject.executions.get('session-a');
  await Promise.all([
    subject.prompt('session-a', 'task A'),
    subject.prompt('session-b', 'task B'),
  ]);

  assert.deepEqual(calls.sort(), ['session-a:task A', 'session-b:task B']);
  assert.equal(subject.executions.get('session-a'), firstExecution);
  assert.equal(subject.executions.size, 2);
  assert.equal(subject.executions.get('session-a').summary.status, 'running');
  assert.equal(subject.executions.get('session-b').summary.status, 'running');
  assert.equal(subject.executions.get('session-a').cwd.endsWith('session-a'), true);
  assert.equal(subject.executions.get('session-b').cwd.endsWith('session-b'), true);
});
