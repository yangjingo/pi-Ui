import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
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

test('Core/PiRuntime permanently deletes an idle Session persistence directory', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-ui-session-delete-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const deletedPath = join(root, 'session-delete');
  mkdirSync(deletedPath, { recursive: true });
  writeFileSync(join(deletedPath, 'artifact.md'), '# disposable\n', 'utf8');

  const subject = new PiRuntime() as any;
  subject.workspaceRoot = root;
  subject.executions.clear();
  subject.sessions = [
    { id: 'session-delete', title: 'Delete me', group: '今天', time: '刚刚', live: false, status: 'idle' },
    { id: 'session-keep', title: 'Keep me', group: '今天', time: '刚刚', live: false, status: 'idle' },
  ];
  const execution = subject.executionFor('session-delete');
  let disposed = false;
  execution.session = {
    isStreaming: false,
    dispose() { disposed = true; },
  };
  subject.legacyExecution = execution;
  const events: any[] = [];
  subject.on((event: any) => events.push(event));

  const result = await subject.deleteSession('session-delete');

  assert.deepEqual(result, { ok: true });
  assert.equal(disposed, true);
  assert.equal(existsSync(deletedPath), false);
  assert.deepEqual(subject.listSessions().map((session: any) => session.id), ['session-keep']);
  assert.equal(subject.executions.has('session-delete'), false);
  assert.equal(subject.legacyExecution.id, 'session-keep');
  assert.equal(events.at(-1)?.type, 'session_deleted');
  assert.equal(events.at(-1)?.deletedSessionId, 'session-delete');
});

test('Core/PiRuntime refuses to delete a running Session or its directory', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-ui-session-running-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const runningPath = join(root, 'session-running');
  mkdirSync(runningPath, { recursive: true });

  const subject = new PiRuntime() as any;
  subject.workspaceRoot = root;
  subject.executions.clear();
  subject.sessions = [
    { id: 'session-running', title: 'Running', group: '今天', time: '刚刚', live: true, status: 'running' },
  ];
  const execution = subject.executionFor('session-running');
  execution.session = { isStreaming: true };

  const result = await subject.deleteSession('session-running');

  assert.equal(result.ok, false);
  assert.match(result.error || '', /仍在运行/);
  assert.equal(existsSync(runningPath), true);
  assert.equal(subject.listSessions().length, 1);
});

test('Core/PiRuntime repairs a local historical Shell Traj from its Pi JSONL', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-ui-session-repair-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const id = 'historical-local';
  const cwd = join(root, id);
  const sourceDir = join(root, 'pi-source');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(sourceDir, { recursive: true });

  const source = SessionManager.create(cwd, sourceDir, {
    id: '22222222-2222-4222-8222-222222222222',
  });
  source.appendMessage({
    role: 'assistant',
    content: [{
      type: 'toolCall',
      id: 'call-history',
      name: 'bash',
      arguments: { command: 'pwsh -Command Get-ChildItem' },
    }],
    api: 'openai-completions',
    provider: 'test',
    model: 'test',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'toolUse',
    timestamp: Date.now(),
  } as any);
  source.appendMessage({
    role: 'toolResult',
    toolCallId: 'call-history',
    toolName: 'bash',
    content: [{ type: 'text', text: `${'\ufffd'.repeat(4)}\nrestored line one\nrestored line two` }],
    isError: false,
    timestamp: Date.now(),
  });

  writeFileSync(join(cwd, '.session.json'), JSON.stringify({
    version: 1,
    summary: { id, title: 'Historical', group: '今天', time: '刚刚', live: false, status: 'idle' },
    messages: [{
      role: 'agent',
      status: 'done',
      traj: [{
        id: 'call-history',
        t: 'code',
        title: 'bash',
        det: 'pwsh -Command Get-ChildItem',
        in: 'pwsh -Command Get-ChildItem',
        out: '\ufffd'.repeat(40),
        status: 'done',
        time: '10:00',
      }],
    }],
    updatedAt: new Date().toISOString(),
  }), 'utf8');

  const sourcePath = source.getSessionFile();
  assert.ok(sourcePath);
  const subject = new PiRuntime() as any;
  subject.workspaceRoot = root;
  subject.executions.clear();
  subject.sessions = [
    { id, title: 'Historical', group: '今天', time: '刚刚', live: false, status: 'idle' },
  ];
  subject.piInspection = {
    inspection: { available: true, sessionCount: 1, modelCount: 0, hasCredentials: false },
    sessions: [{
      id: 'pi-source',
      title: 'Source',
      group: '已有 Pi 会话',
      time: '刚刚',
      live: false,
      status: 'idle',
      pi: { sourcePath, sourceCwd: cwd, sourceId: 'source' },
    }],
  };

  const repaired = subject.executionFor(id).messages[0].traj[0];
  assert.equal(repaired.shell, 'powershell');
  assert.equal(repaired.outputEncoding, 'lossy');
  assert.match(repaired.out, /restored line one\nrestored line two/);
});
