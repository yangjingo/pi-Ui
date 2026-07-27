import { expect, test } from '@playwright/test';
import { collectPageErrors, demoSnapshot, emitAgentEvent, emptySnapshot, installMockAgent } from '../fixtures/agent';

test('renders the completed Agent flow as markdown with interleaved trajectory steps', async ({ page }) => {
  await installMockAgent(page, { snapshot: demoSnapshot });
  const errors = collectPageErrors(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const message = page.getByTestId('agent-message');
  await expect(message).toBeVisible();
  await expect(message.locator('.md-body strong')).toHaveCount(4);
  await expect(message.locator('.md-body li')).toHaveCount(3);

  const rows = page.getByTestId('flow-step');
  await expect(rows).toHaveCount(12);
  await expect(rows.nth(0)).toHaveAttribute('data-kind', 'think');
  await expect(rows.nth(3)).toHaveAttribute('data-kind', 'think');
  await expect(rows.last()).toHaveAttribute('data-kind', 'write');
  await expect(rows.last()).toContainText('run_pipeline.py');
  await expect(message.getByTestId('artifact-manifest')).toHaveCount(0);
  const finalArtifactPaths = await message
    .locator('.agent-flow > [data-testid="flow-step-shell"]')
    .evaluateAll((steps) => steps.slice(-4).map((step) => step.getAttribute('data-artifact-path')));
  expect(finalArtifactPaths).toEqual([
    'README.md',
    'budget.csv',
    'report.html',
    'run_pipeline.py',
  ]);
  await rows.filter({ hasText: 'report.html' }).last().click();
  await expect(page.getByTestId('canvas-tab')).toContainText('report.html');
  await expect(message.locator('.out-card')).toHaveCount(0);
  await expect(message.getByTestId('message-edit')).toHaveCount(0);
  await expect(page.getByTestId('user-message').getByTestId('message-edit')).toBeVisible();
  await expect(page.getByTestId('think')).toHaveCount(0);
  await expect(page.getByTestId('turn-stats')).toContainText('缓存 80%');

  const messageBox = await message.boundingBox();
  const composerBox = await page.locator('.composer').boundingBox();
  expect(messageBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(Math.abs(messageBox!.x + 40 - composerBox!.x)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('Goal stays out of Skill slash suggestions and dispatches through the composer', async ({ page }) => {
  const requests: unknown[] = [];
  await installMockAgent(page, { snapshot: emptySnapshot });
  await page.route('**/api/prompt', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const composer = page.getByTestId('composer-input');
  await expect(composer).toBeVisible();
  await composer.fill('/goal');
  await expect(page.getByTestId('slash-menu')).toHaveCount(0);

  await composer.fill('');
  await page.getByTestId('goal-toggle').click();
  await expect(composer).toHaveValue('/goal ');
  await expect(page.getByTestId('goal-draft')).toHaveCount(0);

  await composer.fill('/goal 完成持久化长程任务');
  await composer.press('Enter');
  await expect.poll(() => requests).toEqual([{
    text: '/goal 完成持久化长程任务',
    displayText: '/goal 完成持久化长程任务',
    workspaceChanges: [],
  }]);

  await emitAgentEvent(page, { type: 'thinking_updated', thinking: true });
  await expect(page.getByTestId('think-toggle')).toHaveAttribute('aria-pressed', 'true');
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
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.composer .goal-status.complete')).toHaveCount(0);
  await expect(page.getByTestId('goal-status')).toHaveCount(0);
  await expect(page.getByTestId('goal-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('goal-completion')).toHaveCount(0);

  const completion = page.getByTestId('flow-step').filter({ hasText: '完成 Goal' });
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
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const status = page.locator('.composer-wrap > .goal-status.active');
  await expect(status).toBeVisible();
  await expect(status).toContainText('持续完成当前工作区交付');
  await expect(status.getByTestId('goal-pause')).toBeVisible();
  await expect(page.locator('.composer .goal-status')).toHaveCount(0);
  await expect(page.getByTestId('goal-toggle')).toHaveAttribute('aria-pressed', 'true');
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
