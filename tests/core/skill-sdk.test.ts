import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import { SkillHarness } from '../../src/harness/skill';

test('Core delegates local Skill discovery and exact locations to Pi SDK', async (context) => {
  const workspace = mkdtempSync(join(tmpdir(), 'pi-ui-skill-sdk-'));
  const skillsRoot = join(workspace, 'skills');
  const sessionRoot = join(workspace, 'sessions', 'one');
  mkdirSync(skillsRoot, { recursive: true });
  mkdirSync(sessionRoot, { recursive: true });
  context.after(() => rmSync(workspace, { recursive: true, force: true }));
  const harness = new SkillHarness(() => skillsRoot);
  assert.equal(harness.save({
    id: 'review',
    name: 'Review changes',
    desc: 'Review only local changes',
    enabled: true,
    files: {
      'SKILL.md': '# Review\n\nRead references/checklist.md only when needed.',
      'references/checklist.md': 'Check types and tests.',
    },
  }).ok, true);

  const loader = new DefaultResourceLoader({
    cwd: sessionRoot,
    agentDir: join(workspace, '.agent'),
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    additionalSkillPaths: [skillsRoot],
  });
  await loader.reload();
  const skill = loader.getSkills().skills.find(item => item.name === 'review');
  assert.equal(resolve(skill?.filePath || ''), resolve(skillsRoot, 'review', 'SKILL.md'));
  assert.equal(resolve(skill?.baseDir || ''), resolve(skillsRoot, 'review'));
  assert.equal(skill?.description, 'Review only local changes');
});
