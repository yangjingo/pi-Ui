import { createHash, randomUUID } from 'node:crypto';
import type {
  GoalCompletionAudit,
  GoalContractInput,
  IntentDraft,
  IntentQuestion,
  LongRunningGoal,
} from '../../core/agent/protocol';

export const INTENT_ENTRY_TYPE = 'pi-ui-user-intent';
export const MAX_CLARIFICATION_ROUNDS = 3;

type IntentEntry =
  | { version: 1; kind: 'draft'; draft: IntentDraft }
  | { version: 1; kind: 'confirmation'; intentId: string; revision: number; contractHash: string; at: number }
  | { version: 1; kind: 'link'; intentId: string; goalId: string; at: number }
  | { version: 1; kind: 'audit'; intentId: string; audit: GoalCompletionAudit; at: number };

export interface IntentResult {
  ok: boolean;
  intent?: IntentDraft;
  objective?: string;
  error?: string;
  code?: 'not-found' | 'invalid-state' | 'stale-contract' | 'active-goal-conflict' | 'clarification-limit';
}

function cleanList(values: ReadonlyArray<unknown> | undefined): string[] {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}

function normalizedContract(input: GoalContractInput): GoalContractInput {
  return {
    objective: String(input.objective || '').trim(),
    deliverables: cleanList(input.deliverables),
    acceptanceCriteria: cleanList(input.acceptanceCriteria),
    constraints: cleanList(input.constraints),
    nonGoals: cleanList(input.nonGoals),
    verificationPlan: cleanList(input.verificationPlan),
    assumptions: cleanList(input.assumptions),
  };
}

function contractHash(contract: GoalContractInput, revision: number): string {
  return createHash('sha256')
    .update(JSON.stringify({ revision, contract: normalizedContract(contract) }))
    .digest('hex');
}

function lines(title: string, prefix: string, values: string[]): string[] {
  return [title, ...(values.length ? values.map((value, index) => `${prefix}-${index + 1}. ${value}`) : [`${prefix}-0. （无）`])];
}

function activeGoal(goal: LongRunningGoal | null | undefined): LongRunningGoal | null {
  return goal && goal.status !== 'complete' ? goal : null;
}

export function projectGoalObjective(intent: IntentDraft): string {
  if (!intent.contractHash) throw new Error('Intent Contract 尚未生成 hash');
  return [
    'Objective',
    intent.objective,
    '',
    ...lines('Deliverables', 'D', intent.deliverables),
    '',
    ...lines('Acceptance Criteria', 'AC', intent.acceptanceCriteria),
    '',
    ...lines('Constraints', 'C', intent.constraints),
    '',
    ...lines('Non-goals', 'N', intent.nonGoals),
    '',
    ...lines('Verification Plan', 'V', intent.verificationPlan),
    '',
    ...lines('Confirmed Assumptions', 'A', intent.assumptions),
    '',
    `Intent ID: ${intent.intentId}`,
    `Revision: ${intent.revision}`,
    `Contract Hash: ${intent.contractHash}`,
  ].join('\n');
}

export function expectedAuditRequirementIds(intent: IntentDraft): string[] {
  return [
    ...intent.deliverables.map((_, index) => `D-${index + 1}`),
    ...intent.acceptanceCriteria.map((_, index) => `AC-${index + 1}`),
    ...intent.constraints.map((_, index) => `C-${index + 1}`),
    ...intent.nonGoals.map((_, index) => `N-${index + 1}`),
    ...intent.verificationPlan.map((_, index) => `V-${index + 1}`),
  ];
}

export class IntentHarness {
  readonly toolNames = [
    'propose_goal_contract',
    'request_intent_clarification',
    'submit_goal_completion_audit',
  ] as const;

  classifyTask(text: string): 'direct' | 'preflight' {
    const source = String(text || '').trim();
    if (!source) return 'direct';
    const explicitGoal = /(?:建立|创建|跟踪|设为|作为).{0,6}(?:目标|goal)/i.test(source);
    const longRunning = /(?:全部|完整|持续|直到完成|不要停|依次完成|部署|监控|等待)/i.test(source);
    const multiStage = (source.match(/[；;]|\n|(?:^|\s)\d+[.)、]/g) || []).length >= 2;
    return explicitGoal || longRunning || multiStage ? 'preflight' : 'direct';
  }

  private entries(session: any): any[] {
    try { return session?.sessionManager?.buildContextEntries?.() || []; }
    catch { return []; }
  }

  private append(session: any, entry: IntentEntry): void {
    session?.sessionManager?.appendCustomEntry?.(INTENT_ENTRY_TYPE, entry);
  }

  snapshot(session: any): IntentDraft | null {
    let draft: IntentDraft | null = null;
    for (const entry of this.entries(session)) {
      if (entry?.type !== 'custom' || entry.customType !== INTENT_ENTRY_TYPE || entry.data?.version !== 1) continue;
      const data = entry.data as IntentEntry;
      if (data.kind === 'draft') draft = { ...data.draft, openQuestions: data.draft.openQuestions.map(question => ({ ...question })) };
      if (data.kind === 'link' && draft?.intentId === data.intentId) draft = { ...draft, linkedGoalId: data.goalId };
    }
    return draft;
  }

  propose(
    session: any,
    input: GoalContractInput,
    context: { sessionId: string; sourceTurnId?: string; currentGoal?: LongRunningGoal | null; replaceExisting?: boolean; at?: number },
  ): IntentResult {
    const contract = normalizedContract(input);
    if (!contract.objective || !contract.deliverables.length || !contract.acceptanceCriteria.length || !contract.verificationPlan.length) {
      return { ok: false, error: 'Goal Contract 必须包含目标、交付物、验收标准和验证计划', code: 'invalid-state' };
    }
    const now = context.at ?? Date.now();
    const current = this.snapshot(session);
    const revision = current ? current.revision + 1 : 1;
    const conflict = activeGoal(context.currentGoal);
    const draft: IntentDraft = {
      intentId: current?.intentId || randomUUID(),
      sessionId: context.sessionId,
      sourceTurnId: context.sourceTurnId || 'agent-turn',
      status: conflict && !context.replaceExisting ? 'blocked' : 'awaitingConfirmation',
      clarificationRound: current?.clarificationRound || 0,
      ...contract,
      assumptions: contract.assumptions || [],
      openQuestions: [],
      revision,
      contractHash: contractHash(contract, revision),
      ...(conflict ? { replacesGoalId: conflict.goalId } : {}),
      ...(conflict && !context.replaceExisting ? { blockedReason: 'activeGoalConflict' as const } : {}),
      createdAt: current?.createdAt || now,
      updatedAt: now,
    };
    this.append(session, { version: 1, kind: 'draft', draft });
    return { ok: true, intent: draft };
  }

  requestClarification(
    session: any,
    intentId: string,
    questions: IntentQuestion[],
    at = Date.now(),
  ): IntentResult {
    const current = this.snapshot(session);
    if (!current || current.intentId !== intentId) return { ok: false, error: 'Intent 不存在', code: 'not-found' };
    if (current.status === 'confirmed' || current.status === 'dismissed') {
      return { ok: false, error: '当前 Intent 已结束', code: 'invalid-state' };
    }
    if (current.clarificationRound >= MAX_CLARIFICATION_ROUNDS) {
      const blocked = { ...current, status: 'blocked' as const, blockedReason: 'clarificationLimit' as const, openQuestions: [], updatedAt: at };
      this.append(session, { version: 1, kind: 'draft', draft: blocked });
      return { ok: false, intent: blocked, error: '已达到三轮澄清上限', code: 'clarification-limit' };
    }
    const next = {
      ...current,
      status: 'clarifying' as const,
      clarificationRound: current.clarificationRound + 1,
      openQuestions: questions.slice(0, 3).map((question, index) => ({
        id: String(question.id || `q-${current.clarificationRound + 1}-${index + 1}`),
        prompt: String(question.prompt || '').trim(),
        required: question.required !== false,
        ...(question.recommendation ? { recommendation: String(question.recommendation) } : {}),
      })).filter(question => question.prompt),
      updatedAt: at,
    };
    this.append(session, { version: 1, kind: 'draft', draft: next });
    return { ok: true, intent: next };
  }

  confirm(
    session: any,
    request: { intentId: string; revision: number; contractHash: string; currentGoal?: LongRunningGoal | null; replaceExisting?: boolean; at?: number },
  ): IntentResult {
    const current = this.snapshot(session);
    if (!current || current.intentId !== request.intentId) return { ok: false, error: 'Intent 不存在', code: 'not-found' };
    if (current.revision !== request.revision || current.contractHash !== request.contractHash) {
      return { ok: false, error: 'Goal Contract 已更新，请确认最新版本', code: 'stale-contract' };
    }
    if (current.status === 'confirmed' && current.revision === request.revision && current.contractHash === request.contractHash) {
      return { ok: true, intent: current, objective: projectGoalObjective(current) };
    }
    const replacingBlockedGoal = current.status === 'blocked' &&
      current.blockedReason === 'activeGoalConflict' &&
      request.replaceExisting === true;
    if (current.status !== 'awaitingConfirmation' && !replacingBlockedGoal) {
      return { ok: false, error: 'Intent 尚不可确认', code: 'invalid-state' };
    }
    const conflict = activeGoal(request.currentGoal);
    if (conflict && (!request.replaceExisting || current.replacesGoalId !== conflict.goalId)) {
      return { ok: false, error: '当前已有未完成 Goal，需要显式确认替换', code: 'active-goal-conflict' };
    }
    const at = request.at ?? Date.now();
    const confirmed = { ...current, status: 'confirmed' as const, updatedAt: at };
    this.append(session, { version: 1, kind: 'confirmation', intentId: current.intentId, revision: current.revision, contractHash: current.contractHash!, at });
    this.append(session, { version: 1, kind: 'draft', draft: confirmed });
    return { ok: true, intent: confirmed, objective: projectGoalObjective(confirmed) };
  }

  dismiss(session: any, intentId: string, at = Date.now()): IntentResult {
    const current = this.snapshot(session);
    if (!current || current.intentId !== intentId) return { ok: false, error: 'Intent 不存在', code: 'not-found' };
    if (current.status === 'confirmed' || current.linkedGoalId) {
      return { ok: false, error: '已确认的 Goal Contract 不能取消', code: 'invalid-state' };
    }
    const dismissed = { ...current, status: 'dismissed' as const, updatedAt: at };
    this.append(session, { version: 1, kind: 'draft', draft: dismissed });
    return { ok: true, intent: dismissed };
  }

  linkGoal(session: any, intentId: string, goalId: string, at = Date.now()): IntentDraft | null {
    const current = this.snapshot(session);
    if (!current || current.intentId !== intentId || current.linkedGoalId === goalId) return current;
    this.append(session, { version: 1, kind: 'link', intentId, goalId, at });
    return { ...current, linkedGoalId: goalId };
  }

  latestCompletionAudit(session: any, intentId: string): GoalCompletionAudit | null {
    let audit: GoalCompletionAudit | null = null;
    for (const entry of this.entries(session)) {
      if (
        entry?.type === 'custom' &&
        entry.customType === INTENT_ENTRY_TYPE &&
        entry.data?.version === 1 &&
        entry.data?.kind === 'audit' &&
        entry.data.intentId === intentId
      ) {
        audit = entry.data.audit as GoalCompletionAudit;
      }
    }
    return audit ? {
      ...audit,
      requirements: audit.requirements.map(requirement => ({
        ...requirement,
        evidence: requirement.evidence.map(item => ({ ...item })),
      })),
    } : null;
  }

  submitCompletionAudit(
    session: any,
    intentId: string,
    audit: GoalCompletionAudit,
    at = Date.now(),
  ): { ok: boolean; error?: string } {
    const intent = this.snapshot(session);
    if (!intent || intent.intentId !== intentId) return { ok: false, error: 'Intent 不存在' };
    const validation = this.validateCompletionAudit(intent, audit);
    if (!validation.ok) return validation;
    this.append(session, { version: 1, kind: 'audit', intentId, audit, at });
    return { ok: true };
  }

  completionGuard(session: any, goalId: string): { ok: boolean; error?: string } {
    const intent = this.snapshot(session);
    if (!intent?.linkedGoalId || intent.linkedGoalId !== goalId) {
      return { ok: true };
    }
    const audit = this.latestCompletionAudit(session, intent.intentId);
    if (!audit) return { ok: false, error: 'Goal 完成前必须提交覆盖全部 Contract 要求的 completion audit' };
    return this.validateCompletionAudit(intent, audit);
  }

  validateCompletionAudit(intent: IntentDraft, audit: GoalCompletionAudit): { ok: boolean; error?: string } {
    if (!intent.linkedGoalId || audit.goalId !== intent.linkedGoalId || audit.contractHash !== intent.contractHash) {
      return { ok: false, error: 'Completion audit 未绑定当前 Goal Contract' };
    }
    const expected = expectedAuditRequirementIds(intent);
    const seen = new Set<string>();
    for (const requirement of audit.requirements) {
      if (seen.has(requirement.criterionId)) return { ok: false, error: `Completion audit 重复：${requirement.criterionId}` };
      seen.add(requirement.criterionId);
      if (requirement.status !== 'verified' || !requirement.evidence.some(item => item.kind.trim() && item.ref.trim())) {
        return { ok: false, error: `Completion audit 尚未验证：${requirement.criterionId}` };
      }
    }
    const missing = expected.filter(id => !seen.has(id));
    const extra = [...seen].filter(id => !expected.includes(id));
    if (missing.length || extra.length) {
      return { ok: false, error: `Completion audit 编号不匹配：missing=${missing.join(',') || 'none'} extra=${extra.join(',') || 'none'}` };
    }
    return { ok: true };
  }
}
