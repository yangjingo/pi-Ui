export interface Skill {
  id: string;
  name: string;
  desc: string;
  files: Record<string, string>;
  enabled: boolean;
  source: 'workspace';
  fileCount: number;
  rootPath: string;
  skillPath: string;
  commandName: string;
}

export type SkillDraft = Pick<Skill, 'name' | 'desc' | 'files' | 'enabled'> & { id?: string };

export function skillSlashCommand(skill: Pick<Skill, 'name'>): string {
  return `/${skill.name.trim()}`;
}

export function makeSkillMd(name: string, desc: string, body: string): string {
  const title = name.trim() || 'Untitled Skill';
  const summary = desc.trim() || title;
  return `---\nname: ${title}\ndescription: ${summary}\n---\n\n${body.trim()}`;
}
