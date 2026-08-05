import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

import { UI_THEMES } from '../../src/ui/theme';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const visibleRoots = [join(projectRoot, 'src', 'app.tsx'), join(projectRoot, 'src', 'canvas')];
const visibleAttributes = new Set(['aria-label', 'title', 'placeholder']);
const technicalCopy = /^(?:Agent|STEER|TTFT|TPOT|TPS|IN|OUT|CACHE(?: R| W)?|tok|· TPOT|Provider|Base URL|API Key|Model ID|Agent Core Benchmark|SKILL\.md|\.workspace|\.agentcore|models\.json|auth\.json|https?:\/\/\S+|sk-…)$/;

function sourceFiles(path: string): string[] {
  if (extname(path)) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? sourceFiles(child) : /\.tsx?$/.test(entry.name) ? [child] : [];
  });
}

function humanCopy(value: string): boolean {
  return /[\p{L}\p{Script=Han}]/u.test(value.replace(/&[a-z]+;/gi, '').trim());
}

function cssBlock(css: string, selector: string): { body: string; full: string } {
  const start = css.indexOf(`${selector}{`);
  if (start < 0) return { body: '', full: '' };
  const bodyStart = start + selector.length + 1;
  const end = css.indexOf('}', bodyStart);
  if (end < 0) return { body: '', full: '' };
  return { body: css.slice(bodyStart, end), full: css.slice(start, end + 1) };
}

function colorToken(body: string, name: string): string {
  return body.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-f]{6})`, 'i'))?.[1] || '';
}

function relativeLuminance(color: string): number {
  const channels = color.slice(1).match(/.{2}/g)?.map(value => Number.parseInt(value, 16) / 255) || [];
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test('visible Canvas copy is catalog-backed except explicit technical identifiers', () => {
  const violations: string[] = [];
  for (const file of visibleRoots.flatMap(sourceFiles)) {
    const source = readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const report = (node: ts.Node, value: string) => {
      const compact = value.replace(/\s+/g, ' ').trim();
      if (!humanCopy(compact) || technicalCopy.test(compact)) return;
      const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
      violations.push(`${relative(projectRoot, file)}:${line}: ${compact}`);
    };
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node)) report(node, node.text);
      if (ts.isJsxAttribute(node)
        && visibleAttributes.has(node.name.getText(ast))
        && node.initializer
        && ts.isStringLiteral(node.initializer)) {
        report(node, node.initializer.text);
      }
      if (ts.isJsxExpression(node) && node.expression && ts.isStringLiteral(node.expression)) {
        report(node, node.expression.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  assert.deepEqual(violations, []);
});

test('every file intake affordance uses the shared file icon contract', () => {
  const contracts = [
    ['src/canvas/panels/conversation-panel.tsx', ['data-testid="composer-drop"', 'data-testid="composer-attach"']],
    ['src/canvas/panels/files-panel.tsx', ['data-testid="ws-import"', 'data-testid="ws-upload-menu"', 'data-testid="ws-empty-import"']],
    ['src/canvas/panels/model-panel.tsx', ['data-testid="cm-upload"']],
    ['src/canvas/panels/skill-panel.tsx', ['data-testid="skill-file-upload"', 'data-testid="skill-upload-menu"']],
    ['src/canvas/panels/workspace-panel.tsx', ['className="drop-overlay"']],
  ] as const;

  for (const [path, markers] of contracts) {
    const source = readFileSync(join(projectRoot, path), 'utf8');
    for (const marker of markers) {
      const start = source.indexOf(marker);
      assert.ok(start >= 0, `${path} must keep ${marker}`);
      assert.match(source.slice(start, start + 400), /<FileUploadIcon\s*\/>/, `${path} ${marker} must use FileUploadIcon`);
    }
  }

  const canvasSource = sourceFiles(join(projectRoot, 'src', 'canvas')).map(file => readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(canvasSource, /<Icon name="paperclip"/, 'Canvas must not reintroduce a second file intake icon');
});

test('every registered theme defines the same token contract', () => {
  const css = readFileSync(join(projectRoot, 'src', 'ui', 'styles.css'), 'utf8');
  const variables = (body: string) => [...body.matchAll(/--([a-z0-9-]+)\s*:/gi)].map(match => match[1]).sort();
  const darkTokens = variables(cssBlock(css, 'html[data-theme="dark"]').body);
  const themeContract = variables(cssBlock(css, 'html[data-theme="zengrid"]').body);
  assert.ok(themeContract.length > 20);
  assert.deepEqual(themeContract.filter(token => !darkTokens.includes(token)), []);
  for (const theme of Object.keys(UI_THEMES)) {
    if (theme === 'dark') continue;
    const themeTokens = variables(cssBlock(css, `html[data-theme="${theme}"]`).body);
    assert.deepEqual(
      themeContract.filter(token => !themeTokens.includes(token)),
      [],
      `${theme} must define the complete shared theme token contract`,
    );
  }
});

test('component chrome does not bypass theme tokens with raw colors', () => {
  const css = readFileSync(join(projectRoot, 'src', 'ui', 'styles.css'), 'utf8');
  const withoutThemeDefinitions = Object.keys(UI_THEMES).reduce(
    (source, theme) => source.replace(cssBlock(css, `html[data-theme="${theme}"]`).full, ''),
    css,
  );
  const violations = withoutThemeDefinitions.split(/\r?\n/).filter(line => {
    if (!/(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(line)) return false;
    return !/\.r-html\{|\.r-excalidraw|\.ab-(?:bg|grain|copy|pill|orb|card)/.test(line);
  });
  assert.deepEqual(violations, []);
});

test('answer artifacts and Trajectory Canvas share one reading width token', () => {
  const css = readFileSync(join(projectRoot, 'src', 'ui', 'styles.css'), 'utf8');
  assert.match(cssBlock(css, '.agent-answer').body, /width:min\(var\(--content-reading-max\),100%\)/);
  assert.match(cssBlock(css, '.agent-artifacts').body, /width:100%/);
  assert.match(cssBlock(css, '.canvas-shell.context-view .step-result').body, /width:min\(var\(--content-reading-max\),100%\)/);
});

test('AIDA owns its canonical palette and keeps primary interaction indigo', () => {
  const css = readFileSync(join(projectRoot, 'src', 'ui', 'styles.css'), 'utf8');
  const aida = cssBlock(css, 'html[data-theme="aida"]').body;
  assert.equal(colorToken(aida, 'c-bg'), '#f6f8fb');
  assert.equal(colorToken(aida, 'c-surface'), '#ffffff');
  assert.equal(colorToken(aida, 'c-text'), '#0f172a');
  assert.equal(colorToken(aida, 'c-brand'), '#3551d8');
  assert.equal(colorToken(aida, 'aida-red'), '', 'the Pi UI AIDA theme must not expose the retired red logo token');
  assert.match(css, /html\[data-theme="aida"\][^\n]*\.send[^\{]*\{[^}]*background:var\(--c-brand\)/);
  assert.match(css, /html\[data-theme="aida"\][^\n]*\.empty-pi-banner[^\{]*\{[^}]*color:var\(--c-brand\)/);
  assert.match(css, /\.composer-wrap\.composer-welcome \.pill:hover\{[^}]*background:var\(--c-brand-soft\)/);
});

test('the welcome slogan is a balanced lockup with restrained entry motion', () => {
  const css = readFileSync(join(projectRoot, 'src', 'ui', 'styles.css'), 'utf8');
  const conversation = readFileSync(join(projectRoot, 'src', 'canvas', 'panels', 'conversation-panel.tsx'), 'utf8');
  const lockup = cssBlock(css, '.empty-welcome-lockup').body;
  assert.match(conversation, /className="empty-welcome-lockup"/);
  assert.match(lockup, /transition:opacity 220ms var\(--ease-out\),transform 220ms var\(--ease-out\)/);
  assert.doesNotMatch(lockup, /(?:width|height|margin|padding)\s*:[^;]*transition/);
  assert.match(css, /@starting-style\{\s*\.empty-welcome-lockup\{opacity:0;transform:translateY\(7px\)\}/);
  assert.match(css, /prefers-reduced-motion:reduce[^]*\.empty-welcome-lockup\{transform:none;transition:opacity 160ms var\(--ease-out\)\}/);
});

test('workbench chrome stays flat and motion remains purposeful', () => {
  const css = readFileSync(join(projectRoot, 'src', 'ui', 'styles.css'), 'utf8');
  const workspace = readFileSync(join(projectRoot, 'src', 'canvas', 'panels', 'workspace-panel.tsx'), 'utf8');
  const mermaid = readFileSync(join(projectRoot, 'src', 'ui', 'markdown', 'mermaid-runtime.ts'), 'utf8');

  assert.doesNotMatch(css, /box-shadow\s*:/, 'flat UI must not regain decorative shadows or glow');
  assert.doesNotMatch(css, /\b100vh\b/, 'viewport-bound UI must use dynamic viewport units');
  assert.doesNotMatch(css, /transition\s*:\s*all\b/, 'components must transition only intentional properties');
  for (const animation of css.matchAll(/animation\s*:\s*([^;}]*\binfinite\b)/g)) {
    assert.match(animation[1], /\blinear\b/, `continuous state motion must be a linear progress indicator: ${animation[1]}`);
  }
  assert.doesNotMatch(workspace, /className="dots"/, 'Canvas path chrome must identify the file, not show decorative traffic lights');
  assert.match(workspace, /canvas-file-mark/);
  assert.match(mermaid, /theme:\s*'base'/);
  assert.match(mermaid, /securityLevel:\s*'strict'/, 'untrusted diagrams must not inject same-origin HTML');
  assert.match(mermaid, /primaryTextColor:\s*'#E5E5E5'/, 'dark Mermaid output must match the default workbench');
});

test('the UI contract is desktop-only, zoom-fluid, and has no phone compatibility layer', () => {
  const css = readFileSync(join(projectRoot, 'src', 'ui', 'styles.css'), 'utf8');
  const html = readFileSync(join(projectRoot, 'index.html'), 'utf8');
  const modelPanel = readFileSync(join(projectRoot, 'src', 'canvas', 'panels', 'model-panel.tsx'), 'utf8');
  const skillPanel = readFileSync(join(projectRoot, 'src', 'canvas', 'panels', 'skill-panel.tsx'), 'utf8');

  assert.match(cssBlock(css, 'html,body,#root').body, /min-width:0/);
  assert.match(cssBlock(css, '.app').body, /min\(var\(--ws-w,50vw\),65vw\)/);
  assert.match(cssBlock(css, '.config-page-workbench').body, /min\(440px,42vw\)/);
  assert.doesNotMatch(css, /@media[^\{]*max-width/i);
  assert.doesNotMatch(css, /pointer\s*:\s*coarse|hover\s*:\s*none|touch-action|-webkit-overflow-scrolling/i);
  assert.doesNotMatch(html, /name=["']viewport["']/i);
  assert.doesNotMatch(`${modelPanel}\n${skillPanel}`, /matchMedia\([^)]*max-width/i);
});

test('registered themes keep normal text and focus above WCAG AA contrast', () => {
  const css = readFileSync(join(projectRoot, 'src', 'ui', 'styles.css'), 'utf8');
  for (const theme of Object.keys(UI_THEMES)) {
    const body = cssBlock(css, `html[data-theme="${theme}"]`).body;
    const background = colorToken(body, 'surface-base');
    for (const token of ['content-primary', 'content-secondary', 'content-tertiary', 'border-focus']) {
      const foreground = colorToken(body, token);
      assert.ok(background && foreground, `${theme} must define ${token} and surface-base as opaque colors`);
      assert.ok(contrastRatio(background, foreground) >= 4.5, `${theme} ${token} must reach WCAG AA on surface-base`);
    }
  }
});
