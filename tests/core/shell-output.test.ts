import assert from 'node:assert/strict';
import test from 'node:test';

import type { Message } from '../../src/core/agent/protocol';
import {
  classifyShellCommand,
  normalizeShellText,
  repairHistoricalShellTrajectories,
} from '../../src/core/pi/shell-output';

test('Core/Shell classifies execution instead of a PowerShell mention', () => {
  assert.equal(classifyShellCommand('where powershell 2>nul || echo missing'), 'bash');
  assert.equal(classifyShellCommand('pwsh.exe -NoProfile -Command Get-ChildItem'), 'powershell');
  assert.equal(classifyShellCommand('echo ready && powershell -Command Get-Date'), 'powershell');
  assert.equal(classifyShellCommand('cmd.exe /c powershell -Command Get-Date'), 'powershell');
  assert.equal(classifyShellCommand('Get-ChildItem', 'powershell'), 'powershell');
});

test('Core/Shell normalizes controls and reports irreversible loss', () => {
  assert.deepEqual(normalizeShellText('w\u0000s\u0000l\u0000:\u0000 warning\r\n'), {
    text: 'wsl: warning\n',
    encoding: 'normalized',
  });
  assert.deepEqual(normalizeShellText('\u001b[31m失败\u001b[0m\r\n'), {
    text: '失败\n',
    encoding: 'utf-8',
  });
  assert.equal(normalizeShellText('broken \ufffd').encoding, 'lossy');
});

test('Core/Shell repairs truncated persisted Traj from canonical Pi tool results', () => {
  const persisted: Message[] = [{
    role: 'agent',
    status: 'done',
    traj: [{
      id: 'call-shell-1',
      t: 'code',
      title: 'bash',
      det: 'pwsh -Command Get-ChildItem',
      in: 'pwsh -Command Get-ChildItem',
      out: '\ufffd'.repeat(40),
      status: 'done',
      time: '10:00',
    }],
  }];
  const projected: Message[] = [{
    role: 'agent',
    status: 'done',
    traj: [{
      id: 'call-shell-1',
      t: 'code',
      shell: 'powershell',
      title: 'bash',
      det: 'pwsh -Command Get-ChildItem',
      in: 'pwsh -Command Get-ChildItem',
      out: `${'\ufffd'.repeat(4)}\nactual output\nsecond line`,
      outputEncoding: 'lossy',
      status: 'done',
      time: '10:00',
    }],
  }];

  const repaired = repairHistoricalShellTrajectories(persisted, projected);
  const step = repaired[0].role === 'agent' ? repaired[0].traj?.[0] : undefined;
  assert.equal(step?.shell, 'powershell');
  assert.equal(step?.outputEncoding, 'lossy');
  assert.match(step?.out || '', /actual output\nsecond line/);
  assert.equal(persisted[0].role === 'agent' && persisted[0].traj?.[0].shell, undefined);
});
