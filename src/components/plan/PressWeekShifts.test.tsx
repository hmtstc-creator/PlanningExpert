// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))

import { PressWeekShifts } from './PressWeekShifts'

afterEach(cleanup)

describe('PressWeekShifts', () => {
  it('seçilen iş yerinin vardiyalarını gün tarihleriyle gösterir', () => {
    const shifts: Record<string, number> = { 'P1|2026-10-26': 3, 'P1|2026-10-27': 2, 'P2|2026-10-26': 1 }
    render(
      <PressWeekShifts
        presses={[{ name: 'P2' }, { name: 'P1' }]}
        dates={['2026-10-26', '2026-10-27']}
        dayOf={(p, d) => (shifts[`${p}|${d}`] === undefined ? undefined : { shifts: shifts[`${p}|${d}`], overtime: [] })}
      />,
    )
    expect(screen.getAllByText('26.10')).toHaveLength(2) // hafta düğmesi + gün başlığı
    // P1 önce (alfabetik): Pzt 3 + Sal 2 vardiya.
    expect(screen.getAllByText('✓')).toHaveLength(5)
    fireEvent.change(screen.getByLabelText('Work center'), { target: { value: 'P2' } })
    expect(screen.getAllByText('✓')).toHaveLength(1)
  })
})
