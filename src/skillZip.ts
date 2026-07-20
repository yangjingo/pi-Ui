// UI/UX layer — parse an uploaded skill .zip as a Claude-Code-style "SKILL package": a directory
// of files whose entry point is SKILL.md (YAML frontmatter name/description + body). We keep
// EVERY file in the archive (SKILL.md + any supporting files) so a skill is a real directory,
// not just the entry body. Pure browser code via fflate; never crosses into the Core/Pi layer.
//
// The zip is UNTRUSTED: its files become a skill the user invokes with "/name", which inlines the
// SKILL.md body into a tool-capable agent's prompt. We bound decompression (zip-bomb guard) and
// the SkillHub surfaces the parsed files for review before commit.

import { unzipSync, strFromU8 } from 'fflate';

export interface ParsedSkill { name: string; desc: string; files: Record<string, string>; }

export type ZipParseResult =
  | { ok: true; skill: ParsedSkill }
  | { ok: false; reason: 'no-skill' | 'empty-body' | 'too-big' | 'bad-zip' };

// Bounds for a prompt-fragment pack. Reject zip-bombs (huge ratio / decompressed size / entry
// count) without burdening normal imports.
const MAX_ZIP_BYTES = 4 * 1024 * 1024;            // reject compressed input > 4 MB up front
const MAX_ENTRIES = 200;                          // reject archives with too many entries
const MAX_TOTAL_DECOMPRESSED = 8 * 1024 * 1024;   // reject if all entries decompress to > 8 MB
const MAX_FILE_BYTES = 256 * 1024;                // skip an individual file > 256 KB
const MAX_RATIO = 200;                            // reject decompressed/compressed ratio > 200×

/** Parse a YAML-ish frontmatter block (--- key: value --- ) at the top of a markdown file.
 *  Only single-line scalar `name` / `description` are read; multi-line block scalars are out of
 *  scope (documented as the package contract). */
export function parseFrontmatter(text: string): { name: string; desc: string; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { name: '', desc: '', body: text };
  const fm = m[1];
  const body = m[2];
  const pick = (key: string) => {
    const r = new RegExp('^' + key + ':\\s*(.+?)\\s*$', 'm').exec(fm);
    if (!r) return '';
    return r[1].replace(/^["']|["']$/g, '');
  };
  return { name: pick('name'), desc: pick('description'), body };
}

const normPath = (p: string): string => p.replace(/\\/g, '/').replace(/^\.?\//, '');

/** Extract a ParsedSkill (all files) from a .zip ArrayBuffer, or a precise error reason. */
export function parseSkillZip(buf: ArrayBuffer): ZipParseResult {
  if (buf.byteLength > MAX_ZIP_BYTES) return { ok: false, reason: 'too-big' };

  let files: Record<string, Uint8Array>;
  try { files = unzipSync(new Uint8Array(buf)); } catch { return { ok: false, reason: 'bad-zip' }; }

  const names = Object.keys(files);
  if (names.length > MAX_ENTRIES) return { ok: false, reason: 'too-big' };
  let totalDecomp = 0;
  for (const n of names) totalDecomp += files[n].length;
  if (totalDecomp > MAX_TOTAL_DECOMPRESSED) return { ok: false, reason: 'too-big' };
  if (buf.byteLength > 0 && totalDecomp / buf.byteLength > MAX_RATIO) return { ok: false, reason: 'too-big' };

  // SKILL.md (root or any subdir) supplies the name/description and must have a post-frontmatter body.
  const entryName = names.find(p => /(^|\/)SKILL\.md$/i.test(normPath(p))) || null;
  if (!entryName) return { ok: false, reason: 'no-skill' };
  const entryData = files[entryName];
  if (entryData.length > MAX_FILE_BYTES) return { ok: false, reason: 'too-big' };
  const parsed = parseFrontmatter(strFromU8(entryData));
  if (!parsed.body.trim()) return { ok: false, reason: 'empty-body' };

  // Harvest every text file into the directory map (skip dirs, oversized, and binary/NUL files).
  const out: Record<string, string> = {};
  for (const n of names) {
    if (n.endsWith('/')) continue;
    const path = normPath(n);
    if (!path) continue;
    const data = files[n];
    if (data.length > MAX_FILE_BYTES || data.includes(0)) continue;   // oversized or binary
    try { out[path] = strFromU8(data); } catch { /* undecodable — skip */ }
  }
  const entryPath = normPath(entryName);
  if (out[entryPath] == null) out[entryPath] = strFromU8(entryData);   // ensure the entry file is present

  const fallback = entryPath.split('/').slice(-1)[0].replace(/\.md$/i, '') || '未命名 skill';
  return { ok: true, skill: { name: parsed.name || fallback, desc: parsed.desc, files: out } };
}
