import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { ICONS, artifactIcon, fileIcon } from '../../src/ui/icons';

const projectRoot = resolve(import.meta.dirname, '..', '..');

test('file icons use one monochrome family with meaningful silhouettes', () => {
  const expected = {
    html: 'web-preview',
    md: 'text-file',
    doc: 'text-file',
    json: 'braces',
    sheet: 'grid',
    slides: 'presentation',
  } as const;

  for (const [type, icon] of Object.entries(expected)) {
    assert.equal(fileIcon(type), icon);
    assert.equal(artifactIcon(type), icon);
    assert.ok(ICONS[icon], `${icon} must be registered`);
  }

  for (const [name, glyph] of Object.entries(ICONS)) {
    assert.doesNotMatch(glyph, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(/i, `${name} must inherit one currentColor`);
  }
});

test('icon color is semantic rather than file-type decoration', () => {
  const css = readFileSync(resolve(projectRoot, 'src', 'ui', 'styles.css'), 'utf8');
  for (const token of ['icon-muted', 'icon-default', 'icon-active', 'icon-success', 'icon-warning', 'icon-danger', 'icon-surface', 'icon-surface-active']) {
    assert.match(css, new RegExp(`--${token}:`), `${token} must be defined`);
  }
  assert.doesNotMatch(css, /--file-(?:doc|slides)/, 'file formats must not own decorative colors');
});
