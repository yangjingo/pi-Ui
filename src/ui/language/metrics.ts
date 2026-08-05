import type { TurnStats } from '../../core/agent/protocol';

export interface CompactTurnMetric {
  label: 'TTFT' | 'TPOT' | 'TPS' | 'IN' | 'OUT' | 'CACHE';
  value: string;
}

export function compactCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) return `${trimDecimal(value / 1_000)}k`;
  return `${trimDecimal(value / 1_000_000)}m`;
}

export function compactTurnMetrics(stats: TurnStats, cumulativeCacheHitRate?: number): CompactTurnMetric[] {
  const metrics: CompactTurnMetric[] = [];
  if (stats.ttft > 0) metrics.push({ label: 'TTFT', value: compactTime(stats.ttft) });
  if (stats.tpot > 0) {
    metrics.push({ label: 'TPOT', value: compactTime(stats.tpot) });
    metrics.push({ label: 'TPS', value: (1_000 / stats.tpot).toFixed(1) });
  }
  if (stats.input >= 0) metrics.push({ label: 'IN', value: compactCount(stats.input) });
  if (stats.output >= 0) metrics.push({ label: 'OUT', value: compactCount(stats.output) });
  if (cumulativeCacheHitRate != null && Number.isFinite(cumulativeCacheHitRate)) {
    const percentage = Math.min(1, Math.max(0, cumulativeCacheHitRate)) * 100;
    metrics.push({ label: 'CACHE', value: `${trimDecimal(percentage)}%` });
  }
  return metrics;
}

function compactTime(value: number): string {
  if (value < 1_000) return `${Math.round(value)}ms`;
  return `${trimDecimal(value / 1_000)}s`;
}

function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}
