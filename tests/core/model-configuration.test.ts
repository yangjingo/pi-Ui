import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { CoreModelConfiguration } from '../../src/core/pi/model-configuration';

async function withTemporaryProject(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'pi-ui-model-config-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('Core owns pi-ai model definitions and credentials separately', async () => {
  await withTemporaryProject(async root => {
    const configuration = new CoreModelConfiguration({ root, allowNetwork: false, inheritPi: false });
    await configuration.ensureRuntime();
    assert.deepEqual(
      await configuration.listModels(),
      [],
      '首次启动不得从 SDK 目录预制任何 Provider 或模型',
    );

    const added = await configuration.addCustomModel({
      id: 'local-test',
      label: 'Local Test',
      format: 'openai',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: 'sdk-secret',
      modelId: 'llama-test',
    });
    assert.equal(added.ok, true);
    assert.equal(added.entry?.apiKey, '');

    const configFile = await configuration.getConfigFile();
    assert.equal(configFile.path, '.workspace/.agentcore/models.json');
    assert.equal(configFile.authPath, '.workspace/.agentcore/auth.json');
    assert.doesNotMatch(configFile.content, /sdk-secret/);
    assert.match(configFile.content, /local-test/);

    const credentials = JSON.parse(await readFile(configuration.authPath, 'utf8'));
    assert.deepEqual(credentials['local-test'], { type: 'api_key', key: 'sdk-secret' });

    const listedModels = await configuration.listModels();
    const model = listedModels.find(item => item.id === 'local-test/llama-test');
    assert.equal(model?.apiKeyConfigured, true);
    assert.equal(model?.configSource, 'core');
    assert.equal(Object.prototype.hasOwnProperty.call(model || {}, 'apiKey'), false);
    assert.deepEqual(
      [...new Set(listedModels.map(item => item.provider))].sort(),
      ['local-test'],
      'SDK 内置 Provider 不应出现在 UI 可见的模型列表中',
    );

    const updated = await configuration.updateModel('local-test', 'llama-test', {
      label: 'Renamed Local',
      format: 'openai',
      baseUrl: 'http://127.0.0.1:11434/v1',
      modelId: 'llama-renamed',
    });
    assert.equal(updated.ok, true);
    assert.equal((await configuration.listModels()).some(item => item.id === 'local-test/llama-renamed'), true);
    assert.deepEqual(JSON.parse(await readFile(configuration.authPath, 'utf8'))['local-test'], {
      type: 'api_key',
      key: 'sdk-secret',
    });

    const removed = await configuration.removeCustomModel('local-test');
    assert.equal(removed.ok, true);
    assert.equal(JSON.parse(await readFile(configuration.authPath, 'utf8'))['local-test'], undefined);
  });
});

test('Core parses imported provider configuration and migrates legacy settings', async () => {
  await withTemporaryProject(async root => {
    const legacyPath = join(root, '.workspace', 'settings.json');
    await mkdir(dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, JSON.stringify({
      providers: {
        legacy: {
          name: 'Legacy Provider',
          baseUrl: 'https://legacy.example/v1',
          api: 'openai-completions',
          apiKey: 'legacy-secret',
          models: [{ id: 'legacy-model', name: 'Legacy Model' }],
        },
      },
      defaultProvider: 'legacy',
      defaultModel: 'legacy-model',
    }), 'utf8');

    const configuration = new CoreModelConfiguration({ root, allowNetwork: false, inheritPi: false });
    await configuration.ensureRuntime();
    assert.equal(configuration.activeSpec, 'legacy/legacy-model');

    const coreFile = await configuration.getConfigFile();
    assert.doesNotMatch(coreFile.content, /legacy-secret/);
    assert.match(coreFile.content, /legacy-model/);
    assert.deepEqual(JSON.parse(await readFile(configuration.authPath, 'utf8')).legacy, {
      type: 'api_key',
      key: 'legacy-secret',
    });

    const imported = configuration.parseImportedConfig(JSON.stringify({
      providers: {
        anthropicProxy: {
          name: 'Anthropic Proxy',
          baseUrl: 'https://proxy.example',
          api: 'anthropic-messages',
          apiKey: 'proxy-secret',
          models: [{ id: 'claude-proxy', name: 'Claude Proxy' }],
        },
      },
    }));
    assert.equal(imported.ok, true);
    assert.deepEqual(imported.missing, []);
    assert.deepEqual(imported.entry, {
      id: 'anthropicProxy',
      label: 'Claude Proxy',
      format: 'anthropic',
      baseUrl: 'https://proxy.example',
      apiKey: 'proxy-secret',
      modelId: 'claude-proxy',
    });
  });
});

test('a declared SDK Provider exposes only model IDs written in Core models.json', async () => {
  await withTemporaryProject(async root => {
    const configuration = new CoreModelConfiguration({ root, allowNetwork: false, inheritPi: false });
    await configuration.ensureRuntime();
    const saved = await configuration.saveConfigFile(JSON.stringify({
      providers: {
        openai: {
          name: 'Explicit OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          api: 'openai-completions',
          apiKey: 'openai-secret',
          models: [{
            id: 'explicit-only',
            name: 'Explicit Only',
            api: 'openai-completions',
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 8192,
            maxTokens: 1024,
          }],
        },
      },
    }));
    assert.equal(saved.ok, true);
    assert.deepEqual(
      (await configuration.listModels()).map(model => model.id),
      ['openai/explicit-only'],
      '声明一个内置 Provider 时也不得展开该 Provider 的 SDK 模型目录',
    );
    assert.equal(configuration.resolveModel('openai/gpt-4o'), undefined);
  });
});

test('Core inherits an installed Pi model selection and credentials without copying secrets', async () => {
  await withTemporaryProject(async root => {
    const agentDir = join(root, 'installed-pi');
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'settings.json'), JSON.stringify({
      defaultProvider: 'existing-pi',
      defaultModel: 'existing-model',
      defaultThinkingLevel: 'high',
      providers: {
        'existing-pi': {
          name: 'Existing Pi Provider',
          baseUrl: 'https://pi.example/v1',
          api: 'openai-completions',
          models: [{
            id: 'existing-model',
            name: 'Existing Model',
            api: 'openai-completions',
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 8192,
            maxTokens: 1024,
          }],
        },
      },
    }), 'utf8');
    await writeFile(join(agentDir, 'auth.json'), JSON.stringify({
      'existing-pi': { type: 'api_key', key: 'existing-secret' },
    }), 'utf8');

    const configuration = new CoreModelConfiguration({
      root,
      agentDir,
      allowNetwork: false,
      inheritPi: true,
    });
    await configuration.ensureRuntime();

    assert.equal(configuration.activeSpec, 'existing-pi/existing-model');
    assert.equal(configuration.inheritedThinkingLevel, 'high');
    assert.equal(configuration.resolveModel('existing-pi/existing-model')?.id, 'existing-model');
    const inherited = (await configuration.listModels()).find(model =>
      model.id === 'existing-pi/existing-model');
    assert.equal(inherited?.apiKeyConfigured, true);
    assert.equal(inherited?.configSource, 'runtime');
    assert.equal(inherited?.sourceLabel, 'Pi settings.json');
    assert.equal((await configuration.selectModel('existing-pi', 'existing-model')).ok, true);

    const localModels = await readFile(configuration.modelsPath, 'utf8');
    assert.doesNotMatch(localModels, /existing-secret|existing-model/);
    await assert.rejects(readFile(configuration.authPath, 'utf8'));
    assert.match(await readFile(join(agentDir, 'auth.json'), 'utf8'), /existing-secret/);
  });
});
