import { createRequire } from 'node:module';
import type { LongRunningGoal, TrajStep } from '../../core/agent/protocol';
import {
  GOAL_LABEL_CREATED,
  GOAL_LABEL_CURRENT,
  GOAL_LABEL_NO_GOAL,
  GOAL_LABEL_UPDATED,
  GOAL_REPORT_CAUSE_HARNESS,
  GOAL_REPORT_EXECUTION_HINT,
  GOAL_REPORT_INTRO,
  GOAL_REPORT_NEXT_STEPS,
  GOAL_REPORT_SECTION_CAUSE,
  GOAL_REPORT_SECTION_EXECUTION,
  GOAL_REPORT_SECTION_GOAL,
  GOAL_REPORT_SECTION_NEXT,
  GOAL_REPORT_SECTION_TIMELINE,
  GOAL_REPORT_TITLE,
} from './prompts';
export {
  expectedAuditRequirementIds,
  IntentHarness,
  INTENT_ENTRY_TYPE,
  MAX_CLARIFICATION_ROUNDS,
  projectGoalObjective,
} from './intent';
export type { IntentResult } from './intent';

const GOAL_ENTRY_TYPE = 'pi-codex-goal';
const GOAL_HARNESS_ENTRY_TYPE = 'pi-ui-goal-harness';
const GOAL_THINKING_LEVEL = 'max' as const;

interface GoalHarnessMetricsEntry {
  version: 1;
  kind: 'metrics';
  goalId: string;
  agentLoops: number;
  thinkingSteps?: number;
  toolCalls?: number;
  at: number;
}

interface GoalHarnessReportEntry {
  version: 1;
  kind: 'report';
  goalId: string;
  status: 'budgetLimited';
  path: string;
  at: number;
}

type GoalHarnessEntry = GoalHarnessMetricsEntry | GoalHarnessReportEntry;

export interface GoalBudgetReport {
  goalId: string;
  path: string;
  content: string;
  agentLoops: number;
}

export interface GoalBudgetReportContext {
  model?: string | null;
  generatedAt?: number;
  responseUsage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cacheWrite1h: number;
    totalTokens: number;
  };
}

export interface GoalExecutionMetrics {
  agentLoops: number;
  thinkingSteps: number;
  toolCalls: number;
}

export interface GoalTrajectoryStart {
  title: string;
  detail: string;
  input: string;
}

export interface GoalTrajectoryEnd {
  detail: string;
  output: string;
}

const GOAL_TOOL_NAMES = new Set(['get_goal', 'create_goal', 'update_goal']);

function applyUsage(current: LongRunningGoal | null, data: any): LongRunningGoal | null {
  if (
    !current ||
    (current.status !== 'active' && current.status !== 'budgetLimited') ||
    data?.goalId !== current.goalId ||
    (data?.status !== 'active' && data?.status !== 'budgetLimited') ||
    (current.status === 'budgetLimited' && data.status === 'active') ||
    typeof data?.usage?.tokensUsed !== 'number' ||
    typeof data?.usage?.activeSeconds !== 'number' ||
    typeof data?.updatedAt !== 'number' ||
    data.updatedAt < current.updatedAt ||
    data.usage.tokensUsed < current.usage.tokensUsed ||
    data.usage.activeSeconds < current.usage.activeSeconds
  ) return current;
  return {
    ...current,
    status: data.status,
    usage: data.usage,
    updatedAt: data.updatedAt,
  };
}

function formatNumber(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString('zh-CN');
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [
    hours ? `${hours} 小时` : '',
    minutes ? `${minutes} 分钟` : '',
    rest || (!hours && !minutes) ? `${rest} 秒` : '',
  ].filter(Boolean).join(' ');
}

function formatTimestamp(unixSeconds: number): string {
  return new Date(Math.max(0, unixSeconds) * 1000).toISOString();
}

function tableValue(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim() || '—';
}

function objectiveQuote(objective: string): string {
  return objective.trim().split(/\r?\n/).map(line => `> ${line || ' '}`).join('\n');
}

function jsonRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function goalResponseFromToolResult(result: any): Record<string, any> | null {
  const details = jsonRecord(result?.details);
  if (details && ('goal' in details || 'remainingTokens' in details)) return details;
  const content = Array.isArray(result?.content) ? result.content : [];
  for (const part of content) {
    if (part?.type !== 'text' || typeof part.text !== 'string') continue;
    try {
      const parsed = jsonRecord(JSON.parse(part.text));
      if (parsed && ('goal' in parsed || 'remainingTokens' in parsed)) return parsed;
    } catch { /* use the next content block */ }
  }
  return null;
}

function goalObjective(value: unknown): string {
  const objective = typeof value === 'string' ? value.trim() : '';
  if (!objective) return '未提供 Goal 内容';
  return objective.length > 72 ? `${objective.slice(0, 72)}…` : objective;
}

function isHarnessEntry(value: unknown): value is GoalHarnessEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as GoalHarnessEntry;
  if (entry.version !== 1 || typeof entry.goalId !== 'string' || typeof entry.at !== 'number') return false;
  if (entry.kind === 'metrics') {
    return Number.isInteger(entry.agentLoops) && entry.agentLoops > 0
      && (entry.thinkingSteps == null || (Number.isInteger(entry.thinkingSteps) && entry.thinkingSteps >= 0))
      && (entry.toolCalls == null || (Number.isInteger(entry.toolCalls) && entry.toolCalls >= 0));
  }
  return entry.kind === 'report' && entry.status === 'budgetLimited' && typeof entry.path === 'string';
}

/** Owns the Pi goal extension contract and reconstructs durable state from a session branch. */
export class GoalHarness {
  readonly extensionPath = createRequire(import.meta.url).resolve('pi-codex-goal');
  readonly toolNames = ['get_goal', 'create_goal', 'update_goal'] as const;

  isTool(name: string): boolean {
    return GOAL_TOOL_NAMES.has(name);
  }

  /** Project Goal tool calls into a semantic Traj payload. `get_goal` deliberately has no SDK
   * parameters, but Canvas still receives a meaningful requested-field contract instead of `{}`. */
  trajectoryStart(name: string, args: any): GoalTrajectoryStart | null {
    if (!this.isTool(name)) return null;
    const params = jsonRecord(args) || {};
    if (name === 'get_goal') {
      return {
        title: '读取 Goal',
        detail: '读取目标、状态、预算与累计用量',
        input: JSON.stringify({
          operation: 'get_goal',
          requestedFields: ['objective', 'status', 'tokenBudget', 'tokensUsed', 'timeUsedSeconds'],
        }),
      };
    }
    if (name === 'create_goal') {
      const objective = String(params.objective || '').trim();
      return {
        title: '创建 Goal',
        detail: goalObjective(objective),
        input: JSON.stringify({
          operation: 'create_goal',
          objective: objective || null,
          tokenBudget: typeof params.token_budget === 'number' ? params.token_budget : null,
          replaceExisting: params.replace_existing === true,
        }),
      };
    }
    return {
      title: '更新 Goal',
      detail: params.status === 'complete' ? '请求标记 Goal 完成' : `请求更新为 ${String(params.status || '未知状态')}`,
      input: JSON.stringify({
        operation: 'update_goal',
        status: params.status || null,
        completionRequirement: '仅在目标全部完成且已有验证证据时允许完成',
      }),
    };
  }

  /** Prefer pi-codex-goal's structured `result.details`; parse its text JSON only as a
   * compatibility fallback. The full objective and accounting data remain available in Canvas. */
  trajectoryEnd(name: string, result: any, isError: boolean): GoalTrajectoryEnd | null {
    if (!this.isTool(name)) return null;
    if (isError) {
      const content = Array.isArray(result?.content)
        ? result.content.map((part: any) => part?.text || '').join('\n').trim()
        : '';
      return {
        detail: 'Goal 操作失败',
        output: JSON.stringify({ operation: name, ok: false, error: content || 'Goal 工具返回错误' }),
      };
    }
    const response = goalResponseFromToolResult(result);
    if (!response) {
      return {
        detail: 'Goal 返回格式不可识别',
        output: JSON.stringify({ operation: name, ok: true, result: result ?? null }),
      };
    }
    const goal = jsonRecord(response.goal);
    const projectedGoal = goal ? {
      goalId: goal.goalId ?? null,
      objective: goal.objective ?? null,
      status: goal.status ?? null,
      tokenBudget: goal.tokenBudget ?? null,
      tokensUsed: goal.tokensUsed ?? null,
      timeUsedSeconds: goal.timeUsedSeconds ?? null,
      createdAt: goal.createdAt ?? null,
      updatedAt: goal.updatedAt ?? null,
    } : null;
    const operationLabel = name === 'get_goal' ? GOAL_LABEL_CURRENT : name === 'create_goal' ? GOAL_LABEL_CREATED : GOAL_LABEL_UPDATED;
    return {
      detail: projectedGoal
        ? `${operationLabel} · ${String(projectedGoal.status || '未知状态')} · ${goalObjective(projectedGoal.objective)}`
        : GOAL_LABEL_NO_GOAL,
      output: JSON.stringify({
        operation: name,
        ok: true,
        goal: projectedGoal,
        remainingTokens: response.remainingTokens ?? null,
        completionBudgetReport: response.completionBudgetReport ?? null,
      }),
    };
  }

  /** Keep Goal completion in the ordinary Traj/Canvas pipeline. The existing Goal tool step
   * receives the cross-continuation summary, so Canvas StepResult renders it without a
   * Goal-specific conversation component. */
  projectCompletedTrajectory(
    steps: ReadonlyArray<TrajStep>,
    goal: LongRunningGoal,
    metrics: GoalExecutionMetrics,
  ): TrajStep[] {
    const projected = steps.map(step => ({ ...step }));
    if (goal.status !== 'complete') return projected;
    for (let index = projected.length - 1; index >= 0; index--) {
      const step = projected[index];
      if (step.t !== 'goal' || !step.out) continue;
      let output: Record<string, any> | null = null;
      try { output = jsonRecord(JSON.parse(step.out)); } catch { /* keep searching */ }
      const outputGoal = jsonRecord(output?.goal);
      if (
        !output ||
        outputGoal?.status !== 'complete' ||
        (outputGoal.goalId && outputGoal.goalId !== goal.goalId)
      ) continue;
      projected[index] = {
        ...step,
        title: '完成 Goal',
        det: `目标已完成 · ${goalObjective(goal.objective)}`,
        out: JSON.stringify({
          ...output,
          executionMetrics: {
            agentLoops: metrics.agentLoops,
            thinkingSteps: metrics.thinkingSteps,
            toolCalls: metrics.toolCalls,
          },
        }),
      };
      break;
    }
    return projected;
  }

  isCommand(text: string): boolean {
    return /^\/goal(?:\s|$)/u.test(text.trim());
  }

  /** Goal turns require reasoning. Core applies this before Pi receives either a new command
   * or a restored active goal, so pi-codex-goal's hidden continuations inherit the same level. */
  thinkingLevelForCommand(text: string): typeof GOAL_THINKING_LEVEL | null {
    return this.isCommand(text) ? GOAL_THINKING_LEVEL : null;
  }

  thinkingLevelForGoal(goal: LongRunningGoal | null): typeof GOAL_THINKING_LEVEL | null {
    return goal?.status === 'active' ? GOAL_THINKING_LEVEL : null;
  }

  private entries(session: any): any[] {
    const entries = session?.sessionManager?.buildContextEntries?.();
    return Array.isArray(entries) ? entries : [];
  }

  private harnessEntries(session: any, goalId: string): GoalHarnessEntry[] {
    return this.entries(session)
      .filter(entry => entry?.type === 'custom' && entry?.customType === GOAL_HARNESS_ENTRY_TYPE)
      .map(entry => entry.data)
      .filter((entry): entry is GoalHarnessEntry => isHarnessEntry(entry) && entry.goalId === goalId);
  }

  /** Persist cumulative run and Traj counts so branch navigation, compaction and process
   * restart do not reduce the Goal's execution evidence. */
  recordAgentLoop(
    session: any,
    at = Math.floor(Date.now() / 1000),
    turn: { thinkingSteps?: number; toolCalls?: number } = {},
  ): number {
    const goal = this.snapshot(session);
    if (!goal) return 0;
    const previous = this.executionMetrics(session, goal.goalId);
    const agentLoops = previous.agentLoops + 1;
    const thinkingSteps = previous.thinkingSteps + Math.max(0, Math.trunc(turn.thinkingSteps || 0));
    const toolCalls = previous.toolCalls + Math.max(0, Math.trunc(turn.toolCalls || 0));
    session?.sessionManager?.appendCustomEntry?.(GOAL_HARNESS_ENTRY_TYPE, {
      version: 1,
      kind: 'metrics',
      goalId: goal.goalId,
      agentLoops,
      thinkingSteps,
      toolCalls,
      at,
    } satisfies GoalHarnessMetricsEntry);
    return agentLoops;
  }

  executionMetrics(session: any, goalId: string): GoalExecutionMetrics {
    const latest = this.harnessEntries(session, goalId)
      .filter((entry): entry is GoalHarnessMetricsEntry => entry.kind === 'metrics')
      .reduce<GoalHarnessMetricsEntry | null>((current, entry) => (
        !current || entry.agentLoops > current.agentLoops || (entry.agentLoops === current.agentLoops && entry.at > current.at)
          ? entry
          : current
      ), null);
    return {
      agentLoops: latest?.agentLoops || 0,
      thinkingSteps: latest?.thinkingSteps || 0,
      toolCalls: latest?.toolCalls || 0,
    };
  }

  /** Build the terminal Canvas artifact. Core remains responsible for the actual file write. */
  budgetReport(session: any, context: GoalBudgetReportContext = {}): GoalBudgetReport | null {
    const goal = this.snapshot(session);
    if (!goal || goal.status !== 'budgetLimited' || goal.tokenBudget === null) return null;
    const harnessEntries = this.harnessEntries(session, goal.goalId);
    if (harnessEntries.some(entry => entry.kind === 'report' && entry.status === 'budgetLimited')) return null;

    const execution = this.executionMetrics(session, goal.goalId);
    const { agentLoops, thinkingSteps, toolCalls } = execution;
    const fileGoalId = goal.goalId.toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'goal';
    const path = `goal-budget-report-${fileGoalId}.md`;
    const budget = goal.tokenBudget;
    const tokens = goal.usage.tokensUsed;
    const utilization = budget > 0 ? `${((tokens / budget) * 100).toFixed(1)}%` : '—';
    const wallClockSeconds = Math.max(0, goal.updatedAt - goal.createdAt);
    const generatedAt = context.generatedAt ?? Math.floor(Date.now() / 1000);
    const averageTokens = agentLoops > 0 ? formatNumber(tokens / agentLoops) : '—';
    const averageActiveTime = agentLoops > 0 ? formatDuration(goal.usage.activeSeconds / agentLoops) : '—';
    const responseUsage = context.responseUsage;
    const promptTokens = responseUsage
      ? responseUsage.input + responseUsage.cacheRead + responseUsage.cacheWrite
      : 0;
    const cacheHitRate = promptTokens > 0 && responseUsage
      ? `${((responseUsage.cacheRead / promptTokens) * 100).toFixed(1)}%`
      : '—';

    const content = [
      GOAL_REPORT_TITLE,
      '',
      GOAL_REPORT_INTRO,
      '',
      GOAL_REPORT_SECTION_EXECUTION,
      '',
      GOAL_REPORT_EXECUTION_HINT,
      '',
      '| 指标 | 结果 |',
      '| --- | ---: |',
      `| Goal 状态 | \`budgetLimited\` |`,
      `| Token 消耗 | ${formatNumber(tokens)} |`,
      `| Token 预算 | ${formatNumber(budget)} |`,
      `| 预算使用率 | ${utilization} |`,
      `| Agent Loop | ${formatNumber(agentLoops)} 轮 |`,
      `| Thinking | ${formatNumber(thinkingSteps)} 轮 |`,
      `| Tool 调用 | ${formatNumber(toolCalls)} 次 |`,
      `| 活跃执行时间 | ${formatDuration(goal.usage.activeSeconds)} |`,
      `| 墙钟跨度 | ${formatDuration(wallClockSeconds)} |`,
      `| 平均每轮 Token | ${averageTokens} |`,
      `| 平均每轮活跃时间 | ${averageActiveTime} |`,
      `| 模型 | ${tableValue(context.model || '未记录')} |`,
      ...(responseUsage ? [
        `| Provider 响应总 Token | ${formatNumber(responseUsage.totalTokens)} |`,
        `| 未缓存输入 Token | ${formatNumber(responseUsage.input)} |`,
        `| 输出 Token | ${formatNumber(responseUsage.output)} |`,
        `| Cache Read Token | ${formatNumber(responseUsage.cacheRead)} |`,
        `| Cache Write Token | ${formatNumber(responseUsage.cacheWrite)} |`,
        `| 其中 1h Cache Write | ${formatNumber(responseUsage.cacheWrite1h)} |`,
        `| Prefix Cache 命中率 | ${cacheHitRate} |`,
      ] : []),
      '',
      GOAL_REPORT_SECTION_GOAL,
      '',
      objectiveQuote(goal.objective),
      '',
      GOAL_REPORT_SECTION_TIMELINE,
      '',
      `- 创建：${formatTimestamp(goal.createdAt)}`,
      `- 最后更新：${formatTimestamp(goal.updatedAt)}`,
      `- 报告生成：${formatTimestamp(generatedAt)}`,
      '',
      GOAL_REPORT_SECTION_CAUSE,
      '',
      `Goal 已消耗 ${formatNumber(tokens)} / ${formatNumber(budget)} Token，达到预算边界。`,
      GOAL_REPORT_CAUSE_HARNESS,
      '',
      GOAL_REPORT_SECTION_NEXT,
      '',
      ...GOAL_REPORT_NEXT_STEPS,
      '',
    ].join('\n');

    return { goalId: goal.goalId, path, content, agentLoops };
  }

  markReportGenerated(
    session: any,
    report: GoalBudgetReport,
    at = Math.floor(Date.now() / 1000),
  ): void {
    session?.sessionManager?.appendCustomEntry?.(GOAL_HARNESS_ENTRY_TYPE, {
      version: 1,
      kind: 'report',
      goalId: report.goalId,
      status: 'budgetLimited',
      path: report.path,
      at,
    } satisfies GoalHarnessReportEntry);
  }

  snapshot(session: any): LongRunningGoal | null {
    const entries = this.entries(session);
    let goal: LongRunningGoal | null = null;
    for (const entry of entries) {
      if (entry?.type !== 'custom' || entry?.customType !== GOAL_ENTRY_TYPE || !entry?.data || typeof entry.data !== 'object') continue;
      const data = entry.data as any;
      if (data.kind === 'set' && data.goal && typeof data.goal.objective === 'string') {
        goal = data.goal as LongRunningGoal;
      } else if (data.kind === 'usage') {
        goal = applyUsage(goal, data);
      } else if (data.kind === 'clear') {
        goal = null;
      }
    }
    return goal ? { ...goal, usage: { ...goal.usage } } : null;
  }
}
