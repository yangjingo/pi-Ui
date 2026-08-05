import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { FileHarness, WorkspaceAccessPolicy } from '../../src/harness/file/runtime';

test('Harness/File tool policy defaults searches to the session and gates external paths', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-ui-file-policy-'));
  const skill = join(root, 'skills', 'review');
  const environment = join(root, '.agentcore', 'skill-envs', 'review', 'digest');
  const session = join(root, 'sessions', 'one');
  mkdirSync(skill, { recursive: true });
  mkdirSync(environment, { recursive: true });
  mkdirSync(session, { recursive: true });
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const policy = new WorkspaceAccessPolicy({
    sessionRoot: () => session,
    skillRoots: () => [skill],
    environmentRoots: () => [environment],
  });

  assert.deepEqual(policy.guardTool('find', {}), { ok: true, input: { path: '.' } });
  assert.equal(policy.guardTool('read', { path: join(skill, 'SKILL.md') }).ok, true);
  assert.equal(policy.guardTool('write', { path: join(skill, 'SKILL.md') }).ok, false);
  assert.equal(policy.guardTool('write', { path: join(environment, 'ready.json') }).ok, true);
  assert.equal(policy.guardTool('read', { path: join(root, 'outside.txt') }).ok, false);
  assert.equal(policy.guardTool('powershell', { command: 'Get-ChildItem ..\\.. -Recurse' }).ok, false);
});

test('Harness/File owns workspace path constraints and text-file mutations', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-ui-file-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const harness = new FileHarness(() => root);
  harness.reload();

  assert.throws(() => harness.resolveFile('../outside.txt'), /当前工作目录/);

  const saved = harness.saveText('notes.md', '# Local');
  assert.equal(saved.ok, true);
  assert.equal(saved.file?.path, 'notes.md');
  assert.equal(readFileSync(join(root, 'notes.md'), 'utf8'), '# Local');

  const renamed = harness.renameFile('notes.md', 'renamed.md');
  assert.equal(renamed.ok, true);
  assert.equal(renamed.previousPath, 'notes.md');
  assert.equal(renamed.path, 'renamed.md');

  const deleted = harness.deleteFile('renamed.md');
  assert.equal(deleted.ok, true);
  assert.equal(deleted.path, 'renamed.md');
});

test('Harness/File projects generated files as Canvas artifacts without path boilerplate', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-ui-file-artifact-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const harness = new FileHarness(() => root);
  harness.reload();

  const path = 'pi-ui-design-slides.html';
  assert.equal(harness.saveText(path, '<!doctype html><title>Slides</title>').ok, true);
  assert.ok(harness.capture(path));

  const artifacts = harness.finalArtifacts();
  assert.deepEqual(artifacts, [{
    name: path,
    path,
    type: 'html',
    label: 'HTML',
    canvasPreview: true,
  }]);

  const disclosure = [
    `文件路径： .workspace/be396e0ee9201bd1a0/${path}`,
    '',
    '直接在浏览器中打开即可使用，支持键盘（← →）和触摸滑动翻页。',
  ].join('\n');
  const projected = harness.projectAgentOutput(disclosure, [
    { kind: 'text', text: '页面已完成，包含三章内容。' },
    { kind: 'text', text: disclosure },
  ], artifacts);

  assert.equal(projected.text, '');
  assert.deepEqual(projected.blocks, [{ kind: 'text', text: '页面已完成，包含三章内容。' }]);
  const localizedDisclosure = [
    '已完成。HTML 文件已更新：',
    '',
    `.workspace/d090fec5926372713d/${path}`,
  ].join('\n');
  const localizedWithMetadata = [
    '已完成。HTML 文件已更新：',
    '',
    `文件: .workspace/d090fec5926372713d/${path}（75KB，21 页）`,
  ].join('\n');
  assert.equal(harness.projectAgentOutput(localizedDisclosure, [], artifacts).text, '');
  assert.equal(harness.projectAgentOutput(localizedWithMetadata, [], artifacts).text, '');
  const conversationalDisclosure = `。你可以直接浏览器打开 ${path} 正常演示。`;
  assert.equal(harness.projectAgentOutput(conversationalDisclosure, [], artifacts).text, '');
  assert.equal(
    harness.projectAgentOutput(`页面已完成。你可以直接浏览器打开 ${path} 正常演示。`, [], artifacts).text,
    '页面已完成。',
  );
  assert.deepEqual(
    harness.projectAgentOutput(localizedWithMetadata, [
      { kind: 'text', text: localizedWithMetadata },
    ], artifacts).blocks,
    [],
  );
  assert.deepEqual(
    harness.projectAgentOutput(localizedWithMetadata, [
      { kind: 'text', text: '已完成。HTML 文件已更新：' },
      { kind: 'text', text: `文件: .workspace/d090fec5926372713d/${path}（75KB，21 页）` },
    ], artifacts).blocks,
    [],
  );
  assert.deepEqual(harness.projectMessage({
    role: 'agent',
    status: 'done',
    intro: localizedWithMetadata,
    blocks: [{ kind: 'text', text: localizedWithMetadata }],
    artifacts,
  }), {
    role: 'agent',
    status: 'done',
    intro: undefined,
    blocks: [],
    outro: undefined,
    artifacts,
  });
  assert.deepEqual(harness.projectMessage({
    role: 'agent',
    status: 'done',
    intro: conversationalDisclosure,
    blocks: [{ kind: 'text', text: conversationalDisclosure }],
  }), {
    role: 'agent',
    status: 'done',
    intro: undefined,
    blocks: [],
    outro: undefined,
    artifacts,
  });
  assert.equal(
    harness.projectAgentOutput('页面已完成，包含三章内容。', [], artifacts).text,
    '页面已完成，包含三章内容。',
  );
});

test('Harness/File creates deterministic ZIP archives within workspace safety limits', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-ui-file-archive-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'nested'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# Local\n', 'utf8');
  writeFileSync(join(root, 'nested', 'data.txt'), 'nested content\n', 'utf8');
  writeFileSync(join(root, '.secret'), 'hidden', 'utf8');
  const harness = new FileHarness(() => root);
  harness.reload();

  const archive = harness.archive(['nested/data.txt', 'README.md', 'README.md']);
  assert.equal(archive.ok, true);
  assert.deepEqual(archive.files, ['nested/data.txt', 'README.md'].sort((a, b) => a.localeCompare(b, 'en-US')));
  const entries = unzipSync(archive.data!);
  assert.deepEqual(Object.keys(entries), archive.files);
  assert.equal(strFromU8(entries['README.md']), '# Local\n');
  assert.equal(strFromU8(entries['nested/data.txt']), 'nested content\n');

  assert.match(harness.archive(['../outside.txt']).error || '', /当前工作目录/);
  assert.match(harness.archive(['.secret']).error || '', /隐藏文件/);
  assert.match(harness.archive([]).error || '', /至少选择/);
});

test('Harness/File rejects a file replaced after authorization and before descriptor open', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-ui-file-descriptor-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'stable.txt');
  writeFileSync(path, 'authorized content', 'utf8');
  const harness = new FileHarness(() => root);
  harness.reload();

  assert.equal(harness.readDownload('stable.txt').data?.toString('utf8'), 'authorized content');
  const original = (harness as any).downloadableFile.bind(harness);
  (harness as any).downloadableFile = (requestedPath: string) => {
    const target = original(requestedPath);
    unlinkSync(path);
    writeFileSync(path, 'replacement content', 'utf8');
    return target;
  };

  const result = harness.readDownload('stable.txt');
  assert.equal(result.ok, false);
  assert.match(result.error || '', /发生变化/);
});
