// UI/UX layer — shared markdown renderer. Renders renderMd() output and lazily
// renders any ```mermaid blocks via the mermaid library (only loaded when present).
// Used by both the Canvas MdRenderer and the conversation message body (intro/outro).

import { useEffect, useMemo, useRef } from 'react';
import { renderMd } from '../render';

export function MdText({ text, className, testId }: { text: string; className?: string; testId?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => renderMd(text || ''), [text]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const nodes = Array.from(el.querySelectorAll<HTMLElement>('.mermaid'));
    if (nodes.length === 0) return;
    let cancelled = false;
    import('mermaid')
      .then((mod: any) => {
        if (cancelled) return;
        const mermaid: any = mod.default ?? mod;
        try {
          mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose', fontFamily: 'inherit' });
          mermaid.run({ nodes: nodes as any }).catch(() => { /* syntax error → leave source text */ });
        } catch { /* ignore */ }
      })
      .catch(() => { /* mermaid unavailable */ });
    return () => { cancelled = true; };
  }, [html]);
  return <div className={className} ref={ref} data-testid={testId} dangerouslySetInnerHTML={{ __html: html }} />;
}
