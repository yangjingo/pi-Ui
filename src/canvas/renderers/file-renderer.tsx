import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import type { FileNode } from '../../core/agent/protocol';
import {
  fetchWorkspaceFileBlob,
  isOfficeFile,
  isOfficeWorkbookPreview,
  parseCSV,
  WorkspaceFileRequestError,
  workspaceFileUrl,
  type OfficeWorkbookPreview,
} from '../../workspace';
import { highlightCode, languageOfPath, t, text, Icon, fileIcon } from '../../ui';
import { useWorkspace } from '../../workspace';
import { EditableMarkdownCanvas } from './editable-markdown-canvas';

const LazyMermaidRenderer = lazy(() => import('./mermaid-renderer'));
const LazyExcalidrawRenderer = lazy(() => import('./excalidraw-renderer'));

/* ---------- HTML (live preview by default, with a source toggle) ---------- */
type SlideCommand = 'previous' | 'next' | 'state';
type SlideState = { ready: boolean; index: number; total: number };

const INITIAL_SLIDE_STATE: SlideState = { ready: false, index: 1, total: 0 };
const HTML_PREVIEW_SOURCE = 'pi-canvas-html-preview';

function isRevealPresentation(content: string): boolean {
  return /class\s*=\s*["'][^"']*\breveal\b/i.test(content)
    && /class\s*=\s*["'][^"']*\bslides\b/i.test(content);
}

const HTML_PERFORMANCE_BRIDGE = `
<script data-pi-canvas-performance>
(() => {
  if (window.__piCanvasPreviewBudget) return;
  window.__piCanvasPreviewBudget = true;
  const SOURCE = '${HTML_PREVIEW_SOURCE}';

  // Preview content can own an endless animation loop. Batch iframe RAF callbacks at 30fps
  // so complex HTML cannot monopolize the workbench rendering thread.
  const nativeRaf = window.requestAnimationFrame.bind(window);
  let previewFrame = 0;
  let previewFrameId = 0;
  let lastPreviewFrame = 0;
  const previewCallbacks = new Map();
  const runPreviewFrame = (time) => {
    previewFrameId = 0;
    if (time - lastPreviewFrame < 32) {
      previewFrameId = nativeRaf(runPreviewFrame);
      return;
    }
    lastPreviewFrame = time;
    const callbacks = Array.from(previewCallbacks.values());
    previewCallbacks.clear();
    callbacks.forEach((callback) => callback(time));
    if (previewCallbacks.size) previewFrameId = nativeRaf(runPreviewFrame);
  };
  window.requestAnimationFrame = (callback) => {
    const id = ++previewFrame;
    previewCallbacks.set(id, callback);
    if (!previewFrameId) previewFrameId = nativeRaf(runPreviewFrame);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    previewCallbacks.delete(id);
  };

  const publishReady = () => window.requestAnimationFrame(() => {
    parent.postMessage({ source: SOURCE, type: 'preview-ready' }, '*');
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', publishReady, { once: true });
  } else {
    publishReady();
  }
})();
</script>`;

const PRESENTATION_PREVIEW_BRIDGE = `
<style data-pi-canvas-preview>
  .reveal .slides section:not(.present) .pretext-stage {
    visibility: hidden !important;
    contain: strict;
  }
</style>
<script data-pi-canvas-preview>
(() => {
  const SOURCE = '${HTML_PREVIEW_SOURCE}';

  let attachedReveal = null;
  const suspendedBackgrounds = new WeakMap();
  const observedBackgrounds = new WeakSet();
  const reveal = () => window.Reveal;
  const optimizeStage = (stage) => {
    const background = stage.querySelector('.pretext-bg');
    if (!background) return;
    if (!observedBackgrounds.has(background)) {
      observedBackgrounds.add(background);
      new MutationObserver(() => optimizeStage(stage)).observe(background, { childList: true });
    }
    const active = Boolean(stage.closest('section.present'));
    if (active) {
      const suspended = suspendedBackgrounds.get(background);
      if (suspended) {
        background.appendChild(suspended);
        suspendedBackgrounds.delete(background);
      }
      return;
    }
    if (!background.childNodes.length) return;
    const suspended = document.createDocumentFragment();
    while (background.firstChild) suspended.appendChild(background.firstChild);
    suspendedBackgrounds.set(background, suspended);
  };
  const optimizePresentation = () => {
    document.querySelectorAll('.pretext-stage').forEach(optimizeStage);
  };
  const publish = () => {
    const api = reveal();
    if (!api || typeof api.getIndices !== 'function') {
      parent.postMessage({ source: SOURCE, type: 'slide-state', ready: false, index: 1, total: 0 }, '*');
      return;
    }
    const indices = api.getIndices() || {};
    const fallbackIndex = Number(indices.h || 0) + Number(indices.v || 0);
    const past = typeof api.getSlidePastCount === 'function' ? api.getSlidePastCount() : fallbackIndex;
    const total = typeof api.getTotalSlides === 'function'
      ? api.getTotalSlides()
      : document.querySelectorAll('.reveal .slides section').length;
    parent.postMessage({
      source: SOURCE,
      type: 'slide-state',
      ready: true,
      index: Math.max(1, Number(past || 0) + 1),
      total: Math.max(1, Number(total || 1)),
    }, '*');
  };
  const attachReveal = () => {
    const api = reveal();
    if (!api || typeof api.getIndices !== 'function') return false;
    if (attachedReveal !== api) {
      attachedReveal = api;
      if (typeof api.on === 'function') {
        ['ready', 'slidechanged'].forEach((type) => api.on(type, () => {
          optimizePresentation();
          publish();
        }));
        ['fragmentshown', 'fragmenthidden'].forEach((type) => api.on(type, publish));
      }
    }
    optimizePresentation();
    publish();
    return true;
  };
  const navigate = (command) => {
    const api = reveal();
    const method = command === 'previous' ? 'prev' : 'next';
    if (api && typeof api[method] === 'function') {
      api[method]();
      window.setTimeout(publish, 40);
      return;
    }
    const key = command === 'previous' ? 'ArrowLeft' : 'ArrowRight';
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  };

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== SOURCE || data.type !== 'slide-command') return;
    if (data.command === 'state') attachReveal();
    if (data.command === 'previous' || data.command === 'next') navigate(data.command);
  });

  let wheelLocked = false;
  const hasScrollableRoom = (target, delta) => {
    let element = target instanceof Element ? target : null;
    while (element && element !== document.body) {
      const style = getComputedStyle(element);
      if (/auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1) {
        if (delta > 0 && element.scrollTop + element.clientHeight < element.scrollHeight - 1) return true;
        if (delta < 0 && element.scrollTop > 1) return true;
      }
      element = element.parentElement;
    }
    return false;
  };
  document.addEventListener('wheel', (event) => {
    if (Math.abs(event.deltaY) < 24 || hasScrollableRoom(event.target, event.deltaY)) return;
    event.preventDefault();
    if (wheelLocked) return;
    wheelLocked = true;
    navigate(event.deltaY > 0 ? 'next' : 'previous');
    window.setTimeout(() => { wheelLocked = false; }, 420);
  }, { passive: false, capture: true });

  let attempts = 0;
  const waitForReveal = () => {
    if (attachReveal() || attempts++ > 80) return;
    window.setTimeout(waitForReveal, 50);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForReveal, { once: true });
  } else {
    waitForReveal();
  }
})();
</script>`;

function injectPreviewBridge(content: string, bridge: string): string {
  const closingHead = content.search(/<\/head\s*>/i);
  if (closingHead >= 0) {
    return `${content.slice(0, closingHead)}${bridge}${content.slice(closingHead)}`;
  }
  return `${bridge}${content}`;
}

function htmlPreview(content: string, presentation: boolean): string {
  const bridge = presentation
    ? `${HTML_PERFORMANCE_BRIDGE}${PRESENTATION_PREVIEW_BRIDGE}`
    : HTML_PERFORMANCE_BRIDGE;
  return injectPreviewBridge(content, bridge);
}

export function HtmlRenderer({ f }: { f: FileNode }) {
  const { getFileContent, getEditBuffer, setEditBuffer, enterEdit, editing } = useWorkspace();
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const [slideState, setSlideState] = useState<SlideState>(INITIAL_SLIDE_STATE);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const content = (editing ? getEditBuffer(f.path) : getFileContent(f.path)) || '';
  const presentation = useMemo(() => isRevealPresentation(content), [content]);
  const previewContent = useMemo(
    () => htmlPreview(content, presentation),
    [content, presentation],
  );
  const sendSlideCommand = useCallback((command: SlideCommand) => {
    iframeRef.current?.contentWindow?.postMessage({
      source: HTML_PREVIEW_SOURCE,
      type: 'slide-command',
      command,
    }, '*');
  }, []);
  useEffect(() => {
    setSlideState(INITIAL_SLIDE_STATE);
    setPreviewLoaded(false);
  }, [f.path, previewContent]);
  useEffect(() => {
    if (mode !== 'preview' || !content.trim()) return;
    const frame = iframeRef.current;
    if (!frame) return;
    setPreviewLoaded(false);
    const frameId = window.requestAnimationFrame(() => {
      frame.srcdoc = previewContent;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [content, mode, previewContent]);
  useEffect(() => {
    const receiveSlideState = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as Partial<SlideState> & { source?: string; type?: string };
      if (data?.source !== HTML_PREVIEW_SOURCE) return;
      if (data.type === 'preview-ready') {
        setPreviewLoaded(true);
        return;
      }
      if (!presentation || data.type !== 'slide-state') return;
      setSlideState({
        ready: Boolean(data.ready),
        index: Math.max(1, Number(data.index || 1)),
        total: Math.max(0, Number(data.total || 0)),
      });
    };
    window.addEventListener('message', receiveSlideState);
    return () => window.removeEventListener('message', receiveSlideState);
  }, [presentation]);
  const openSource = () => {
    if (!editing) enterEdit();
    setMode('source');
  };
  const onPresentationKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!presentation || mode !== 'preview') return;
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      event.preventDefault();
      sendSlideCommand('previous');
    }
    if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
      event.preventDefault();
      sendSlideCommand('next');
    }
  };
  return (
    <div className={`r-html-wrap${presentation ? ' is-presentation' : ''}`} data-testid="renderer-html" onKeyDown={onPresentationKeyDown}>
      <div className="r-html-toolbar">
        <div className="r-html-bar" role="tablist" aria-label={t('renderer.viewMode', { name: f.name })}>
          <button type="button" role="tab" aria-selected={mode === 'preview'} aria-controls="html-render-panel" className={mode === 'preview' ? 'on' : ''} data-testid="html-preview" onClick={() => setMode('preview')}>{t('renderer.preview')}</button>
          <button type="button" role="tab" aria-selected={mode === 'source'} aria-controls="html-render-panel" className={mode === 'source' ? 'on' : ''} data-testid="html-source" onClick={openSource}>{t('renderer.source')}</button>
        </div>
        {presentation && mode === 'preview' && (
          <div className="r-html-slide-controls" data-testid="html-slide-controls" aria-label={t('renderer.presentationControls')}>
            <button type="button" data-testid="html-slide-previous" aria-label={t('renderer.previousPage')} disabled={!slideState.ready} onClick={() => sendSlideCommand('previous')}><Icon name="chevron" /></button>
            <output data-testid="html-slide-status" aria-live="polite">{slideState.ready ? `${slideState.index} / ${slideState.total}` : t('common.loading')}</output>
            <button type="button" data-testid="html-slide-next" aria-label={t('renderer.nextPage')} disabled={!slideState.ready} onClick={() => sendSlideCommand('next')}><Icon name="chevron" /></button>
          </div>
        )}
      </div>
      <div id="html-render-panel" className={`r-html-stage${mode === 'preview' && content.trim() && !previewLoaded ? ' is-loading' : ''}`} role="tabpanel" aria-label={mode === 'preview' ? t('renderer.htmlPreview') : t('renderer.htmlSource')}>
        {mode === 'preview' ? (
          content.trim() ? (
            <>
              {!previewLoaded && <div className="r-html-loading" role="status"><span className="preview-loading-mark" />{t('renderer.loadingHtml')}</div>}
              <iframe ref={iframeRef} className="r-html" title={f.name} sandbox="allow-scripts" aria-busy={!previewLoaded} data-loaded={previewLoaded || undefined} onLoad={() => sendSlideCommand('state')} />
            </>
          ) : (
            <div className="r-empty">{t('renderer.emptyNamed', { name: text(f.name) })}</div>
          )
        ) : <div className="r-code"><textarea className="r-edit-area" data-testid="html-source-body" spellCheck={false} value={content} onChange={(event) => { if (!editing) enterEdit(); setEditBuffer(event.target.value); }} /></div>}
      </div>
    </div>
  );
}

/* ---------- Source code: highlighted preview by default, explicit source editing ---------- */
export function CodeRenderer({ f }: { f: FileNode }) {
  const { getFileContent, getEditBuffer, setEditBuffer, enterEdit, editing, editSaving } = useWorkspace();
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const content = (editing ? getEditBuffer(f.path) : getFileContent(f.path)) || '';
  const language = languageOfPath(f.path || f.name);
  const highlighted = useMemo(() => highlightCode(content, language), [content, language]);
  useEffect(() => setMode(editing ? 'source' : 'preview'), [editing, f.path]);
  const openSource = () => {
    if (!editing) enterEdit();
    setMode('source');
  };
  return (
    <div className="r-code-wrap" data-testid="renderer-code">
      <div className="r-html-toolbar">
        <div className="r-html-bar" role="tablist" aria-label={t('renderer.viewMode', { name: f.name })}>
          <button type="button" role="tab" aria-selected={mode === 'preview'} className={mode === 'preview' ? 'on' : ''} data-testid="code-preview-toggle" onClick={() => setMode('preview')}>{t('renderer.preview')}</button>
          <button type="button" role="tab" aria-selected={mode === 'source'} className={mode === 'source' ? 'on' : ''} data-testid="code-source-toggle" onClick={openSource}>{t('renderer.source')}</button>
        </div>
        <span className="syntax-language">{highlighted.language === 'text' ? t('renderer.plainText') : highlighted.language}</span>
      </div>
      <div className="r-code-stage">
        {mode === 'preview' ? (
          <div className="r-code" data-testid="code-highlight-preview">
            <pre><code className={highlighted.highlighted ? 'is-highlighted' : 'is-plain'} dangerouslySetInnerHTML={{ __html: highlighted.html || t('renderer.emptyFile') }} /></pre>
            {highlighted.truncated && <div className="syntax-fallback">{t('renderer.largePlainText')}</div>}
          </div>
        ) : (
          <div className="r-code">
            <textarea
              className="r-code-source"
              data-testid="code-source-body"
              aria-label={t('renderer.sourceEditor', { name: f.name })}
              placeholder={t('renderer.emptyFile')}
              spellCheck={false}
              readOnly={editSaving}
              aria-busy={editSaving}
              value={content}
              onChange={(event) => {
                if (!editing) enterEdit();
                setEditBuffer(event.target.value);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Markdown ---------- */
export function MdRenderer({ f }: { f: FileNode }) {
  const { getFileContent, getEditBuffer, setEditBuffer, enterEdit, editing } = useWorkspace();
  const path = f.path || f.name;
  const content = getFileContent(f.path);
  const value = editing ? getEditBuffer(f.path) : content;

  return (
    <EditableMarkdownCanvas
      path={path}
      editing={editing}
      text={value || ''}
      onEditStart={enterEdit}
      onChange={(next) => {
        if (!editing) enterEdit();
        setEditBuffer(next);
      }}
    />
  );
}

/* ---------- Sheet (CSV / inline rows) ---------- */
const isTotalRow = (r: string[]) => /合计|总计|共/.test(String(r[0] || ''));
const isSectionRow = (r: string[]) => Boolean(String(r[0] || '').trim()) && r.slice(1).every(cell => !String(cell || '').trim());
const isNumericCell = (value: string) => /^[+-]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)(?:%|[a-zA-Z]{0,3})?$/.test(value.trim());

export function SheetRenderer({ f }: { f: FileNode }) {
  const { getFileContent } = useWorkspace();
  const content = getFileContent(f.path);
  const workbook = useMemo<OfficeWorkbookPreview | null>(() => {
    if (!isOfficeFile(f.name)) return null;
    try {
      const parsed: unknown = JSON.parse(content || 'null');
      return isOfficeWorkbookPreview(parsed) ? parsed : null;
    } catch { return null; }
  }, [content, f.name]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });
  const sheetScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => setSheetIndex(0), [f.path]);
  const sheet = workbook?.sheets[Math.min(sheetIndex, Math.max(0, workbook.sheets.length - 1))];
  const csvRows = useMemo(() => f.rows ?? parseCSV(content), [content, f.rows]);
  const rows = sheet?.rows ?? csvRows;
  const totals: number[] = f.totals || [];
  const head = rows[0] || [];
  const body = rows.slice(1);
  const columnCount = useMemo(
    () => Math.max(1, ...rows.map(row => row.length)),
    [rows],
  );
  const updateScrollEdges = useCallback(() => {
    const element = sheetScrollRef.current;
    if (!element) return;
    const next = {
      left: element.scrollLeft > 2,
      right: element.scrollLeft + element.clientWidth < element.scrollWidth - 2,
    };
    setScrollEdges(previous => previous.left === next.left && previous.right === next.right ? previous : next);
  }, []);
  useEffect(() => {
    const frame = window.requestAnimationFrame(updateScrollEdges);
    const element = sheetScrollRef.current;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateScrollEdges);
    if (element) observer?.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [rows, updateScrollEdges]);

  return (
    <div className={`r-sheet-wrap${workbook ? ' office-workbook' : ''}`} data-testid="renderer-sheet">
      {workbook && (
        <div className="office-sheet-tabs scroll" role="tablist" aria-label={t('renderer.worksheets')}>
          {workbook.sheets.map((item, index) => (
            <button key={`${item.name}-${index}`} role="tab" aria-selected={index === sheetIndex} className={index === sheetIndex ? 'on' : ''} onClick={() => setSheetIndex(index)}>
              {text(item.name)}
            </button>
          ))}
        </div>
      )}
      <div className={`r-sheet-frame${scrollEdges.left ? ' is-scrollable-left' : ''}${scrollEdges.right ? ' is-scrollable-right' : ''}`}>
        <div
          className="r-sheet scroll"
          data-scroll-left={scrollEdges.left ? 'true' : 'false'}
          data-scroll-right={scrollEdges.right ? 'true' : 'false'}
          ref={sheetScrollRef}
          onScroll={updateScrollEdges}
        >
          {rows.length ? (
            <table>
              <caption className="visually-hidden">{t('renderer.dataPreview', { name: text(sheet?.name || f.name) })}</caption>
              <colgroup>
                {Array.from({ length: columnCount }, (_, index) => (
                  <col key={index} className={index === 0 ? 'sheet-name-column' : 'sheet-data-column'} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {Array.from({ length: columnCount }, (_, index) => (
                    <th key={index} scope="col">{text(String(head[index] ?? ''))}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, rowIndex) => {
                  const total = totals.includes(rowIndex + 1) || isTotalRow(row);
                  const section = !total && isSectionRow(row);
                  return (
                    <tr key={rowIndex} className={section ? 'section' : total ? 'total' : undefined}>
                      {Array.from({ length: columnCount }, (_, columnIndex) => {
                        const value = String(row[columnIndex] ?? '');
                        if (columnIndex === 0) {
                          return <th key={columnIndex} scope={section ? 'rowgroup' : 'row'}>{text(value)}</th>;
                        }
                        return (
                          <td key={columnIndex} className={isNumericCell(value) ? 'numeric' : undefined} aria-hidden={section || undefined}>
                            {text(value)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <div className="r-empty">{t('renderer.noSheetData')}</div>}
        </div>
      </div>
    </div>
  );
}

/** Binary artifacts remain visible and session-scoped even when Canvas has no safe byte-level
 * preview for the format. The original remains available to tools in the same session folder. */
export function BinaryRenderer({ f }: { f: FileNode }) {
  const { activeId } = useWorkspace();
  const office = f.type === 'doc' || f.type === 'slides';
  const label = f.type === 'doc' ? t('renderer.wordDocument') : f.type === 'slides' ? t('renderer.powerpointPresentation') : t('renderer.binaryFile');
  const path = f.path || f.name;
  if (office) {
    return (
      <div className={`r-office-unavailable is-${f.type}`} data-testid="renderer-office-unavailable" role="region" aria-label={t('renderer.officeUnavailable', { format: label })}>
        <div className="r-office-unavailable-content">
          <span className={`r-office-unavailable-icon ftype-${f.type}`} aria-hidden="true"><Icon name={fileIcon(f.type)} /></span>
          <span className="r-office-unavailable-kind">{label}</span>
          <b className="r-office-unavailable-title">{t('renderer.unsupportedTitle')}</b>
          <p>{t('renderer.officeSaved')}</p>
          <div className="r-office-file-summary" title={path}>
            <span className={`tree-ico ftype-${f.type}`}><Icon name={fileIcon(f.type)} /></span>
            <span><b>{text(f.name)}</b>{f.size && <small>{text(f.size)}</small>}</span>
          </div>
          <a className="r-office-download" data-testid="renderer-office-download" href={workspaceFileUrl(activeId || '', path, true)} download>
            <Icon name="download" />{t('renderer.downloadFile')}
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="r-office r-binary" data-testid="renderer-binary">
      <div className="r-office-head">
        <span className={`tree-ico ftype-${f.type}`}><Icon name={fileIcon(f.type)} /></span>
        <span><b>{label}</b><small>{t('renderer.syncedFile')}</small></span>
      </div>
      <div className="r-doc">
        <p><b>{text(f.name)}</b>{f.size ? ` · ${text(f.size)}` : ''}</p>
        <p>{t('renderer.unsupportedHint')}</p>
      </div>
    </div>
  );
}

function isExcalidrawPayload(value: unknown): boolean {
  return !!value && typeof value === 'object' && (
    (value as { type?: unknown }).type === 'excalidraw'
    || Array.isArray((value as { elements?: unknown }).elements)
  );
}

function ExcalidrawFileRenderer({ f, source }: { f: FileNode; source?: string }) {
  const { getFileContent } = useWorkspace();
  const content = source ?? getFileContent(f.path) ?? '';
  return (
    <Suspense fallback={<div className="r-pdf-loading" role="status">{t('renderer.loadingExcalidraw')}</div>}>
      <LazyExcalidrawRenderer name={f.name} source={content} />
    </Suspense>
  );
}

export function JsonRenderer({ f }: { f: FileNode }) {
  const { getFileContent } = useWorkspace();
  const source = getFileContent(f.path) || '';
  const parsed = useMemo(() => {
    try {
      const value: unknown = JSON.parse(source);
      return { value, content: JSON.stringify(value, null, 2), invalid: false };
    } catch {
      return { value: null, content: source, invalid: Boolean(source.trim()) };
    }
  }, [source]);
  if (isExcalidrawPayload(parsed.value)) return <ExcalidrawFileRenderer f={f} source={source} />;
  return (
    <div className={`r-code r-json${parsed.invalid ? ' invalid' : ''}`} data-testid="renderer-json">
      {parsed.invalid && <div className="r-json-error" role="alert">{t('renderer.invalidJson')}</div>}
      <pre><code>{parsed.content || t('renderer.emptyJson')}</code></pre>
    </div>
  );
}

function MermaidFileRenderer({ f }: { f: FileNode }) {
  const { getFileContent } = useWorkspace();
  const source = getFileContent(f.path) || '';
  return (
    <Suspense fallback={<div className="r-pdf-loading" role="status">{t('renderer.loadingMermaid')}</div>}>
      <LazyMermaidRenderer name={f.name} source={source} />
    </Suspense>
  );
}

export function PdfRenderer({ f }: { f: FileNode }) {
  const { activeId, refreshWorkspaceFiles } = useWorkspace();
  const path = f.path || f.name;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setUrl(null); setError(null);
    if (!activeId) return () => controller.abort();
    void fetchWorkspaceFileBlob(activeId, path, controller.signal)
      .then(blob => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((reason: any) => {
        if (reason?.name !== 'AbortError') {
          setError(reason?.message || t('renderer.pdfLoadFailed'));
          if (reason instanceof WorkspaceFileRequestError && reason.status === 404) void refreshWorkspaceFiles();
        }
      });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [activeId, path, refreshWorkspaceFiles, retryRevision]);
  if (error) return <PreviewLoadError message={`${t('renderer.pdfFailed')} ${text(error)}`} onRetry={() => setRetryRevision(revision => revision + 1)} />;
  if (!url) return <div className="r-pdf-loading" role="status">{t('renderer.loadingPdf')}</div>;
  return <iframe className="r-pdf" data-testid="renderer-pdf" title={f.name} src={url} />;
}

/* ---------- Image ---------- */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error(t('renderer.imageBase64Failed')));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

export function ImageRenderer({ f }: { f: FileNode }) {
  const { activeId, refreshWorkspaceFiles } = useWorkspace();
  const path = f.path || f.name;
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setDataUrl(null); setError(null);
    if (!activeId) return () => controller.abort();
    void fetchWorkspaceFileBlob(activeId, path, controller.signal)
      .then(async blob => {
        const nextDataUrl = await blobToDataUrl(blob);
        if (controller.signal.aborted) return;
        setDataUrl(nextDataUrl);
      })
      .catch((reason: any) => {
        if (reason?.name !== 'AbortError') {
          setError(reason?.message || t('renderer.imageLoadFailed'));
          if (reason instanceof WorkspaceFileRequestError && reason.status === 404) void refreshWorkspaceFiles();
        }
      });
    return () => controller.abort();
  }, [activeId, path, refreshWorkspaceFiles, retryRevision]);
  if (error) return <PreviewLoadError message={`${t('renderer.imagePreviewFailed')} ${text(error)}`} onRetry={() => setRetryRevision(revision => revision + 1)} />;
  if (!dataUrl) return <div className="r-pdf-loading" role="status">{t('renderer.loadingImage')}</div>;
  return (
    <div className="r-img" data-testid="renderer-png">
      <div className="stage"><img src={dataUrl} alt={f.caption || f.name} onError={() => setError(t('renderer.imageDecodeFailed'))} /></div>
      <div className="cap">
        <span>{text(f.caption || f.name)}</span>
        <span>{text(f.size || '')}</span>
      </div>
    </div>
  );
}

function PreviewLoadError({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <div className="r-preview-error" role="alert">
      <Icon name="warning" />
      <span>{message}</span>
      <button type="button" onClick={onRetry}><Icon name="refresh" />{t('common.refresh')}</button>
    </div>
  );
}

/* ---------- Fig artboard (from a JSON spec the agent wrote) ---------- */
export function FigRenderer({ f }: { f: FileNode }) {
  const { getFileContent } = useWorkspace();
  let spec: any = {};
  try { spec = JSON.parse(getFileContent(f.path) || '{}'); } catch { /* empty */ }
  const eyebrow = spec.eyebrow || t('renderer.defaultEyebrow');
  const title = String(spec.title || t('renderer.defaultTitle'));
  const subtitle = spec.subtitle || '';
  const date = spec.date || '';
  const m = spec.market || {};
  const mdesc = String(m.desc || '');
  const bg = spec.bg || '#203c35';
  const cc = spec.copyColor || '#f7f3e6';

  const abRef = useRef<HTMLDivElement | null>(null);
  const [sel, setSel] = useState<{ l: number; t: number; w: number; h: number } | null>(null);

  const select = (e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const ab = abRef.current;
    if (!ab) return;
    const r = e.currentTarget.getBoundingClientRect();
    const ar = ab.getBoundingClientRect();
    setSel({ l: r.left - ar.left, t: r.top - ar.top, w: r.width, h: r.height });
  };

  const selectFromKeyboard = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    select(e);
  };

  return (
    <div data-testid="renderer-fig" style={{ position: 'relative' }}>
      <div className="artboard" ref={abRef} onClick={() => setSel(null)} onKeyDown={(e) => { if (e.key === 'Escape') setSel(null); }}>
        <div className="ab-bg ab-layer" style={{ background: bg }} role="button" tabIndex={0} aria-label={t('renderer.selectBackground')} onClick={select} onKeyDown={selectFromKeyboard} />
        <div className="ab-grain" />
        <div className="ab-orb ab-layer" role="button" tabIndex={0} aria-label={t('renderer.selectDecoration')} onClick={select} onKeyDown={selectFromKeyboard} />
        <div className="ab-copy ab-layer" style={{ color: cc }} role="button" tabIndex={0} aria-label={t('renderer.selectCopy')} onClick={select} onKeyDown={selectFromKeyboard}>
          <small>{text(eyebrow)}</small>
          <h2>{text(title)}</h2>
          <p>{text(subtitle)}</p>
          {date ? <span className="ab-pill">{text(date)}</span> : null}
        </div>
        <div className="ab-card ab-layer" role="button" tabIndex={0} aria-label={t('renderer.selectDataCard')} onClick={select} onKeyDown={selectFromKeyboard}>
          <b>{text(m.title || '')}</b>
          <p>{text(mdesc)}</p>
        </div>
        {sel && (
          <div className="ab-sel" style={{ left: sel.l, top: sel.t, width: sel.w, height: sel.h }}>
            <i style={{ left: -4, top: -4 }} /><i style={{ right: -4, top: -4 }} />
            <i style={{ left: -4, bottom: -4 }} /><i style={{ right: -4, bottom: -4 }} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- dispatcher ---------- */
export function FileRenderer({ f }: { f: FileNode }) {
  switch (f.type) {
    case 'fig': return <FigRenderer f={f} />;
    case 'html': return <HtmlRenderer f={f} />;
    case 'md': return <MdRenderer f={f} />;
    case 'doc': return <BinaryRenderer f={f} />;
    case 'sheet': return <SheetRenderer f={f} />;
    case 'slides': return <BinaryRenderer f={f} />;
    case 'png': return <ImageRenderer f={f} />;
    case 'code': return <CodeRenderer f={f} />;
    case 'json': return <JsonRenderer f={f} />;
    case 'mermaid': return <MermaidFileRenderer f={f} />;
    case 'excalidraw': return <ExcalidrawFileRenderer f={f} />;
    case 'pdf': return <PdfRenderer f={f} />;
    case 'binary': return <BinaryRenderer f={f} />;
    default: return null;
  }
}
