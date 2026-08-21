// @vitest-environment jsdom
// FilePreview of the AIDA Canvas, mounted directly with realistic file reads:
// image and PDF object-URL previews, download-only binary/office payloads,
// markdown/HTML/mermaid/text renderers, the edit textarea with the save
// shortcut, and the loading/error states.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WorkspaceFileNode, WorkspaceFileRead } from '../src/workspace-protocol.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import { textToBase64 } from '../src/client/canvas/files.ts'
import { FilePreview, type FilePreviewProps } from '../src/client/canvas/preview.tsx'

const t: FilePreviewProps['t'] = makeTranslate(zh, commonZh)

/** jsdom lacks URL.createObjectURL; stub it like the panel spec. */
let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>

beforeEach(() => {
  createObjectURL = vi.fn(() => 'blob:fake')
  revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Default FilePreview props; override the file kind, read, and mode per test. */
function preview(overrides: Partial<FilePreviewProps> = {}): FilePreviewProps {
  return {
    node: { name: 'a.txt', path: 'a.txt', kind: 'text', size: 1 },
    format: 'text',
    read: null,
    error: null,
    editing: false,
    buffer: '',
    saving: false,
    onBufferChange: vi.fn(),
    onSave: vi.fn(),
    t,
    ...overrides,
  }
}

/** A leaf workspace-file node for one preview kind. */
function node(name: string, kind: WorkspaceFileNode['kind']): WorkspaceFileNode {
  return { name, path: name, kind, size: 4 }
}

describe('AIDA canvas file preview', () => {
  it('renders an image preview from its base64 payload and revokes the object URL on unmount', () => {
    const { unmount } = render(<FilePreview {...preview({
      node: node('photo.png', 'image'),
      read: { path: 'photo.png', base64: 'aGVsbG8=', contentType: 'image/png', truncated: false, totalBytes: 8 },
    })} />)
    expect(screen.getByAltText('photo.png').getAttribute('src')).toBe('blob:fake')
    expect(screen.getByText('photo.png')).toBeTruthy()
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })

  it('falls back to an empty payload and the png type when an image read lacks them', () => {
    render(<FilePreview {...preview({
      node: node('empty.png', 'image'),
      read: { path: 'empty.png', base64: null as never, contentType: null as never, truncated: false, totalBytes: 0 },
    })} />)
    expect(screen.getByAltText('empty.png').getAttribute('src')).toBe('blob:fake')
  })

  it('renders an SVG document as an image preview from its base64 payload', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>'
    render(<FilePreview {...preview({
      node: node('diagram.svg', 'image'),
      read: { path: 'diagram.svg', base64: textToBase64(source), contentType: 'image/svg+xml', truncated: false, totalBytes: source.length },
      format: 'svg',
    })} />)
    expect(screen.getByAltText('diagram.svg').getAttribute('src')).toBe('blob:fake')
    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/svg+xml' }))
  })

  it('edits an SVG document as its decoded UTF-8 source', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><text>你好</text></svg>'
    const onBufferChange = vi.fn()
    render(<FilePreview {...preview({
      node: node('diagram.svg', 'image'),
      read: { path: 'diagram.svg', base64: textToBase64(source), contentType: 'image/svg+xml', truncated: false, totalBytes: source.length },
      format: 'svg',
      editing: true,
      buffer: source,
      onBufferChange,
    })} />)
    const textarea = screen.getByTestId('aida-canvas-edit') as HTMLTextAreaElement
    expect(textarea.value).toBe(source)
    fireEvent.change(textarea, { target: { value: '<svg><circle r="1"/></svg>' } })
    expect(onBufferChange).toHaveBeenCalledWith('<svg><circle r="1"/></svg>')
    expect(screen.getByTestId('aida-canvas-save').textContent).toBe('保存')
  })

  it('shows the loading placeholder while an SVG source read is pending', () => {
    render(<FilePreview {...preview({
      node: node('diagram.svg', 'image'),
      format: 'svg',
      editing: true,
      buffer: '',
    })} />)
    expect(screen.getByText('加载中…')).toBeTruthy()
  })

  it('offers download-only for an SVG read without a payload', () => {
    render(<FilePreview {...preview({
      node: node('broken.svg', 'image'),
      read: { path: 'broken.svg', truncated: false, totalBytes: 4 },
      format: 'svg',
    })} />)
    expect(screen.getByText('二进制文件仅支持下载')).toBeTruthy()
  })

  it('renders valid JSON files as the collapsible tree', () => {
    render(<FilePreview {...preview({
      node: node('data.json', 'text'),
      read: { path: 'data.json', content: '{"name": "aida", "items": [1, 2]}', truncated: false, totalBytes: 30 },
      format: 'json',
    })} />)
    const tree = screen.getByTestId('aida-canvas-json')
    expect(tree.textContent).toContain('name')
    expect(tree.textContent).toContain('aida')
    // Hovering a row mounts the copy button, whose tooltip uses the localized
    // copy-title formatter.
    fireEvent.mouseOver(tree.querySelector('[data-json-root-row]')!)
    expect(tree.querySelector('[data-json-copy-button]')).toBeTruthy()
  })

  it('falls back to the raw content when JSON cannot render as a tree', () => {
    render(<FilePreview {...preview({
      node: node('broken.json', 'text'),
      read: { path: 'broken.json', content: '{nope', truncated: false, totalBytes: 5 },
      format: 'json',
    })} />)
    const fallback = screen.getByTestId('aida-canvas-json-error')
    expect(fallback.querySelector('[role="alert"]')?.textContent).toBe('无法以树形预览，以下为原始内容')
    expect(fallback.querySelector('pre')?.textContent).toBe('{nope')
  })

  it('falls back for scalar JSON values', () => {
    render(<FilePreview {...preview({
      node: node('scalar.json', 'text'),
      read: { path: 'scalar.json', content: '42', truncated: false, totalBytes: 2 },
      format: 'json',
    })} />)
    expect(screen.getByTestId('aida-canvas-json-error')).toBeTruthy()
  })

  it('renders CSV files as a table with quoted fields', () => {
    const { container } = render(<FilePreview {...preview({
      node: node('data.csv', 'text'),
      read: { path: 'data.csv', content: 'a,"b,1"\n1,2\n', truncated: false, totalBytes: 10 },
      format: 'csv',
    })} />)
    const table = screen.getByTestId('aida-canvas-csv')
    expect(table.textContent).toContain('a')
    expect(table.textContent).toContain('b,1')
    expect(container.querySelectorAll('td')).toHaveLength(4)
  })

  it('pads ragged CSV rows to the widest row', () => {
    render(<FilePreview {...preview({
      node: node('ragged.csv', 'text'),
      read: { path: 'ragged.csv', content: 'a\n1,2\n', truncated: false, totalBytes: 6 },
      format: 'csv',
    })} />)
    const cells = screen.getByTestId('aida-canvas-csv').querySelectorAll('td')
    expect(cells).toHaveLength(4)
    expect(cells[0]!.textContent).toBe('a')
    expect(cells[1]!.textContent).toBe('')
  })

  it('renders TSV files with the tab delimiter', () => {
    render(<FilePreview {...preview({
      node: node('data.tsv', 'text'),
      read: { path: 'data.tsv', content: 'a\tb\n1\t2\n', truncated: false, totalBytes: 6 },
      format: 'csv',
    })} />)
    const table = screen.getByTestId('aida-canvas-csv')
    expect(table.querySelectorAll('td')).toHaveLength(4)
    expect(table.textContent).toContain('1')
  })

  it('shows the empty-table message for a CSV without rows', () => {
    render(<FilePreview {...preview({
      node: node('empty.csv', 'text'),
      read: { path: 'empty.csv', content: '', truncated: false, totalBytes: 0 },
      format: 'csv',
    })} />)
    expect(screen.getByTestId('aida-canvas-csv-empty').textContent).toBe('没有可展示的行')
  })

  it('renders source code files through the shared syntax-highlighted block', () => {
    render(<FilePreview {...preview({
      node: node('main.ts', 'text'),
      read: { path: 'main.ts', content: 'const x: number = 1', truncated: false, totalBytes: 20 },
      format: 'code',
    })} />)
    const wrap = screen.getByTestId('aida-canvas-code')
    expect(wrap.querySelector('pre')?.textContent).toContain('const x: number = 1')
  })

  it('offers download-only when an image read has no payload', () => {
    render(<FilePreview {...preview({
      node: node('broken.png', 'image'),
      read: { path: 'broken.png', truncated: false, totalBytes: 4 },
    })} />)
    expect(screen.getByText('二进制文件仅支持下载')).toBeTruthy()
  })

  it('renders a PDF preview in an iframe and revokes its object URL on unmount', () => {
    const { container, unmount } = render(<FilePreview {...preview({
      node: node('doc.pdf', 'pdf'),
      read: { path: 'doc.pdf', base64: 'JVBERi0=', truncated: false, totalBytes: 4 },
    })} />)
    const frame = container.querySelector('iframe')
    expect(frame).not.toBeNull()
    expect(frame?.getAttribute('src')).toBe('blob:fake')
    expect(frame?.getAttribute('title')).toBe('PDF')
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })

  it('falls back to an empty payload when a PDF read lacks a base64 body', () => {
    const { container } = render(<FilePreview {...preview({
      node: node('blank.pdf', 'pdf'),
      read: { path: 'blank.pdf', base64: null as never, truncated: false, totalBytes: 0 },
    })} />)
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe('blob:fake')
  })

  it('downloads a binary file through its download button', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<FilePreview {...preview({
      node: node('data.bin', 'binary'),
      read: { path: 'data.bin', base64: 'aGk=', contentType: 'application/octet-stream', truncated: false, totalBytes: 2 },
    })} />)
    expect(screen.getByText('二进制文件仅支持下载')).toBeTruthy()
    const button = screen.getByText('下载 data.bin') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'application/octet-stream' }))
  })

  it('uses the octet-stream fallback type for binary payloads without a content type', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<FilePreview {...preview({
      node: node('data.bin', 'binary'),
      read: { path: 'data.bin', base64: 'aGk=', truncated: false, totalBytes: 2 },
    })} />)
    fireEvent.click(screen.getByText('下载 data.bin'))
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'application/octet-stream' }))
  })

  it('does nothing when the binary payload disappears before the click lands', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const read: WorkspaceFileRead = { path: 'data.bin', base64: 'aGk=', truncated: false, totalBytes: 2 }
    render(<FilePreview {...preview({
      node: node('data.bin', 'binary'),
      read,
    })} />)
    const button = screen.getByText('下载 data.bin') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    // The download guard also protects a stale read whose payload vanished
    // between renders; the button was enabled at render time, so the click
    // still reaches the handler, which must decline the download.
    delete read.base64
    fireEvent.click(button)
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('disables the download button for binary files without a payload', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<FilePreview {...preview({
      node: node('data.bin', 'binary'),
      read: { path: 'data.bin', truncated: false, totalBytes: 2 },
    })} />)
    const button = screen.getByText('下载 data.bin') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('offers download-only for Office files without a preview payload', () => {
    render(<FilePreview {...preview({
      node: node('data.xlsx', 'office'),
      read: null,
    })} />)
    expect(screen.getByText('Office 文档仅支持下载查看')).toBeTruthy()
    expect((screen.getByText('下载 data.xlsx') as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders Office workbook previews as sheet tables', () => {
    const workbook = JSON.stringify({
      __office: 'workbook',
      sheets: [
        { name: 'Sheet1', rows: [['a', 'b'], ['1', '2']] },
        { rows: [['x']] },
      ],
    })
    const { container } = render(<FilePreview {...preview({
      node: node('data.xlsx', 'office'),
      read: { path: 'data.xlsx', content: workbook, truncated: false, totalBytes: workbook.length },
    })} />)
    const sheet = screen.getByTestId('aida-canvas-sheet')
    expect(sheet.textContent).toContain('Sheet1')
    expect(sheet.textContent).toContain('a')
    expect(sheet.textContent).toContain('2')
    expect(container.querySelectorAll('table')).toHaveLength(2)
  })

  it('renders non-JSON Office content as plain text', () => {
    render(<FilePreview {...preview({
      node: node('notes.rtf', 'office'),
      read: { path: 'notes.rtf', content: 'plain text', truncated: false, totalBytes: 10 },
    })} />)
    expect(screen.getByTestId('aida-canvas-office-text').textContent).toBe('plain text')
  })

  it('treats valid non-workbook JSON as plain text', () => {
    render(<FilePreview {...preview({
      node: node('meta.json', 'office'),
      read: { path: 'meta.json', content: '{"foo": 1}', truncated: false, totalBytes: 10 },
    })} />)
    expect(screen.getByTestId('aida-canvas-office-text').textContent).toBe('{"foo": 1}')
  })

  it('treats an Office read without content as an empty text document', () => {
    render(<FilePreview {...preview({
      node: node('blank.xlsx', 'office'),
      read: { path: 'blank.xlsx', content: null as never, truncated: false, totalBytes: 0 },
    })} />)
    expect(screen.getByTestId('aida-canvas-office-text').textContent).toBe('')
  })

  it('renders plain text files in a read-only preview', () => {
    render(<FilePreview {...preview({
      node: node('notes.txt', 'text'),
      read: { path: 'notes.txt', content: 'hello text', truncated: false, totalBytes: 10 },
      format: 'text',
    })} />)
    expect(screen.getByTestId('aida-canvas-preview').textContent).toBe('hello text')
  })

  it('renders markdown files as formatted documents', () => {
    render(<FilePreview {...preview({
      node: node('README.md', 'text'),
      read: { path: 'README.md', content: '# Title\n\n- one\n', truncated: false, totalBytes: 14 },
      format: 'markdown',
    })} />)
    const doc = screen.getByTestId('aida-canvas-markdown')
    expect(doc.querySelector('h1')?.textContent).toBe('Title')
  })

  it('renders HTML files in a sandboxed iframe', () => {
    render(<FilePreview {...preview({
      node: node('page.html', 'text'),
      read: { path: 'page.html', content: '<h1>Hi</h1>', truncated: false, totalBytes: 12 },
      format: 'html',
    })} />)
    const stage = screen.getByTestId('aida-canvas-html')
    const frame = stage.querySelector('iframe')
    expect(frame).not.toBeNull()
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame?.getAttribute('srcdoc')).toBe('<h1>Hi</h1>')
  })

  it('renders mermaid files through the diagram stage', async () => {
    render(<FilePreview {...preview({
      node: node('flow.mmd', 'text'),
      read: { path: 'flow.mmd', content: 'flowchart LR\n  A --> B\n', truncated: false, totalBytes: 20 },
      format: 'mermaid',
    })} />)
    // The mermaid runtime is lazily imported; the stage (or its error
    // fallback) must mount. The lazy import is slow under coverage
    // instrumentation, so the wait outlives the default test timeout.
    await waitFor(() => {
      expect(screen.getByTestId('aida-canvas-mermaid') || screen.getByTestId('aida-canvas-mermaid-error')).toBeTruthy()
    }, { timeout: 20000 })
  }, 25000)

  it('shows the loading placeholder while the text read is pending', () => {
    render(<FilePreview {...preview({
      node: node('notes.txt', 'text'),
      read: null,
      format: 'text',
    })} />)
    expect(screen.getByText('加载中…')).toBeTruthy()
  })

  it('surfaces the read error in an alert', () => {
    render(<FilePreview {...preview({
      node: node('notes.txt', 'text'),
      read: null,
      error: '读取失败',
      format: 'text',
    })} />)
    expect(screen.getByRole('alert').textContent).toBe('读取失败')
  })

  it('edits a text file in a textarea and saves through the button and the Ctrl/⌘+S shortcut', () => {
    const onBufferChange = vi.fn()
    const onSave = vi.fn()
    const base = {
      node: node('notes.txt', 'text'),
      read: { path: 'notes.txt', content: 'hello', truncated: false, totalBytes: 5 },
      format: 'text' as const,
      editing: true,
      buffer: 'hello',
      onBufferChange,
      onSave,
    }
    const { rerender } = render(<FilePreview {...preview(base)} />)
    const textarea = screen.getByTestId('aida-canvas-edit') as HTMLTextAreaElement
    expect(textarea.value).toBe('hello')
    expect(screen.getByText('Ctrl/⌘+S 保存')).toBeTruthy()
    const save = screen.getByTestId('aida-canvas-save') as HTMLButtonElement
    expect(save.disabled).toBe(false)
    expect(save.textContent).toBe('保存')

    fireEvent.change(textarea, { target: { value: 'edited' } })
    expect(textarea.value).toBe('edited')
    expect(onBufferChange).toHaveBeenCalledWith('edited')

    fireEvent.click(save)
    expect(onSave).toHaveBeenCalledTimes(1)

    // Ctrl+S saves and prevents the browser default.
    const ctrlS = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    const preventDefault = vi.spyOn(ctrlS, 'preventDefault')
    fireEvent(textarea, ctrlS)
    expect(preventDefault).toHaveBeenCalled()
    expect(onSave).toHaveBeenCalledTimes(2)

    // Meta+S saves too.
    fireEvent.keyDown(textarea, { key: 's', metaKey: true })
    expect(onSave).toHaveBeenCalledTimes(3)

    // A non-shortcut key does not save.
    fireEvent.keyDown(textarea, { key: 'a', ctrlKey: true })
    expect(onSave).toHaveBeenCalledTimes(3)

    // The draft re-syncs when the buffer changes from outside.
    rerender(<FilePreview {...preview({ ...base, buffer: 'new-buffer' })} />)
    expect(textarea.value).toBe('new-buffer')
  })

  it('blocks the save shortcut and disables the button while a save is in flight', () => {
    const onSave = vi.fn()
    render(<FilePreview {...preview({
      node: node('notes.txt', 'text'),
      read: { path: 'notes.txt', content: 'hello', truncated: false, totalBytes: 5 },
      format: 'text',
      editing: true,
      buffer: 'hello',
      saving: true,
      onSave,
    })} />)
    const save = screen.getByTestId('aida-canvas-save') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(save.textContent).toBe('保存中…')
    fireEvent.keyDown(screen.getByTestId('aida-canvas-edit'), { key: 's', ctrlKey: true })
    expect(onSave).not.toHaveBeenCalled()
  })
})
