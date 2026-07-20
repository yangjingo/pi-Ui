// UI/UX layer — SkillHub store. Each skill is a small filesystem: a map of path → content,
// with SKILL.md as the entry point (its frontmatter gives name/description; its post-frontmatter
// body is the prompt inlined when the user types "/name"). Pure frontend, persisted to
// localStorage; never crosses into the Core/Pi layer.

import { useSyncExternalStore } from 'react';
import type { FileNode } from '../core/types';
import { fileTypeOf } from '../core/agent';
import { basename } from '../core/util';

export interface Skill { id: string; name: string; desc: string; files: Record<string, string>; }

const KEY = 'chatbotui.skills';
const ENTRY = 'SKILL.md';

/** Build SKILL.md content (frontmatter + body) for a newly-authored skill. */
export function makeSkillMd(name: string, desc: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${desc}\n---\n${body}`;
}

const PRESET: Skill[] = [
  { id: 'preset-report', name: '周报', desc: '生成本周工作周报', files: { [ENTRY]: makeSkillMd('周报', '生成本周工作周报', '请帮我整理本周工作周报，分为「本周完成 / 进行中 / 下周计划」三部分，语气简洁、要点清晰。') } },
  { id: 'preset-translate', name: '翻译', desc: '中英互译', files: { [ENTRY]: makeSkillMd('翻译', '中英互译', '请将以下内容在中文与英文之间互译，保持语气、术语与格式一致：\n\n') } },
  { id: 'preset-review', name: '代码审查', desc: '审查一段代码', files: { [ENTRY]: makeSkillMd('代码审查', '审查一段代码', '请审查下面这段代码，关注正确性、可读性与潜在 bug，并给出可执行的改进建议：\n\n') } },
];

let cache: Skill[] | null = null;

// localStorage is untrusted/corruptible. Accept both legacy {body} and new {files}; drop the
// rest. A non-array payload falls back to presets. (An intentionally empty array is preserved.)
function isRawSkill(x: unknown): boolean {
  if (!x || typeof x !== 'object') return false;
  const s = x as any;
  return typeof s.id === 'string' && s.id.length > 0 &&
    typeof s.name === 'string' && typeof s.desc === 'string' &&
    (typeof s.body === 'string' || (s.files && typeof s.files === 'object'));
}

/** Normalize a raw entry to the new {files} shape (legacy {body} → a single SKILL.md). */
function migrate(raw: any): Skill {
  if (raw.files && typeof raw.files === 'object') {
    const files: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.files)) if (typeof v === 'string') files[k] = v;
    if (!(ENTRY in files)) files[ENTRY] = makeSkillMd(raw.name || '未命名', raw.desc || '', '');
    return { id: raw.id, name: raw.name, desc: raw.desc, files };
  }
  return { id: raw.id, name: raw.name, desc: raw.desc || '', files: { [ENTRY]: makeSkillMd(raw.name || '未命名', raw.desc || '', raw.body || '') } };
}

function read(): Skill[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) { cache = PRESET; return cache; }
    const parsed: unknown = JSON.parse(raw);
    cache = Array.isArray(parsed) ? parsed.filter(isRawSkill).map(migrate) : PRESET;
  } catch { cache = PRESET; }
  return cache;
}
function write(list: Skill[]) {
  cache = list;   // new reference each mutation → useSyncExternalStore + memoized selectors update
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* quota / disabled — ignore */ }
}

const subs = new Set<() => void>();
function emit() { subs.forEach(f => f()); }

export function getSkills(): Skill[] { return read(); }

// Normalize for collision checks so "/周报" always resolves to one skill. A same-name add
// (manual or imported) updates the existing entry in place — keeping its id — rather than
// creating a silent duplicate that would make slash lookup non-deterministic.
const normName = (s: string) => s.trim().toLocaleLowerCase();

export function addSkill(input: { name: string; desc: string; files: Record<string, string> }): Skill | null {
  const name = input.name.trim();
  if (!name) return null;
  const desc = input.desc.trim();
  const files = input.files && input.files[ENTRY] != null ? { ...input.files } : { [ENTRY]: makeSkillMd(name, desc, '') };
  const list = read();
  const idx = list.findIndex(s => normName(s.name) === normName(name));
  let sk: Skill;
  let next: Skill[];
  if (idx >= 0) {
    sk = { ...list[idx], name, desc, files };
    next = list.map((s, i) => (i === idx ? sk : s));
  } else {
    sk = { id: 'sk_' + Math.random().toString(36).slice(2, 10), name, desc, files };
    next = [sk, ...list];
  }
  write(next);
  emit();
  return sk;
}

/** Rewrite a skill's name/desc and/or whole file map (keeps id + entry file). */
export function updateSkill(id: string, input: { name?: string; desc?: string; files?: Record<string, string> }): boolean {
  const list = read();
  const idx = list.findIndex(s => s.id === id);
  if (idx < 0) return false;
  const cur = list[idx];
  const name = input.name != null ? input.name.trim() : cur.name;
  if (!name) return false;
  const desc = input.desc != null ? input.desc.trim() : cur.desc;
  const files = input.files != null ? input.files : cur.files;
  const next = list.map((s, i) => (i === idx ? { ...s, name, desc, files } : s));
  write(next);
  emit();
  return true;
}

/** Patch one skill's files. The patcher returns null to signal a no-op. */
function patchFiles(id: string, patch: (files: Record<string, string>) => Record<string, string> | null): boolean {
  const list = read();
  const idx = list.findIndex(s => s.id === id);
  if (idx < 0) return false;
  const files = patch(list[idx].files);
  if (!files) return false;
  write(list.map((s, i) => (i === idx ? { ...s, files } : s)));
  emit();
  return true;
}

export function updateSkillFile(id: string, path: string, content: string): boolean {
  if (!path) return false;
  return patchFiles(id, files => ({ ...files, [path]: content }));
}
export function addSkillFile(id: string, path: string, content: string): boolean {
  const p = path.trim();
  if (!p) return false;
  return patchFiles(id, files => (files[p] != null ? null : { ...files, [p]: content }));
}
export function removeSkillFile(id: string, path: string): boolean {
  if (path === ENTRY || !path) return false;   // refuse to delete the entry file
  return patchFiles(id, files => (files[path] == null ? null : (() => { const n = { ...files }; delete n[path]; return n; })()));
}

export function removeSkill(id: string) {
  write(read().filter(s => s.id !== id));
  emit();
}

// ── SKILL.md frontmatter helpers ──
function parseFrontmatter(text: string): { fm: string; body: string } | null {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  return m ? { fm: m[1], body: m[2] } : null;
}
const fmPick = (fm: string, key: string) => {
  const r = new RegExp('^' + key + ':\\s*(.+?)\\s*$', 'm').exec(fm);
  return r ? r[1].replace(/^["']|["']$/g, '') : '';
};

/** The skill's entry file path (case-insensitive SKILL.md lookup, else the first file). */
export function entryPath(skill: Skill): string {
  const lower = ENTRY.toLowerCase();
  const found = Object.keys(skill.files).find(p => p.toLowerCase() === lower || p.toLowerCase().endsWith('/' + lower));
  return found || Object.keys(skill.files)[0] || ENTRY;
}

/** Post-frontmatter body of the entry file — what "/name" inlines into the composer. */
export function skillEntryBody(skill: Skill): string {
  const md = skill.files[entryPath(skill)] || '';
  const pf = parseFrontmatter(md);
  return pf ? pf.body : md;
}
export function skillEntryMeta(skill: Skill): { name: string; desc: string } {
  const md = skill.files[entryPath(skill)] || '';
  const pf = parseFrontmatter(md);
  if (!pf) return { name: skill.name, desc: skill.desc };
  return { name: fmPick(pf.fm, 'name') || skill.name, desc: fmPick(pf.fm, 'description') || skill.desc };
}

/** Flat FileNode[] (path + type) for `buildFileTree`. */
export function skillToFileNodes(skill: Skill): FileNode[] {
  return Object.keys(skill.files).map(path => ({ name: basename(path), path, type: fileTypeOf(path) }));
}

function subscribe(cb: () => void) { subs.add(cb); return () => { subs.delete(cb); }; }

export function useSkills(): Skill[] {
  return useSyncExternalStore(subscribe, () => read(), () => read());
}
