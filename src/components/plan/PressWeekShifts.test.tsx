// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))
const setDay = vi.fn(async () => null)
let records: { press: string; date: string; shifts: number[] }[] = []
vi.mock('../../lib/convexTransport', () => ({ useQuery: () => records, useMutation: () => setDay }))

import { PressWeekShifts } from './PressWeekShifts'

afterEach(() => {
  cleanup()
  setDay.mockClear()
  records = []
})

const shifts: Record<string, number> = { 'P1|2026-10-26': 3, 'P1|2026-10-27': 2, 'P2|2026-10-26': 1 }
const view = () => (
  <PressWeekShifts
    presses={[{ name: 'P2' }, { name: 'P1' }]}
    dates={['2026-10-26', '2026-10-27']}
    shiftMinutes={480}
    dayOf={(p, d) => (shifts[`${p}|${d}`] === undefined ? undefined : { shifts: shifts[`${p}|${d}`], overtime: [] })}
  />
)

describe('PressWeekShifts', () => {
  it('seçilen iş yerinin vardiyalarını gün tarihleriyle gösterir', () => {
    render(view())
    expect(screen.getAllByText('26.10')).toHaveLength(2) // hafta düğmesi + gün başlığı
    // P1 önce (alfabetik): Pzt 3 + Sal 2 vardiya.
    expect(screen.getAllByText('✓')).toHaveLength(5)
    fireEvent.change(screen.getByLabelText('Work center'), { target: { value: 'P2' } })
    expect(screen.getAllByText('✓')).toHaveLength(1)
  })

  it('hücreye tıklamak o pres × gün × vardiyayı açar (gün kaydı)', () => {
    render(view())
    // Salı 3. vardiya kapalı → açılır: [1, 2, 3].
    fireEvent.click(screen.getByTitle(/P1 27\.10\.2026 shift 3: not working/))
    expect(setDay).toHaveBeenCalledWith({ press: 'P1', date: '2026-10-27', shifts: [1, 2, 3] })
  })

  it('gün kaydı plandan önce gösterilir; ↺ kaydı siler', () => {
    // Pazartesi yalnız 3. vardiya kaydedildi, plan henüz 3 vardiya görüyor.
    records = [{ press: 'P1', date: '2026-10-26', shifts: [3] }]
    render(view())
    expect(screen.getAllByText('✓')).toHaveLength(3) // Pzt 1 + Sal 2
    expect(screen.getByTitle(/26\.10\.2026 shift 3: working \(applies when the plan is recalculated\)/)).toBeTruthy()
    fireEvent.click(screen.getByText('↺'))
    expect(setDay).toHaveBeenCalledWith({ press: 'P1', date: '2026-10-26', shifts: null })
  })
})
