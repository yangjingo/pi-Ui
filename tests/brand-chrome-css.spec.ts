import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const dshRoot = resolve(root, '../../deepseek-harness')

/** Match one `[class*='_name']` attribute selector with either quoting style. */
function attrSelector(name: string): string {
  return `\\[class\\*=["']?_${name}["']?\\]`
}

/** Sidebar column rule: must not declare backdrop-filter anywhere inside it. */
function sidebarRule(css: string): string {
  const match = css.match(new RegExp(`${attrSelector('sidebarCol')}[^{}]*\\{([^}]*)\\}`))
  expect(match, 'sidebarCol rule found').toBeTruthy()
  return match![1]!
}

type CssRule = { selector: string; declarations: string }

/** Parse the flat rule set used by this stylesheet (no nested at-rules). */
function cssRules(css: string): CssRule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([match, selector, declarations]) => ({
      selector: selector!.trim(),
      declarations: declarations!.trim(),
      text: match,
    }))
    .map(({ selector, declarations }) => ({ selector, declarations }))
}

/** Split declarations into an ordered property map for exact assertions. */
function declarationMap(rule: CssRule): Record<string, string> {
  return Object.fromEntries(rule.declarations
    .split(';')
    .map(declaration => declaration.trim())
    .filter(declaration => declaration !== '')
    .map(declaration => {
      const separator = declaration.indexOf(':')
      return [declaration.slice(0, separator).trim().toLowerCase(), declaration.slice(separator + 1).trim()]
    }))
}

describe('AidaBrand chrome css guards', () => {
  const sourceCss = readFileSync(
    join(root, 'src', 'client', 'AidaBrand.module.css'),
    'utf8',
  )
  const shippedBundle = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  const hostSettingsCss = readFileSync(
    join(dshRoot, 'packages/client/ui-settings-general/src/client/SettingsRoot.module.css'),
    'utf8',
  )
  const hostThemeCss = readFileSync(
    join(dshRoot, 'packages/client/ui-theme/src/styles/gradient-shadow-text.css'),
    'utf8',
  )

  it('source sidebarCol rule has no backdrop-filter (containing block trap)', () => {
    expect(sidebarRule(sourceCss)).not.toMatch(/backdrop-filter/i)
  })

  it('shipped bundle sidebarCol rule has no backdrop-filter', () => {
    expect(sidebarRule(shippedBundle)).not.toMatch(/backdrop-filter/i)
  })

  it('source css leaves every host dialog mask untouched', () => {
    const maskRules = cssRules(sourceCss)
      .filter(({ selector }) => selector.includes('_mask'))
      .map(({ selector }) => selector)
    expect(maskRules).toEqual([])
    expect(sourceCss).not.toContain('--dsw-alias-bg-mask-1')
    expect(sourceCss).not.toContain('--dsw-mask-blur')
  })

  it('locks the native settings mask and panel stacking contract', () => {
    const rules = new Map(cssRules(hostSettingsCss).map(rule => [rule.selector, rule]))
    const overlay = declarationMap(rules.get('.overlay')!)
    const mask = declarationMap(rules.get('.mask')!)
    const panel = declarationMap(rules.get('.panel')!)

    expect(rules.has('.overlay')).toBe(true)
    expect(rules.has('.mask')).toBe(true)
    expect(rules.has('.panel')).toBe(true)
    expect(overlay).toMatchObject({
      position: 'fixed',
      inset: '0',
      'z-index': '1000',
    })
    expect(mask).toMatchObject({
      background: 'var(--dsw-alias-bg-mask-1)',
      'backdrop-filter': 'var(--dsw-mask-blur)',
    })
    expect(panel).toMatchObject({
      position: 'relative',
      'z-index': '1',
    })
    expect(hostThemeCss).toMatch(/--dsw-mask-blur:\s*blur\(2px\);/)
  })

  it('hides the full composer seat without changing its layout', () => {
    const rules = cssRules(sourceCss)
      .filter(({ selector }) => selector.includes('data-aida-settings-dialog'))
    expect(rules).toHaveLength(1)
    expect(rules[0]!.selector.replace(/\s+/g, ' ')).toBe(
      ":global(html[data-aida-settings-dialog='open'] [class*='_composerSeat'])",
    )

    expect(declarationMap(rules[0]!)).toEqual({
      'visibility': 'hidden !important',
      'opacity': '0 !important',
      'pointer-events': 'none !important',
      'user-select': 'none !important',
    })
  })

  it('shipped bundle keeps the native mask and the composer-seat guard in sync', () => {
    expect(shippedBundle).not.toContain('DialogMask.css')
    expect(shippedBundle).not.toMatch(/\[class\*=['"]?_mask['"]?\]/)
    expect(shippedBundle).not.toMatch(/--dsw-alias-bg-mask-1\s*:/)
    expect(shippedBundle).not.toMatch(/--dsw-mask-blur\s*:/)
    expect(shippedBundle).not.toContain('backdrop-filter:blur(6px)!important')
    expect(shippedBundle).toContain("html[data-aida-settings-dialog=open]")
    expect(shippedBundle).toContain('_composerSeat]{visibility:hidden!important;opacity:0!important;pointer-events:none!important;user-select:none!important}')
    // The ModuleLoader factory cannot resolve an emitted sibling chunk; all
    // lazy client code (notably Mermaid) must stay inside lib/client.js.
    expect(shippedBundle).not.toMatch(/require\("\.\/[^"]+\.cjs"\)/)
  })
})
