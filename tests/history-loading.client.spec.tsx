// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { HistoryLoadingProps } from '../src/client/HistoryLoadingIndicator.tsx'
import { AidaHistoryLoadingIndicator } from '../src/client/HistoryLoadingIndicator.tsx'

afterEach(cleanup)

describe('AIDA history loading indicator', () => {
  it('keeps the localized status text beside a decorative circular animation', () => {
    const props = { label: '载入历史…' } as HistoryLoadingProps
    const view = render(<AidaHistoryLoadingIndicator {...props} />)
    const status = view.getByRole('status')
    expect(status.textContent).toBe('载入历史…')
    expect(status.querySelector('[aria-hidden="true"]')).toBeTruthy()
  })
})
