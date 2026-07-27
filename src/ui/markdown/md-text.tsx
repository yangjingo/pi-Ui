// UI/UX layer — shared markdown renderer. Renders renderMd() output and lazily
// renders any ```mermaid blocks via the mermaid library (only loaded when present).
// Used by both the Canvas MdRenderer and the conversation message body (intro/outro).

import { useEffect, useId, useMemo, useRef } from 'react';
import {
  mountMermaidResult,
  peekMermaidResult,
  renderMermaid,
  scheduleMermaidRender,
} from './mermaid-runtime';
import { renderMd } from './render';

export function MdText({ text, className, testId }: { text: string; className?: string; testId?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const scope = `markdown-mermaid-${useId().replace(/:/g, '')}`;
  const html = useMemo(() => renderMd(text || ''), [text]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const nodes = Array.from(el.querySelectorAll<HTMLElement>('.mermaid'));
    if (nodes.length === 0) return;

    let cancelled = false;
    const pending: Array<{ node: HTMLElement; source: string; index: number }> = [];
    nodes.forEach((node, index) => {
      const source = node.textContent?.trim() ?? '';
      if (!source) return;
      const cached = peekMermaidResult(source);
      if (cached) {
        mountMermaidResult(node, cached, `${scope}-${index}`);
      } else {
        node.dataset.renderState = 'loading';
        pending.push({ node, source, index });
      }
    });

    const cancelSchedule = pending.length
      ? scheduleMermaidRender(() => {
          for (const { node, source, index } of pending) {
            void renderMermaid(source)
              .then(result => {
                if (!cancelled && node.isConnected) {
                  mountMermaidResult(node, result, `${scope}-${index}`);
                }
              })
              .catch(() => {
                if (!cancelled) node.dataset.renderState = 'error';
              });
          }
        })
      : () => {};
    return () => {
      cancelled = true;
      cancelSchedule();
    };
  }, [html, scope]);
  return <div className={className} ref={ref} data-testid={testId} dangerouslySetInnerHTML={{ __html: html }} />;
}
