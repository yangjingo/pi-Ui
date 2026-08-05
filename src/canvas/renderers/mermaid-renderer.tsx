import { memo, useEffect, useId, useRef, useState } from 'react';
import {
  mountMermaidResult,
  peekMermaidResult,
  renderMermaid,
  scheduleMermaidRender,
  t,
} from '../../ui';
import type { RenderResult } from 'mermaid';

interface MermaidRendererProps {
  name: string;
  source: string;
}

interface MermaidState {
  source: string;
  result?: RenderResult;
  error?: string;
}

export const MermaidRenderer = memo(function MermaidRenderer({ name, source }: MermaidRendererProps) {
  const diagram = source.trim() ? source : `flowchart LR\n  A[${t('renderer.emptyDiagram')}]`;
  const scope = `mermaid-${useId().replace(/:/g, '')}`;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<MermaidState>({ source: '' });
  const cached = peekMermaidResult(diagram);
  const result = state.source === diagram ? state.result : cached ?? undefined;
  const error = state.source === diagram ? state.error : undefined;

  useEffect(() => {
    const ready = peekMermaidResult(diagram);
    if (ready) {
      setState({ source: diagram, result: ready });
      return;
    }

    let cancelled = false;
    setState({ source: diagram });
    const cancelSchedule = scheduleMermaidRender(() => {
      void renderMermaid(diagram)
        .then(next => {
          if (!cancelled) setState({ source: diagram, result: next });
        })
        .catch(reason => {
          if (!cancelled) setState({
            source: diagram,
            error: reason instanceof Error ? reason.message : t('renderer.mermaidFailed'),
          });
        });
    });
    return () => {
      cancelled = true;
      cancelSchedule();
    };
  }, [diagram]);

  useEffect(() => {
    const host = hostRef.current;
    if (host && result) mountMermaidResult(host, result, scope);
  }, [result, scope]);

  return (
    <div className="r-mermaid" data-testid="renderer-mermaid">
      <div className="r-doc">
        {result ? (
          <div ref={hostRef} className="mermaid" aria-label={t('renderer.mermaidPreview', { name })} />
        ) : error ? (
          <div className="r-diagram-error" data-testid="renderer-mermaid-error" role="alert">
            <b>{t('renderer.mermaidFailed')}</b>
            <span>{error}</span>
            <pre><code>{diagram.slice(0, 20_000)}{diagram.length > 20_000 ? `\n${t('renderer.truncated')}` : ''}</code></pre>
          </div>
        ) : (
          <div className="r-diagram-loading" role="status" data-testid="renderer-mermaid-loading">{t('renderer.loadingMermaid')}</div>
        )}
      </div>
    </div>
  );
});

export default MermaidRenderer;
