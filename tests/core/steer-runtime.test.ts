import assert from 'node:assert/strict';
import test from 'node:test';
import { PiRuntime, runtime } from '../../src/core/pi/runtime';

test('Core/PiRuntime enables Thinking before dispatching a /goal command', async () => {
  const subject = new PiRuntime() as any;
  const order: string[] = [];
  const events: any[] = [];

  subject.persistSessions = () => {};
  subject.persistSessionRecord = () => {};
  subject.messages = [];
  subject.summary = { id: 'goal-test', title: 'Existing session', group: '今天', time: '刚刚', live: true };
  subject.skillHarness = { inject: (text: string) => text };
  subject.on((event: any) => events.push(event));
  subject.session = {
    isStreaming: false,
    sessionManager: {
      getLeafId: () => 'before-goal',
      buildContextEntries: () => [],
    },
    setThinkingLevel(level: string) {
      order.push(`thinking:${level}`);
    },
    async prompt(text: string) {
      order.push(`prompt:${text}`);
    },
  };

  await subject.prompt('/goal 完成长程任务');

  assert.deepEqual(order, [
    'thinking:max',
    'prompt:/goal 完成长程任务',
  ]);
  assert.equal(subject.thinkingLevel, 'max');
  assert.ok(events.some(event => event.type === 'thinking_updated' && event.thinking === true));
});

test('Core/PiRuntime turns a budget-limited Goal report into a Canvas artifact', () => {
  const subject = new PiRuntime() as any;
  const events: any[] = [];
  const entries: any[] = [{
    type: 'custom',
    customType: 'pi-codex-goal',
    data: {
      kind: 'set',
      goal: {
        goalId: 'goal-budget-1',
        objective: '交付完整结果',
        status: 'budgetLimited',
        tokenBudget: 1_000,
        usage: { tokensUsed: 1_020, activeSeconds: 90 },
        createdAt: 10,
        updatedAt: 120,
      },
    },
  }];
  let saved: { path: string; content: string } | null = null;

  subject.persistSessions = () => {};
  subject.persistSessionRecord = () => {};
  subject.messages = [];
  subject.steps = [];
  subject.blocks = [];
  subject.summary = { id: 'goal-budget', title: 'Goal budget', group: '今天', time: '刚刚', live: true };
  subject.sessions = [subject.summary];
  subject.session = {
    sessionManager: {
      buildContextEntries: () => entries,
      appendCustomEntry: (customType: string, data: unknown) => {
        entries.push({ type: 'custom', customType, data });
      },
    },
  };
  subject.fileHarness = {
    sync: () => ({ deleted: [], files: [] }),
    saveText: (path: string, content: string) => {
      saved = { path, content };
      return { ok: true, file: { name: path, path, type: 'md' }, content };
    },
    capture: (path: string) => saved && saved.path === path
      ? { file: { name: path, path, type: 'md', size: '1 KB' }, content: saved.content }
      : null,
    finalArtifacts: () => saved
      ? [{ name: saved.path, path: saved.path, type: 'md', label: '文件' }]
      : [],
    projectAgentOutput: (text: string, blocks: any[]) => ({ text, blocks }),
    clearTurn: () => {},
  };
  subject.on((event: any) => events.push(event));

  subject.handle({
    type: 'agent_end',
    messages: [{
      role: 'assistant',
      usage: {
        input: 200,
        output: 50,
        cacheRead: 800,
        cacheWrite: 100,
        cacheWrite1h: 40,
        totalTokens: 1_150,
      },
    }],
  });

  const reportEvent = events.find(event => event.type === 'goal_report');
  assert.ok(reportEvent);
  assert.match(reportEvent.content, /1,020/);
  assert.match(reportEvent.content, /1 轮/);
  assert.match(reportEvent.content, /Cache Read Token \| 800/);
  const finalMessage = events.find(event => event.type === 'agent_end')?.message;
  assert.equal(finalMessage.artifacts[0].path, reportEvent.file.path);
  assert.equal(finalMessage.stats.totalTokens, 1_150);
  assert.equal(finalMessage.stats.cacheRead, 800);
});

test('Core/PiRuntime exposes Goal tool content and input/output in Traj', () => {
  const subject = new PiRuntime() as any;
  const events: any[] = [];
  subject.steps = [];
  subject.blocks = [];
  subject.pendingFiles = new Map();
  subject.on((event: any) => events.push(event));

  subject.handle({
    type: 'tool_execution_start',
    toolCallId: 'goal-tool-1',
    toolName: 'get_goal',
    args: {},
  });
  subject.handle({
    type: 'tool_execution_end',
    toolCallId: 'goal-tool-1',
    toolName: 'get_goal',
    isError: false,
    result: {
      details: {
        goal: {
          goalId: 'goal-1',
          objective: '完成 Goal Traj 强化',
          status: 'active',
          tokenBudget: null,
          tokensUsed: 900,
          timeUsedSeconds: 42,
          createdAt: 100,
          updatedAt: 142,
        },
        remainingTokens: null,
        completionBudgetReport: null,
      },
    },
  });

  assert.equal(subject.steps[0].t, 'goal');
  assert.equal(subject.steps[0].title, '读取 Goal');
  assert.deepEqual(JSON.parse(subject.steps[0].in), {
    operation: 'get_goal',
    requestedFields: ['objective', 'status', 'tokenBudget', 'tokensUsed', 'timeUsedSeconds'],
  });
  const output = JSON.parse(subject.steps[0].out);
  assert.equal(output.goal.objective, '完成 Goal Traj 强化');
  assert.equal(output.goal.status, 'active');
  assert.equal(output.goal.tokenBudget, null);
  assert.equal(output.remainingTokens, null);
  assert.ok(events.some(event => event.type === 'tool_end' && event.step.t === 'goal'));
});

test('Core/PiRuntime projects completed Goal metrics through the existing Canvas Traj', () => {
  const subject = new PiRuntime() as any;
  const events: any[] = [];
  const entries: any[] = [{
    type: 'custom',
    customType: 'pi-codex-goal',
    data: {
      kind: 'set',
      goal: {
        goalId: 'goal-complete-1',
        objective: '交付完整 Goal 结果',
        status: 'complete',
        tokenBudget: 4_000,
        usage: { tokensUsed: 2_400, activeSeconds: 75 },
        createdAt: 10,
        updatedAt: 85,
      },
    },
  }];

  subject.persistSessions = () => {};
  subject.persistSessionRecord = () => {};
  subject.messages = [];
  subject.steps = [
    { t: 'think', title: '思考', det: '检查目标', status: 'done', time: '10:00' },
    { t: 'code', title: '执行命令', det: 'pnpm test', status: 'done', time: '10:01' },
    {
      t: 'goal',
      title: '更新 Goal',
      det: '完成',
      out: JSON.stringify({
        operation: 'update_goal',
        ok: true,
        goal: {
          goalId: 'goal-complete-1',
          objective: '交付完整 Goal 结果',
          status: 'complete',
          tokenBudget: 4_000,
          tokensUsed: 2_400,
          timeUsedSeconds: 75,
        },
      }),
      status: 'done',
      time: '10:02',
    },
  ];
  subject.blocks = subject.steps.map((_step: any, step: number) => ({ kind: 'step', step }));
  subject.textBuf = '目标已完成。';
  subject.summary = { id: 'goal-complete', title: 'Goal complete', group: '今天', time: '刚刚', live: true };
  subject.sessions = [subject.summary];
  subject.session = {
    sessionManager: {
      buildContextEntries: () => entries,
      appendCustomEntry: (customType: string, data: unknown) => {
        entries.push({ type: 'custom', customType, data });
      },
    },
  };
  subject.fileHarness = {
    sync: () => ({ deleted: [], files: [] }),
    finalArtifacts: () => [],
    projectAgentOutput: (text: string, blocks: any[]) => ({ text, blocks }),
    clearTurn: () => {},
  };
  subject.on((event: any) => events.push(event));

  subject.handle({ type: 'agent_end', messages: [] });

  const message = events.find(event => event.type === 'agent_end')?.message;
  assert.ok(message);
  assert.equal(message.traj.length, 3);
  const completionStep = message.traj[2];
  assert.equal(completionStep.title, '完成 Goal');
  assert.match(completionStep.det, /交付完整 Goal 结果/);
  assert.deepEqual(JSON.parse(completionStep.out).executionMetrics, {
    agentLoops: 1,
    thinkingSteps: 1,
    toolCalls: 2,
  });
});

test('Core/PiRuntime delivers queued steering and branches away from interrupted input', async () => {
  const subject = runtime as any;
  const events: any[] = [];
  const prompts: string[] = [];
  const steers: string[] = [];
  const branches: string[] = [];
  let cleared = 0;

  subject.persistSessions = () => {};
  subject.persistSessionRecord = () => {};
  subject.messages = [];
  subject.steerQueue = [];
  subject.turnParentId = null;
  subject.turnMessageStartIndex = -1;
  subject.interrupting = false;
  subject.on((event: any) => events.push(event));

  const session: any = {
    isStreaming: false,
    sessionManager: {
      getLeafId: () => 'before-turn',
      resetLeaf: () => branches.push('root'),
    },
    agent: { state: { messages: [] } },
    async prompt(text: string) {
      prompts.push(text);
      this.isStreaming = true;
    },
    async steer(text: string) {
      steers.push(text);
    },
    clearQueue() {
      cleared++;
    },
    async abort() {
      this.isStreaming = false;
      subject.handle({ type: 'agent_end', messages: [] });
    },
    async navigateTree(id: string) {
      branches.push(id);
    },
  };
  subject.session = session;

  await subject.prompt('original task');
  assert.deepEqual(prompts, ['original task']);

  const queued = await subject.steer('switch direction');
  assert.equal(queued.ok, true);
  assert.deepEqual(steers, ['switch direction']);
  const steerEntry = subject.steerQueue[0];
  subject.handle({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: steerEntry.modelText }] } });
  assert.deepEqual(subject.messages.map((message: any) => message.text), ['original task', 'switch direction']);

  const replaced = await subject.interruptAndSteer('replacement task');
  assert.equal(replaced.ok, true);
  assert.equal(cleared, 1);
  assert.deepEqual(branches, ['before-turn']);
  assert.equal(prompts.at(-1), 'replacement task');
  assert.deepEqual(subject.messages.map((message: any) => message.text), ['replacement task']);

  for (const type of ['steer_queued', 'steer_delivered', 'turn_interrupted', 'turn_replaced']) {
    assert.ok(events.some(event => event.type === type), `missing event: ${type}`);
  }
});
