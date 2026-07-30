import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { emptySnapshot, installMockAgent } from '../fixtures/agent';

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
  await installMockAgent(page, { snapshot: emptySnapshot, skills: [skill] });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
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
  await page.getByTestId('composer-input').fill('/rev');
  await expect(page.getByTestId('slash-menu')).toBeVisible();
  await expect(page.getByTestId('slash-item').filter({ hasText: '/review' })).toHaveCount(1);
});

test('materializes a completed Agent turn as a local Skill', async ({ page }) => {
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
  const generated = { ...skill, id: 'turn-local', name: '检查发布配置' };
  const requests: unknown[] = [];
  await installMockAgent(page, { snapshot, skills: [generated] });
  await page.route('**/api/skills/from-turn', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, skill: generated }),
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('message-create-skill').click();
  await expect(page.getByTestId('skill-hub-page')).toBeVisible();
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
  await page.getByTestId('skill-upload-menu').getByRole('button', { name: '文件', exact: true }).click();
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

  // Open the upload menu, pick "文件夹", then feed a real directory to the webkitdirectory input.
  await page.getByTestId('skill-upload-menu').getByRole('button', { name: '文件夹', exact: true }).click();
  const folder = testInfo.outputPath('snippet-pack');
  await mkdir(`${folder}/refs`, { recursive: true });
  await writeFile(`${folder}/refs/a.md`, '# A\nFOLDER_MARKER', 'utf8');
  await page.locator('input[data-testid=skill-folder-input]').setInputFiles(folder);

  await expect.poll(() => current.files['snippet-pack/refs/a.md']).toContain('FOLDER_MARKER');
  await expect(page.getByTestId('file-item').filter({ hasText: 'a.md' })).toHaveCount(1);
});
