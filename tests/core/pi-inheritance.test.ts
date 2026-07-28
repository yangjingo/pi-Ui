import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { SessionManager } from '@earendil-works/pi-coding-agent';

import {
  discoverPiSessions,
  inspectPiInstallation,
  loadPiSessionMessages,
} from '../../src/core/pi/pi-installation-reader';

test('installed Pi sessions are discovered and projected without rewriting the source JSONL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-ui-inheritance-'));
  try {
    const agentDir = join(root, '.pi', 'agent');
    const sessionDir = join(agentDir, 'sessions', '--existing-project--');
    const cwd = join(root, 'existing-project');
    await mkdir(sessionDir, { recursive: true });
    await mkdir(cwd, { recursive: true });

    const native = SessionManager.create(cwd, sessionDir, {
      id: '11111111-1111-4111-8111-111111111111',
    });
    native.appendSessionInfo('Existing Pi conversation');
    native.appendMessage({
      role: 'user',
      content: 'Continue the existing work',
      timestamp: Date.now(),
    });
    native.appendMessage({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Inspect the repository first.' },
        {
          type: 'toolCall',
          id: 'call-1',
          name: 'read',
          arguments: { path: 'README.md' },
        },
        { type: 'text', text: 'The existing work is ready.' },
      ],
      api: 'openai-completions',
      provider: 'test',
      model: 'test-model',
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
    native.appendMessage({
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'read',
      content: [{ type: 'text', text: '# Existing' }],
      isError: false,
      timestamp: Date.now(),
    });

    const sourcePath = native.getSessionFile();
    assert.ok(sourcePath);
    const before = await readFile(sourcePath, 'utf8');
    const discovered = await discoverPiSessions(agentDir);
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0].title, 'Existing Pi conversation');
    assert.equal(discovered[0].pi?.sourceCwd, cwd);
    assert.match(discovered[0].id, /^pi-[a-f0-9]{18}$/);
    assert.match(discovered[0].time, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

    const messages = loadPiSessionMessages(sourcePath);
    assert.equal(messages[0]?.role, 'user');
    assert.equal(messages[0]?.text, 'Continue the existing work');
    assert.equal(messages[1]?.role, 'agent');
    assert.equal(messages[1]?.intro, 'The existing work is ready.');
    assert.equal(messages[1]?.traj?.some(step => step.t === 'think'), true);
    assert.equal(messages[1]?.traj?.find(step => step.id === 'call-1')?.out, '# Existing');
    assert.equal(await readFile(sourcePath, 'utf8'), before);

    const inspection = await inspectPiInstallation(agentDir);
    assert.equal(inspection.inspection.available, true);
    assert.equal(inspection.inspection.sessionCount, 1);
    assert.equal(inspection.inspection.modelCount, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
