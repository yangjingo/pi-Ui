import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { Message } from '../../core/agent/protocol';
import { SKILL_DRAFT_MD_TEMPLATE } from './prompts';

const SKILL_META_FILE = '.skillhub.json';
const MAX_SKILL_FILES = 500;
const MAX_SKILL_FILE_BYTES = 50 * 1024 * 1024;
const MAX_SKILL_TOTAL_BYTES = 100 * 1024 * 1024;
const SKILL_ENVIRONMENT_FILES = [
  'skill.env.json',
  'requirements.txt',
  'requirements-dev.txt',
  'pyproject.toml',
  'uv.lock',
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lock',
] as const;

export interface SkillEnvironment {
  skillId: string;
  digest: string;
  path: string;
  ready: boolean;
  sources: string[];
}

export interface SharedSkillSummary {
  id: string;
  name: string;
  desc: string;
  enabled: boolean;
  source: 'workspace';
  fileCount: number;
  rootPath: string;
  skillPath: string;
  commandName: string;
}

/** A local, workspace-owned Skill. Remote sources intentionally do not exist here. */
export interface SharedSkill extends SharedSkillSummary {
  files: Record<string, string>;
}

export interface GeneratedSkillDraft {
  id: string;
  files: Record<string, string>;
}

export interface SkillTurnSource {
  user: Message | null;
  agent: Message;
  workspaceFiles?: Record<string, string>;
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

export interface SkillInstallInput {
  sessionRoot: string;
  sourceDirectory: string;
  replace?: boolean;
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

function clip(value: string, max: number): string {
  const clean = value.replace(/\r\n/g, '\n').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}\n…（已截断）`;
}

function generatedSkillId(task: string): string {
  const normalized = task.replace(/^\/\S+\s*/u, '').trim();
  const suffix = randomBytes(4).toString('hex');
  return `skill-draft-${createHash('sha256').update(normalized || 'empty-turn').digest('hex').slice(0, 12)}-${suffix}`;
}

const SCRIPT_FILE = /\.(?:py|pyw|js|mjs|cjs|ts|tsx|jsx|mts|cts|ps1|sh|bash|zsh|fish|rb|php|pl|lua|r|sql)$/iu;

function normalizedPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//u, '').trim();
}

function reusableToolSteps(message: Message): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const step of message.traj || []) {
    if (step.t === 'think') continue;
    let detail = step.det || step.title || step.t;
    try {
      const input = JSON.parse(step.in || '{}');
      detail = String(input.command || input.path || input.query || input.pattern || detail);
    } catch { /* use the visible Trajectory detail */ }
    const tool = step.shell || step.t || 'tool';
    const line = `- ${tool}: ${clip(detail.replace(/\s+/g, ' '), 180).replace(/[\r\n]+/g, ' ')}`;
    if (!seen.has(line)) { seen.add(line); lines.push(line); }
    if (lines.length >= 10) break;
  }
  return lines.length ? lines.join('\n') : '- 本轮没有可复用的 Tool Call；验证时按目标选择最小工具集。';
}

function reusableScripts(source: SkillTurnSource): { files: Record<string, string>; section: string } {
  const workspaceFiles = source.workspaceFiles || {};
  const candidates = new Set<string>();
  for (const step of source.agent.traj || []) {
    for (const value of [step.file, step.det]) {
      const path = normalizedPath(String(value || ''));
      if (SCRIPT_FILE.test(path) && workspaceFiles[path] != null) candidates.add(path);
    }
  }
  for (const artifact of source.agent.artifacts || []) {
    const path = normalizedPath(artifact.path || artifact.name);
    if (SCRIPT_FILE.test(path) && workspaceFiles[path] != null) candidates.add(path);
  }
  const files: Record<string, string> = {};
  const usedNames = new Set<string>();
  for (const path of candidates) {
    let name = basename(path);
    let suffix = 2;
    while (usedNames.has(name)) {
      const dot = name.lastIndexOf('.');
      const stem = dot >= 0 ? name.slice(0, dot) : name;
      const ext = dot >= 0 ? name.slice(dot) : '';
      name = `${stem}-${suffix++}${ext}`;
    }
    usedNames.add(name);
    files[`scripts/${name}`] = workspaceFiles[path];
  }
  const paths = Object.keys(files);
  return {
    files,
    section: paths.length
      ? `## Reusable scripts\n\n${paths.map(path => `- \`${path}\``).join('\n')}`
      : '## Reusable scripts\n\n- 本轮没有生成可复用脚本；验证后仅在确有需要时添加。',
  };
}

function yamlString(value: string): string {
  return JSON.stringify(value.replace(/[\r\n]+/g, ' ').trim());
}

function openAiManifest(id: string, displayName: string, desc: string, task: string): string {
  const promptTask = clip(task.replace(/\s+/g, ' '), 88).replace(/[\r\n]+/g, ' ');
  return [
    'interface:',
    `  display_name: ${yamlString(displayName)}`,
    `  short_description: ${yamlString(desc)}`,
    `  default_prompt: ${yamlString(`Use $${id} to complete: ${promptTask}`)}`,
    '',
  ].join('\n');
}

function sdkSkillName(value: string): string {
  const name = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
  return name || `skill-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
}

function validSdkSkillName(value: string): boolean {
  return value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

function xmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function normalizeSkillEntry(source: string, id: string, description: string): string {
  const body = source.replace(/^---\s*\r?\n[\s\S]*?\r?\n---(?:\s*\r?\n|$)/u, '').trimStart();
  const safeDescription = description.replace(/[\r\n]+/g, ' ').trim() || id;
  return `---\nname: ${sdkSkillName(id)}\ndescription: ${safeDescription}\n---\n\n${body}`;
}

/** Resolves explicitly-invoked local skills immediately before Pi receives a prompt. */
export class SkillHarness {
  constructor(private readonly skillRoot: () => string) {}

  rootPath(): string {
    return resolve(this.skillRoot());
  }

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

  private skillEntry(directory: string): string | null {
    const entry = readdirSync(directory, { withFileTypes: true })
      .find(item => item.isFile() && item.name.toLowerCase() === 'skill.md');
    return entry ? join(directory, entry.name) : null;
  }

  private frontmatter(source: string): { name?: string; description?: string } {
    const block = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/u)?.[1] || '';
    const value = (key: string) => {
      const raw = block.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'imu'))?.[1]?.trim();
      return raw?.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/u, '$1$2').trim() || undefined;
    };
    return { name: value('name'), description: value('description') };
  }

  private summary(id: string): SharedSkillSummary | null {
    const directory = this.directory(id);
    const skillPath = this.skillEntry(directory);
    if (!skillPath) return null;
    const metaPath = join(directory, SKILL_META_FILE);
    const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
    const declared = this.frontmatter(readFileSync(skillPath, 'utf8'));
    const name = String(meta?.name || declared.name || id).trim();
    if (!name) return null;
    let fileCount = 0;
    const count = (current: string) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (entry.name === SKILL_META_FILE) continue;
        const next = join(current, entry.name);
        if (entry.isDirectory()) count(next);
        else if (entry.isFile()) fileCount++;
        if (fileCount > MAX_SKILL_FILES) throw new Error('Skill 文件数量超出限制');
      }
    };
    count(directory);
    return {
      id,
      name,
      desc: String(meta?.desc || declared.description || '').trim(),
      enabled: meta?.enabled !== false,
      source: 'workspace',
      fileCount,
      rootPath: directory,
      skillPath,
      commandName: declared.name && validSdkSkillName(declared.name) ? declared.name : sdkSkillName(id),
    };
  }

  /** Metadata-only discovery for slash completion and Skill Hub lists. */
  catalog(): SharedSkillSummary[] {
    const root = this.rootPath();
    if (!existsSync(root)) return [];
    const skills: SharedSkillSummary[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !validSkillId(entry.name)) continue;
      try {
        const summary = this.summary(entry.name);
        if (summary) skills.push(summary);
      } catch {
        // One malformed local Skill must not hide the rest.
      }
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  read(id: string): SharedSkill | null {
    try {
      const summary = this.summary(id);
      if (!summary) return null;
      return { ...summary, files: this.readFiles(summary.rootPath) };
    } catch {
      return null;
    }
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
        files.push([
          path,
          path.toLowerCase() === 'skill.md' ? normalizeSkillEntry(content, id, desc) : content,
        ]);
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
      const skill = this.read(id);
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

  /** Translate the compact UI command to Pi SDK's native /skill:name command. */
  resolveInvocation(prompt: string): { modelText: string; skillId?: string; environment?: SkillEnvironment } {
    const source = String(prompt || '');
    for (const skill of this.catalog()) {
      if (!skill.enabled) continue;
      const commands = [`/${skill.name}`, `/${skill.id}`];
      const command = commands.find(candidate => source === candidate || source.startsWith(`${candidate} `));
      if (!command) continue;
      const request = source.slice(command.length).trim();
      const environment = this.environment(skill.id);
      const runtime = [
        `<skill_runtime skill_id="${xmlAttribute(skill.id)}" environment="${xmlAttribute(environment.path)}" digest="${environment.digest}" ready="${environment.ready}">`,
        'Skill files are read-only. Reuse this workspace environment when dependencies are needed; write task outputs only to the current session workspace.',
        '</skill_runtime>',
      ].join('\n');
      return {
        modelText: `/skill:${skill.commandName} ${runtime}${request ? `\n\n${request}` : ''}`,
        skillId: skill.id,
        environment,
      };
    }
    return { modelText: source };
  }

  /** Install one already-staged, text-based Skill package without granting normal tools write
   * access to the workspace Skill root. URL fetching and archive extraction stay in Session. */
  installFromDirectory(input: SkillInstallInput): SkillMutationResult {
    try {
      const sessionRoot = realpathSync.native(resolve(input.sessionRoot));
      const requested = resolve(sessionRoot, String(input.sourceDirectory || '').trim() || '.');
      if (!existsSync(requested) || !statSync(requested).isDirectory()) {
        throw new Error('Skill 安装源必须是当前 Session 中已解包的目录');
      }
      const source = realpathSync.native(requested);
      const sourceRelative = relative(sessionRoot, source);
      if (sourceRelative.startsWith('..') || isAbsolute(sourceRelative)) {
        throw new Error('Skill 安装源必须位于当前 Session');
      }
      const entry = this.skillEntry(source);
      if (!entry) throw new Error('安装目录必须直接包含 SKILL.md；请先定位具体 Skill 子目录');
      const files = this.readFiles(source);
      const declared = this.frontmatter(readFileSync(entry, 'utf8'));
      const name = String(declared.name || basename(source)).trim();
      const id = sdkSkillName(name);
      if (existsSync(this.directory(id)) && input.replace !== true) {
        throw new Error(`Skill ${id} 已存在；只有用户明确要求替换时才能设置 replace=true`);
      }
      const desc = String(declared.description || name).trim();
      if (!files['agents/openai.yaml']) {
        files['agents/openai.yaml'] = openAiManifest(id, name, desc, desc);
      }
      return this.save({
        id,
        name,
        desc,
        files,
        enabled: true,
      });
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  environment(id: string): SkillEnvironment {
    const directory = this.directory(id);
    const entry = this.skillEntry(directory);
    if (!entry) throw new Error('Skill 缺少 SKILL.md');
    const entryPath = relative(directory, entry).replace(/\\/g, '/');
    const sources = [
      entryPath,
      ...SKILL_ENVIRONMENT_FILES.filter(path => path.toLowerCase() !== 'skill.md' && existsSync(join(directory, path))),
    ];
    const hash = createHash('sha256')
      .update(JSON.stringify({ platform: process.platform, arch: process.arch, node: process.versions.node }));
    for (const path of sources) hash.update(`\0${path}\0`).update(readFileSync(join(directory, path)));
    const digest = hash.digest('hex').slice(0, 20);
    const path = resolve(dirname(this.rootPath()), '.agentcore', 'skill-envs', id, digest);
    mkdirSync(path, { recursive: true });
    const manifestPath = join(path, 'manifest.json');
    if (!existsSync(manifestPath)) {
      writeFileSync(manifestPath, JSON.stringify({ version: 1, skillId: id, digest, sources, platform: process.platform, arch: process.arch, node: process.versions.node }, null, 2), 'utf8');
    }
    return { skillId: id, digest, path, ready: existsSync(join(path, 'ready.json')), sources: [...sources] };
  }

  markEnvironmentReady(id: string, digest: string): SkillEnvironment {
    const environment = this.environment(id);
    if (environment.digest !== digest) throw new Error('Skill 环境指纹已变化，请重新准备依赖');
    writeFileSync(join(environment.path, 'ready.json'), JSON.stringify({ readyAt: new Date().toISOString() }, null, 2), 'utf8');
    return { ...environment, ready: true };
  }

  /** Project one completed Agent turn into a Session-owned draft. The Harness extracts only
   * reusable Tool strategy and referenced scripts; Core decides where the draft is written. */
  createFromTurn(source: SkillTurnSource): GeneratedSkillDraft {
    const task = clip(source.user?.text || source.agent.outro || source.agent.intro || '当前已完成任务', 520);
    const id = generatedSkillId(task);
    const desc = clip(`待验证的 Session Skill 草稿：${task.replace(/\s+/g, ' ')}`, 120).replace(/[\r\n]+/g, ' ');
    const scripts = reusableScripts(source);
    const skillMd = SKILL_DRAFT_MD_TEMPLATE
      .replace('{{id}}', id)
      .replace('{{desc}}', desc)
      .replace('{{task}}', task)
      .replace('{{tools}}', `## Tool strategy\n\n${reusableToolSteps(source.agent)}`)
      .replace('{{scripts}}', scripts.section);
    return {
      id,
      files: {
        'SKILL.md': skillMd,
        ...scripts.files,
      },
    };
  }
}
