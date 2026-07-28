import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { parseCliArgs } from '../../src/core/pi/cli';

test('CLI parses one-command install options', () => {
  const base = resolve('cli-test-root');
  const options = parseCliArgs([
    'install',
    '--cwd',
    'project',
    '--host',
    '0.0.0.0',
    '--port',
    '4317',
    '--no-open',
  ], base);

  assert.deepEqual(options, {
    command: 'install',
    cwd: resolve(base, 'project'),
    host: '0.0.0.0',
    json: false,
    noOpen: true,
    port: 4317,
  });
});

test('CLI supports JSON doctor in either option order', () => {
  assert.equal(parseCliArgs(['doctor', '--json']).command, 'doctor');
  assert.equal(parseCliArgs(['doctor', '--json']).json, true);
  assert.equal(parseCliArgs(['--json', 'doctor']).json, true);
});

test('CLI rejects unknown commands and invalid ports', () => {
  assert.throws(() => parseCliArgs(['launch']), /Unknown command/);
  assert.throws(() => parseCliArgs(['start', '--port', '70000']), /Invalid port/);
  assert.throws(() => parseCliArgs(['start', '--host', 'localhost&whoami']), /Invalid host/);
});
