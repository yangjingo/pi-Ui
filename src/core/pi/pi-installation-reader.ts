// Node-only filesystem gateway for an existing Pi installation. It performs no
// startup orchestration; the browser Workspace decides if and when inheritance
// is applied.

import {
  SessionManager,
  type SessionEntry,
  type SessionInfo,
} from '@earendil-works/pi-coding-agent';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';

import type {
  AgentContentBlock,
  Message,
  SessionSummary,
  TrajStep,
} from '../agent/protocol';

const MAX_IMPORTED_TRANSCRIPT_CHARS = 4 * 1024 * 1024;
const MAX_TOOL_OUTPUT_CHARS = 4 * 1024;

export interface PiSessionOrigin {
  sourcePath: string;
  sourceCwd: string;
  sourceId: string;
  forkPath?: string;
}

export interface ManagedSessionSummary extends SessionSummary {
  pi?: PiSessionOrigin;
}

export interface PiInstallationInspection {
  available: boolean;
  sessionCount: number;
  modelCount: number;
  defaultModel?: string;
  hasCredentials: boolean;
}

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => {
    if (!part || typeof part !== 'object') return '';
    if ((part as any).type === 'text') return String((part as any).text || '');
    if ((part as any).type === 'image') return '[图片]';
    return '';
  }).filter(Boolean).join('\n');
}

function timeOf(value: unknown): string {
  const date = new Date(typeof value === 'number' || typeof value === 'string' ? value : Date.now());
  if (Number.isNaN(date.getTime())) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-') + ` ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function compactTitle(value: string): string {
  const title = value.replace(/\s+/g, ' ').trim();
  return title.length > 36 ? `${title.slice(0, 36)}…` : title || 'Pi 会话';
}

function groupOf(date: Date): string {
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return '已有 Pi 会话 · 今天';
  return `已有 Pi 会话 · ${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function inheritedSessionId(info: Pick<SessionInfo, 'id' | 'path'>): string {
  return `pi-${createHash('sha256').update(`${info.id}\0${resolve(info.path)}`).digest('hex').slice(0, 18)}`;
}

export function inheritedSessionSummary(info: SessionInfo): ManagedSessionSummary {
  return {
    id: inheritedSessionId(info),
    title: compactTitle(info.name || info.firstMessage),
    group: groupOf(info.modified),
    time: timeOf(info.modified),
    live: false,
    pi: {
      sourcePath: resolve(info.path),
      sourceCwd: resolve(info.cwd || process.cwd()),
      sourceId: info.id,
    },
  };
}

function globalSessionDirectory(agentDir: string): string {
  const environmentDirectory = process.env.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (environmentDirectory) {
    if (environmentDirectory === '~') return homedir();
    if (environmentDirectory.startsWith('~/') || environmentDirectory.startsWith('~\\')) {
      return resolve(homedir(), environmentDirectory.slice(2));
    }
    return resolve(environmentDirectory);
  }
  try {
    const settingsPath = join(agentDir, 'settings.json');
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const configured = typeof settings?.sessionDir === 'string' ? settings.sessionDir.trim() : '';
      if (configured) {
        if (configured === '~') return homedir();
        if (configured.startsWith('~/') || configured.startsWith('~\\')) {
          return resolve(homedir(), configured.slice(2));
        }
        return isAbsolute(configured) ? resolve(configured) : resolve(agentDir, configured);
      }
    }
  } catch {
    // A corrupt optional setting must not block the UI's own sessions.
  }
  return join(agentDir, 'sessions');
}

/**
 * Enumerate standard and configured Pi session directories through the SDK's
 * parser. One unreadable project directory cannot hide all other sessions.
 */
export async function discoverPiSessions(agentDir: string): Promise<ManagedSessionSummary[]> {
  const sessionDirectory = globalSessionDirectory(agentDir);
  if (!existsSync(sessionDirectory)) return [];

  const directories = [sessionDirectory];
  try {
    for (const entry of await readdir(sessionDirectory, { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(join(sessionDirectory, entry.name));
    }
  } catch {
    return [];
  }

  const batches = await Promise.all(directories.map(async directory => {
    try {
      return await SessionManager.listAll(directory);
    } catch {
      return [] as SessionInfo[];
    }
  }));
  const unique = new Map<string, SessionInfo>();
  for (const info of batches.flat()) unique.set(resolve(info.path), info);
  return [...unique.values()]
    .sort((left, right) => right.modified.getTime() - left.modified.getTime())
    .map(inheritedSessionSummary);
}

function modelsIn(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const providers = (value as any).providers;
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return [];
  return Object.entries(providers).flatMap(([providerId, provider]) =>
    Array.isArray((provider as any)?.models)
      ? (provider as any).models.flatMap((model: any) =>
          typeof model?.id === 'string' && model.id.trim()
            ? [`${providerId}/${model.id.trim()}`]
            : [])
      : []);
}

/** Safe metadata only. Config bodies and credential values never cross the gateway. */
export async function inspectPiInstallation(agentDir: string): Promise<{
  inspection: PiInstallationInspection;
  sessions: ManagedSessionSummary[];
}> {
  const sessions = await discoverPiSessions(agentDir);
  const modelSpecs = new Set<string>();
  let defaultModel: string | undefined;
  for (const name of ['settings.json', 'models.json']) {
    const path = join(agentDir, name);
    if (!existsSync(path)) continue;
    try {
      const value = JSON.parse(readFileSync(path, 'utf8'));
      for (const spec of modelsIn(value)) modelSpecs.add(spec);
      if (name === 'settings.json') {
        const provider = typeof value?.defaultProvider === 'string' ? value.defaultProvider.trim() : '';
        const model = typeof value?.defaultModel === 'string' ? value.defaultModel.trim() : '';
        if (provider && model) {
          defaultModel = `${provider}/${model}`;
          modelSpecs.add(defaultModel);
        }
      }
    } catch {
      // Malformed optional Pi configuration is reported as unavailable metadata.
    }
  }
  const hasCredentials = existsSync(join(agentDir, 'auth.json'));
  return {
    inspection: {
      available: sessions.length > 0 || modelSpecs.size > 0 || hasCredentials,
      sessionCount: sessions.length,
      modelCount: modelSpecs.size,
      defaultModel,
      hasCredentials,
    },
    sessions,
  };
}

function truncate(value: string, max = MAX_TOOL_OUTPUT_CHARS): string {
  return value.length > max ? `${value.slice(0, max)}\n…` : value;
}

function toolResultText(message: any): string {
  return truncate(textOfContent(message?.content) || (message?.isError ? '执行失败' : '完成'));
}

/**
 * Project the active branch of a native Pi JSONL session into the compact UI
 * transcript. Tool calls stay attached to their assistant turn.
 */
export function projectPiSessionEntries(entries: SessionEntry[]): Message[] {
  const messages: Message[] = [];
  let agent: Message | null = null;
  let agentText = '';
  let agentThinking = '';
  let steps: TrajStep[] = [];
  let blocks: AgentContentBlock[] = [];
  const toolSteps = new Map<string, TrajStep>();

  const ensureAgent = (when?: string): Message => {
    if (!agent) {
      agent = { role: 'agent', status: 'done', when };
      agentText = '';
      agentThinking = '';
      steps = [];
      blocks = [];
      toolSteps.clear();
    }
    return agent;
  };
  const flushAgent = () => {
    if (!agent) return;
    agent.intro = agentText.trim() || undefined;
    agent.thinking = agentThinking.trim() || undefined;
    agent.traj = steps.length ? steps : undefined;
    agent.blocks = blocks.length ? blocks : undefined;
    messages.push(agent);
    agent = null;
  };

  for (const entry of entries) {
    if (entry.type === 'compaction') {
      flushAgent();
      messages.push({
        role: 'agent',
        status: 'done',
        intro: `会话摘要\n\n${entry.summary}`,
        when: timeOf(entry.timestamp),
      });
      continue;
    }
    if (entry.type === 'branch_summary') {
      flushAgent();
      messages.push({
        role: 'agent',
        status: 'done',
        intro: `分支摘要\n\n${entry.summary}`,
        when: timeOf(entry.timestamp),
      });
      continue;
    }
    if (entry.type !== 'message') continue;

    const source = entry.message as any;
    if (source?.role === 'user') {
      flushAgent();
      messages.push({
        role: 'user',
        text: truncate(textOfContent(source.content), 256 * 1024),
        when: timeOf(source.timestamp || entry.timestamp),
      });
      continue;
    }

    if (source?.role === 'assistant') {
      const target = ensureAgent(timeOf(source.timestamp || entry.timestamp));
      for (const part of Array.isArray(source.content) ? source.content : []) {
        if (part?.type === 'text' && part.text) {
          const text = truncate(String(part.text), 256 * 1024);
          agentText += text;
          const previous = blocks[blocks.length - 1];
          if (previous?.kind === 'text') previous.text += text;
          else blocks.push({ kind: 'text', text });
        } else if (part?.type === 'thinking' && part.thinking) {
          const text = truncate(String(part.thinking), 256 * 1024);
          agentThinking += text;
          const step: TrajStep = {
            t: 'think',
            title: '思考',
            det: compactTitle(text),
            text,
            status: 'done',
            time: target.when || '',
          };
          steps.push(step);
          blocks.push({ kind: 'step', step: steps.length - 1 });
        } else if (part?.type === 'toolCall') {
          const id = String(part.id || '');
          const step: TrajStep = {
            id: id || undefined,
            t: String(part.name || 'tool'),
            title: String(part.name || '工具'),
            det: truncate(JSON.stringify(part.arguments || {}), 240),
            in: truncate(JSON.stringify(part.arguments || {})),
            status: 'done',
            time: target.when || '',
          };
          steps.push(step);
          blocks.push({ kind: 'step', step: steps.length - 1 });
          if (id) toolSteps.set(id, step);
        }
      }
      if (source.errorMessage) agentText += `\n${source.errorMessage}`;
      continue;
    }

    if (source?.role === 'toolResult') {
      const step = toolSteps.get(String(source.toolCallId || ''));
      if (step) step.out = toolResultText(source);
      continue;
    }

    if (source?.role === 'bashExecution') {
      const target = ensureAgent(timeOf(source.timestamp || entry.timestamp));
      const step: TrajStep = {
        t: 'code',
        title: '执行命令',
        det: truncate(String(source.command || ''), 240),
        in: truncate(String(source.command || '')),
        out: truncate(String(source.output || '')),
        status: 'done',
        time: target.when || '',
      };
      steps.push(step);
      blocks.push({ kind: 'step', step: steps.length - 1 });
    }
  }
  flushAgent();

  let total = 0;
  const kept: Message[] = [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const serializedLength = JSON.stringify(messages[index]).length;
    if (kept.length && total + serializedLength > MAX_IMPORTED_TRANSCRIPT_CHARS) break;
    total += serializedLength;
    kept.unshift(messages[index]);
  }
  return kept;
}

export function loadPiSessionMessages(path: string): Message[] {
  try {
    const manager = SessionManager.open(path);
    return projectPiSessionEntries(manager.getBranch());
  } catch {
    return [];
  }
}

export function inheritedWorkingDirectory(session: ManagedSessionSummary, fallback: string): string {
  const cwd = session.pi?.sourceCwd;
  return cwd && existsSync(cwd) ? resolve(cwd) : resolve(fallback);
}

export async function isSessionFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile() && basename(path).endsWith('.jsonl');
  } catch {
    return false;
  }
}
