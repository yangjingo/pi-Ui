import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileHarness } from '../../src/harness/file/runtime';

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
