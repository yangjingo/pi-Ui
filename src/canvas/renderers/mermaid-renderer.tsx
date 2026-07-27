import { memo, useEffect, useId, useRef, useState } from 'react';
import {
  mountMermaidResult,
  peekMermaidResult,
  renderMermaid,
  scheduleMermaidRender,
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

const EMPTY_DIAGRAM = 'flowchart LR\n  A[空图]';

export const MermaidRenderer = memo(function MermaidRenderer({ name, source }: MermaidRendererProps) {
  const diagram = source.trim() ? source : EMPTY_DIAGRAM;
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
            error: reason instanceof Error ? reason.message : 'Mermaid 图表无法渲染',
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
          <div ref={hostRef} className="mermaid" aria-label={`${name} Mermaid 预览`} />
        ) : error ? (
          <div className="r-diagram-error" data-testid="renderer-mermaid-error">
            <b>无法渲染 Mermaid 图表</b>
            <span>{error}</span>
            <pre><code>{diagram.slice(0, 20_000)}{diagram.length > 20_000 ? '\n…（内容已截断）' : ''}</code></pre>
          </div>
        ) : (
          <div className="r-diagram-loading" role="status" data-testid="renderer-mermaid-loading">正在渲染 Mermaid…</div>
        )}
      </div>
    </div>
  );
});

export default MermaidRenderer;
