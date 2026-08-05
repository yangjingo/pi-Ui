import assert from 'node:assert/strict';
import test from 'node:test';

import { esc, fmtMs, fmtTok, relativeTimeLabel, sessionGroupLabel, term, text } from '../../src/ui/language/format';
import { compactCount, compactTurnMetrics } from '../../src/ui/language/metrics';
import {
  parseLanguage,
  readLanguage,
  t,
  UI_LOCALES,
} from '../../src/ui/language/runtime';

test('UI language helpers format unknown values, latency and tokens consistently', () => {
  assert.equal(text(null), '');
  assert.equal(text(42), '42');
  assert.equal(esc('<tag attr="x">&'), '&lt;tag attr=&quot;x&quot;>&amp;');
  assert.equal(fmtMs(undefined), '—');
  assert.equal(fmtMs(320), '320ms');
  assert.equal(fmtMs(1250), '1.3s');
  assert.equal(fmtTok(612), '612');
  assert.equal(fmtTok(12_450), '12.4k');
});

test('compact Agent metrics preserve the agreed order and short labels', () => {
  assert.equal(compactCount(999), '999');
  assert.equal(compactCount(18_420), '18.4k');
  assert.equal(compactCount(2_000_000), '2m');
  assert.deepEqual(compactTurnMetrics({
    ttft: 1_200,
    tpot: 24,
    duration: 5_000,
    input: 18_000,
    output: 2_400,
    cacheRead: 12_000,
    cacheWrite: 0,
    totalTokens: 32_400,
  }, 0.4), [
    { label: 'TTFT', value: '1.2s' },
    { label: 'TPOT', value: '24ms' },
    { label: 'TPS', value: '41.7' },
    { label: 'IN', value: '18k' },
    { label: 'OUT', value: '2.4k' },
    { label: 'CACHE', value: '40%' },
  ]);
  assert.deepEqual(compactTurnMetrics({
    ttft: 0,
    tpot: 0,
    duration: 0,
    input: 0,
    output: 0,
  }), [
    { label: 'IN', value: '0' },
    { label: 'OUT', value: '0' },
  ]);
});

test('UI product terms keep fixed navigation language consistent', () => {
  assert.equal(term('files'), 'Files');
  assert.equal(term('goal'), 'Goal');
  assert.equal(term('goal', 'zh-CN'), '目标');
  assert.equal(term('canvas'), 'Canvas');
  assert.equal(term('skillCenter'), 'Skills');
  assert.equal(term('trajectory'), 'Trajectory');
  assert.equal(parseLanguage(undefined), 'en');
  assert.equal(parseLanguage('zh-CN'), 'zh-CN');
  assert.equal(parseLanguage('zh-Hans'), 'zh-CN');
  assert.equal(parseLanguage('en-GB'), 'en');
  assert.equal(readLanguage({ dataset: { language: 'zh-CN' }, lang: 'en' }), 'zh-CN');
});

test('Core-owned Session metadata follows the active locale without translating titles', () => {
  assert.equal(sessionGroupLabel('今天', 'en'), 'Today');
  assert.equal(sessionGroupLabel('Existing Pi sessions · Today', 'zh-CN'), '已有 Pi 会话 · 今天');
  assert.equal(sessionGroupLabel('已有 Pi 会话 · 2026-07-25', 'en'), 'Existing Pi sessions · 2026-07-25');
  assert.equal(relativeTimeLabel('刚刚', 'en'), 'Just now');
  assert.equal(relativeTimeLabel('2026-07-25 10:00', 'zh-CN'), '2026-07-25 10:00');
});

test('locale catalogs have identical keys and support parameters and plurals', () => {
  assert.deepEqual(
    Object.keys(UI_LOCALES.en.messages).sort(),
    Object.keys(UI_LOCALES['zh-CN'].messages).sort(),
  );
  assert.equal(t('common.selectedCount', { count: 1 }, 'en'), '1 item');
  assert.equal(t('common.selectedCount', { count: 2 }, 'en'), '2 items');
  assert.equal(t('common.selectedCount', { count: 2 }, 'zh-CN'), '2 项');
  assert.equal(t('renderer.viewMode', { name: 'README.md' }, 'en'), 'README.md view mode');
  assert.equal(t('conversation.newTask', undefined, 'en'), 'Pi Cooks. You Look busy');
  assert.equal(t('conversation.newTaskAida', undefined, 'en'), 'AIDA Cooks. You Look busy');
  assert.equal(t('conversation.newTask', undefined, 'zh-CN'), '告诉 Pi，然后假装很忙。');
  assert.equal(t('conversation.newTaskAida', undefined, 'zh-CN'), '告诉 Pi，然后假装很忙。');
});
