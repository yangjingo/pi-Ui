import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type {
  GoalCompletionAudit,
  GoalContractInput,
  IntentDraft,
  IntentQuestion,
  LongRunningGoal,
} from '../agent/protocol';
import { projectGoalObjective, type IntentHarness } from '../../harness/goal';

export interface IntentExtensionContext {
  session(): any;
  sessionId(): string;
  goal(): LongRunningGoal | null;
  onIntent(intent: IntentDraft): void;
}

const list = Type.Array(Type.String({ minLength: 1 }), { minItems: 1 });
const optionalList = Type.Optional(Type.Array(Type.String({ minLength: 1 })));

function toolResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: 'text' as const, text }], details };
}

/** Pi adapter for the durable Intent Harness. The Agent may propose and clarify a Contract,
 * while confirmation remains a browser-to-Core user action. */
export function createIntentExtension(
  harness: IntentHarness,
  context: IntentExtensionContext,
): InlineExtension {
  return {
    name: 'intent-harness',
    factory(pi) {
      pi.registerTool({
        name: 'propose_goal_contract',
        label: '提议 Goal Contract',
        description: [
          'For complex or explicitly long-running user tasks, propose a structured Goal Contract.',
          'Do not use for simple one-turn tasks. This tool does not create a Goal.',
          'After proposing, stop and wait for the user to confirm, modify, or dismiss the Contract.',
        ].join(' '),
        parameters: Type.Object({
          objective: Type.String({ minLength: 1 }),
          deliverables: list,
          acceptance_criteria: list,
          constraints: optionalList,
          non_goals: optionalList,
          verification_plan: list,
          assumptions: optionalList,
          replace_existing: Type.Optional(Type.Boolean()),
        }),
        execute: async (toolCallId, params: any) => {
          const contract: GoalContractInput = {
            objective: params.objective,
            deliverables: params.deliverables,
            acceptanceCriteria: params.acceptance_criteria,
            constraints: params.constraints || [],
            nonGoals: params.non_goals || [],
            verificationPlan: params.verification_plan,
            assumptions: params.assumptions || [],
          };
          const result = harness.propose(context.session(), contract, {
            sessionId: context.sessionId(),
            sourceTurnId: toolCallId,
            currentGoal: context.goal(),
            replaceExisting: params.replace_existing === true,
          });
          if (!result.ok || !result.intent) {
            throw new Error(result.error || '无法生成 Goal Contract');
          }
          context.onIntent(result.intent);
          return toolResult(
            result.intent.status === 'blocked'
              ? 'Goal Contract 因当前 active Goal 冲突而阻塞；请等待用户明确是否替换。'
              : 'Goal Contract 已展示给用户；在收到绑定 revision/hash 的确认前不得调用 create_goal。',
            { intent: result.intent },
          );
        },
      });

      pi.registerTool({
        name: 'request_intent_clarification',
        label: '请求 Intent 澄清',
        description: 'Persist one concentrated clarification round for a proposed Intent. The hard maximum is three rounds.',
        parameters: Type.Object({
          intent_id: Type.String({ minLength: 1 }),
          questions: Type.Array(Type.Object({
            id: Type.String({ minLength: 1 }),
            prompt: Type.String({ minLength: 1 }),
            required: Type.Optional(Type.Boolean()),
            recommendation: Type.Optional(Type.String()),
          }), { minItems: 1, maxItems: 3 }),
        }),
        execute: async (_toolCallId, params: any) => {
          const questions: IntentQuestion[] = params.questions;
          const result = harness.requestClarification(context.session(), params.intent_id, questions);
          if (result.intent) context.onIntent(result.intent);
          if (!result.ok) {
            return toolResult(result.error || 'Intent 澄清请求失败', {
              ok: false,
              code: result.code,
              intent: result.intent,
            });
          }
          return toolResult('Intent 澄清轮次已持久化；请在本轮集中提出这些问题。', {
            ok: true,
            intent: result.intent,
          });
        },
      });

      pi.registerTool({
        name: 'submit_goal_completion_audit',
        label: '提交 Goal 完成审计',
        description: [
          'Submit deterministic evidence coverage before update_goal(status=complete).',
          'Every D-*, AC-*, C-*, N-* and V-* requirement from the confirmed Contract must appear exactly once.',
        ].join(' '),
        parameters: Type.Object({
          intent_id: Type.String({ minLength: 1 }),
          goal_id: Type.String({ minLength: 1 }),
          contract_hash: Type.String({ minLength: 1 }),
          requirements: Type.Array(Type.Object({
            criterion_id: Type.String({ minLength: 1 }),
            status: Type.Union([
              Type.Literal('verified'),
              Type.Literal('missing'),
              Type.Literal('unverified'),
            ]),
            evidence: Type.Array(Type.Object({
              kind: Type.String({ minLength: 1 }),
              ref: Type.String({ minLength: 1 }),
            })),
          })),
        }),
        execute: async (_toolCallId, params: any) => {
          const audit: GoalCompletionAudit = {
            goalId: params.goal_id,
            contractHash: params.contract_hash,
            requirements: params.requirements.map((requirement: any) => ({
              criterionId: requirement.criterion_id,
              status: requirement.status,
              evidence: requirement.evidence,
            })),
          };
          const result = harness.submitCompletionAudit(context.session(), params.intent_id, audit);
          if (!result.ok) throw new Error(result.error || 'Goal completion audit 不完整');
          return toolResult('Goal completion audit 已通过结构检查并持久化。', { ok: true, audit });
        },
      });

      pi.on('tool_call', async event => {
        const input = event.input as Record<string, unknown>;
        if (event.toolName === 'create_goal') {
          const intent = harness.snapshot(context.session());
          if (intent?.status !== 'confirmed' || !intent.contractHash) {
            return {
              block: true,
              reason: 'create_goal 需要用户先确认当前 Goal Contract revision/hash',
            };
          }
          if (String(input?.objective || '') !== projectGoalObjective(intent)) {
            return {
              block: true,
              reason: 'create_goal.objective 必须与用户确认的完整编号 Contract 完全一致',
            };
          }
          const replacing = !!intent.replacesGoalId;
          if ((input?.replace_existing === true) !== replacing) {
            return {
              block: true,
              reason: replacing
                ? '替换 active Goal 必须携带 replace_existing=true'
                : '当前 Contract 未授权替换 active Goal',
            };
          }
          return undefined;
        }
        if (event.toolName !== 'update_goal' || input?.status !== 'complete') return undefined;
        const goal = context.goal();
        if (!goal) return { block: true, reason: '当前没有可完成的 Goal' };
        const intent = harness.snapshot(context.session());
        if (
          intent?.status === 'confirmed' &&
          !intent.linkedGoalId &&
          intent.contractHash &&
          goal.objective.includes(`Contract Hash: ${intent.contractHash}`)
        ) {
          const linked = harness.linkGoal(context.session(), intent.intentId, goal.goalId);
          if (linked) context.onIntent(linked);
        }
        const guard = harness.completionGuard(context.session(), goal.goalId);
        return guard.ok ? undefined : { block: true, reason: guard.error || 'Goal completion audit 未通过' };
      });
    },
  };
}
