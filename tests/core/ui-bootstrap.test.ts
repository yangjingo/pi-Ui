import assert from 'node:assert/strict';
import test from 'node:test';

import {
  injectUiBootstrap,
  resolveUiBootstrap,
  UI_BOOTSTRAP_BRANDS,
  UI_BOOTSTRAP_LANGUAGES,
  UI_BOOTSTRAP_THEMES,
} from '../../src/core/pi/ui-bootstrap';

test('Core/UI bootstrap defaults to dark English and allow-lists startup values', () => {
  assert.deepEqual(resolveUiBootstrap({}), { theme: 'dark', language: 'en', brand: 'pi' });
  assert.deepEqual(resolveUiBootstrap({
    PI_UI_THEME: 'ZenGrid',
    PI_UI_LANGUAGE: 'zh-CN',
    PI_UI_BRAND: 'AIDA',
  }), { theme: 'zengrid', language: 'zh-CN', brand: 'aida' });
  assert.deepEqual(resolveUiBootstrap({
    PI_UI_THEME: 'dark',
    PI_UI_LANGUAGE: 'zh-Hans',
  }), { theme: 'dark', language: 'zh-CN', brand: 'pi' });
  assert.deepEqual(resolveUiBootstrap({
    PI_UI_THEME: 'AIDA',
  }), { theme: 'aida', language: 'en', brand: 'aida' });
  assert.deepEqual(resolveUiBootstrap({
    PI_UI_THEME: 'aida',
    PI_UI_BRAND: 'pi',
  }), { theme: 'aida', language: 'en', brand: 'pi' });
  assert.deepEqual(resolveUiBootstrap({
    PI_UI_THEME: '<script>',
    PI_UI_LANGUAGE: 'unknown',
    PI_UI_BRAND: '<script>',
  }), { theme: 'dark', language: 'en', brand: 'pi' });
});

test('Core/UI bootstrap injects the configured theme and language into HTML', () => {
  const html = injectUiBootstrap(
    '<!doctype html><html class="old"><head></head><body></body></html>',
    { theme: 'zengrid', language: 'zh-CN', brand: 'aida' },
  );
  assert.match(html, /<html lang="zh-CN" data-language="zh-CN" data-theme="zengrid" data-brand="aida"/);
  assert.match(html, /style="color-scheme:light"/);
  assert.doesNotMatch(html, /class="old"/);
});

test('Core bootstrap registries expose every startup option explicitly', () => {
  assert.deepEqual(Object.keys(UI_BOOTSTRAP_THEMES), ['dark', 'zengrid', 'aida']);
  assert.deepEqual(Object.keys(UI_BOOTSTRAP_LANGUAGES), ['en', 'zh-CN']);
  assert.deepEqual(Object.keys(UI_BOOTSTRAP_BRANDS), ['pi', 'aida']);
});
