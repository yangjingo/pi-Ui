import assert from 'node:assert/strict';
import test from 'node:test';

import { createPiInheritanceService } from '../../src/workspace/pi-inheritance/service';

const emptyPreview = {
  available: false,
  applied: false,
  sessionCount: 0,
  modelCount: 0,
  hasCredentials: false,
};

test('Workspace owns the decision to inherit an installed Pi during bootstrap', async () => {
  const choices: boolean[] = [];
  const service = createPiInheritanceService({
    async inspectPiInheritance() {
      return {
        ...emptyPreview,
        available: true,
        sessionCount: 3,
        modelCount: 2,
        hasCredentials: true,
      };
    },
    async bootstrapRuntime(inheritPi) {
      choices.push(inheritPi);
      return {
        ok: true,
        inherited: inheritPi,
        preview: { ...emptyPreview, available: true, applied: inheritPi },
      };
    },
  });

  const result = await service.bootstrap();
  assert.equal(result.ok, true);
  assert.equal(result.inherited, true);
  assert.deepEqual(choices, [true]);
});

test('Workspace initializes local runtime without inheritance when Pi is absent', async () => {
  const choices: boolean[] = [];
  const service = createPiInheritanceService({
    async inspectPiInheritance() {
      return emptyPreview;
    },
    async bootstrapRuntime(inheritPi) {
      choices.push(inheritPi);
      return {
        ok: true,
        inherited: false,
        preview: emptyPreview,
      };
    },
  });

  await service.bootstrap();
  assert.deepEqual(choices, [false]);
});
