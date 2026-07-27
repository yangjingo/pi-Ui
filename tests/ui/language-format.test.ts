import assert from 'node:assert/strict';
import test from 'node:test';

import { esc, fmtMs, fmtTok, text } from '../../src/ui/language/format';

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
