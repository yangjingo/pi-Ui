/**
 * File preview surface of the AIDA Canvas: formatted text (markdown, HTML,
 * mermaid, and SVG — each with a plain-textarea edit mode; SVG edits the
 * UTF-8 source decoded from the base64 read), generic text, image, PDF,
 * Office, and binary download. The panel feeds it the fetched workspace-file
 * read result; it never performs transport itself.
 */

import { useEffect, useMemo, useState } from 'react'
import { CodeBlock, JsonTree, MarkdownText, type JsonTreeLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceFileNode, WorkspaceFileRead } from '../../workspace-protocol.ts'
import type { AidaKey } from '../locales.ts'
import { base64ToBlob, parseCsv, saveBlobAs } from './files.ts'
import { codeLangOf, isTsvName, type CanvasFileFormat } from './formats.ts'
import { MermaidDiagram } from './MermaidDiagram.tsx'
import css from './canvas.module.css'

/** Locale seat shape the preview consumes (the panel's own `t`). */
export type CanvasTranslate = (key: AidaKey, params?: Record<string, string>) => string

export interface FilePreviewProps {
  /** The file being previewed. */
  node: WorkspaceFileNode
  /** Render format for text files (derived from the extension). */
  format: CanvasFileFormat
  /** Fetched content; null while loading or after a failed fetch. */
  read: WorkspaceFileRead | null
  /** Fetch error message, shown when read is null and the fetch failed. */
  error: string | null
  /** Whether the canvas is in edit mode for this file. */
  editing: boolean
  /** Unsaved source rendered while the editor is in preview mode. */
  previewContent?: string
  /** Edit buffer (only meaningful while editing). */
  buffer: string
  /** Edit-buffer change callback. */
  onBufferChange: (value: string) => void
  /** Whether a save is in flight. */
  saving: boolean
  /** Trigger a save of the current buffer. */
  onSave: () => void
  /** Localized copy. */
  t: CanvasTranslate
}

/** Render the preview body for one file kind. */
export function FilePreview({ node, read, error, editing, previewContent, buffer, format, onBufferChange, saving, onSave, t }: FilePreviewProps) {
  // SVG documents are dual-mode: the rendered image, or the UTF-8 source
  // decoded from the base64 read (the host classifies SVG as an image).
  if (node.kind === 'image' && format === 'svg') {
    if (editing) {
      return (
        <TextPreview
          content={buffer}
          editing
          error={error}
          loading={read === null && error === null}
          saving={saving}
          onBufferChange={onBufferChange}
          onSave={onSave}
          t={t}
        />
      )
    }
    if (read?.base64 !== undefined) return <ImagePreview node={node} read={read} t={t} />
    return <BinaryPreview node={node} read={read} t={t} />
  }
  if (node.kind === 'image' && read?.base64 !== undefined) {
    return <ImagePreview node={node} read={read} t={t} />
  }
  if (node.kind === 'pdf' && read?.base64 !== undefined) {
    return <PdfPreview read={read} t={t} />
  }
  if (node.kind === 'office') {
    if (read?.content !== undefined) return <OfficePreview read={read} />
    return <BinaryPreview node={node} read={read} t={t} />
  }
  if (node.kind === 'text') {
    const content = editing ? buffer : (previewContent ?? read?.content ?? '')
    if (!editing && format === 'markdown') {
      return (
        <div className={css.markdownDoc} data-testid="aida-canvas-markdown">
          <MarkdownText text={content} />
        </div>
      )
    }
    if (!editing && format === 'html') {
      return (
        <div className={css.htmlStage} data-testid="aida-canvas-html">
          <iframe className={css.htmlFrame} sandbox="allow-scripts" srcDoc={content} title="HTML" />
        </div>
      )
    }
    if (!editing && format === 'mermaid') {
      return <MermaidDiagram source={content} />
    }
    if (!editing && format === 'json') {
      return <JsonFileView content={content} name={node.name} t={t} />
    }
    if (!editing && format === 'csv') {
      return <CsvTableView content={content} name={node.name} t={t} />
    }
    if (!editing && format === 'code') {
      return <CodeFileView content={content} name={node.name} t={t} />
    }
    return (
      <TextPreview
        content={content}
        editing={editing}
        error={error}
        loading={read === null && error === null}
        saving={saving}
        onBufferChange={onBufferChange}
        onSave={onSave}
        t={t}
      />
    )
  }
  return <BinaryPreview node={node} read={read} t={t} />
}

/** Read-only or editable text pane. */
function TextPreview({ content, editing, error, loading, saving, onBufferChange, onSave, t }: {
  content: string
  editing: boolean
  error: string | null
  loading: boolean
  saving: boolean
  onBufferChange: (value: string) => void
  onSave: () => void
  t: CanvasTranslate
}) {
  const [draft, setDraft] = useState(content)
  useEffect(() => { setDraft(content) }, [content])
  if (loading) return <div className={css.previewCenter}>{t('canvas.previewLoading')}</div>
  if (error !== null) return <div className={`${css.previewCenter} ${css.previewError}`} role="alert">{error}</div>
  return (
    <div className={css.previewText}>
      {editing ? (
        <>
          <textarea
            className={css.editArea}
            data-testid="aida-canvas-edit"
            value={draft}
            onChange={(event) => { setDraft(event.target.value); onBufferChange(event.target.value) }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault()
                if (!saving) onSave()
              }
            }}
            aria-label="canvas.edit"
          />
          <div className={css.editBar}>
            <span className={css.editHint}>{t('canvas.saveHint')}</span>
            <button type="button" className={css.editSave} data-testid="aida-canvas-save" disabled={saving} onClick={onSave}>
              {saving ? t('canvas.saving') : t('canvas.save')}
            </button>
          </div>
        </>
      ) : (
        <pre className={css.previewPre} data-testid="aida-canvas-preview">{content}</pre>
      )}
    </div>
  )
}

/** Image preview from a base64 payload. */
function ImagePreview({ node, read, t }: { node: WorkspaceFileNode; read: WorkspaceFileRead; t: CanvasTranslate }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const blob = base64ToBlob(read.base64 ?? '', read.contentType ?? 'image/png')
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () =>{  URL.revokeObjectURL(objectUrl) }
  }, [read.base64, read.contentType])
  if (url === null) return <div className={css.previewCenter}>{t('canvas.previewLoading')}</div>
  return (
    <div className={css.previewImage}>
      <img src={url} alt={node.name} />
      <span className={css.previewCaption}>{node.name}</span>
    </div>
  )
}

/** PDF preview in an iframe from a base64 payload. */
function PdfPreview({ read, t }: { read: WorkspaceFileRead; t: CanvasTranslate }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const blob = base64ToBlob(read.base64 ?? '', 'application/pdf')
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () =>{  URL.revokeObjectURL(objectUrl) }
  }, [read.base64])
  if (url === null) return <div className={css.previewCenter}>{t('canvas.previewLoading')}</div>
  return <iframe className={css.previewPdf} src={url} title="PDF" />
}

/** Binary/Office payloads: download only. */
function BinaryPreview({ node, read, t }: { node: WorkspaceFileNode; read: WorkspaceFileRead | null; t: CanvasTranslate }) {
  const download = (): void => {
    if (read?.base64 === undefined) return
    const blob = base64ToBlob(read.base64, read.contentType ?? 'application/octet-stream')
    saveBlobAs(blob, node.name)
  }
  return (
    <div className={css.previewCenter}>
      <p>{node.kind === 'office' ? t('canvas.officeHint') : t('canvas.binaryHint')}</p>
      <button type="button" className={css.downloadButton} disabled={read?.base64 === undefined} onClick={download}>
        {t('canvas.download')} {node.name}
      </button>
    </div>
  )
}

/** One workbook sheet row shape carried by the host's Office preview JSON. */
interface WorkbookSheet {
  /** Sheet name; the host may omit it for unnamed sheets. */
  name?: string
  rows: string[][]
}

function isWorkbookPreview(value: unknown): value is { __office: 'workbook'; sheets: WorkbookSheet[] } {
  const candidate = value as { __office?: unknown; sheets?: unknown } | null
  return candidate !== null && typeof candidate === 'object'
    && candidate.__office === 'workbook' && Array.isArray(candidate.sheets)
}

/** Office preview: a sheet table for workbooks, plain text otherwise. */
function OfficePreview({ read }: { read: WorkspaceFileRead }) {
  const content = read.content ?? ''
  let workbook: { __office: 'workbook'; sheets: WorkbookSheet[] } | null = null
  try {
    const parsed: unknown = JSON.parse(content)
    if (isWorkbookPreview(parsed)) workbook = parsed
  } catch {
    workbook = null
  }
  if (workbook !== null) {
    return (
      <div className={css.sheetPreview} data-testid="aida-canvas-sheet">
        {workbook.sheets.map((sheet, sheetIndex) => (
          <div key={sheet.name ?? sheetIndex} className={css.sheetBlock}>
            <h4 className={css.sheetTitle}>{sheet.name}</h4>
            <table className={css.sheetTable}>
              <tbody>
                {sheet.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className={css.previewText}>
      <pre className={css.previewPre} data-testid="aida-canvas-office-text">{content}</pre>
    </div>
  )
}

/** Localized copy for the shared JSON tree (all keys come from the aida dictionary). */
function jsonLabels(t: CanvasTranslate): Partial<JsonTreeLabels> {
  return {
    copyValue: t('canvas.jsonCopyValue'),
    copyJson: t('canvas.jsonCopyJson'),
    copyPath: t('canvas.jsonCopyPath'),
    copyPrettyJson: t('canvas.jsonCopyPrettyJson'),
    copyCompactJson: t('canvas.jsonCopyCompactJson'),
    copied: t('canvas.jsonCopied'),
    copyFailed: t('canvas.jsonCopyFailed'),
    collapseNode: t('canvas.jsonCollapse'),
    expandNode: t('canvas.jsonExpand'),
    copyButtonTitle: action => t('canvas.jsonCopyTitle', { action }),
  }
}

/**
 * JSON file preview: the shared collapsible tree; content that cannot render
 * as a tree (invalid JSON, or a valid scalar) falls back to the raw text with
 * an error note.
 */
function JsonFileView({ content, name, t }: { content: string; name: string; t: CanvasTranslate }) {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    parsed = undefined
  }
  if (parsed === undefined || typeof parsed !== 'object' || parsed === null) {
    return (
      <div className={css.jsonFallback} data-testid="aida-canvas-json-error">
        <p className={css.previewError} role="alert">{t('canvas.jsonInvalid')}</p>
        <pre className={css.previewPre}>{content}</pre>
      </div>
    )
  }
  return (
    <div className={css.jsonTreeWrap} data-testid="aida-canvas-json">
      <JsonTree data={parsed} label={name} labels={jsonLabels(t)} />
    </div>
  )
}

/** Delimited-table preview (CSV/TSV): one row per line, RFC-4180 quoting honored. */
function CsvTableView({ content, name, t }: { content: string; name: string; t: CanvasTranslate }) {
  const delimiter = isTsvName(name) ? '\t' : ','
  const rows = useMemo(() => parseCsv(content, delimiter), [content, delimiter])
  if (rows.length === 0) {
    return <div className={css.previewCenter} data-testid="aida-canvas-csv-empty">{t('canvas.tableEmpty')}</div>
  }
  const width = Math.max(...rows.map(row => row.length))
  return (
    <div className={css.csvScroll} data-testid="aida-canvas-csv">
      <table className={css.csvTable}>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {Array.from({ length: width }, (_, columnIndex) => (
                <td key={columnIndex}>{row[columnIndex] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Source-code preview: the shared shiki CodeBlock with the extension-derived language. */
function CodeFileView({ content, name, t }: { content: string; name: string; t: CanvasTranslate }) {
  return (
    <div className={css.codeWrap} data-testid="aida-canvas-code">
      <CodeBlock code={content} lang={codeLangOf(name)} copyLabel={t('canvas.copy')} copiedLabel={t('canvas.copied')} />
    </div>
  )
}
