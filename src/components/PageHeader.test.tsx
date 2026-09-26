// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { InfoTip } from './PageHeader'
import { relatedPages } from '../lib/navigation'

// Mavi "i": uzun açıklama sayfada durmaz, üzerine gelince açılır.

afterEach(cleanup)

describe('InfoTip', () => {
  it('is closed until hovered, opens on hover and closes on Escape', () => {
    const { getByRole, queryByRole } = render(<InfoTip label="About">Long explanation</InfoTip>)
    expect(queryByRole('tooltip')).toBeNull()
    fireEvent.mouseEnter(getByRole('button', { name: 'About' }).parentElement!)
    expect(getByRole('tooltip').textContent).toBe('Long explanation')
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(queryByRole('tooltip')).toBeNull()
  })

  it('opens on click for touch screens', () => {
    const { getByRole } = render(<InfoTip label="About">Text</InfoTip>)
    fireEvent.click(getByRole('button', { name: 'About' }))
    expect(getByRole('tooltip')).toBeTruthy()
  })
})

describe('relatedPages', () => {
  it('links Work Calendar and Capacity Dashboard both ways, with menu labels', () => {
    expect(relatedPages('/takvim').map((l) => l.to)).toContain('/capacity')
    expect(relatedPages('/capacity').map((l) => l.to)).toContain('/takvim')
    expect(relatedPages('/capacity').find((l) => l.to === '/takvim')?.label).toBe('Work Calendar')
  })

  it('never links a page to itself and every label is a real name', () => {
    for (const path of ['/planlama', '/capacity', '/takvim', '/hammadde', '/referanslar', '/makineler', '/depolar', '/sapdata']) {
      for (const link of relatedPages(path)) {
        expect(link.to).not.toBe(path)
        expect(link.label.startsWith('/')).toBe(false)
      }
    }
  })
})
