import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { Message, TrajStep } from '../../core/agent/protocol';

const SKILL_META_FILE = '.skillhub.json';
const MAX_SKILL_FILES = 200;
const MAX_SKILL_FILE_BYTES = 256 * 1024;
const MAX_SKILL_TOTAL_BYTES = 2 * 1024 * 1024;

/** A local, workspace-owned Skill. Remote sources intentionally do not exist here. */
export interface SharedSkill {
  id: string;
  name: string;
  desc: string;
  files: Record<string, string>;
  enabled: boolean;
  source: 'workspace';
}

export interface GeneratedSkillDraft {
  name: string;
  desc: string;
  files: Record<string, string>;
}

export interface SkillTurnSource {
  user: Message | null;
  agent: Message;
}

export interface SkillSaveInput {
  id?: string;
  name: string;
  desc?: string;
  files: Record<string, string>;
  enabled?: boolean;
}

export interface SkillMutationResult {
  ok: boolean;
  skill?: SharedSkill;
  error?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validSkillId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(value);
}

function validSkillPath(value: string): boolean {
  return !!value && !value.includes('\\') && !value.startsWith('/') &&
    !value.split('/').some(part => !part || part === '.' || part === '..');
}

function skillId(name: string): string {
  const slug = name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || `skill-${randomBytes(6).toString('hex')}`;
}

function skillBody(skill: SharedSkill): string {
  const source = skill.files['SKILL.md'] || skill.files['skill.md'] || '';
  // Strip only the optional frontmatter delimiters. The rest is authored prompt content.
  return source.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/u, '').trim();
}

function clip(value: string, max: number): string {
  const clean = value.replace(/\r\n/g, '\n').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}\n…（已截断）`;
}

function agentText(message: Message): string {
  const blocks = message.blocks?.filter((block): block is Extract<NonNullable<Message['blocks']>[number], { kind: 'text' }> => block.kind === 'text').map(block => block.text) || [];
  return clip(blocks.length ? blocks.join('\n\n') : [message.intro, message.outro].filter(Boolean).join('\n\n'), 12_000);
}

function trajectoryText(steps: TrajStep[]): string {
  return steps.map((step, index) => {
    const detail = step.text || step.det || '';
    return `${index + 1}. ${step.title || step.t}${detail ? ` — ${clip(detail, 700)}` : ''}`;
  }).join('\n');
}

function suggestedName(task: string): string {
  const title = task.replace(/\s+/g, ' ').replace(/^\/\S+\s*/u, '').trim();
  return clip(title || '复用工作流', 32).replace(/[\r\n]/g, ' ').trim() || '复用工作流';
}

/** Resolves explicitly-invoked local skills immediately before Pi receives a prompt. */
export class SkillHarness {
  constructor(private readonly skillRoot: () => string) {}

  private directory(id: string): string {
    if (!validSkillId(id)) throw new Error('无效的 Skill 标识');
    const root = resolve(this.skillRoot());
    const directory = resolve(root, id);
    if (relative(root, directory) !== id) throw new Error('无效的 Skill 路径');
    return directory;
  }

  private readFiles(directory: string): Record<string, string> {
    const files: Record<string, string> = {};
    let total = 0;
    const visit = (current: string, prefix = '') => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (entry.name === SKILL_META_FILE) continue;
        const nextPath = join(current, entry.name);
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          visit(nextPath, path);
          continue;
        }
        if (!entry.isFile() || !validSkillPath(path)) continue;
        if (Object.keys(files).length >= MAX_SKILL_FILES || statSync(nextPath).size > MAX_SKILL_FILE_BYTES) {
          throw new Error('Skill 文件数量或大小超出限制');
        }
        const content = readFileSync(nextPath, 'utf8');
        total += Buffer.byteLength(content, 'utf8');
        if (total > MAX_SKILL_TOTAL_BYTES) throw new Error('Skill 内容超出限制');
        files[path] = content;
      }
    };
    visit(directory);
    return files;
  }

  list(): SharedSkill[] {
    const root = resolve(this.skillRoot());
    if (!existsSync(root)) return [];
    const skills: SharedSkill[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !validSkillId(entry.name)) continue;
      try {
        const directory = this.directory(entry.name);
        const files = this.readFiles(directory);
        if (!Object.keys(files).some(path => path.toLowerCase() === 'skill.md')) continue;
        const metaPath = join(directory, SKILL_META_FILE);
        const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
        const name = String(meta?.name || entry.name).trim();
        if (!name) continue;
        skills.push({
          id: entry.name,
          name,
          desc: String(meta?.desc || '').trim(),
          files,
          enabled: meta?.enabled !== false,
          source: 'workspace',
        });
      } catch {
        // One malformed local Skill must not hide the rest.
      }
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  save(input: SkillSaveInput): SkillMutationResult {
    try {
      const name = String(input?.name || '').trim();
      const desc = String(input?.desc || '').trim();
      const sourceFiles = input?.files;
      if (!name || name.length > 120 || !sourceFiles || typeof sourceFiles !== 'object') {
        throw new Error('Skill 名称或文件无效');
      }
      const id = String(input.id || skillId(name)).trim();
      const directory = this.directory(id);
      const entries = Object.entries(sourceFiles);
      if (!entries.length || entries.length > MAX_SKILL_FILES ||
        !entries.some(([path]) => path.toLowerCase() === 'skill.md')) {
        throw new Error('Skill 必须包含 SKILL.md');
      }
      let total = 0;
      const files: Array<[string, string]> = [];
      for (const [path, content] of entries) {
        if (!validSkillPath(path) || typeof content !== 'string') throw new Error('Skill 文件路径或内容无效');
        const size = Buffer.byteLength(content, 'utf8');
        if (size > MAX_SKILL_FILE_BYTES) throw new Error('单个 Skill 文件过大');
        total += size;
        if (total > MAX_SKILL_TOTAL_BYTES) throw new Error('Skill 内容超出限制');
        files.push([path, content]);
      }

      if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
      mkdirSync(directory, { recursive: true });
      for (const [path, content] of files) {
        const target = resolve(directory, path);
        if (relative(directory, target).replace(/\\/g, '/') !== path) throw new Error('无效的 Skill 文件路径');
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, 'utf8');
      }
      writeFileSync(
        join(directory, SKILL_META_FILE),
        JSON.stringify({ name, desc, enabled: input.enabled !== false }, null, 2),
        'utf8',
      );
      const skill = this.list().find(item => item.id === id);
      return skill ? { ok: true, skill } : { ok: false, error: '保存后无法读取 Skill' };
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  remove(id: string): { ok: boolean; error?: string } {
    try {
      const directory = this.directory(id);
      if (!existsSync(directory)) return { ok: false, error: 'Skill 不存在' };
      rmSync(directory, { recursive: true, force: true });
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  inject(prompt: string): string {
    for (const skill of this.list()) {
      if (!skill.enabled || !skill.name.trim()) continue;
      const command = `/${skill.name.trim()}`;
      const matcher = new RegExp(`(^|\\s)${escapeRegExp(command)}(?=\\s|$)`, 'u');
      if (!matcher.test(prompt)) continue;

      const body = skillBody(skill);
      if (!body) return prompt;
      const supportingFiles = Object.keys(skill.files)
        .filter(path => path.toLowerCase() !== 'skill.md')
        .sort((a, b) => a.localeCompare(b));
      const references = supportingFiles.length
        ? `\n\nSupporting files are available locally in ${join(this.skillRoot(), skill.id)}: ${supportingFiles.join(', ')}`
        : '';
      const request = prompt.replace(matcher, (_match, prefix: string) => prefix).trim();
      const safeName = skill.name.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      const activation = `<activated_skill name="${safeName}">\n${body}${references}\n</activated_skill>`;
      return request ? `${activation}\n\n<user_request>\n${request}\n</user_request>` : activation;
    }
    return prompt;
  }

  /** Convert one completed Agent turn into a reviewable, local Skill package. The harness owns
   * this projection so the browser only selects a turn; it never fabricates or writes Skills. */
  createFromTurn(source: SkillTurnSource): GeneratedSkillDraft {
    const task = clip(source.user?.text || '复用当前 Agent 工作流', 2_400);
    const answer = agentText(source.agent);
    const trajectory = trajectoryText(source.agent.traj || []);
    const name = suggestedName(task);
    const desc = `基于一轮 Agent 对话${source.agent.traj?.length ? `与 ${source.agent.traj.length} 步轨迹` : ''}沉淀的本地工作流`;
    const skillMd = `---\nname: ${name}\ndescription: ${desc}\n---\n\n# 适用场景\n${task}\n\n# 执行方式\n\n1. 先确认用户的目标、约束与现有工作区状态。\n2. 参考本 Skill 的来源轨迹，按需复用有效的工具与检查步骤。\n3. 交付前说明完成内容、验证结果与仍需用户确认的事项。\n\n# 来源材料\n\n本 Skill 由一轮已完成的 Agent 对话生成。需要具体结论、措辞或操作细节时，读取同目录的：\n\n- \`references/source-turn.md\`：用户请求与 Agent 最终答复\n- \`references/trajectory.md\`：本轮执行轨迹\n`;
    return {
      name,
      desc,
      files: {
        'SKILL.md': skillMd,
        'references/source-turn.md': `# 用户请求\n\n${task}\n\n# Agent 最终答复\n\n${answer || '（本轮没有可沉淀的文本答复。）'}\n`,
        'references/trajectory.md': `# Agent 执行轨迹\n\n${trajectory || '（本轮没有记录可用的轨迹步骤。）'}\n`,
      },
    };
  }

  saveFromTurn(source: SkillTurnSource): SkillMutationResult {
    return this.save({
      ...this.createFromTurn(source),
      id: `turn-${randomBytes(9).toString('hex')}`,
      enabled: true,
    });
  }
}
