import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { emitAgentEvent, emptySnapshot, installMockAgent } from '../fixtures/agent';

const skill = {
  id: 'review',
  name: 'review',
  desc: '检查变更风险',
  files: {
    'SKILL.md': '---\nname: review\n---\n\nReview the change.',
    'references/checklist.md': '# Checklist\n\n- Confirm tests.',
  },
  enabled: true,
  source: 'workspace',
};

test('keeps Skill Hub local-only and exposes slash completion', async ({ page }) => {
  let catalogReads = 0;
  let detailReads = 0;
  page.on('request', request => {
    if (request.method() !== 'GET') return;
    const url = new URL(request.url());
    if (url.pathname !== '/api/skills') return;
    if (url.searchParams.has('id')) detailReads += 1;
    else catalogReads += 1;
  });
  await installMockAgent(page, { snapshot: emptySnapshot, skills: [skill] });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('skill-hub').hover();
  await page.getByTestId('skill-hub').click();

  await expect(page.getByTestId('skill-master')).toBeVisible();
  await expect(page.getByTestId('config-canvas')).toBeVisible();
  await expect(page.getByTestId('skill-item')).toHaveCount(1);
  await expect(page.locator('[data-testid*="remote"]')).toHaveCount(0);

  await page.getByTestId('skill-item').click();
  await page.getByTestId('config-workbench-files-tab').click();
  await expect(page.getByTestId('skill-files-panel')).toBeVisible();
  await expect(page.getByTestId('skill-file-preview-content')).toContainText('Review the change.');
  await expect(page.getByTestId('skill-file-preview')).toHaveCount(0);
  await expect(page.getByTestId('skill-file-source')).toHaveCount(0);

  await page.getByTestId('skill-hub').click();
  await page.getByTestId('skill-hub').click();
  await page.getByTestId('skill-item').click();
  await expect(page.getByTestId('skill-hub-page')).toBeVisible();
  await expect.poll(() => catalogReads).toBe(1);
  await expect.poll(() => detailReads).toBe(1);

  await page.getByTestId('skill-hub').click();
  await page.getByTestId('composer-input').fill('/rev');
  await expect(page.getByTestId('slash-menu')).toBeVisible();
  await expect(page.getByTestId('slash-item').filter({ hasText: '/review' })).toHaveCount(1);
});

test('materializes a completed Agent turn as a Session draft before Skill Hub contribution', async ({ page }) => {
  const snapshot = {
    ...emptySnapshot,
    messages: [
      { role: 'user' as const, text: '检查发布配置', when: '00:00' },
      {
        role: 'agent' as const,
        outro: '已完成检查。',
        status: 'done' as const,
        traj: [{ t: 'read', title: '读取配置', det: 'settings', status: 'done' as const, time: '00:01' }],
      },
    ],
  };
  const draft = {
    id: 'skill-draft-local',
    directory: 'skill-drafts/skill-draft-local',
    path: 'skill-drafts/skill-draft-local/SKILL.md',
    sourceMessageIndex: 1,
  };
  const requests: unknown[] = [];
  await installMockAgent(page, { snapshot, skills: [] });
  await page.route('**/api/skills/from-turn', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, draft }),
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const message = page.getByTestId('agent-message');
  await message.hover();
  await message.getByTestId('message-more').click();
  await expect(message.getByTestId('message-action-menu').getByRole('menuitem').nth(2)).toHaveAttribute('data-testid', 'message-create-skill');
  await message.getByTestId('message-create-skill').click();
  await expect(page.getByTestId('session-skill-draft')).toContainText('Skill draft saved in this Session');
  await expect(page.getByTestId('composer-input')).toHaveValue(new RegExp(`@${draft.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  await expect(page.getByTestId('skill-draft-contribute')).toHaveCount(0);

  await emitAgentEvent(page, { type: 'turn_started', message: { role: 'user', text: `Use @${draft.path} to validate it.`, when: '00:02' } });
  await emitAgentEvent(page, { type: 'agent_end', message: { role: 'agent', outro: 'Validation passed.', status: 'done', when: '00:03' } });
  await expect(page.getByTestId('session-skill-draft')).toContainText('Validation turn complete');
  await page.getByTestId('skill-draft-contribute').click();
  await expect(page.getByTestId('composer-input')).toHaveValue(/discuss and confirm the final name with me/i);
  await expect(page.getByTestId('composer-input')).toHaveValue(/skill_package/);
  expect(requests).toEqual([{ sessionId: 'test', messageIndex: 1 }]);
});

test('keeps uploaded supporting files and saves per-file edits', async ({ page }) => {
  let current: typeof skill & { files: Record<string, string> } = structuredClone(skill);
  await installMockAgent(page, { snapshot: emptySnapshot, skills: [current] });
  await page.route('**/api/skills', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([current]) });
      return;
    }
    const draft = route.request().postDataJSON() as typeof current;
    current = { ...current, ...draft, source: 'workspace' };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, skill: current }),
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('skill-hub').click();
  await page.getByTestId('skill-item').click();
  await page.getByTestId('config-workbench-files-tab').click();

  await page.getByTestId('skill-file-upload').click();
  await expect(page.getByTestId('skill-upload-menu')).toBeVisible();
  await page.getByTestId('skill-upload-menu').getByRole('button', { name: 'File', exact: true }).click();
  await page.locator('input[data-testid=skill-file-input]').setInputFiles([
    { name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes\nUPLOAD_MARKER') },
    { name: 'template.html', mimeType: 'text/html', buffer: Buffer.from('<h1>TEMPLATE_MARKER</h1>') },
  ]);

  await expect(page.getByTestId('file-item').filter({ hasText: 'notes.md' })).toHaveCount(1);
  await expect(page.getByTestId('file-item').filter({ hasText: 'template.html' })).toHaveCount(1);
  await expect(page.getByTestId('skill-file-editor')).toHaveValue(/UPLOAD_MARKER/);

  await page.getByTestId('skill-file-editor').fill('# Notes\nREWRITTEN_MARKER');
  await page.getByTestId('skill-file-save').click();
  await expect.poll(() => current.files['notes.md']).toContain('REWRITTEN_MARKER');
  expect(current.files['template.html']).toContain('TEMPLATE_MARKER');
});

test('uploads a whole folder into a Skill while keeping nested relative paths', async ({ page }, testInfo) => {
  let current: typeof skill & { files: Record<string, string> } = structuredClone(skill);
  await installMockAgent(page, { snapshot: emptySnapshot, skills: [current] });
  await page.route('**/api/skills', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([current]) });
      return;
    }
    const draft = route.request().postDataJSON() as typeof current;
    current = { ...current, ...draft, source: 'workspace' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, skill: current }) });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('skill-hub').click();
  await page.getByTestId('skill-item').click();
  await page.getByTestId('config-workbench-files-tab').click();

  await page.getByTestId('skill-file-upload').click();
  await expect(page.getByTestId('skill-upload-menu')).toBeVisible();

  // Open the upload menu, pick "Folder", then feed a real directory to the webkitdirectory input.
  await page.getByTestId('skill-upload-menu').getByRole('button', { name: 'Folder', exact: true }).click();
  const folder = testInfo.outputPath('snippet-pack');
  await mkdir(`${folder}/refs`, { recursive: true });
  await writeFile(`${folder}/refs/a.md`, '# A\nFOLDER_MARKER', 'utf8');
  await page.locator('input[data-testid=skill-folder-input]').setInputFiles(folder);

  await expect.poll(() => current.files['snippet-pack/refs/a.md']).toContain('FOLDER_MARKER');
  await expect(page.getByTestId('file-item').filter({ hasText: 'a.md' })).toHaveCount(1);
});
