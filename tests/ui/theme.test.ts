import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTheme, readTheme, UI_THEMES } from '../../src/ui/theme';
import { parseBrand, readBrand, UI_BRANDS } from '../../src/ui/brand';

test('UI theme defaults unknown and missing values to dark', () => {
  assert.equal(parseTheme(undefined), 'dark');
  assert.equal(parseTheme('system'), 'dark');
  assert.equal(parseTheme('dark'), 'dark');
  assert.equal(parseTheme('zengrid'), 'zengrid');
  assert.equal(parseTheme('AIDA'), 'aida');
  assert.equal(readTheme(), 'dark');
});

test('UI theme reads the startup-injected document theme', () => {
  assert.equal(readTheme({ dataset: { theme: 'zengrid' } }), 'zengrid');
  assert.equal(readTheme({ dataset: { theme: 'aida' } }), 'aida');
});

test('theme registry owns color-scheme metadata for every supported theme', () => {
  assert.deepEqual(Object.keys(UI_THEMES), ['dark', 'zengrid', 'aida']);
  assert.equal(UI_THEMES.dark.colorScheme, 'dark');
  assert.equal(UI_THEMES.zengrid.colorScheme, 'light');
  assert.equal(UI_THEMES.aida.colorScheme, 'light');
});

test('brand selection is independent from the visual theme', () => {
  assert.deepEqual(UI_BRANDS, ['pi', 'aida']);
  assert.equal(parseBrand('AIDA'), 'aida');
  assert.equal(parseBrand('unknown'), 'pi');
  assert.equal(readBrand({ dataset: { brand: 'aida', theme: 'dark' } }), 'aida');
});
