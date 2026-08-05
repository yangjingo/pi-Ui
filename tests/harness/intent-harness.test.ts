import assert from 'node:assert/strict';
import test from 'node:test';
import type { GoalCompletionAudit, LongRunningGoal } from '../../src/core/agent';
import {
  expectedAuditRequirementIds,
  IntentHarness,
  projectGoalObjective,
} from '../../src/harness/goal';

function fakeSession() {
  const entries: any[] = [];
  return {
    entries,
    sessionManager: {
      buildContextEntries: () => entries,
      appendCustomEntry: (customType: string, data: unknown) => {
        entries.push({ type: 'custom', customType, data });
      },
    },
  };
}

const contract = {
  objective: '完成可验证的四模块交付',
  deliverables: ['代码', '文档'],
  acceptanceCriteria: ['类型检查通过'],
  constraints: ['保持模块边界'],
  nonGoals: ['不部署'],
  verificationPlan: ['运行 pnpm typecheck'],
  assumptions: ['依赖已安装'],
};

test('Intent policy keeps simple tasks direct and preflights complex goals', () => {
  const harness = new IntentHarness();
  assert.equal(harness.classifyTask('解释这个函数'), 'direct');
  assert.equal(harness.classifyTask('修正文案中的错别字'), 'direct');
  assert.equal(harness.classifyTask('请依次完成全部模块、测试和文档，不要停'), 'preflight');
  assert.equal(harness.classifyTask('把这项工作建立为 Goal'), 'preflight');
});

test('Contract confirmation is revision/hash bound and idempotent', () => {
  const harness = new IntentHarness();
  const session = fakeSession();
  const proposed = harness.propose(session, contract, { sessionId: 's1', sourceTurnId: 't1', at: 10 });
  assert.equal(proposed.ok, true);
  assert.equal(proposed.intent?.status, 'awaitingConfirmation');
  assert.equal(harness.snapshot(session)?.revision, 1);

  const stale = harness.confirm(session, {
    intentId: proposed.intent!.intentId,
    revision: 1,
    contractHash: 'stale',
    at: 11,
  });
  assert.equal(stale.code, 'stale-contract');

  const request = {
    intentId: proposed.intent!.intentId,
    revision: proposed.intent!.revision,
    contractHash: proposed.intent!.contractHash!,
    at: 12,
  };
  const confirmed = harness.confirm(session, request);
  const duplicate = harness.confirm(session, request);
  assert.equal(confirmed.ok, true);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.objective, confirmed.objective);
  const oldTab = harness.confirm(session, { ...request, revision: 0 });
  assert.equal(oldTab.code, 'stale-contract');
  assert.match(confirmed.objective!, /D-1\. 代码/);
  assert.match(confirmed.objective!, /AC-1\. 类型检查通过/);
  assert.match(confirmed.objective!, /Contract Hash:/);
});

test('clarification rounds are code-limited to three', () => {
  const harness = new IntentHarness();
  const session = fakeSession();
  const proposed = harness.propose(session, contract, { sessionId: 's1' });
  const id = proposed.intent!.intentId;
  for (let round = 1; round <= 3; round++) {
    const result = harness.requestClarification(session, id, [{
      id: `q-${round}`,
      prompt: `第 ${round} 轮问题`,
      required: true,
    }], round);
    assert.equal(result.ok, true);
    assert.equal(result.intent?.clarificationRound, round);
  }
  const blocked = harness.requestClarification(session, id, [{
    id: 'q-4',
    prompt: '不应提出的第四轮问题',
    required: true,
  }], 4);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'clarification-limit');
  assert.equal(blocked.intent?.status, 'blocked');
  assert.equal(blocked.intent?.blockedReason, 'clarificationLimit');
});

test('active Goal replacement requires an explicit replacement confirmation', () => {
  const harness = new IntentHarness();
  const session = fakeSession();
  const currentGoal: LongRunningGoal = {
    goalId: 'active-1',
    objective: '旧目标',
    status: 'active',
    tokenBudget: null,
    usage: { tokensUsed: 10, activeSeconds: 2 },
    createdAt: 1,
    updatedAt: 2,
  };
  const proposed = harness.propose(session, contract, {
    sessionId: 's1',
    currentGoal,
  });
  assert.equal(proposed.intent?.status, 'blocked');
  assert.equal(proposed.intent?.replacesGoalId, 'active-1');

  const denied = harness.confirm(session, {
    intentId: proposed.intent!.intentId,
    revision: proposed.intent!.revision,
    contractHash: proposed.intent!.contractHash!,
    currentGoal,
  });
  assert.equal(denied.code, 'invalid-state');

  const accepted = harness.confirm(session, {
    intentId: proposed.intent!.intentId,
    revision: proposed.intent!.revision,
    contractHash: proposed.intent!.contractHash!,
    currentGoal,
    replaceExisting: true,
  });
  assert.equal(accepted.ok, true);
});

test('completion audit must cover every numbered Contract requirement exactly once', () => {
  const harness = new IntentHarness();
  const session = fakeSession();
  const proposed = harness.propose(session, contract, { sessionId: 's1' });
  const confirmed = harness.confirm(session, {
    intentId: proposed.intent!.intentId,
    revision: proposed.intent!.revision,
    contractHash: proposed.intent!.contractHash!,
  });
  const intent = harness.linkGoal(session, confirmed.intent!.intentId, 'goal-1')!;
  const ids = expectedAuditRequirementIds(intent);
  const audit: GoalCompletionAudit = {
    goalId: 'goal-1',
    contractHash: intent.contractHash!,
    requirements: ids.map(criterionId => ({
      criterionId,
      status: 'verified',
      evidence: [{ kind: 'test', ref: `${criterionId}.log` }],
    })),
  };
  assert.equal(harness.submitCompletionAudit(session, intent.intentId, audit).ok, true);
  assert.equal(harness.completionGuard(session, 'goal-1').ok, true);

  const incomplete = { ...audit, requirements: audit.requirements.slice(1) };
  assert.equal(harness.validateCompletionAudit(intent, incomplete).ok, false);
  assert.equal(projectGoalObjective(intent).includes(`Intent ID: ${intent.intentId}`), true);
});
