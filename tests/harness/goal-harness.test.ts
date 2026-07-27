import assert from 'node:assert/strict';
import test from 'node:test';
import { GoalHarness } from '../../src/harness/goal';

test('Harness/Goal identifies commands and rebuilds the active branch state', () => {
  const harness = new GoalHarness();
  const goal = {
    goalId: 'goal-1',
    objective: '完成重构',
    status: 'active' as const,
    tokenBudget: null,
    usage: { tokensUsed: 1, activeSeconds: 2 },
    createdAt: 10,
    updatedAt: 10,
  };
  const session = {
    sessionManager: {
      buildContextEntries: () => [
        { type: 'custom', customType: 'pi-codex-goal', data: { kind: 'set', goal } },
        {
          type: 'custom',
          customType: 'pi-codex-goal',
          data: {
            kind: 'usage',
            goalId: 'goal-1',
            status: 'active',
            usage: { tokensUsed: 8, activeSeconds: 13 },
            updatedAt: 20,
          },
        },
      ],
    },
  };

  assert.equal(harness.isCommand('/goal 继续'), true);
  assert.equal(harness.isCommand('explain /goal'), false);
  assert.equal(harness.thinkingLevelForCommand('/goal 继续'), 'max');
  assert.equal(harness.thinkingLevelForCommand('/review 继续'), null);
  assert.equal(harness.thinkingLevelForGoal(goal), 'max');
  assert.equal(harness.thinkingLevelForGoal({ ...goal, status: 'paused' }), null);
  assert.deepEqual(harness.snapshot(session), {
    ...goal,
    usage: { tokensUsed: 8, activeSeconds: 13 },
    updatedAt: 20,
  });
});

test('Harness/Goal ignores stale or decreasing usage projections', () => {
  const harness = new GoalHarness();
  const goal = {
    goalId: 'goal-1',
    objective: '完成重构',
    status: 'active' as const,
    tokenBudget: 100,
    usage: { tokensUsed: 20, activeSeconds: 5 },
    createdAt: 10,
    updatedAt: 20,
  };
  const session = {
    sessionManager: {
      buildContextEntries: () => [
        { type: 'custom', customType: 'pi-codex-goal', data: { kind: 'set', goal } },
        {
          type: 'custom',
          customType: 'pi-codex-goal',
          data: {
            kind: 'usage',
            goalId: 'goal-1',
            status: 'active',
            usage: { tokensUsed: 10, activeSeconds: 4 },
            updatedAt: 19,
          },
        },
      ],
    },
  };

  assert.deepEqual(harness.snapshot(session), goal);
});

test('Harness/Goal projects semantic Traj input and complete Goal output', () => {
  const harness = new GoalHarness();
  const read = harness.trajectoryStart('get_goal', {});
  assert.ok(read);
  assert.equal(read.title, '读取 Goal');
  assert.deepEqual(JSON.parse(read.input), {
    operation: 'get_goal',
    requestedFields: ['objective', 'status', 'tokenBudget', 'tokensUsed', 'timeUsedSeconds'],
  });

  const created = harness.trajectoryStart('create_goal', {
    objective: '完成 Canvas 与 Goal 的联动验证',
  });
  assert.ok(created);
  assert.deepEqual(JSON.parse(created.input), {
    operation: 'create_goal',
    objective: '完成 Canvas 与 Goal 的联动验证',
    tokenBudget: null,
    replaceExisting: false,
  });
  const explicitlyBudgeted = harness.trajectoryStart('create_goal', {
    objective: '完成显式预算兼容验证',
    token_budget: 5_000,
  });
  assert.ok(explicitlyBudgeted);
  assert.equal(JSON.parse(explicitlyBudgeted.input).tokenBudget, 5_000);

  const result = harness.trajectoryEnd('get_goal', {
    content: [{ type: 'text', text: '{"goal":{"objective":"fallback"}}' }],
    details: {
      goal: {
        goalId: 'goal-trajectory-1',
        objective: '完成 Canvas 与 Goal 的联动验证',
        status: 'active',
        tokenBudget: 5_000,
        tokensUsed: 1_200,
        timeUsedSeconds: 90,
        createdAt: 100,
        updatedAt: 190,
      },
      remainingTokens: 3_800,
      completionBudgetReport: null,
    },
  }, false);
  assert.ok(result);
  assert.match(result.detail, /完成 Canvas 与 Goal 的联动验证/);
  assert.deepEqual(JSON.parse(result.output), {
    operation: 'get_goal',
    ok: true,
    goal: {
      goalId: 'goal-trajectory-1',
      objective: '完成 Canvas 与 Goal 的联动验证',
      status: 'active',
      tokenBudget: 5_000,
      tokensUsed: 1_200,
      timeUsedSeconds: 90,
      createdAt: 100,
      updatedAt: 190,
    },
    remainingTokens: 3_800,
    completionBudgetReport: null,
  });

  const completion = harness.projectCompletedTrajectory([{
    t: 'goal',
    title: '更新 Goal',
    det: '已更新',
    in: '{"operation":"update_goal","status":"complete"}',
    out: JSON.stringify({
      operation: 'update_goal',
      ok: true,
      goal: {
        goalId: 'goal-trajectory-1',
        objective: '完成 Canvas 与 Goal 的联动验证',
        status: 'complete',
      },
    }),
    status: 'done',
    time: '10:00',
  }], {
    goalId: 'goal-trajectory-1',
    objective: '完成 Canvas 与 Goal 的联动验证',
    status: 'complete',
    tokenBudget: 5_000,
    usage: { tokensUsed: 3_200, activeSeconds: 90 },
    createdAt: 100,
    updatedAt: 190,
  }, {
    agentLoops: 3,
    thinkingSteps: 7,
    toolCalls: 12,
  });
  assert.equal(completion[0].title, '完成 Goal');
  assert.match(completion[0].det, /完成 Canvas 与 Goal 的联动验证/);
  assert.deepEqual(JSON.parse(completion[0].out!).executionMetrics, {
    agentLoops: 3,
    thinkingSteps: 7,
    toolCalls: 12,
  });
});

test('Harness/Goal persists loop metrics and creates one budget report per goal', () => {
  const harness = new GoalHarness();
  const entries: any[] = [{
    type: 'custom',
    customType: 'pi-codex-goal',
    data: {
      kind: 'set',
      goal: {
        goalId: 'goal-report-1234',
        objective: '完成所有验收要求并提供验证证据',
        status: 'budgetLimited',
        tokenBudget: 100,
        usage: { tokensUsed: 120, activeSeconds: 30 },
        createdAt: 10,
        updatedAt: 70,
      },
    },
  }];
  const session = {
    sessionManager: {
      buildContextEntries: () => entries,
      appendCustomEntry: (customType: string, data: unknown) => {
        entries.push({ type: 'custom', customType, data });
      },
    },
  };

  assert.equal(harness.recordAgentLoop(session, 71, { thinkingSteps: 2, toolCalls: 3 }), 1);
  assert.equal(harness.recordAgentLoop(session, 72, { thinkingSteps: 1, toolCalls: 4 }), 2);
  assert.deepEqual(harness.executionMetrics(session, 'goal-report-1234'), {
    agentLoops: 2,
    thinkingSteps: 3,
    toolCalls: 7,
  });

  const report = harness.budgetReport(session, {
    model: 'test/reasoning-model',
    generatedAt: 80,
    responseUsage: {
      input: 200,
      output: 50,
      cacheRead: 800,
      cacheWrite: 100,
      cacheWrite1h: 40,
      totalTokens: 1_150,
    },
  });
  assert.ok(report);
  assert.equal(report.agentLoops, 2);
  assert.equal(report.path, 'goal-budget-report-goal-report-1234.md');
  assert.match(report.content, /120/);
  assert.match(report.content, /100/);
  assert.match(report.content, /120\.0%/);
  assert.match(report.content, /2 轮/);
  assert.match(report.content, /Thinking \| 3 轮/);
  assert.match(report.content, /Tool 调用 \| 7 次/);
  assert.match(report.content, /30 秒/);
  assert.match(report.content, /test\/reasoning-model/);
  assert.match(report.content, /Provider 响应总 Token \| 1,150/);
  assert.match(report.content, /Cache Read Token \| 800/);
  assert.match(report.content, /Prefix Cache 命中率 \| 72\.7%/);
  assert.match(report.content, /目标尚未完成/);

  harness.markReportGenerated(session, report, 80);
  assert.equal(harness.budgetReport(session), null);
});
