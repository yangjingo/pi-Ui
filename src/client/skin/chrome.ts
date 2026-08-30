/**
 * AIDA chrome skin: small deterministic DOM adjustments the AIDA deployment
 * owns, driven by one document MutationObserver. Two behaviors:
 *
 * 1. The trajectory surface lives in the Canvas — the center-column
 *    trajectory view and its view-ring tab are hidden. Its session-log action
 *    is relocated into the Canvas trajectory toolbar, while unrelated header
 *    utilities remain available.
 *
 * 2. Project vocabulary — the sidebar workspace region and the hero
 *    workspace picker present the "Project" concept instead of "Workspace"
 *    (en/zh label replacement in text nodes and aria-label/title/placeholder
 *    attributes, scoped to the two seat slots). React skips text updates when
 *    its fiber props are unchanged, so the rewrite survives re-renders.
 *
 * All behaviors are pure functions over DOM nodes (unit-tested) plus a thin
 * observer that reconciles them; the observer is disposed with the plugin
 * fiber.
 */

/** Labels used only by the exported session-log DOM locator. */
const SESSION_LOG_LABELS = new Set(['会话日志', 'Session log'])
const HERO_HEADLINES = new Map([
  ['探索未至之境', '你的交付态势导航仓'],
  ['Into the Unknown', 'AIDA'],
])
const COMPOSER_PLACEHOLDER = '给AIDA智能交付助手下发任务'
const SETTINGS_DIALOG_SELECTOR = "[class*='_footArea'] [role='dialog'][aria-modal='true']"

/**
 * Apply the English/Chinese Workspace-to-Project vocabulary mapping.
 * @param value - visible text or accessible label.
 * @returns the mapped string.
 */
export function projectText(value: string): string {
  return value
    .replace(/\bWorkspaces\b/g, 'Projects')
    .replace(/\bWorkspace\b/g, 'Project')
    .replace(/\bworkspaces\b/g, 'projects')
    .replace(/\bworkspace\b/g, 'project')
    .replace(/工作区/g, '项目')
    .replace(/工作空间/g, '项目')
}

/**
 * Check whether a label changes under the Project vocabulary.
 * @param value - visible text or accessible label.
 * @returns true when the mapping changes it.
 */
export function isProjectRename(value: string): boolean {
  return projectText(value) !== value
}

/** Seat slots the Project vocabulary rewrites. */
export const PROJECT_SCOPE_SLOTS = [
  'sidebar.workspaces',
  'conversation.hero.workspace',
  'conversation.composer.bar',
] as const

/**
 * Toggle an element's display state.
 * @param element - target element, when found.
 * @param hidden - requested hidden state.
 * @returns true when the inline style changed.
 */
export function setHidden(element: Element | null, hidden: boolean): boolean {
  if (element === null) return false
  const style = (element as HTMLElement).style
  if (hidden && style.display !== 'none') {
    style.display = 'none'
    return true
  }
  if (!hidden && style.display !== '') {
    style.display = ''
    return true
  }
  return false
}

/**
 * Find the session header's view-ring tab list.
 * @param root - DOM subtree to query.
 * @returns the tab list, when mounted.
 */
export function findViewTablist(root: ParentNode): Element | null {
  const header = root.querySelector('[data-slot="conversation.session.header"]')
  return header?.querySelector('[role="tablist"]') ?? null
}

/**
 * Find session-log buttons in the session-header utilities seat.
 * @param root - DOM subtree to query.
 * @returns matching buttons; the Canvas toggle is excluded.
 */
export function findSessionLogButtons(root: ParentNode): readonly Element[] {
  const seat = root.querySelector('[data-slot="conversation.session.header.utilities"]')
  if (seat === null) return []
  return Array.from(seat.querySelectorAll('button')).filter((button) => {
    /* v8 ignore next -- a button's textContent is never null in the DOM. */
    const label = (button.textContent ?? '').trim()
    return SESSION_LOG_LABELS.has(label)
  })
}

/**
 * Rewrite Project vocabulary inside one seat slot.
 * @param slot - scoped slot element.
 * @returns true when a text node or label attribute changed.
 */
export function applyProjectVocabulary(slot: Element): boolean {
  let changed = false
  for (const attribute of ['aria-label', 'title', 'placeholder'] as const) {
    const value = slot.getAttribute(attribute)
    if (value !== null && isProjectRename(value)) {
      slot.setAttribute(attribute, projectText(value))
      changed = true
    }
  }
  const walker = document.createTreeWalker(slot, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node !== null) {
    const value = node.nodeValue
    if (value !== null && isProjectRename(value)) {
      node.nodeValue = projectText(value)
      changed = true
    }
    node = walker.nextNode()
  }
  return changed
}

/**
 * Rewrite every in-scope seat once.
 * @param root - DOM subtree to query.
 * @returns true when any seat changed.
 */
export function applyProjectVocabularyOnce(root: ParentNode): boolean {
  let changed = false
  for (const slotKey of PROJECT_SCOPE_SLOTS) {
    const slot = root.querySelector(`[data-slot="${slotKey}"]`)
    if (slot !== null && applyProjectVocabulary(slot)) changed = true
  }
  return changed
}

/**
 * Sync the settings dialog state onto the document element.
 * @param root - DOM subtree containing the sidebar settings dialog.
 * @returns true when the state attribute changed.
 */
export function syncSettingsDialogState(root: ParentNode): boolean {
  const ownerDocument = root.nodeType === Node.DOCUMENT_NODE ? (root as Document) : (root as Element).ownerDocument
  const documentElement = ownerDocument?.documentElement
  if (!documentElement) return false

  const isOpen = root.querySelector(SETTINGS_DIALOG_SELECTOR) !== null
  if (isOpen && documentElement.dataset.aidaSettingsDialog !== 'open') {
    documentElement.dataset.aidaSettingsDialog = 'open'
    return true
  }
  if (!isOpen && 'aidaSettingsDialog' in documentElement.dataset) {
    delete documentElement.dataset.aidaSettingsDialog
    return true
  }
  return false
}

/** Replace the shipped hero headline while leaving its preview badge intact. */
export function applyHeroHeadlineOnce(root: ParentNode): boolean {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node !== null) {
    const replacement = HERO_HEADLINES.get(node.nodeValue?.trim() ?? '')
    if (replacement !== undefined) {
      node.nodeValue = replacement
      return true
    }
    node = walker.nextNode()
  }
  return false
}

/** Keep every host-provided conversation composer on AIDA product language. */
export function applyComposerPlaceholderOnce(root: ParentNode): boolean {
  const slot = root.querySelector('[data-slot="conversation.composer.bar"]')
  if (slot === null) return false
  const elements = [slot, ...slot.querySelectorAll('[placeholder]')]
  let changed = false
  for (const element of elements) {
    if (!element.hasAttribute('placeholder')) continue
    if (element.getAttribute('placeholder') === COMPOSER_PLACEHOLDER) continue
    element.setAttribute('placeholder', COMPOSER_PLACEHOLDER)
    changed = true
  }
  return changed
}

/**
 * Reconcile the whole chrome: hide the center-column trajectory surface (the
 * lone view-ring tab nav, its session-log action, and any mounted trajectory
 * view outside the canvas) and apply the Project vocabulary.
 * @param root - document root.
 * @returns true when the DOM changed.
 */
export function reconcileChrome(root: ParentNode): boolean {
  let changed = setHidden(findViewTablist(root), true)
  for (const button of findSessionLogButtons(root)) {
    if (setHidden(button, true)) changed = true
  }
  for (const view of root.querySelectorAll('[data-conversation-composer-overlay]')) {
    // The canvas panel renders the same view component inside its trajectory
    // tab; only the center-column occurrence is hidden.
    if (view.closest('[data-testid="aida-canvas-panel"]') !== null) continue
    if (setHidden(view, true)) changed = true
  }
  if (applyProjectVocabularyOnce(root)) changed = true
  if (syncSettingsDialogState(root)) changed = true
  if (applyHeroHeadlineOnce(root)) changed = true
  if (applyComposerPlaceholderOnce(root)) changed = true
  return changed
}

/**
 * Start the chrome skin: reconcile the hidden trajectory surface and the
 * Project vocabulary on every DOM mutation
 * (microtask-batched).
 * @param root - document root to observe.
 * @returns disposer.
 */
export function startChromeSkin(root: ParentNode = document): () => void {
  const reconcile = (): void => {
    reconcileChrome(root)
  }
  let scheduled = false
  const schedule = (): void => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      reconcile()
    })
  }
  const observer = new MutationObserver(schedule)
  observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true })
  schedule()
  return () =>{  observer.disconnect() }
}
