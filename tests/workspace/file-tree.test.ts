import assert from 'node:assert/strict';
import test from 'node:test';

import type { FileNode } from '../../src/core/agent/protocol';
import { filterFileTree, listFiles, parentPath } from '../../src/workspace/files/tree';
import { workspaceChangeContext } from '../../src/workspace/state/pending-changes';

const tree: FileNode[] = [{
  name: 'docs',
  path: 'docs',
  type: 'folder',
  children: [
    { name: 'guide.md', path: 'docs/guide.md', type: 'md' },
    { name: 'data.csv', path: 'docs/data.csv', type: 'sheet' },
  ],
}];

test('Workspace flattens and filters the browser file tree without owning filesystem I/O', () => {
  assert.deepEqual(listFiles(tree).map(file => file.path), ['docs/guide.md', 'docs/data.csv']);
  assert.equal(parentPath('docs/guide.md'), 'docs');
  assert.equal(parentPath('guide.md'), '工作区根目录');

  const filtered = filterFileTree(tree, 'GUIDE');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.open, true);
  assert.deepEqual(filtered[0]?.children?.map(file => file.path), ['docs/guide.md']);
});

test('Workspace serializes bounded Canvas edits for the next Agent turn', () => {
  const context = workspaceChangeContext([{
    id: 1,
    path: 'notes.md',
    kind: 'edit',
    content: 'x'.repeat(13_000),
  }]);

  assert.match(context, /\[Canvas workspace changes\]/);
  assert.match(context, /"path":"notes.md"/);
  assert.match(context, /"truncated":true/);
  assert.ok(context.length < 13_000);
});
