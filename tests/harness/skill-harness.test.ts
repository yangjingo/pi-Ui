import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SkillHarness } from '../../src/harness/skill';

test('Harness/Skill discovers metadata and delegates explicit expansion to Pi SDK', (context) => {
  const workspace = mkdtempSync(join(tmpdir(), 'pi-ui-skill-'));
  const root = join(workspace, 'skills');
  mkdirSync(root, { recursive: true });
  context.after(() => rmSync(workspace, { recursive: true, force: true }));
  const harness = new SkillHarness(() => root);
  const saved = harness.save({
    id: 'review',
    name: 'review',
    desc: 'local test',
    enabled: true,
    files: { 'SKILL.md': '---\nname: review\n---\n\nReview only local changes.' },
  });

  assert.equal(saved.ok, true);
  const summary = harness.catalog()[0];
  assert.equal(summary?.source, 'workspace');
  assert.equal(summary?.fileCount, 1);
  assert.equal(harness.read('review')?.files['SKILL.md']?.includes('Review only local changes.'), true);
  const invocation = harness.resolveInvocation('/review inspect this diff');
  assert.match(invocation.modelText, /^\/skill:review /);
  assert.match(invocation.modelText, /<skill_runtime skill_id="review" environment="[^"]+"/);
  assert.match(invocation.modelText, /inspect this diff$/);
  assert.equal(harness.resolveInvocation('/other leave this alone').modelText, '/other leave this alone');
});

test('SkillHarness creates a restrained Session draft from reusable Trajectory evidence', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-ui-skill-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const harness = new SkillHarness(() => root);
  const generated = harness.createFromTurn({
    user: { role: 'user', text: '审查并修复这次发布前的问题' },
    agent: {
      role: 'agent',
      outro: '已完成检查和修复。',
      traj: [
        { t: 'read', title: '读取配置', det: 'settings.json', in: '{"path":"settings.json"}', status: 'done', time: '10:00' },
        { t: 'code', shell: 'powershell', title: '运行脚本', det: 'review.ps1', in: '{"command":"pwsh ./review.ps1"}', file: 'review.ps1', status: 'done', time: '10:01' },
      ],
      artifacts: [{ name: 'review.ps1', path: 'review.ps1', type: 'code', label: 'PowerShell', canvasPreview: true }],
    },
    workspaceFiles: { 'review.ps1': 'Write-Output "reviewed"' },
  });

  assert.match(generated.id, /^skill-draft-[a-f0-9]{12}-[a-f0-9]{8}$/);
  assert.match(generated.files['SKILL.md'], new RegExp(`^---\\nname: ${generated.id}\\n`));
  assert.match(generated.files['SKILL.md'], /# Objective\n/);
  assert.match(generated.files['SKILL.md'], /powershell: pwsh \.\/review\.ps1/);
  assert.match(generated.files['SKILL.md'], /`scripts\/review\.ps1`/);
  assert.equal(generated.files['scripts/review.ps1'], 'Write-Output "reviewed"');
  assert.deepEqual(Object.keys(generated.files).sort(), ['SKILL.md', 'scripts/review.ps1']);
  assert.equal(generated.files['SKILL.md'].includes('已完成检查和修复'), false);
  assert.equal(generated.files['SKILL.md'].includes('Tool output'), false);
});

test('SkillHarness installs one staged package into the workspace Skill root', (context) => {
  const workspace = mkdtempSync(join(tmpdir(), 'pi-ui-skill-install-'));
  const session = join(workspace, 'sessions', 'one');
  const staged = join(session, 'downloaded-skill');
  const outside = join(workspace, 'outside-skill');
  const skills = join(workspace, 'skills');
  mkdirSync(join(staged, 'agents'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  mkdirSync(skills, { recursive: true });
  writeFileSync(join(staged, 'SKILL.md'), '---\nname: release-review\ndescription: Review a release before shipping.\n---\n\nReview the release.', 'utf8');
  writeFileSync(join(outside, 'SKILL.md'), '---\nname: outside\ndescription: Must not install.\n---\n', 'utf8');
  context.after(() => rmSync(workspace, { recursive: true, force: true }));

  const harness = new SkillHarness(() => skills);
  const installed = harness.installFromDirectory({
    sessionRoot: session,
    sourceDirectory: 'downloaded-skill',
  });
  assert.equal(installed.ok, true);
  assert.equal(installed.skill?.id, 'release-review');
  assert.equal(installed.skill?.rootPath, join(skills, 'release-review'));
  assert.deepEqual(Object.keys(installed.skill?.files || {}).sort(), ['SKILL.md', 'agents/openai.yaml']);
  assert.match(installed.skill?.files['agents/openai.yaml'] || '', /\$release-review/);

  const duplicate = harness.installFromDirectory({
    sessionRoot: session,
    sourceDirectory: 'downloaded-skill',
  });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error || '', /已存在/);

  const escaped = harness.installFromDirectory({
    sessionRoot: session,
    sourceDirectory: '../../outside-skill',
  });
  assert.equal(escaped.ok, false);
  assert.match(escaped.error || '', /必须位于当前 Session/);
});

test('SkillHarness reuses ready environments until the Skill fingerprint changes', (context) => {
  const workspace = mkdtempSync(join(tmpdir(), 'pi-ui-skill-env-'));
  const root = join(workspace, 'skills');
  mkdirSync(root, { recursive: true });
  context.after(() => rmSync(workspace, { recursive: true, force: true }));
  const harness = new SkillHarness(() => root);
  const save = (body: string) => harness.save({
    id: 'chart', name: 'Chart', desc: 'Render charts', enabled: true,
    files: { 'SKILL.md': body, 'package.json': '{"dependencies":{"d3":"7.9.0"}}' },
  });
  assert.equal(save('# Chart v1').ok, true);
  const first = harness.environment('chart');
  assert.equal(first.ready, false);
  assert.equal(harness.markEnvironmentReady('chart', first.digest).ready, true);
  assert.equal(harness.environment('chart').path, first.path);
  assert.equal(harness.environment('chart').ready, true);

  assert.equal(save('# Chart v2').ok, true);
  const changed = harness.environment('chart');
  assert.notEqual(changed.digest, first.digest);
  assert.equal(changed.ready, false);
});
