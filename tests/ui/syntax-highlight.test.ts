import assert from 'node:assert/strict';
import test from 'node:test';

import { highlightCode, languageOfPath, MAX_HIGHLIGHT_CHARS, normalizeCodeLanguage } from '../../src/ui/syntax/highlight';

test('UI syntax highlighting recognizes required code language aliases', () => {
  assert.equal(normalizeCodeLanguage('ts'), 'typescript');
  assert.equal(normalizeCodeLanguage('js'), 'javascript');
  assert.equal(normalizeCodeLanguage('py'), 'python');
  assert.equal(languageOfPath('src/app.tsx'), 'typescript');
  assert.equal(languageOfPath('unknown.xyz'), 'text');
  for (const language of ['typescript', 'javascript', 'json', 'css', 'html', 'shell', 'python', 'markdown']) {
    assert.equal(highlightCode('const value = 1', language).highlighted, true, language);
  }
});

test('UI syntax highlighting escapes source and emits semantic tokens', () => {
  const result = highlightCode('const value = "<unsafe>"; // note', 'ts');
  assert.equal(result.highlighted, true);
  assert.match(result.html, /syntax-keyword/);
  assert.match(result.html, /syntax-string/);
  assert.match(result.html, /syntax-comment/);
  assert.doesNotMatch(result.html, /<unsafe>/);
});

test('UI syntax highlighting falls back for unknown languages and large files', () => {
  assert.equal(highlightCode('<tag>', 'unknown').html, '&lt;tag>');
  const large = highlightCode('x'.repeat(MAX_HIGHLIGHT_CHARS + 1), 'js');
  assert.equal(large.highlighted, false);
  assert.equal(large.truncated, true);
});
