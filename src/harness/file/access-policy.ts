import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export type WorkspaceAccessMode = 'read' | 'write';

export interface WorkspaceAccessContext {
  sessionRoot(): string;
  skillRoots(): string[];
  environmentRoots(): string[];
}

export interface ToolAccessDecision {
  ok: boolean;
  reason?: string;
  input?: Record<string, unknown>;
}

const PATH_TOOLS = new Set(['read', 'write', 'edit', 'find', 'grep', 'ls']);
const SEARCH_TOOLS = new Set(['find', 'grep', 'ls']);

function canonical(path: string): string {
  let cursor = resolve(path);
  const suffix: string[] = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(cursor.slice(parent.length).replace(/^[/\\]+/u, ''));
    cursor = parent;
  }
  const base = existsSync(cursor) ? realpathSync.native(cursor) : cursor;
  return resolve(base, ...suffix);
}

function inside(root: string, target: string): boolean {
  const rel = relative(canonical(root), canonical(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** App-level guard for Pi tools. This is intentionally not an OS sandbox: it narrows tool
 * requests to the current session and explicitly activated Skill resources. */
export class WorkspaceAccessPolicy {
  constructor(private readonly context: WorkspaceAccessContext) {}

  authorizePath(rawPath: string, mode: WorkspaceAccessMode): ToolAccessDecision {
    const sessionRoot = canonical(this.context.sessionRoot());
    const target = canonical(isAbsolute(rawPath) ? rawPath : resolve(sessionRoot, rawPath || '.'));
    if (inside(sessionRoot, target)) return { ok: true };
    if (mode === 'read' && this.context.skillRoots().some(root => inside(root, target))) return { ok: true };
    if (this.context.environmentRoots().some(root => inside(root, target))) return { ok: true };
    return {
      ok: false,
      reason: mode === 'write'
        ? '写入仅允许当前 session 工作区或本轮激活的 Skill 环境目录'
        : '读取仅允许当前 session、已启用 Skill 或本轮激活的 Skill 环境目录',
    };
  }

  guardTool(toolName: string, rawInput: unknown): ToolAccessDecision {
    const input = rawInput && typeof rawInput === 'object'
      ? { ...(rawInput as Record<string, unknown>) }
      : {};
    if (PATH_TOOLS.has(toolName)) {
      if (SEARCH_TOOLS.has(toolName) && !String(input.path || '').trim()) input.path = '.';
      const mode: WorkspaceAccessMode = toolName === 'write' || toolName === 'edit' ? 'write' : 'read';
      const decision = this.authorizePath(String(input.path || '.'), mode);
      return decision.ok ? { ok: true, input } : decision;
    }
    if (toolName === 'bash' || toolName === 'powershell') return this.guardShell(String(input.command || ''));
    return { ok: true, input };
  }

  private guardShell(command: string): ToolAccessDecision {
    if (!command.trim()) return { ok: false, reason: 'Shell 命令不能为空' };
    if (/(^|[\s"'])\.\.[/\\]/u.test(command)) {
      return { ok: false, reason: 'Shell 不允许通过 .. 离开当前 session；请使用工作区内路径' };
    }
    const absolutePaths = [
      ...command.matchAll(/(?:^|[\s"'])([A-Za-z]:\\[^\s"'|;&<>]*)/gu),
      ...command.matchAll(/(?:^|[\s"'])(\/(?![A-Za-z](?:\s|$))[^\s"'|;&<>]*)/gu),
    ].map(match => match[1]).filter(Boolean);
    const mutating = /(?:^|[;&|]\s*)(?:rm|del|erase|rmdir|mv|move|cp|copy|mkdir|md|touch|set-content|add-content|out-file|new-item|remove-item|move-item|copy-item)\b|(?:^|[^<])>(?![>&])/iu.test(command);
    for (const path of absolutePaths) {
      const decision = this.authorizePath(path, mutating ? 'write' : 'read');
      if (!decision.ok) return { ok: false, reason: `Shell 路径超出当前工作空间：${path}` };
    }
    return { ok: true, input: { command } };
  }
}
