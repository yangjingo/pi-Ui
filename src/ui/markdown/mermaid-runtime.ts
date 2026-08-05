import type { Mermaid, RenderResult } from 'mermaid';

const MERMAID_RENDER_MEASURE = 'pi:mermaid:render';

const MAX_CACHE_ENTRIES = 24;
const MAX_CACHE_SOURCE_CHARS = 512_000;
const MAX_CACHEABLE_SOURCE_CHARS = 128_000;

interface MermaidCacheEntry {
  sourceLength: number;
  promise: Promise<RenderResult>;
  result?: RenderResult;
}

const resultCache = new Map<string, MermaidCacheEntry>();
let cachedSourceChars = 0;
let mermaidPromise: Promise<Mermaid> | null = null;
let renderSequence = 0;

function sourceHash(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function loadMermaid(): Promise<Mermaid> {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = import('mermaid')
    .then(module => {
      const mermaid = module.default;
      const theme = typeof document === 'undefined'
        ? 'dark'
        : document.documentElement.dataset.theme;
      const themeVariables = theme === 'aida' ? {
        background: '#f6f8fb',
        primaryColor: '#ffffff',
        primaryTextColor: '#0f172a',
        primaryBorderColor: '#cbd5e1',
        lineColor: '#64748b',
        secondaryColor: '#eef1fc',
        tertiaryColor: '#eef2f7',
        clusterBkg: '#fafbfc',
        clusterBorder: '#cbd5e1',
        edgeLabelBackground: '#f6f8fb',
        noteBkgColor: '#eef1fc',
        noteTextColor: '#1e34a8',
        noteBorderColor: '#3551d8',
      } : theme === 'zengrid' ? {
        background: '#FAF9F6',
        primaryColor: '#FFFFFF',
        primaryTextColor: '#57534E',
        primaryBorderColor: '#D6D3CE',
        lineColor: '#78716C',
        secondaryColor: '#F5F4F1',
        tertiaryColor: '#FAF9F6',
        clusterBkg: '#FAF9F6',
        clusterBorder: '#D6D3CE',
        edgeLabelBackground: '#FAF9F6',
        noteBkgColor: '#F5F4F1',
        noteTextColor: '#57534E',
        noteBorderColor: '#D6D3CE',
      } : {
        background: '#171717',
        primaryColor: '#202020',
        primaryTextColor: '#E5E5E5',
        primaryBorderColor: '#505050',
        lineColor: '#858585',
        secondaryColor: '#171717',
        tertiaryColor: '#121212',
        clusterBkg: '#171717',
        clusterBorder: '#505050',
        edgeLabelBackground: '#171717',
        noteBkgColor: '#242424',
        noteTextColor: '#E5E5E5',
        noteBorderColor: '#505050',
      };
      mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        themeVariables,
        // Session files and Agent output are untrusted input. Mermaid's strict mode keeps
        // labels useful while preventing diagram markup from becoming same-origin HTML.
        securityLevel: 'strict',
        fontFamily: 'inherit',
        deterministicIds: true,
      });
      return mermaid;
    })
    .catch(error => {
      mermaidPromise = null;
      throw error;
    });
  return mermaidPromise;
}

function removeCached(source: string, entry: MermaidCacheEntry) {
  if (resultCache.get(source) !== entry) return;
  resultCache.delete(source);
  cachedSourceChars -= entry.sourceLength;
}

function trimCache() {
  while (resultCache.size > MAX_CACHE_ENTRIES || cachedSourceChars > MAX_CACHE_SOURCE_CHARS) {
    const oldest = resultCache.entries().next().value as [string, MermaidCacheEntry] | undefined;
    if (!oldest) return;
    removeCached(oldest[0], oldest[1]);
  }
}

async function renderUncached(source: string): Promise<RenderResult> {
  const measure = typeof window !== 'undefined'
    && (window as Window & { __PI_RENDER_DIAGNOSTICS__?: boolean }).__PI_RENDER_DIAGNOSTICS__ === true
    && typeof performance !== 'undefined';
  const started = measure ? performance.now() : 0;
  try {
    const mermaid = await loadMermaid();
    const id = `pi-mermaid-${sourceHash(source)}-${renderSequence++}`;
    return await mermaid.render(id, source);
  } finally {
    if (measure) {
      performance.measure(MERMAID_RENDER_MEASURE, {
        start: started,
        duration: performance.now() - started,
      });
    }
  }
}

export function peekMermaidResult(source: string): RenderResult | null {
  return resultCache.get(source)?.result ?? null;
}

export function renderMermaid(source: string): Promise<RenderResult> {
  const cached = resultCache.get(source);
  if (cached) {
    resultCache.delete(source);
    resultCache.set(source, cached);
    return cached.promise;
  }

  const promise = renderUncached(source);
  if (source.length > MAX_CACHEABLE_SOURCE_CHARS) return promise;

  const entry: MermaidCacheEntry = { sourceLength: source.length, promise };
  resultCache.set(source, entry);
  cachedSourceChars += source.length;
  trimCache();
  void promise
    .then(result => {
      entry.result = result;
    })
    .catch(() => removeCached(source, entry));
  return promise;
}

export function scheduleMermaidRender(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(callback, { timeout: 200 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, 0);
  return () => window.clearTimeout(handle);
}

/**
 * Mermaid render results are cached by source. Bind interactive handlers before namespacing the
 * SVG ids so a cached diagram can safely appear more than once in the same document.
 */
export function mountMermaidResult(host: HTMLElement, result: RenderResult, scope: string) {
  host.innerHTML = result.svg;
  result.bindFunctions?.(host);

  const safeScope = scope.replace(/[^a-zA-Z0-9_-]/g, '');
  const idElements = Array.from(host.querySelectorAll<Element>('[id]'));
  const ids = idElements
    .map((element, index) => {
      const id = element.id;
      return id ? [id, `${safeScope}-${index}-${id}`] as [string, string] : null;
    })
    .filter((entry): entry is [string, string] => Boolean(entry))
    .sort((a, b) => b[0].length - a[0].length);
  const replacements = new Map(ids);
  const idPattern = ids.length
    ? new RegExp(ids.map(([id]) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
    : null;
  const replaceIds = (value: string) => idPattern
    ? value.replace(idPattern, id => replacements.get(id) ?? id)
    : value;

  for (const element of idElements) {
    const scoped = replacements.get(element.id);
    if (scoped) element.id = scoped;
  }
  for (const element of Array.from(host.querySelectorAll<Element>('*'))) {
    for (const attribute of element.getAttributeNames()) {
      if (attribute === 'id') continue;
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, replaceIds(value));
    }
    if (element.tagName.toLowerCase() === 'style' && element.textContent) {
      element.textContent = replaceIds(element.textContent);
    }
  }
  host.dataset.renderState = 'ready';
}
