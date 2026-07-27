interface JsonRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  errorMessage?: string;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function requestJson<T>(
  path: string,
  { method, body, errorMessage }: JsonRequestOptions = {},
): Promise<T> {
  const hasBody = body !== undefined;
  const response = await fetch(path, {
    method,
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || errorMessage || `请求失败 (${response.status})`);
  return result;
}
