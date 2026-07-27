import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { emptySnapshot, fixtureWorkspaceRoot, installMockAgent } from '../fixtures/agent';

const models = [{
  id: 'test/model',
  provider: 'test',
  modelId: 'model',
  label: 'Test Model',
  custom: true,
  active: true,
  apiKeyConfigured: true,
  configSource: 'core',
  sourceLabel: '.workspace/.agentcore/models.json',
  format: 'openai',
  baseUrl: 'https://api.example.invalid/v1',
}];

test.beforeEach(async ({ page }) => {
  await installMockAgent(page, { snapshot: emptySnapshot });
  await page.route('**/api/models', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ models, active: 'test/model' }),
  }));
  await page.route('**/api/models/config', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      path: '.workspace/.agentcore/models.json',
      authPath: '.workspace/.agentcore/auth.json',
      content: '{"providers":{}}\n',
    }),
  }));
  await page.route('**/api/models/config/parse', async route => {
    const content = JSON.parse(route.request().postData() || '{}').content;
    const value = JSON.parse(content);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        entry: {
          label: value.label,
          format: value.format,
          baseUrl: value.baseUrl,
          apiKey: value.apiKey,
          modelId: value.modelId,
        },
        missing: [],
      }),
    });
  });
});

test('opens model configuration in the shared master/Canvas workbench', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('model-center').click();
  await expect(page.getByTestId('model-master')).toBeVisible();
  await expect(page.getByTestId('config-canvas')).toBeVisible();
  await expect(page.getByTestId('model-option')).toHaveCount(1);
  const master = page.getByTestId('model-master').locator('.model-workbench-master');
  const entries = master.locator('.config-entry-list');
  const [masterBox, entriesBox] = await Promise.all([master.boundingBox(), entries.boundingBox()]);
  expect(masterBox).not.toBeNull();
  expect(entriesBox).not.toBeNull();
  expect(Math.abs((masterBox!.y + masterBox!.height) - (entriesBox!.y + entriesBox!.height))).toBeLessThanOrEqual(1);

  await page.getByTestId('add-custom-model').click();
  await expect(page.getByTestId('custom-model-form')).toBeVisible();
  await expect(page.getByTestId('cm-save')).toBeDisabled();
  await page.getByTestId('cm-label').fill('Local Model');
  await page.getByTestId('cm-baseurl').fill('https://example.invalid/v1');
  await page.getByTestId('cm-apikey').fill('test-key');
  await page.getByTestId('cm-modelid').fill('local-model');
  await expect(page.getByTestId('cm-save')).toBeEnabled();
});

test('shows the Workspace root instead of the active session directory', async ({ page }, testInfo) => {
  const pickedDirectory = testInfo.outputPath('picked-folder');
  await mkdir(pickedDirectory, { recursive: true });
  await writeFile(`${pickedDirectory}/seed.txt`, 'fixture', 'utf8');

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('model-center').click();
  await expect(page.getByTestId('model-environment')).toContainText(fixtureWorkspaceRoot);
  await expect(page.getByTestId('model-environment')).not.toContainText(emptySnapshot.cwd);
  await page.getByTestId('model-environment').click();
  const input = page.getByTestId('cwd-input');
  const save = page.getByTestId('cwd-save');
  await expect(input).toHaveValue(fixtureWorkspaceRoot);
  await expect(save).toBeDisabled();

  await input.fill(`${fixtureWorkspaceRoot}-changed`);
  await expect(save).toBeEnabled();
  await input.fill(fixtureWorkspaceRoot);
  await expect(save).toBeDisabled();

  const directoryInput = page.locator('input[webkitdirectory]');
  await expect(directoryInput).toHaveCount(1);
  await directoryInput.setInputFiles(pickedDirectory);
  await expect(input).not.toHaveValue(fixtureWorkspaceRoot);
  await expect(input).toHaveValue(/picked-folder/);
});

test('lists models.json and protected auth.json under the configuration root', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('model-center').click();
  await page.getByTestId('config-workbench-files-tab').click();

  await expect(page.getByTestId('model-config-models-file')).toContainText('models.json');
  await expect(page.getByTestId('model-config-auth-file')).toContainText('auth.json');
  await page.getByTestId('model-config-auth-file').click();

  await expect(page.getByTestId('model-config-auth-protected')).toContainText('凭据由 Core 保护');
  await expect(page.getByTestId('model-config-auth-protected')).toContainText('内容不会发送到浏览器');
  await expect(page.getByTestId('model-config-json')).toHaveCount(0);
  await expect(page.getByTestId('model-config-file')).toContainText('.workspace/.agentcore/auth.json');
});

test('asks Core to parse an imported model configuration for review', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('model-center').click();
  await page.getByTestId('add-custom-model').click();

  await page.getByTestId('custom-model-form').locator('input[type=file]').setInputFiles({
    name: 'models.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      label: 'Imported Model',
      format: 'anthropic',
      baseUrl: 'https://api.example.invalid',
      apiKey: 'test-key',
      modelId: 'imported-model',
    })),
  });

  await expect(page.getByTestId('cm-label')).toHaveValue('Imported Model');
  await expect(page.getByTestId('cm-baseurl')).toHaveValue('https://api.example.invalid');
  await expect(page.getByTestId('cm-apikey')).toHaveValue('test-key');
  await expect(page.getByTestId('cm-modelid')).toHaveValue('imported-model');
  await expect(page.getByTestId('fmt-anthropic')).toHaveClass(/on/);
});

test('edits a Core-declared model directly from the UI', async ({ page }) => {
  let requestBody: any;
  await page.route('**/api/models/custom', async route => {
    requestBody = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, model: 'test/renamed-model' }),
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('model-center').click();
  await page.getByTestId('model-option').click();
  await expect(page.getByTestId('model-detail-apikey')).toHaveValue('');
  await expect(page.getByTestId('model-detail-apikey')).toHaveAttribute('placeholder', /留空不修改/);

  await page.getByTestId('model-detail-label').fill('Renamed Model');
  await page.getByTestId('model-detail-baseurl').fill('https://renamed.example.invalid/v1');
  await page.getByTestId('model-detail-modelid').fill('renamed-model');
  await page.getByTestId('model-detail-apikey').fill('replacement-secret');
  await page.getByTestId('model-detail-save').click();

  await expect.poll(() => requestBody).toEqual({
    providerId: 'test',
    modelId: 'model',
    update: {
      label: 'Renamed Model',
      format: 'openai',
      baseUrl: 'https://renamed.example.invalid/v1',
      apiKey: 'replacement-secret',
      modelId: 'renamed-model',
    },
  });
});

test('saves the advanced Core models.json editor with Ctrl+S', async ({ page }) => {
  let savedContent = '';
  await page.unroute('**/api/models/config');
  await page.route('**/api/models/config', async route => {
    if (route.request().method() === 'PUT') {
      savedContent = JSON.parse(route.request().postData() || '{}').content;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          file: {
            path: '.workspace/.agentcore/models.json',
            authPath: '.workspace/.agentcore/auth.json',
            content: savedContent,
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        path: '.workspace/.agentcore/models.json',
        authPath: '.workspace/.agentcore/auth.json',
        content: '{"providers":{}}\n',
      }),
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('model-center').click();
  await page.getByTestId('config-workbench-files-tab').click();
  const editor = page.getByTestId('model-config-json');
  const nextConfig = JSON.stringify({ providers: { local: { models: [] } } }, null, 2);
  await editor.fill(nextConfig);
  await editor.press('Control+s');

  await expect.poll(() => savedContent).toBe(nextConfig);
  await expect(editor).toHaveValue(nextConfig);
});

test('the real models API never expands the SDK built-in catalog', async ({ page, request }) => {
  const configResponse = await request.get('/api/models/config');
  expect(configResponse.ok()).toBe(true);
  const configPayload = await configResponse.json();
  const config = JSON.parse(configPayload.content);
  const declared = new Set<string>();
  for (const [providerId, provider] of Object.entries<any>(config.providers || {})) {
    for (const model of Array.isArray(provider.models) ? provider.models : []) {
      if (typeof model?.id === 'string') declared.add(`${providerId}/${model.id}`);
    }
  }

  const listResponse = await request.get('/api/models');
  expect(listResponse.ok()).toBe(true);
  const listPayload = await listResponse.json();
  const listedIds = (listPayload.models || []).map((model: { id: string }) => model.id);
  expect(listedIds.every((id: string) => declared.has(id))).toBe(true);
  expect(new Set(listedIds).size).toBe(listedIds.length);

  await page.unroute('**/api/models');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('model-center').click();
  await expect(page.getByTestId('model-option')).toHaveCount(listedIds.length);
});
