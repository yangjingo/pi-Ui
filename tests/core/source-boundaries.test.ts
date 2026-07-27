import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import test from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const sourceRoot = resolve(projectRoot, 'src');
const testRoot = resolve(projectRoot, 'tests');
const sourceModules = ['canvas', 'core', 'harness', 'ui', 'workspace'] as const;
const testAreas = [...sourceModules, 'e2e', 'fixtures'] as const;
const sourceExtensions = new Set(['.ts', '.tsx']);

interface ImportReference {
  specifier: string;
  typeOnly: boolean;
}

function slash(path: string): string {
  return path.replaceAll('\\', '/');
}

function extension(path: string): string {
  const match = path.match(/(\.[^.\\/]+)$/);
  return match?.[1] || '';
}

function filesUnder(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function directoriesUnder(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    if (!entry.isDirectory()) return [];
    const path = resolve(root, entry.name);
    return [path, ...directoriesUnder(path)];
  });
}

function topDirectories(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function importReferences(source: string): ImportReference[] {
  const references: ImportReference[] = [];
  const staticImport = /\b(?:import|export)\s+(type\s+)?(?:[\w*$,\s{}]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImport = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = staticImport.exec(source)) != null) {
    references.push({ specifier: match[2], typeOnly: !!match[1] });
  }
  while ((match = dynamicImport.exec(source)) != null) {
    references.push({ specifier: match[1], typeOnly: false });
  }
  return references;
}

function sourceRoute(file: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const target = resolve(dirname(file), specifier);
  const route = slash(relative(sourceRoot, target));
  if (route.startsWith('../')) return null;
  return route
    .replace(/\.(?:ts|tsx|css)$/, '')
    .replace(/\/index$/, '');
}

function sourceArea(sourcePath: string): string {
  const [module, child] = sourcePath.split('/');
  if (module === 'core' && (child === 'agent' || child === 'pi')) return `${module}/${child}`;
  return module;
}

function routeAllowed(area: string, route: string): boolean {
  const targetModule = route.split('/')[0];

  if (area === 'core/agent') return route.startsWith('core/agent/');
  if (area === 'core/pi') {
    return route.startsWith('core/pi/')
      || route === 'core/agent/protocol'
      || ['harness/context', 'harness/file/runtime', 'harness/goal', 'harness/skill'].includes(route);
  }
  if (targetModule === area) return true;

  const publicRoutes: Record<string, string[]> = {
    harness: ['core/agent/protocol'],
    ui: ['core/agent/protocol'],
    canvas: ['core/agent/protocol', 'ui', 'workspace'],
    workspace: ['core/agent', 'core/agent/protocol', 'harness/file'],
  };
  return publicRoutes[area]?.includes(route) ?? false;
}

function resolveModule(file: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(file), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
  ];
  return candidates.find(candidate => existsSync(candidate) && sourceExtensions.has(extension(candidate))) ?? null;
}

test('source and test trees mirror the five-module design', () => {
  assert.deepEqual(topDirectories(sourceRoot), [...sourceModules].sort());
  assert.deepEqual(topDirectories(testRoot), [...testAreas].sort());
  assert.equal(existsSync(resolve(projectRoot, 'verify')), false, 'legacy verify/ must stay removed');

  for (const module of sourceModules) {
    const ownedTests = filesUnder(resolve(testRoot, module))
      .filter(path => /\.(?:test|spec)\.ts$/.test(path));
    assert.ok(ownedTests.length > 0, `tests/${module} must contain an owned test`);
  }
});

test('source and test filenames use lowercase kebab-case', () => {
  const checkedFiles = [...filesUnder(sourceRoot), ...filesUnder(testRoot)]
    .filter(path => sourceExtensions.has(extension(path)));
  const checkedDirectories = [...directoriesUnder(sourceRoot), ...directoriesUnder(testRoot)];
  const invalid = [
    ...checkedFiles
      .filter(path => !/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.(?:test|spec))?\.(?:ts|tsx)$/.test(path.split(/[\\/]/).at(-1) || ''))
      .map(path => slash(relative(projectRoot, path))),
    ...checkedDirectories
      .filter(path => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path.split(/[\\/]/).at(-1) || ''))
      .map(path => `${slash(relative(projectRoot, path))}/`),
  ];
  assert.deepEqual(invalid, []);
});

test('source imports follow the public module dependency matrix', () => {
  const violations: string[] = [];
  const sourceFiles = filesUnder(sourceRoot).filter(path => sourceExtensions.has(extension(path)));

  for (const file of sourceFiles) {
    const sourcePath = slash(relative(sourceRoot, file));
    if (!sourcePath.includes('/')) continue;
    const area = sourceArea(sourcePath);
    const references = importReferences(readFileSync(file, 'utf8'));

    for (const reference of references) {
      const route = sourceRoute(file, reference.specifier);
      if (route && !routeAllowed(area, route)) {
        violations.push(`${sourcePath}: ${reference.specifier} is outside ${area}'s public dependencies`);
      }
      if (route === 'core/agent/protocol'
        && (area === 'canvas' || area === 'ui')
        && !reference.typeOnly) {
        violations.push(`${sourcePath}: browser protocol imports must use import type`);
      }
      if (reference.specifier.startsWith('node:')
        && area !== 'core/pi'
        && area !== 'harness') {
        violations.push(`${sourcePath}: Node built-in ${reference.specifier} is server-only`);
      }
      if ((reference.specifier === '@earendil-works/pi-ai'
        || reference.specifier === '@earendil-works/pi-coding-agent')
        && area !== 'core/pi') {
        violations.push(`${sourcePath}: Pi SDK imports belong in core/pi`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('root entries and browser-safe File Harness stay isolated', () => {
  const rootImports = (name: 'app.tsx' | 'main.tsx') => importReferences(
    readFileSync(resolve(sourceRoot, name), 'utf8'),
  )
    .map(reference => sourceRoute(resolve(sourceRoot, name), reference.specifier))
    .filter((route): route is string => !!route)
    .sort();

  assert.deepEqual(rootImports('main.tsx'), ['app', 'ui/styles']);
  assert.deepEqual(rootImports('app.tsx'), ['canvas', 'canvas', 'canvas', 'canvas', 'workspace']);

  const entry = resolve(sourceRoot, 'harness', 'file', 'index.ts');
  const visited = new Set<string>();
  const pending = [entry];
  const violations: string[] = [];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    for (const reference of importReferences(readFileSync(file, 'utf8'))) {
      if (reference.specifier.startsWith('node:')) {
        violations.push(`${slash(relative(sourceRoot, file))}: ${reference.specifier}`);
      }
      const dependency = resolveModule(file, reference.specifier);
      if (!dependency) continue;
      if (slash(dependency).endsWith('/harness/file/runtime.ts')) {
        violations.push(`${slash(relative(sourceRoot, file))}: imports server runtime`);
      }
      pending.push(dependency);
    }
  }
  assert.deepEqual(violations, []);
});

test('package commands run boundary validation from tests', () => {
  const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};
  assert.equal(scripts['test:boundaries'], 'tsx --test tests/core/source-boundaries.test.ts');
  assert.equal(scripts['check:boundaries'], 'pnpm test:boundaries');
  assert.match(scripts.typecheck || '', /pnpm check:boundaries/);
  assert.match(scripts.build || '', /pnpm check:boundaries/);
});
