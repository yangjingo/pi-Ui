import assert from 'node:assert/strict';
import test from 'node:test';
import { runPowerShell } from '../../src/core/pi/powershell-tool';

test('Core native PowerShell tool preserves UTF-8 Chinese output', {
  skip: process.platform !== 'win32',
}, async () => {
  const result = await runPowerShell(
    "Write-Output ([char]0x4E2D + [char]0x6587); Write-Output 'second-line'",
    process.cwd(),
    { timeout: 15 },
  );

  assert.equal(result.exitCode, 0);
  assert.match(result.executable.toLowerCase(), /(?:pwsh|powershell)\.exe$/);
  assert.match(result.output, /中文/);
  assert.match(result.output, /second-line/);
  assert.equal(result.output.includes('\u0000'), false);
});
