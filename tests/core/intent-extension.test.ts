import assert from 'node:assert/strict';
import test from 'node:test';
import { createIntentExtension } from '../../src/core/pi/intent-extension';
import { IntentHarness, projectGoalObjective } from '../../src/harness/goal';

function fakeSession() {
  const entries: any[] = [];
  return {
    sessionManager: {
      buildContextEntries: () => entries,
      appendCustomEntry: (customType: string, data: unknown) => {
        entries.push({ type: 'custom', customType, data });
      },
    },
  };
}

test('Intent extension registers a stable preflight/audit tool set and completion guard', async () => {
  const harness = new IntentHarness();
  const session = fakeSession();
  const tools = new Map<string, any>();
  const handlers = new Map<string, any>();
  const intents: unknown[] = [];
  let goal: any = null;
  const extension = createIntentExtension(harness, {
    session: () => session,
    sessionId: () => 'session-1',
    goal: () => goal,
    onIntent: intent => intents.push(intent),
  });
  (extension as any).factory({
    registerTool: (tool: any) => tools.set(tool.name, tool),
    on: (name: string, handler: any) => handlers.set(name, handler),
  } as any);

  assert.deepEqual([...tools.keys()], [
    'propose_goal_contract',
    'request_intent_clarification',
    'submit_goal_completion_audit',
  ]);
  assert.equal(typeof handlers.get('tool_call'), 'function');

  const result = await tools.get('propose_goal_contract').execute('turn-1', {
    objective: '完成复杂任务',
    deliverables: ['代码'],
    acceptance_criteria: ['测试通过'],
    verification_plan: ['运行测试'],
  });
  assert.match(result.content[0].text, /收到.*确认|展示给用户/);
  assert.equal(intents.length, 1);
  assert.equal(harness.snapshot(session)?.status, 'awaitingConfirmation');
  const blocked = await handlers.get('tool_call')({
    toolName: 'create_goal',
    input: { objective: '完成复杂任务' },
  });
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /用户先确认/);

  const current = harness.snapshot(session)!;
  harness.confirm(session, {
    intentId: current.intentId,
    revision: current.revision,
    contractHash: current.contractHash!,
  });
  const objective = projectGoalObjective(harness.snapshot(session)!);
  assert.equal(await handlers.get('tool_call')({
    toolName: 'create_goal',
    input: { objective, replace_existing: false },
  }), undefined);

  goal = {
    goalId: 'goal-1',
    objective,
    status: 'active',
    tokenBudget: null,
    usage: { tokensUsed: 0, activeSeconds: 0 },
    createdAt: 1,
    updatedAt: 1,
  };
  const completionBlocked = await handlers.get('tool_call')({
    toolName: 'update_goal',
    input: { status: 'complete' },
  });
  assert.equal(completionBlocked.block, true);
  assert.match(completionBlocked.reason, /completion audit/);
});
