import { createHash } from 'node:crypto';
import { CONTEXT_SYSTEM_PROMPT, CONTEXT_WORKSPACE_LINE } from './prompts';

export { CONTEXT_SYSTEM_PROMPT, CONTEXT_WORKSPACE_LINE };

export interface ContextToolDefinition {
  name: string;
  description?: unknown;
  parameters?: unknown;
  promptGuidelines?: unknown;
}

export interface ContextPrefixSnapshot {
  fingerprint: string;
  systemPromptFingerprint: string;
  toolsFingerprint: string;
  toolNames: string[];
}

export interface ContextUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h: number;
  totalTokens: number;
}

export interface ContextResponseMetadata {
  role?: string;
  usage?: Partial<ContextUsage>;
}

export interface ContextTurnMetrics {
  cacheRead: number;
  cacheWrite: number;
  cacheHitRate: number;
  contextPrefix: string;
  contextPrefixStable: boolean;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .filter(key => (value as Record<string, unknown>)[key] !== undefined)
      .map(key => [key, canonicalize((value as Record<string, unknown>)[key])]),
  );
}

function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function finiteTokenCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Owns the cache-sensitive context contract without depending on the Pi SDK.
 * Core/Pi remains responsible for adapting this policy to Pi extension events. */
export class ContextHarness {
  readonly systemPrompt = CONTEXT_SYSTEM_PROMPT;

  /** Tool definitions are a front-loaded cache prefix. Keep one deterministic allowlist and
   * never add/remove tools in response to a user turn or an activated Skill. */
  stableToolNames(...groups: ReadonlyArray<ReadonlyArray<string>>): string[] {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const group of groups) {
      for (const rawName of group) {
        const name = String(rawName || '').trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        names.push(name);
      }
    }
    return names;
  }

  /** Pi appends the physical CWD to its prompt. The physical path contains a per-session id,
   * so expose only the stable relative-path contract to the model. */
  stabilizeSystemPrompt(systemPrompt: string): string {
    return String(systemPrompt || '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(line => /^Current working directory:\s*/u.test(line) ? CONTEXT_WORKSPACE_LINE : line)
      .join('\n');
  }

  /** Dynamic user/Skill content is append-only. Normalizing line endings is the only rewrite;
   * no timestamps, state snapshots, or provider-specific cache markers are injected here. */
  assembleUserTurn(prompt: string): string {
    return String(prompt || '').replace(/\r\n/g, '\n');
  }

  prefixSnapshot(systemPrompt: string, tools: ReadonlyArray<ContextToolDefinition>): ContextPrefixSnapshot {
    const stableSystemPrompt = this.stabilizeSystemPrompt(systemPrompt);
    const stableTools = tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      promptGuidelines: tool.promptGuidelines,
    }));
    const systemPromptFingerprint = fingerprint(stableSystemPrompt);
    const toolsFingerprint = fingerprint(stableTools);
    return {
      fingerprint: fingerprint({
        version: 1,
        systemPrompt: stableSystemPrompt,
        tools: stableTools,
      }),
      systemPromptFingerprint,
      toolsFingerprint,
      toolNames: stableTools.map(tool => tool.name),
    };
  }

  turnMetrics(
    usage: Pick<ContextUsage, 'input' | 'cacheRead' | 'cacheWrite'>,
    current: ContextPrefixSnapshot,
    baseline: ContextPrefixSnapshot,
  ): ContextTurnMetrics {
    const input = finiteTokenCount(usage.input);
    const cacheRead = finiteTokenCount(usage.cacheRead);
    const cacheWrite = finiteTokenCount(usage.cacheWrite);
    const promptTokens = input + cacheRead + cacheWrite;
    return {
      cacheRead,
      cacheWrite,
      cacheHitRate: promptTokens > 0 ? cacheRead / promptTokens : 0,
      contextPrefix: current.fingerprint.slice(0, 12),
      contextPrefixStable: current.fingerprint === baseline.fingerprint,
    };
  }

  /** Pi-ai's canonical response metadata lives on each assistant message as `usage`.
   * Reports must consume these normalized fields rather than estimate tokens from text. */
  responseUsage(responses: ReadonlyArray<ContextResponseMetadata>): ContextUsage {
    const total: ContextUsage = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cacheWrite1h: 0,
      totalTokens: 0,
    };
    for (const response of responses) {
      if (response?.role !== 'assistant' || !response.usage) continue;
      const input = finiteTokenCount(response.usage.input || 0);
      const output = finiteTokenCount(response.usage.output || 0);
      const cacheRead = finiteTokenCount(response.usage.cacheRead || 0);
      const cacheWrite = finiteTokenCount(response.usage.cacheWrite || 0);
      const cacheWrite1h = finiteTokenCount(response.usage.cacheWrite1h || 0);
      const reportedTotal = finiteTokenCount(response.usage.totalTokens || 0);
      total.input += input;
      total.output += output;
      total.cacheRead += cacheRead;
      total.cacheWrite += cacheWrite;
      total.cacheWrite1h += cacheWrite1h;
      total.totalTokens += reportedTotal || input + output + cacheRead + cacheWrite;
    }
    return total;
  }
}
