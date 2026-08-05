import { expect, test } from '@playwright/test';
import { collectPageErrors, demoSnapshot, emitAgentEvent, emptySnapshot, installMockAgent } from '../fixtures/agent';

test('keeps the desktop workbench fluid across browser zoom-equivalent viewports', async ({ page }) => {
  await installMockAgent(page, { snapshot: demoSnapshot });
  await page.goto('/sessions/demo', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('ws-toggle').click();
  await expect(page.locator('.workspace')).toBeVisible();

  for (const { width, height } of [
    { width: 960, height: 540 },
    { width: 640, height: 320 },
    { width: 1152, height: 720 },
    { width: 800, height: 400 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize({ width, height });
    await expect.poll(async () => page.evaluate(() => {
      const app = document.querySelector<HTMLElement>('.app');
      const conversation = document.querySelector<HTMLElement>('.conversation');
      const workspace = document.querySelector<HTMLElement>('.workspace');
      const topbar = document.querySelector<HTMLElement>('.topbar');
      const dialog = document.querySelector<HTMLElement>('.dialog');
      const composer = document.querySelector<HTMLElement>('.composer-wrap:not(.composer-welcome)');
      if (!app || !conversation || !workspace || !topbar || !dialog || !composer) return false;
      const appBox = app.getBoundingClientRect();
      const conversationBox = conversation.getBoundingClientRect();
      const workspaceBox = workspace.getBoundingClientRect();
      const topbarBox = topbar.getBoundingClientRect();
      const dialogBox = dialog.getBoundingClientRect();
      const composerBox = composer.getBoundingClientRect();
      const tolerance = 1;
      return document.documentElement.scrollWidth <= window.innerWidth + tolerance
        && document.body.scrollWidth <= window.innerWidth + tolerance
        && document.documentElement.scrollHeight <= window.innerHeight + tolerance
        && appBox.right <= window.innerWidth + tolerance
        && appBox.bottom <= window.innerHeight + tolerance
        && workspaceBox.right <= window.innerWidth + tolerance
        && conversationBox.width >= window.innerWidth * 0.35 - tolerance
        && workspaceBox.width <= window.innerWidth * 0.65 + tolerance
        && Math.abs(conversationBox.width + workspaceBox.width - appBox.width) <= tolerance
        && topbarBox.bottom <= dialogBox.top + tolerance
        && dialogBox.height > 40
        && dialogBox.bottom <= composerBox.top + tolerance
        && composerBox.bottom <= window.innerHeight + tolerance;
    })).toBe(true);
    await expect(page.getByTestId('composer-input')).toBeVisible();
    await expect(page.getByTestId('ws-tab').first()).toBeVisible();
  }

  await page.setViewportSize({ width: 640, height: 320 });
  await page.getByTestId('composer-input').fill('one\ntwo\nthree\nfour\nfive\nsix');
  await expect.poll(async () => page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('.dialog')?.getBoundingClientRect();
    const composer = document.querySelector<HTMLElement>('.composer-wrap:not(.composer-welcome)')?.getBoundingClientRect();
    return !!dialog && !!composer && dialog.height > 40 && dialog.bottom <= composer.top + 1 && composer.bottom <= window.innerHeight + 1;
  })).toBe(true);
});

test('keeps the welcome composer reachable when desktop zoom compresses height', async ({ page }) => {
  await installMockAgent(page, { snapshot: emptySnapshot });
  await page.setViewportSize({ width: 640, height: 260 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const dialog = page.getByTestId('conversation');
  await expect.poll(async () => dialog.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await dialog.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(page.getByTestId('composer-input')).toBeInViewport();
});

test('shows Traj by default and keeps full details available in Canvas', async ({ page }) => {
  await installMockAgent(page, { snapshot: demoSnapshot });
  const errors = collectPageErrors(page);

  await page.goto('/sessions/demo', { waitUntil: 'domcontentloaded' });
  const message = page.getByTestId('agent-message');
  await expect(message).toBeVisible();
  await expect(message.locator('.md-body strong')).toHaveCount(4);
  await expect(message.locator('.md-body li')).toHaveCount(3);

  await expect(page.getByTestId('agent-flow')).toBeVisible();
  await expect(page.getByTestId('flow-step')).toHaveCount(8);
  const thinkingSteps = message.locator('[data-testid="flow-step"][data-kind="think"]');
  await expect(thinkingSteps).toHaveCount(2);
  await expect(thinkingSteps.first()).toHaveAttribute('aria-expanded', 'false');
  await expect(message.getByTestId('flow-thinking')).toHaveCount(0);
  await thinkingSteps.first().click();
  await expect(thinkingSteps.first()).toHaveAttribute('aria-expanded', 'true');
  await expect(message.getByTestId('flow-thinking')).toHaveText('先解析 PDF，再生成文档、预算表与看板。');
  await thinkingSteps.first().click();
  await expect(message.getByTestId('flow-thinking')).toHaveCount(0);
  await expect(message.locator('.badge.done')).toHaveCount(0);
  await expect(message.locator('.agent-completed')).toHaveCount(0);
  await expect(message.getByTestId('artifact-manifest')).toHaveCount(0);
  const finalArtifactPaths = await message.getByTestId('agent-artifact')
    .evaluateAll(artifacts => artifacts.map(artifact => artifact.getAttribute('data-artifact-path')));
  expect(finalArtifactPaths).toEqual([
    'README.md',
    'budget.csv',
    'report.html',
    'run_pipeline.py',
  ]);
  await expect(message.locator('.out-card')).toHaveCount(0);
  await expect(message.getByTestId('message-edit')).toHaveCount(0);
  await expect(page.getByTestId('user-message').getByTestId('message-edit')).toBeVisible();
  await expect(page.getByTestId('think')).toHaveCount(0);
  await message.hover();
  await expect(page.getByTestId('turn-stats')).toContainText('TTFT 740ms');
  await expect(page.getByTestId('turn-stats')).toContainText('TPOT 38ms');
  await expect(page.getByTestId('turn-stats')).toContainText('TPS 26.3');
  await expect(page.getByTestId('turn-stats')).toContainText('IN 4.3k');
  await expect(page.getByTestId('turn-stats')).toContainText('OUT 612');
  await expect(page.getByTestId('turn-stats')).toContainText('CACHE 80%');
  await message.getByTestId('message-more').click();
  await expect(message.getByTestId('message-action-menu')).toBeVisible();
  await expect(message.getByTestId('message-copy')).toBeVisible();
  await expect(message.getByTestId('message-create-skill')).toBeVisible();
  await expect(message.getByTestId('open-turn')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(message.getByTestId('message-action-menu')).toHaveCount(0);
  await expect(message.getByTestId('message-more')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(message.getByTestId('message-action-menu')).toBeVisible();

  const messageBox = await message.boundingBox();
  const composerBox = await page.locator('.composer').boundingBox();
  expect(messageBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(Math.abs(messageBox!.x + 40 - composerBox!.x)).toBeLessThanOrEqual(1);

  await message.getByTestId('message-more').click();
  await message.getByTestId('agent-artifact').filter({ hasText: 'report.html' }).click();
  await expect(page.getByTestId('canvas-tab')).toContainText('report.html');
  await expect(page.locator('.app')).not.toHaveClass(/canvas-focused/);
  await expect(page.getByTestId('conversation-rail-return')).toBeHidden();
  await expect(page.getByTestId('canvas-panel')).toBeVisible();
  expect(errors).toEqual([]);
});

test('shows CACHE as the weighted cumulative hit ratio for the current Session', async ({ page }) => {
  const snapshot = structuredClone(demoSnapshot);
  const firstAgent = structuredClone(snapshot.messages[1]);
  const secondAgent = structuredClone(snapshot.messages[1]);
  firstAgent.stats = { ...firstAgent.stats!, input: 900, cacheRead: 100, cacheWrite: 0 };
  secondAgent.stats = { ...secondAgent.stats!, input: 100, cacheRead: 900, cacheWrite: 0 };
  snapshot.messages = [
    { role: 'user', text: 'First turn' },
    firstAgent,
    { role: 'user', text: 'Second turn' },
    secondAgent,
  ];
  await installMockAgent(page, { snapshot });
  await page.goto('/sessions/demo', { waitUntil: 'domcontentloaded' });

  const stats = page.getByTestId('turn-stats');
  await expect(stats).toHaveCount(2);
  await expect(stats.nth(0)).toContainText('CACHE 10%');
  await expect(stats.nth(1)).toContainText('CACHE 50%');
});

test('places Goal beside File and keeps simple requests direct', async ({ page }) => {
  const requests: unknown[] = [];
  await installMockAgent(page, { snapshot: emptySnapshot });
  await page.route('**/api/prompt', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  await page.goto('/sessions/test', { waitUntil: 'domcontentloaded' });
  const composer = page.getByTestId('composer-input');
  await expect(composer).toBeVisible();
  const goalToggle = page.getByTestId('goal-toggle');
  await expect(goalToggle).toBeVisible();
  await expect(page.getByTestId('composer-attach')).toHaveText('File');
  await expect(goalToggle).toHaveText('Goal');
  await expect(goalToggle.locator('svg')).toHaveCount(1);
  await expect(page.locator('[data-testid="composer-attach"] + [data-testid="goal-toggle"]')).toHaveCount(1);
  await goalToggle.click();
  await expect(composer).toHaveValue('/goal ');
  await expect(goalToggle).toHaveAttribute('aria-pressed', 'true');
  await goalToggle.click();
  await expect(composer).toHaveValue('');
  await expect(goalToggle).toHaveAttribute('aria-pressed', 'false');

  await composer.fill('/goal');
  await expect(page.getByTestId('slash-menu')).toHaveCount(0);
  await expect(page.getByTestId('goal-draft')).toHaveCount(0);

  await composer.fill('解释这个函数的作用');
  await composer.press('Enter');
  await expect.poll(() => requests).toEqual([{
    sessionId: 'test',
    text: '解释这个函数的作用',
    displayText: '解释这个函数的作用',
    workspaceChanges: [],
  }]);

});

test('renders a completed Goal through the existing Traj and Canvas StepResult', async ({ page }) => {
  const goal = {
    goalId: 'goal-complete-ui',
    objective: '完成可验证的长程交付',
    status: 'complete' as const,
    tokenBudget: null,
    usage: { tokensUsed: 3_200, activeSeconds: 95 },
    createdAt: 100,
    updatedAt: 195,
  };
  const snapshot = structuredClone(demoSnapshot);
  snapshot.goal = goal;
  const agent = [...snapshot.messages].reverse().find(message => message.role === 'agent');
  if (!agent) throw new Error('Agent fixture is missing');
  const step = agent.traj?.length || 0;
  agent.traj = [...(agent.traj || []), {
    t: 'goal',
    title: '完成 Goal',
    det: '目标已完成 · 完成可验证的长程交付',
    in: JSON.stringify({
      operation: 'update_goal',
      status: 'complete',
    }),
    out: JSON.stringify({
      operation: 'update_goal',
      ok: true,
      goal: {
        goalId: goal.goalId,
        objective: goal.objective,
        status: goal.status,
        tokensUsed: goal.usage.tokensUsed,
        timeUsedSeconds: goal.usage.activeSeconds,
      },
      executionMetrics: {
        agentLoops: 3,
        thinkingSteps: 7,
        toolCalls: 12,
      },
    }),
    status: 'done',
    time: '10:00',
  }];
  agent.blocks = [...(agent.blocks || []), { kind: 'step', step }];

  await installMockAgent(page, { snapshot });
  await page.goto('/sessions/demo', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('goal-completion')).toHaveCount(0);
  await expect(page.getByTestId('agent-flow')).toHaveCount(0);
  await expect(page.getByTestId('flow-step')).toHaveCount(0);
  await expect(page.getByTestId('agent-answer')).not.toContainText('我先检查 PDF 批次');
  await expect(page.getByTestId('agent-answer')).toContainText('已完成 26 份 PDF 检测报告');

  const message = page.getByTestId('agent-message');
  await message.hover();
  await message.getByTestId('message-more').click();
  await message.getByTestId('open-turn').click();
  const completion = page.getByTestId('turn-step').filter({ hasText: '完成可验证的长程交付' });
  await expect(completion).toContainText('完成可验证的长程交付');
  await completion.click();

  await expect(page.getByTestId('renderer-step')).toBeVisible();
  await expect(page.getByTestId('step-input')).toContainText('update_goal');
  const output = page.getByTestId('step-output');
  await expect(output).toContainText('完成可验证的长程交付');
  await expect(output).toContainText('executionMetrics');
  await expect(output).toContainText('agentLoops');
  await expect(output).toContainText('thinkingSteps');
  await expect(output).toContainText('toolCalls');
  await expect(output).toContainText('3200');
});

test('keeps an active Goal above the composer instead of inside the input surface', async ({ page }) => {
  const snapshot = structuredClone(demoSnapshot);
  snapshot.goal = {
    goalId: 'goal-active-ui',
    objective: '持续完成当前工作区交付',
    status: 'active',
    tokenBudget: null,
    usage: { tokensUsed: 1_200, activeSeconds: 40 },
    createdAt: 100,
    updatedAt: 140,
  };
  await installMockAgent(page, { snapshot });
  await page.goto('/sessions/demo', { waitUntil: 'domcontentloaded' });

  const status = page.locator('.composer-wrap > .goal-status.active');
  await expect(status).toBeVisible();
  await expect(status).toContainText('持续完成当前工作区交付');
  await expect(status.getByTestId('goal-pause')).toBeVisible();
  await expect(page.locator('.composer .goal-status')).toHaveCount(0);
  await expect(page.getByTestId('goal-toggle')).toBeVisible();
  await expect(page.getByTestId('goal-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('flow-step')).toHaveCount(0);
});

test('shows one cancellable Loop Pet only after a long visible turn', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await installMockAgent(page, { snapshot: emptySnapshot });
  await page.goto('/sessions/test', { waitUntil: 'domcontentloaded' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();

  await emitAgentEvent(page, {
    type: 'turn_started',
    message: { role: 'user', text: '执行一个长任务', when: '刚刚' },
  });
  await expect(page.getByTestId('agent-running-status')).toBeVisible();
  await page.clock.runFor(44_999);
  await expect(page.getByTestId('loop-pet')).toHaveCount(0);
  let appeared = false;
  for (let elapsed = 45_000; elapsed <= 107_000 && !appeared; elapsed += 1_000) {
    await page.clock.runFor(1_000);
    appeared = await page.getByTestId('loop-pet').isVisible().catch(() => false);
  }
  expect(appeared).toBe(true);
  await expect(page.getByTestId('loop-pet')).toBeVisible();
  const staticFrame = await page.getByTestId('loop-pet').innerText();
  await page.clock.runFor(1_000);
  await expect(page.getByTestId('loop-pet')).toHaveText(staticFrame);
  await page.clock.runFor(7_000);
  await expect(page.getByTestId('loop-pet')).toHaveCount(0);
  await page.clock.runFor(120_000);
  await expect(page.getByTestId('loop-pet')).toHaveCount(0);

  await emitAgentEvent(page, {
    type: 'agent_end',
    message: { role: 'agent', status: 'done', outro: '完成。' },
  });
  await expect(page.getByTestId('loop-pet')).toHaveCount(0);
});

test('cancels Loop Pet for the turn when the user types before reveal', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await installMockAgent(page, { snapshot: emptySnapshot });
  await page.goto('/sessions/test', { waitUntil: 'domcontentloaded' });
  await page.clock.install();

  await emitAgentEvent(page, {
    type: 'turn_started',
    message: { role: 'user', text: '执行一个长任务', when: '刚刚' },
  });
  await page.clock.fastForward(46_000);
  await page.getByTestId('composer-input').fill('继续关注尾部');
  await page.clock.fastForward(60_000);
  await expect(page.getByTestId('loop-pet')).toHaveCount(0);

  await emitAgentEvent(page, {
    type: 'agent_end',
    message: { role: 'agent', status: 'done', outro: '第一轮完成。' },
  });
  await emitAgentEvent(page, {
    type: 'turn_started',
    message: { role: 'user', text: '第二个长任务', when: '刚刚' },
  });
  await expect(page.getByTestId('agent-running-status')).toBeVisible();
  await page.clock.fastForward(46_000);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.clock.fastForward(60_000);
  await expect(page.getByTestId('loop-pet')).toHaveCount(0);
});

test('renders a durable Goal Contract and confirms the exact revision through Core', async ({ page }) => {
  const snapshot = structuredClone(emptySnapshot);
  snapshot.intent = {
    intentId: 'intent-1',
    sessionId: 'test',
    sourceTurnId: 'turn-1',
    status: 'awaitingConfirmation',
    clarificationRound: 1,
    objective: '完成四个模块的实现与验证',
    deliverables: ['代码实现', '刷新设计文档'],
    acceptanceCriteria: ['模块测试通过'],
    constraints: ['不扩展范围'],
    nonGoals: ['不部署'],
    verificationPlan: ['pnpm typecheck', 'pnpm test:modules'],
    assumptions: [],
    openQuestions: [],
    revision: 2,
    contractHash: 'contract-hash-2',
    createdAt: 1,
    updatedAt: 2,
  };
  const requests: unknown[] = [];
  await installMockAgent(page, { snapshot });
  await page.route('**/api/intent/confirm', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, intent: { ...snapshot.intent, status: 'confirmed' } }),
    });
  });

  await page.goto('/sessions/test', { waitUntil: 'domcontentloaded' });
  const contract = page.getByTestId('goal-contract');
  await expect(contract).toBeVisible();
  await expect(contract).toContainText('完成四个模块的实现与验证');
  await expect(contract).toContainText('REV 2');
  await contract.locator('summary').click();
  await expect(contract).toContainText('代码实现');
  await expect(contract).toContainText('pnpm typecheck');
  await contract.getByTestId('goal-contract-confirm').click();
  await expect.poll(() => requests).toEqual([{
    sessionId: 'test',
    intentId: 'intent-1',
    revision: 2,
    contractHash: 'contract-hash-2',
    replaceExisting: false,
  }]);
});

test('Goal Contract can be revised or dismissed without creating a Goal', async ({ page }) => {
  const snapshot = structuredClone(emptySnapshot);
  snapshot.intent = {
    intentId: 'intent-dismiss',
    sessionId: 'test',
    sourceTurnId: 'turn-1',
    status: 'awaitingConfirmation',
    clarificationRound: 0,
    objective: '需要调整的任务',
    deliverables: ['交付物'],
    acceptanceCriteria: ['验收项'],
    constraints: [],
    nonGoals: [],
    verificationPlan: ['运行测试'],
    assumptions: [],
    openQuestions: [],
    revision: 1,
    contractHash: 'hash-dismiss',
    createdAt: 1,
    updatedAt: 2,
  };
  const requests: unknown[] = [];
  await installMockAgent(page, { snapshot });
  await page.route('**/api/intent/dismiss', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  await page.goto('/sessions/test', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('goal-contract-revise').click();
  await expect(page.getByTestId('composer-input')).toHaveValue('Revise the current Goal contract:');
  await page.getByTestId('goal-contract-dismiss').click();
  await expect.poll(() => requests).toEqual([{ sessionId: 'test', intentId: 'intent-dismiss' }]);
});

test('an active turn stages steering and double Enter interrupts it', async ({ page }) => {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  await installMockAgent(page, { snapshot: emptySnapshot });
  for (const path of ['prompt', 'steer', 'interrupt']) {
    await page.route(`**/api/${path}`, async route => {
      requests.push({ path, body: route.request().postDataJSON() });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
  }

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const field = page.getByTestId('composer-input');
  await field.fill('start a long task');
  await field.press('Enter');
  await expect(page.getByTestId('steer-panel')).toHaveCount(0);

  await field.fill('focus on the final answer');
  await expect(page.getByTestId('steer-panel')).toHaveCount(0);
  await emitAgentEvent(page, {
    type: 'tool_start',
    step: {
      id: 'thinking-1',
      t: 'think',
      title: '思考',
      det: '规划当前任务',
      text: '正在规划当前任务。',
      status: 'running',
      time: '10:00',
    },
  });
  const liveMessage = page.getByTestId('agent-message').last();
  const liveThinking = liveMessage.locator('[data-testid="flow-step"][data-kind="think"]');
  await expect(liveThinking.locator('.flow-step-copy')).toContainText('规划当前任务');
  await expect(liveThinking.locator('.flow-step-status.running')).toHaveCount(0);
  await expect.poll(() => liveThinking.locator('.flow-step-icon.running > svg').evaluate(element => getComputedStyle(element).animationName)).toBe('flow-step-icon-running');
  await expect.poll(() => liveMessage.locator('.agent-avatar').evaluate(element => getComputedStyle(element, '::after').animationName)).toBe('agent-avatar-breathe');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => liveThinking.locator('.flow-step-icon.running > svg').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await expect.poll(() => liveMessage.locator('.agent-avatar').evaluate(element => getComputedStyle(element, '::after').animationName)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.getByTestId('steer-panel')).toBeVisible();
  await field.press('Enter');
  await expect(page.getByTestId('steer-draft')).toContainText('focus on the final answer');
  expect(requests.map(item => item.path)).toEqual(['prompt']);

  await page.getByTestId('steer-confirm').click();
  await expect.poll(() => requests.map(item => item.path)).toEqual(['prompt', 'steer']);
  await expect(page.getByTestId('steer-panel')).toHaveCount(0);

  await field.fill('replace the current task');
  await expect(page.getByTestId('steer-panel')).toBeVisible();
  await field.press('Enter');
  await expect(page.getByTestId('steer-draft')).toBeVisible();
  await field.press('Enter');
  await expect.poll(() => requests.map(item => item.path)).toEqual(['prompt', 'steer', 'interrupt']);
  expect(requests.at(-1)?.body.displayText).toBe('replace the current task');
});

test('shows and clears the reconnecting state in the latest Agent message', async ({ page }) => {
  await installMockAgent(page, { snapshot: demoSnapshot });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('agent-message')).toBeVisible();

  await emitAgentEvent(page, {
    type: 'turn_started',
    message: { role: 'user', text: '继续执行', when: '刚刚' },
  });
  await expect(page.getByTestId('agent-running-status')).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const status = page.getByTestId('agent-reconnecting');
  await expect(status).toBeVisible();
  await expect(status).toContainText('Reconnecting');

  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(status).toBeHidden({ timeout: 10_000 });
});

test('offers workspace files and local Skills through composer references', async ({ page }) => {
  await installMockAgent(page, {
    snapshot: demoSnapshot,
    skills: [{
      id: 'review',
      name: 'review',
      desc: '检查本地变更',
      files: { 'SKILL.md': '---\nname: review\n---\n\nReview local changes.' },
      enabled: true,
      source: 'workspace',
    }],
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const composer = page.getByTestId('composer-input');

  await composer.fill('@');
  await expect(page.getByTestId('slash-menu')).toBeVisible();
  await expect(page.getByTestId('slash-item').filter({ hasText: 'README.md' })).toHaveCount(1);
  await page.getByTestId('slash-item').filter({ hasText: 'README.md' }).click();
  await expect(composer).toHaveValue(/@README\.md/);

  await composer.fill('/rev');
  await expect(page.getByTestId('slash-menu')).toBeVisible();
  await expect(page.getByTestId('slash-item').filter({ hasText: '/review' })).toHaveCount(1);
});
