import assert from 'node:assert/strict';
import test from 'node:test';
import { createContextExtension } from '../../src/core/pi/context-extension';

test('Core/Pi Context adapter stabilizes the fully assembled prompt before the Agent loop', async () => {
  let received = '';
  const extension = createContextExtension({
    stabilizeSystemPrompt(systemPrompt: string) {
      received = systemPrompt;
      return 'stable system prompt';
    },
  } as any);
  assert.equal(typeof extension, 'object');
  if (typeof extension === 'function') throw new Error('Expected named inline extension');

  let handler: ((event: any) => any) | undefined;
  await extension.factory({
    on(event: string, candidate: (value: any) => any) {
      if (event === 'before_agent_start') handler = candidate;
    },
  } as any);

  assert.ok(handler);
  const result = await handler({
    type: 'before_agent_start',
    prompt: 'Inspect the workspace',
    systemPrompt: 'Pi base\nCurrent working directory: C:\\work\\.workspace\\session-123',
    systemPromptOptions: {},
  });
  assert.equal(received, 'Pi base\nCurrent working directory: C:\\work\\.workspace\\session-123');
  assert.equal(result.systemPrompt, 'stable system prompt');
});
