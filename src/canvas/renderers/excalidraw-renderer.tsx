import { memo, useId, useMemo } from 'react';

export const EXCALIDRAW_PREPARE_MEASURE = 'pi:excalidraw:prepare';

const MAX_CACHE_ENTRIES = 12;
const MAX_CACHE_SOURCE_CHARS = 2_000_000;
const MAX_CACHEABLE_SOURCE_CHARS = 500_000;
const MARKER_TOKEN = '__PI_EXCALIDRAW_ARROW_MARKER__';

type ExcalidrawElement = {
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  angle?: number;
  points?: Array<[number, number]>;
  text?: string;
  fontSize?: number;
  textAlign?: 'left' | 'center' | 'right';
  strokeColor?: string;
  backgroundColor?: string;
  strokeWidth?: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  opacity?: number;
  isDeleted?: boolean;
  roundness?: unknown;
};

interface PreparedScene {
  body: string;
  viewBox: string;
  visibleElements: number;
}

interface SceneCacheEntry {
  sourceLength: number;
  scene: PreparedScene | null;
}

const sceneCache = new Map<string, SceneCacheEntry>();
let cachedSourceChars = 0;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function color(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+-]+\)|[a-z]+)$/i.test(value)
    ? value
    : fallback;
}

function pathFor(element: ExcalidrawElement): string {
  const x = number(element.x);
  const y = number(element.y);
  const points = Array.isArray(element.points) ? element.points : [];
  if (points.length) {
    return points
      .map(([px, py], index) => `${index ? 'L' : 'M'} ${x + number(px)} ${y + number(py)}`)
      .join(' ');
  }
  return `M ${x} ${y} L ${x + number(element.width)} ${y + number(element.height)}`;
}

function elementMarkup(element: ExcalidrawElement): string {
  const x = number(element.x);
  const y = number(element.y);
  const width = number(element.width);
  const height = number(element.height);
  const stroke = color(element.strokeColor, '#44403C');
  const background = element.backgroundColor === 'transparent'
    ? 'none'
    : color(element.backgroundColor, 'none');
  const strokeWidth = Math.max(0, number(element.strokeWidth, 1.5));
  const opacity = Math.max(0, Math.min(1, number(element.opacity, 100) / 100));
  const dash = element.strokeStyle === 'dashed'
    ? ' stroke-dasharray="8 6"'
    : element.strokeStyle === 'dotted'
      ? ' stroke-dasharray="2 5"'
      : '';
  const angle = number(element.angle) * 180 / Math.PI;
  const transform = angle
    ? ` transform="rotate(${angle} ${x + width / 2} ${y + height / 2})"`
    : '';
  const common = ` stroke="${stroke}" fill="${background}" stroke-width="${strokeWidth}" opacity="${opacity}"${dash}${transform}`;
  const lineCommon = ` stroke="${stroke}" fill="none" stroke-width="${strokeWidth}" opacity="${opacity}"${dash}${transform}`;

  switch (element.type) {
    case 'rectangle':
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${element.roundness ? 8 : 0}"${common}/>`;
    case 'ellipse':
      return `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${Math.abs(width / 2)}" ry="${Math.abs(height / 2)}"${common}/>`;
    case 'diamond':
      return `<path d="M ${x + width / 2} ${y} L ${x + width} ${y + height / 2} L ${x + width / 2} ${y + height} L ${x} ${y + height / 2} Z"${common}/>`;
    case 'line':
    case 'freedraw':
      return `<path d="${pathFor(element)}"${lineCommon}/>`;
    case 'arrow':
      return `<path d="${pathFor(element)}" marker-end="url(#${MARKER_TOKEN})"${lineCommon}/>`;
    case 'text': {
      const fontSize = Math.max(1, number(element.fontSize, 20));
      const anchor = element.textAlign === 'center' ? 'middle' : element.textAlign === 'right' ? 'end' : 'start';
      const textX = element.textAlign === 'center' ? x + width / 2 : element.textAlign === 'right' ? x + width : x;
      const lines = String(element.text ?? '').split('\n');
      const tspans = lines
        .map((line, index) => `<tspan x="${textX}" dy="${index ? fontSize * 1.25 : 0}">${escapeHtml(line || ' ')}</tspan>`)
        .join('');
      return `<text x="${textX}" y="${y + fontSize}" fill="${stroke}" opacity="${opacity}" font-size="${fontSize}" font-family="var(--body)" text-anchor="${anchor}"${transform}>${tspans}</text>`;
    }
    default:
      return '';
  }
}

function prepareScene(source: string): PreparedScene | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }
  const elements = Array.isArray(parsed)
    ? parsed as ExcalidrawElement[]
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { elements?: unknown }).elements)
      ? (parsed as { elements: ExcalidrawElement[] }).elements
      : null;
  if (!elements) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let visibleElements = 0;
  const markup: string[] = [];
  const add = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const element of elements) {
    if (!element || element.isDeleted) continue;
    visibleElements += 1;
    const x = number(element.x);
    const y = number(element.y);
    add(x, y);
    add(x + number(element.width), y + number(element.height));
    for (const point of Array.isArray(element.points) ? element.points : []) {
      add(x + number(point?.[0]), y + number(point?.[1]));
    }
    markup.push(elementMarkup(element));
  }

  const padding = 40;
  const viewBox = Number.isFinite(minX)
    ? `${minX - padding} ${minY - padding} ${Math.max(1, maxX - minX + padding * 2)} ${Math.max(1, maxY - minY + padding * 2)}`
    : '0 0 800 500';
  return { body: markup.join(''), viewBox, visibleElements };
}

function removeCached(source: string, entry: SceneCacheEntry) {
  if (sceneCache.get(source) !== entry) return;
  sceneCache.delete(source);
  cachedSourceChars -= entry.sourceLength;
}

function trimCache() {
  while (sceneCache.size > MAX_CACHE_ENTRIES || cachedSourceChars > MAX_CACHE_SOURCE_CHARS) {
    const oldest = sceneCache.entries().next().value as [string, SceneCacheEntry] | undefined;
    if (!oldest) return;
    removeCached(oldest[0], oldest[1]);
  }
}

function sceneFor(source: string): PreparedScene | null {
  const cached = sceneCache.get(source);
  if (cached) {
    sceneCache.delete(source);
    sceneCache.set(source, cached);
    return cached.scene;
  }

  const measure = typeof window !== 'undefined'
    && (window as Window & { __PI_RENDER_DIAGNOSTICS__?: boolean }).__PI_RENDER_DIAGNOSTICS__ === true
    && typeof performance !== 'undefined';
  const started = measure ? performance.now() : 0;
  const scene = prepareScene(source);
  if (measure) {
    performance.measure(EXCALIDRAW_PREPARE_MEASURE, {
      start: started,
      duration: performance.now() - started,
    });
  }
  if (source.length <= MAX_CACHEABLE_SOURCE_CHARS) {
    const entry = { sourceLength: source.length, scene };
    sceneCache.set(source, entry);
    cachedSourceChars += source.length;
    trimCache();
  }
  return scene;
}

interface ExcalidrawRendererProps {
  name: string;
  source: string;
}

export const ExcalidrawRenderer = memo(function ExcalidrawRenderer({ name, source }: ExcalidrawRendererProps) {
  const markerId = `excal-arrow-${useId().replace(/:/g, '')}`;
  const scene = useMemo(() => sceneFor(source), [source]);
  const body = useMemo(
    () => scene?.body.split(MARKER_TOKEN).join(markerId) ?? '',
    [markerId, scene],
  );

  if (!scene || !scene.visibleElements) {
    const preview = source.slice(0, 20_000);
    return (
      <div className="r-excalidraw-error" data-testid="renderer-excalidraw-error">
        <b>无法渲染 Excalidraw 场景</b>
        <span>请确认文件包含 Excalidraw 的 <code>elements</code> 数据。</span>
        {preview && <pre><code>{preview}{source.length > preview.length ? '\n…（内容已截断）' : ''}</code></pre>}
      </div>
    );
  }

  return (
    <div className="r-excalidraw" data-testid="renderer-excalidraw">
      <svg viewBox={scene.viewBox} role="img" aria-label={`${name} Excalidraw 预览`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id={markerId} markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto" markerUnits="strokeWidth">
            <path d="M 0 0 L 8 4.5 L 0 9 z" fill="context-stroke" />
          </marker>
        </defs>
        <g dangerouslySetInnerHTML={{ __html: body }} />
      </svg>
    </div>
  );
});

export default ExcalidrawRenderer;
