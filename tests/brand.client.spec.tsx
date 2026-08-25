// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import {
  AidaMark, AidaSidebarBrand, AidaSidebarMark, type AidaSidebarBrandProps,
} from '@aida/aida-ui-dsh/src/client/AidaBrand.tsx'
import {
  AidaHeroBrand, type AidaHeroBrandProps,
} from '@aida/aida-ui-dsh/src/client/AidaHeroBrand.tsx'
import { zh } from '@aida/aida-ui-dsh/src/client/locales.ts'
import { AIDA_TOKENS } from '@aida/aida-ui-dsh/client'

const t: AidaSidebarBrandProps['t'] = makeTranslate(zh)

afterEach(cleanup)

describe('AIDA identity', () => {
  it('renders the accessible official brand asset geometry', () => {
    const html = render(<AidaMark size={32} label={t('logo.label')} />).container.innerHTML
    expect(html).toContain('aria-label="AIDA 品牌标识"')
    expect(html).toContain('viewBox="0 0 100 100"')
    expect(html).toContain('M 50 6 L 11 92')
    expect(html).toContain('stop-color="#1565C0"')
  })

  it('renders the mark decorative when no label is given', () => {
    const html = render(<AidaMark />).container.innerHTML
    expect(html).toContain('aria-hidden="true"')
  })

  it('renders the expanded and collapsed sidebar artwork', () => {
    const expanded = render(<AidaSidebarBrand t={t} />).container.innerHTML
    const collapsed = render(<AidaSidebarMark t={t} size={25} />).container.innerHTML
    expect(expanded).toContain('AIDA')
    expect(expanded).not.toContain('智能行动引擎')
    expect(collapsed).toContain('AIDA 品牌标识')
  })

  it('renders the new-session AIDA mark through the host mark slot', () => {
    const props = {
      size: 50,
      t,
    } as AidaHeroBrandProps
    const view = render(<AidaHeroBrand {...props} />)
    expect(view.getByRole('img', { name: 'AIDA 品牌标识' })).toBeTruthy()
  })

  it('pins accessible brand accents for both built-in palettes', () => {
    expect(AIDA_TOKENS).toMatchObject({
      '--dsw-alias-brand-primary': { light: '#3551D8', dark: '#7386F5' },
      '--dsw-alias-brand-text': { light: '#1E34A8', dark: '#AAB5FF' },
    })
  })
})
