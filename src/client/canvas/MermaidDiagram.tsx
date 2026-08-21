/**
 * Mermaid diagram renderer for the AIDA Canvas: loads the mermaid runtime
 * lazily (dynamic import keeps it out of the main bundle) and renders the
 * source to an SVG. Mermaid validates color formats, so theme tokens are
 * resolved to literal colors before rendering. Errors fall back to the raw
 * source with the failure message, so a broken diagram never blanks the
 * canvas.
 */

import { useEffect, useRef, useState } from 'react'
import type { MermaidConfig } from 'mermaid'
import css from './canvas.module.css'

export interface MermaidDiagramProps {
  /** Mermaid source text. */
  source: string
}

/** Resolve a CSS custom property to a literal color (mermaid validates formats). */
function resolvedToken(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

function mermaidConfig(): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: {
      primaryColor: resolvedToken('--dsw-alias-bg-layer-2', '#ffffff'),
      primaryTextColor: resolvedToken('--dsw-alias-label-primary', '#111827'),
      lineColor: resolvedToken('--dsw-alias-border-l3', '#9ca3af'),
      fontSize: '13px',
    },
  }
}

/** Render a mermaid diagram from its source. */
export function MermaidDiagram({ source }: MermaidDiagramProps) {
  const host = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const revision = useRef(0)

  useEffect(() => {
    const current = ++revision.current
    let cancelled = false
    setError(null)
    const render = async (): Promise<void> => {
      try {
        const { default: mermaid } = await import('mermaid')
        if (cancelled) return
        mermaid.initialize(mermaidConfig())
        const id = `aida-mermaid-${current}`
        const { svg } = await mermaid.render(id, source || 'flowchart LR\n  A[empty]')
        if (cancelled || host.current === null) return
        host.current.innerHTML = svg
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      }
    }
    void render()
    return () => { cancelled = true }
  }, [source])

  if (error !== null) {
    return (
      <div className={css.mermaidFallback} data-testid="aida-canvas-mermaid-error">
        <p className={css.mermaidErrorText} role="alert">{error}</p>
        <pre className={css.previewPre}>{source}</pre>
      </div>
    )
  }
  return <div ref={host} className={css.mermaidStage} data-testid="aida-canvas-mermaid" />
}
