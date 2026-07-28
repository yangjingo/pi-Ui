import type { SessionSummary } from '../../core/agent';

function sessionIdSearchTerm(query: string): string {
  const normalized = query.trim().toLowerCase();
  return normalized.replace(/^sess(?:ion)?id\s*[:：#]?\s*/, '').trim() || normalized;
}

/** Prefer the native Pi sessid while retaining the internal key for UI actions. */
export function sessionDisplayId(session: SessionSummary): string {
  return session.sourceId || session.id;
}

/** Match a session by its visible title or by a complete/partial sessid. */
export function matchesSessionSearch(session: SessionSummary, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const idTerm = sessionIdSearchTerm(normalized);

  return session.title.toLowerCase().includes(normalized)
    || session.id.toLowerCase().includes(idTerm)
    || sessionDisplayId(session).toLowerCase().includes(idTerm);
}
