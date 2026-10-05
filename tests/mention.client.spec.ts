// @vitest-environment jsdom
// AIDA workspace-file mention: the ref/codec pure helpers, the '@' source's
// candidate/lexicon/pick behavior against stubbed workspaces + sessions, and
// the composer injection helpers against a stubbed conversation shell.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceFileListing, WorkspaceFileNode } from '../src/workspace-protocol.ts'
import {
  createFileMentionSource, FILE_MENTION_SOURCE, fileModelForm, fileReference,
  flattenTextFiles, lastMentionBySession, MAX_MENTION_CHARS, mentionFileIntoComposer, mentionRef,
  quoteBlock, quoteSelectionIntoComposer, splitMentionRef,
} from '../src/client/canvas/mention.ts'

// The mention dedup memo is module-level; a fresh case must not inherit the
// previous case's last-insert state.
beforeEach(() => { lastMentionBySession.clear() })

const sid = (id: string) => id as SessionId
const SID = sid('s1')
const ROOT = '/projects/one'

function sessionsState(): SessionListState {
  return {
    ids: [SID],
    byId: { [SID]: { id: SID, displayTitle: 'proj', cwd: ROOT, running: false, blank: false, updatedAt: 1 } },
    current: SID,
    phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }
}

function listing(...files: WorkspaceFileNode[]): WorkspaceFileListing {
  return { root: ROOT, files, truncated: false }
}

/** A recording composer shell shaped like the conversation service's session shell. */
function fakeShell(initialDraft = '') {
  const state = { draft: initialDraft, draftRev: 1 }
  const insertReference = vi.fn(() => true)
  const setDraft = vi.fn((text: string) => { state.draft = text; state.draftRev += 1 })
  return {
    state: { getSnapshot: () => ({ draft: state.draft, draftRev: state.draftRev }) },
    insertReference,
    setDraft,
  }
}

/** Assemble the minimal client context the mention helpers and source read. */
function bench(options: { listing?: WorkspaceFileListing; read?: { path: string; content: string } } = {}) {
  const shell = fakeShell()
  const sessions = {
    list: createSnapshotStore<SessionListState>(sessionsState()),
    scope: vi.fn(() => ({ sessionId: SID })),
  }
  const listFiles = vi.fn(async () => options.listing ?? listing())
  const readFile = vi.fn(async (_root: string, path: string) => ({
    path, content: options.read?.path === path ? options.read.content : `content of ${path}`, truncated: false, totalBytes: 10,
  }))
  const workspaces = { listFiles, readFile }
  const conversation = { input: { for: vi.fn(() => shell) } }
  // The current-Session selection lives on the uiSession adapter in dsh 0.2.0.
  const uiSession = { adapter: { current: { getSnapshot: () => ({ key: SID }) } } }
  const ctx = {
    sessions,
    uiSession,
    workspaces,
    get: (name: string) => (name === 'conversation' ? conversation : undefined),
  } as unknown as ClientContext
  return { ctx, shell, listFiles, readFile, conversation }
}

/** Create a source with the bench's legacy-shaped file methods as an explicit transport. */
function mentionSource(ctx: ClientContext) {
  const workspace = (ctx as unknown as {
    workspaces: Parameters<typeof createFileMentionSource>[1]
  }).workspaces
  return createFileMentionSource(ctx, workspace)
}

describe('AIDA mention refs and model forms', () => {
  it('flattens text files in tree order and skips non-text entries', () => {
    const tree: WorkspaceFileNode[] = [
      { name: 'src', path: 'src', kind: 'folder', children: [
        { name: 'a.ts', path: 'src/a.ts', kind: 'text' },
        { name: 'logo.png', path: 'src/logo.png', kind: 'image' },
      ] },
      { name: 'empty', path: 'empty', kind: 'folder' },
      { name: 'README.md', path: 'README.md', kind: 'text' },
    ]
    expect(flattenTextFiles(tree)).toEqual(['src/a.ts', 'README.md'])
  })

  it('encodes and splits root-qualified refs', () => {
    expect(splitMentionRef(mentionRef(ROOT, 'notes/a.md'))).toEqual({ root: ROOT, path: 'notes/a.md' })
    // The fallback arm: a ref without the separator is treated as path-only.
    expect(splitMentionRef('bare.md')).toEqual({ root: '', path: 'bare.md' })
    expect(fileReference(ROOT, 'notes/a.md')).toEqual({
      source: FILE_MENTION_SOURCE,
      ref: mentionRef(ROOT, 'notes/a.md'),
      label: 'notes/a.md',
      clipboardText: '@notes/a.md',
    })
  })

  it('embeds content in the model form and cuts oversized files with a marker', () => {
    expect(fileModelForm('a.md', 'hello')).toBe('[file: a.md]\nhello\n[/file]')
    const big = 'x'.repeat(MAX_MENTION_CHARS + 10)
    const form = fileModelForm('a.md', big)
    expect(form).toContain('x'.repeat(MAX_MENTION_CHARS))
    expect(form).toContain('[/file]')
    expect(form).toContain('已截断')
  })

  it('quotes selections as labeled blockquote lines', () => {
    expect(quoteBlock('a.md', 'line1\nline2')).toBe('> [引用自 a.md]\n> line1\n> line2\n')
  })
})

describe('AIDA file mention source', () => {
  it('lists the session files as candidates and filters by query', async () => {
    const { ctx } = bench({
      listing: listing(
        { name: 'README.md', path: 'README.md', kind: 'text' },
        { name: 'notes', path: 'notes', kind: 'folder', children: [{ name: 'plan.md', path: 'notes/plan.md', kind: 'text' }] },
      ),
    })
    const source = mentionSource(ctx)
    const session = { sessionId: SID }
    const all = await source.candidates(session, { query: '', position: 'leading', signal: new AbortController().signal })
    expect(all.map(item => item.name)).toEqual(['README.md', 'notes/plan.md'])
    const filtered = await source.candidates(session, { query: 'plan', position: 'leading', signal: new AbortController().signal })
    expect(filtered.map(item => item.name)).toEqual(['notes/plan.md'])
  })

  it('picks into a root-qualified insert and serializes the file content', async () => {
    const { ctx, readFile } = bench({
      listing: listing({ name: 'a.md', path: 'a.md', kind: 'text' }),
      read: { path: 'a.md', content: '# plan' },
    })
    const source = mentionSource(ctx)
    const session = { sessionId: SID }
    const outcome = source.onPick({
      candidate: { name: 'a.md' },
      session,
      position: 'leading',
      via: 'menu',
      span: { start: 0, end: 2, draftRev: 1 },
    })
    expect(outcome).toEqual({ insert: fileReference(ROOT, 'a.md') })
    const model = await source.codec!.serialize((outcome as { insert: { ref: string } }).insert.ref, new AbortController().signal)
    expect(model).toBe('[file: a.md]\n# plan\n[/file]')
    expect(readFile).toHaveBeenCalledWith(ROOT, 'a.md', {}, expect.anything())
  })

  it('warms the lexicon roll and reports undefined before the first listing settles', async () => {
    const { ctx } = bench({ listing: listing({ name: 'a.md', path: 'a.md', kind: 'text' }) })
    const source = mentionSource(ctx)
    const session = { sessionId: SID }
    expect(source.lexicon!(session)).toBeUndefined()
    source.warm!(session)
    await vi.waitFor(() =>{  expect(source.lexicon!(session)).toEqual(['a.md']) })
  })

  it('drops the listener set when the last subscriber unsubscribes', async () => {
    const { ctx } = bench({ listing: listing({ name: 'a.md', path: 'a.md', kind: 'text' }) })
    const source = mentionSource(ctx)
    const listener = vi.fn()
    const unsubscribe = source.subscribeLexicon!({ sessionId: SID }, listener)
    source.warm!({ sessionId: SID })
    await vi.waitFor(() =>{  expect(listener).toHaveBeenCalled() })
    unsubscribe()
    // Unsubscribing the only listener removes the empty set; a later refresh
    // no longer reaches it.
    const calls = listener.mock.calls.length
    source.warm!({ sessionId: SID })
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    expect(listener.mock.calls.length).toBe(calls)
  })

  it('notifies lexicon subscribers when the roll refreshes', async () => {
    const { ctx } = bench({ listing: listing({ name: 'a.md', path: 'a.md', kind: 'text' }) })
    const source = mentionSource(ctx)
    const listener = vi.fn()
    const second = vi.fn()
    const unsubscribe = source.subscribeLexicon!({ sessionId: SID }, listener)
    source.subscribeLexicon!({ sessionId: SID }, second)
    source.warm!({ sessionId: SID })
    await vi.waitFor(() =>{  expect(listener).toHaveBeenCalled() })
    unsubscribe()
    // One subscriber remains, so the listener set is kept; the second
    // subscriber still receives later refreshes.
    const before = listener.mock.calls.length
    source.warm!({ sessionId: SID })
    await vi.waitFor(() =>{  expect(second.mock.calls.length).toBeGreaterThan(before) })
    // The clipboard projection of a mention ref is the plain `@path` literal.
    expect(source.codec!.clipboardText(mentionRef(ROOT, 'a.md'))).toBe('@a.md')
  })

  it('yields an empty menu without a session workspace root', async () => {
    const sessions = {
      list: createSnapshotStore<SessionListState>({ ...sessionsState(), byId: {} }),
      scope: vi.fn(),
    }
    const ctx = { sessions, workspaces: { listFiles: vi.fn(), readFile: vi.fn() }, get: () => undefined } as unknown as ClientContext
    const source = mentionSource(ctx)
    const items = await source.candidates({ sessionId: SID }, { query: '', position: 'leading', signal: new AbortController().signal })
    expect(items).toEqual([])
  })

  it('returns no candidates once the request signal aborts', async () => {
    const { ctx } = bench({ listing: listing({ name: 'a.md', path: 'a.md', kind: 'text' }) })
    const source = mentionSource(ctx)
    const controller = new AbortController()
    const pending = source.candidates({ sessionId: SID }, { query: '', position: 'leading', signal: controller.signal })
    controller.abort()
    expect(await pending).toEqual([])
  })

  it('keeps the last warm roll when a listing refresh fails', async () => {
    const { ctx, listFiles } = bench({ listing: listing({ name: 'a.md', path: 'a.md', kind: 'text' }) })
    const source = mentionSource(ctx)
    source.warm!({ sessionId: SID })
    await vi.waitFor(() =>{  expect(source.lexicon!({ sessionId: SID })).toEqual(['a.md']) })
    listFiles.mockRejectedValueOnce(new Error('listing failed'))
    const items = await source.candidates({ sessionId: SID }, { query: '', position: 'leading', signal: new AbortController().signal })
    expect(items.map(item => item.name)).toEqual(['a.md'])
  })

  it('dedupes concurrent listing refreshes per session', async () => {
    const { ctx, listFiles } = bench({ listing: listing({ name: 'a.md', path: 'a.md', kind: 'text' }) })
    const source = mentionSource(ctx)
    source.warm!({ sessionId: SID })
    const items = await source.candidates({ sessionId: SID }, { query: '', position: 'leading', signal: new AbortController().signal })
    expect(items.map(item => item.name)).toEqual(['a.md'])
    expect(listFiles).toHaveBeenCalledTimes(1)
  })

  it('falls back to an empty menu when the listing fails before any warm', async () => {
    const { ctx, listFiles } = bench({ listing: listing({ name: 'a.md', path: 'a.md', kind: 'text' }) })
    listFiles.mockRejectedValueOnce(new Error('boom'))
    const source = mentionSource(ctx)
    const items = await source.candidates({ sessionId: SID }, { query: '', position: 'leading', signal: new AbortController().signal })
    expect(items).toEqual([])
  })

  it('warm without a workspace root never fetches', async () => {
    const sessions = {
      list: createSnapshotStore<SessionListState>({ ...sessionsState(), byId: {} }),
      scope: vi.fn(),
    }
    const listFiles = vi.fn(async () => listing())
    const ctx = { sessions, workspaces: { listFiles, readFile: vi.fn() }, get: () => undefined } as unknown as ClientContext
    const source = mentionSource(ctx)
    source.warm!({ sessionId: SID })
    expect(listFiles).not.toHaveBeenCalled()
  })

  it('picks without a workspace root miss the default sink', () => {
    const sessions = {
      list: createSnapshotStore<SessionListState>({ ...sessionsState(), byId: {} }),
      scope: vi.fn(),
    }
    const ctx = { sessions, workspaces: { listFiles: vi.fn(), readFile: vi.fn() }, get: () => undefined } as unknown as ClientContext
    const source = mentionSource(ctx)
    expect(source.onPick({ candidate: { name: 'a.md' }, session: { sessionId: SID }, position: 'leading', via: 'menu', span: { start: 0, end: 1, draftRev: 1 } })).toBeUndefined()
  })

  it('serializes a content-less read as an empty file body', async () => {
    const sessions = {
      list: createSnapshotStore<SessionListState>(sessionsState()),
      scope: vi.fn(() => ({ sessionId: SID })),
    }
    const workspaces = {
      listFiles: vi.fn(async () => listing({ name: 'a.md', path: 'a.md', kind: 'text' })),
      readFile: vi.fn(async () => ({ path: 'a.md', truncated: false, totalBytes: 0 })),
    }
    const ctx = { sessions, workspaces, get: () => undefined } as unknown as ClientContext
    const source = mentionSource(ctx)
    const model = await source.codec!.serialize(mentionRef(ROOT, 'a.md'), new AbortController().signal)
    expect(model).toBe('[file: a.md]\n\n[/file]')
  })
})

describe('AIDA composer injection', () => {
  it('mentions a file by inserting a chip at the end of the draft with a CAS span', () => {
    const { ctx, shell, conversation } = bench()
    const ok = mentionFileIntoComposer(ctx, 'notes/a.md')
    expect(ok).toBe(true)
    expect(shell.insertReference).toHaveBeenCalledWith(
      fileReference(ROOT, 'notes/a.md'),
      { start: 0, end: 0, draftRev: 1 },
    )
    expect(conversation.input.for).toHaveBeenCalled()
  })

  it('reports a rejected insert without recording the dedup memo', () => {
    const { ctx, shell } = bench()
    shell.insertReference.mockReturnValueOnce(false)
    expect(mentionFileIntoComposer(ctx, 'notes/a.md')).toBe(false)
    // The failed insert is not memoized, so a retry inserts normally.
    expect(mentionFileIntoComposer(ctx, 'notes/a.md')).toBe(true)
    expect(shell.insertReference).toHaveBeenCalledTimes(2)
  })

  it('dedupes a consecutive mention of the same file and inserts after an intervening change', () => {
    const { ctx, shell } = bench()
    expect(mentionFileIntoComposer(ctx, 'notes/a.md')).toBe(true)
    expect(shell.insertReference).toHaveBeenCalledTimes(1)
    // The same file again with no draft change in between inserts nothing.
    expect(mentionFileIntoComposer(ctx, 'notes/a.md')).toBe(true)
    expect(shell.insertReference).toHaveBeenCalledTimes(1)
    // A different file inserts again; then the original file is no longer
    // consecutive, so it inserts too.
    expect(mentionFileIntoComposer(ctx, 'b.md')).toBe(true)
    expect(shell.insertReference).toHaveBeenCalledTimes(2)
    expect(mentionFileIntoComposer(ctx, 'notes/a.md')).toBe(true)
    expect(shell.insertReference).toHaveBeenCalledTimes(3)
    // An intervening draft change defeats the dedup for a repeated file.
    shell.setDraft('typed between')
    expect(mentionFileIntoComposer(ctx, 'b.md')).toBe(true)
    expect(shell.insertReference).toHaveBeenCalledTimes(4)
  })

  it('quotes a selection by appending a labeled blockquote', () => {
    const { ctx, shell } = bench()
    shell.setDraft('hello')
    const ok = quoteSelectionIntoComposer(ctx, 'notes/a.md', 'line1\nline2')
    expect(ok).toBe(true)
    expect(shell.setDraft).toHaveBeenCalledWith('hello\n> [引用自 notes/a.md]\n> line1\n> line2\n')
  })

  it('seeds an empty draft with the quoted block', () => {
    const { ctx, shell } = bench()
    const ok = quoteSelectionIntoComposer(ctx, 'notes/a.md', 'line1')
    expect(ok).toBe(true)
    expect(shell.setDraft).toHaveBeenCalledWith('> [引用自 notes/a.md]\n> line1\n')
  })

  it('does not double the newline when the draft already ends with one', () => {
    const { ctx, shell } = bench()
    shell.setDraft('line1\n')
    const ok = quoteSelectionIntoComposer(ctx, 'notes/a.md', 'line2')
    expect(ok).toBe(true)
    expect(shell.setDraft).toHaveBeenCalledWith('line1\n> [引用自 notes/a.md]\n> line2\n')
  })

  it('declines when the conversation service is absent', () => {
    const sessions = {
      list: createSnapshotStore<SessionListState>(sessionsState()),
      scope: vi.fn(),
    }
    const ctx = { sessions, workspaces: { listFiles: vi.fn(), readFile: vi.fn() }, get: () => undefined } as unknown as ClientContext
    expect(mentionFileIntoComposer(ctx, 'a.md')).toBe(false)
  })

  it('declines without a current session', () => {
    const sessions = {
      list: createSnapshotStore<SessionListState>({ ...sessionsState(), current: undefined }),
      scope: vi.fn(),
    }
    const conversation = { input: { for: vi.fn() } }
    const ctx = { sessions, workspaces: { listFiles: vi.fn(), readFile: vi.fn() }, get: (name: string) => (name === 'conversation' ? conversation : undefined) } as unknown as ClientContext
    expect(mentionFileIntoComposer(ctx, 'a.md')).toBe(false)
    expect(quoteSelectionIntoComposer(ctx, 'a.md', 'x')).toBe(false)
    expect(conversation.input.for).not.toHaveBeenCalled()
  })

  it('declines when the current session carries no workspace root', () => {
    const sessions = {
      list: createSnapshotStore<SessionListState>({
        ...sessionsState(),
        byId: { [SID]: { id: SID, displayTitle: 'proj', running: false, blank: false, updatedAt: 1 } },
      }),
      scope: vi.fn(),
    }
    const conversation = { input: { for: vi.fn() } }
    const ctx = { sessions, workspaces: { listFiles: vi.fn(), readFile: vi.fn() }, get: (name: string) => (name === 'conversation' ? conversation : undefined) } as unknown as ClientContext
    expect(mentionFileIntoComposer(ctx, 'a.md')).toBe(false)
    expect(conversation.input.for).not.toHaveBeenCalled()
  })

  it('declines when the session scope is not materialized', () => {
    const sessions = {
      list: createSnapshotStore<SessionListState>(sessionsState()),
      scope: vi.fn(() => undefined),
    }
    const conversation = { input: { for: vi.fn() } }
    const ctx = { sessions, workspaces: { listFiles: vi.fn(), readFile: vi.fn() }, get: (name: string) => (name === 'conversation' ? conversation : undefined) } as unknown as ClientContext
    expect(quoteSelectionIntoComposer(ctx, 'a.md', 'x')).toBe(false)
  })
})
