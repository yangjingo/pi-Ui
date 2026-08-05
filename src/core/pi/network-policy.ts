const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/** Pi UI has no remote authentication boundary, so every server entry point is loopback-only. */
export function loopbackHost(value: string | undefined): string {
  const host = String(value || '127.0.0.1').trim().toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`Invalid host "${value}". Pi UI only listens on 127.0.0.1, localhost, or ::1.`);
  }
  return host;
}

/** Reject cross-origin browser calls to the local privileged API. Non-browser clients omit Origin. */
export function hasAllowedApiOrigin(origin: string | string[] | undefined, host: string | undefined): boolean {
  if (origin == null) return true;
  if (Array.isArray(origin) || !host) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host;
  } catch {
    return false;
  }
}
