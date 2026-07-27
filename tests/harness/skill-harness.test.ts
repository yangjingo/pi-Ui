import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SkillHarness } from '../../src/harness/skill';

test('Harness/Skill persists and injects only explicit local skills', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-ui-skill-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const harness = new SkillHarness(() => root);
  const saved = harness.save({
    id: 'review',
    name: 'review',
    desc: 'local test',
    enabled: true,
    files: { 'SKILL.md': '---\nname: review\n---\n\nReview only local changes.' },
  });

  assert.equal(saved.ok, true);
  assert.equal(harness.list()[0]?.source, 'workspace');
  const injected = harness.inject('/review inspect this diff');
  assert.match(injected, /<activated_skill name="review">/);
  assert.match(injected, /Review only local changes\./);
  assert.match(injected, /<user_request>\ninspect this diff\n<\/user_request>$/);
  assert.ok(injected.indexOf('<activated_skill') < injected.indexOf('<user_request>'));
  assert.equal(harness.inject('/other leave this alone'), '/other leave this alone');
});

test('SkillHarness preserves source and trajectory when creating from a turn', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-ui-skill-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const harness = new SkillHarness(() => root);
  const generated = harness.createFromTurn({
    user: { role: 'user', text: '审查并修复这次发布前的问题' },
    agent: {
      role: 'agent',
      outro: '已完成检查和修复。',
      traj: [{ t: 'read', title: '读取配置', det: '检查部署配置', status: 'done', time: '10:00' }],
    },
  });

  assert.ok(generated.files['SKILL.md']);
  assert.ok(generated.files['references/source-turn.md']);
  assert.ok(generated.files['references/trajectory.md']);
});
