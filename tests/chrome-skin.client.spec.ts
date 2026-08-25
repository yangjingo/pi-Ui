// @vitest-environment jsdom
// AIDA chrome skin: the Project vocabulary mapping, the hidden center-column
// trajectory surface (view-ring tab + mounted view), the relocated session-log
// header action, and the combined reconciliation.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import {
  applyProjectVocabulary,
  findSessionLogButtons,
  findViewTablist,
  isProjectRename,
  projectText,
  reconcileChrome,
  setHidden,
  startChromeSkin,
} from '../src/client/skin/chrome.ts'

afterEach(() => { cleanup() })

/** The session-header utilities seat with a session-log button + a canvas toggle. */
function utilitiesSeat(root: HTMLElement, logLabel = 'Session log'): { seat: HTMLDivElement; log: HTMLButtonElement; toggle: HTMLButtonElement } {
  const seat = document.createElement('div')
  seat.setAttribute('data-slot', 'conversation.session.header.utilities')
  const log = document.createElement('button')
  log.textContent = logLabel
  const toggle = document.createElement('button')
  toggle.textContent = '画布'
  seat.append(log, toggle)
  root.appendChild(seat)
  return { seat, log, toggle }
}

/** The session header with the view-ring tab nav (chat + trajectory tabs). */
function headerWithTabs(root: HTMLElement): { header: HTMLElement; tablist: HTMLElement; chat: HTMLButtonElement; trajectory: HTMLButtonElement } {
  const header = document.createElement('div')
  header.setAttribute('data-slot', 'conversation.session.header')
  const tablist = document.createElement('div')
  tablist.setAttribute('role', 'tablist')
  const chat = document.createElement('button')
  chat.setAttribute('role', 'tab')
  chat.textContent = '对话'
  const trajectory = document.createElement('button')
  trajectory.setAttribute('role', 'tab')
  trajectory.textContent = '轨迹'
  tablist.append(chat, trajectory)
  header.appendChild(tablist)
  root.appendChild(header)
  return { header, tablist, chat, trajectory }
}

describe('project vocabulary', () => {
  it('maps en and zh workspace labels to project', () => {
    expect(projectText('Workspaces')).toBe('Projects')
    expect(projectText('Add workspace')).toBe('Add project')
    expect(projectText('工作区')).toBe('项目')
    expect(projectText('添加工作区')).toBe('添加项目')
    expect(projectText('Choose workspace')).toBe('Choose project')
    expect(projectText('workspace files')).toBe('project files')
    expect(isProjectRename('Workspaces')).toBe(true)
    expect(isProjectRename('Projects')).toBe(false)
  })

  it('rewrites text nodes and label attributes inside a scope slot', () => {
    const slot = document.createElement('div')
    slot.setAttribute('data-slot', 'sidebar.workspaces')
    slot.setAttribute('aria-label', 'Workspaces')
    const span = document.createElement('span')
    span.textContent = 'Add workspace'
    slot.appendChild(span)

    expect(applyProjectVocabulary(slot)).toBe(true)
    expect(slot.getAttribute('aria-label')).toBe('Projects')
    expect(span.textContent).toBe('Add project')
  })
})

describe('trajectory surface hiding', () => {
  it('hides the whole view-ring tab nav (the lone chat tab)', () => {
    const root = document.createElement('div')
    const { tablist, chat } = headerWithTabs(root)
    expect(findViewTablist(root)).toBe(tablist)
    expect(reconcileChrome(root)).toBe(true)
    expect(tablist.style.display).toBe('none')
    expect(chat.style.display).toBe('')
  })

  it('hides the mounted center-column trajectory view', () => {
    const root = document.createElement('div')
    const view = document.createElement('div')
    view.setAttribute('data-conversation-composer-overlay', '')
    root.appendChild(view)
    expect(reconcileChrome(root)).toBe(true)
    expect(view.style.display).toBe('none')
    // Already hidden: the second pass reports no change.
    expect(reconcileChrome(root)).toBe(false)
  })

  it('keeps the trajectory view alive inside the canvas panel', () => {
    const root = document.createElement('div')
    const panel = document.createElement('div')
    panel.setAttribute('data-testid', 'aida-canvas-panel')
    const inside = document.createElement('div')
    inside.setAttribute('data-conversation-composer-overlay', '')
    panel.appendChild(inside)
    root.appendChild(panel)
    const outside = document.createElement('div')
    outside.setAttribute('data-conversation-composer-overlay', '')
    root.appendChild(outside)
    expect(reconcileChrome(root)).toBe(true)
    expect(inside.style.display).toBe('')
    expect(outside.style.display).toBe('none')
  })

  it('hides the original session-log header button and preserves the canvas toggle', () => {
    const root = document.createElement('div')
    const { log, toggle } = utilitiesSeat(root)
    expect(reconcileChrome(root)).toBe(true)
    expect(log.style.display).toBe('none')
    expect(toggle.style.display).toBe('')
  })

  it('is idempotent and only reports changes', () => {
    const root = document.createElement('div')
    headerWithTabs(root)
    utilitiesSeat(root)
    expect(reconcileChrome(root)).toBe(true)
    expect(reconcileChrome(root)).toBe(false)
  })

  it('locates and hides the zh session-log label', () => {
    const root = document.createElement('div')
    const { log } = utilitiesSeat(root, '会话日志')
    expect(findSessionLogButtons(root)).toEqual([log])
    expect(reconcileChrome(root)).toBe(true)
    expect(log.style.display).toBe('none')
  })

  it('reconciles the Project vocabulary through the scope slots', () => {
    const root = document.createElement('div')
    const slot = document.createElement('div')
    slot.setAttribute('data-slot', 'sidebar.workspaces')
    slot.setAttribute('aria-label', 'Workspaces')
    const span = document.createElement('span')
    span.textContent = 'Add workspace'
    slot.appendChild(span)
    root.appendChild(slot)
    expect(reconcileChrome(root)).toBe(true)
    expect(slot.getAttribute('aria-label')).toBe('Projects')
    expect(span.textContent).toBe('Add project')
    expect(reconcileChrome(root)).toBe(false)
  })

  it('starts the skin: the observer reconciles batched DOM mutations', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { tablist } = headerWithTabs(root)
    const { log } = utilitiesSeat(root)
    const stop = startChromeSkin(root)
    // Two synchronous mutations batch into one microtask reconciliation.
    const unrelated = document.createElement('span')
    root.appendChild(unrelated)
    root.appendChild(document.createElement('b'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(tablist.style.display).toBe('none')
    expect(log.style.display).toBe('none')
    stop()
    root.remove()
  })
})

describe('setHidden', () => {
  it('toggles the display style and reports changes', () => {
    const el = document.createElement('div')
    expect(setHidden(el, true)).toBe(true)
    expect(el.style.display).toBe('none')
    expect(setHidden(el, true)).toBe(false)
    expect(setHidden(el, false)).toBe(true)
    expect(el.style.display).toBe('')
    expect(setHidden(null, true)).toBe(false)
  })
})
