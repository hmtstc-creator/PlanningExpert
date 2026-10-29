// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../convex/_generated/api', () => {
  const fn = (name: string) => ({ _name: name, toString: () => name })
  return {
    api: {
      dayShifts: { list: fn('dayShifts.list'), setDay: fn('dayShifts.setDay') },
      overtime: {
        listDefinitions: fn('overtime.listDefinitions'),
        listPressOvertime: fn('overtime.listPressOvertime'),
        addPressOvertime: fn('overtime.addPressOvertime'),
        removePressOvertime: fn('overtime.removePressOvertime'),
      },
    },
  }
})
vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))
const setDay = vi.fn(async () => null)
const addOvertime = vi.fn(async () => null)
const removeOvertime = vi.fn(async () => null)
let records: { press: string; date: string; shifts: number[] }[] = []
let definitions: { _id: string; name: string; startMinute: number; durationMinutes: number }[] = []
let pressOvertime: { _id: string; press: string; date: string; definitionId: string }[] = []
vi.mock('../../lib/convexTransport', () => ({
  useQuery: (q: unknown) =>
    String(q) === 'overtime.listDefinitions'
      ? definitions
      : String(q) === 'overtime.listPressOvertime'
        ? pressOvertime
        : records,
  useMutation: (m: unknown) =>
    String(m) === 'overtime.addPressOvertime'
      ? addOvertime
      : String(m) === 'overtime.removePressOvertime'
        ? removeOvertime
        : setDay,
}))

import { PressWeekShifts } from './PressWeekShifts'

afterEach(() => {
  cleanup()
  setDay.mockClear()
  addOvertime.mockClear()
  removeOvertime.mockClear()
  records = []
  definitions = []
  pressOvertime = []
})

const shifts: Record<string, number> = { 'P1|2026-10-26': 3, 'P1|2026-10-27': 2, 'P2|2026-10-26': 1 }
const view = () => (
  <PressWeekShifts
    presses={[{ name: 'P2' }, { name: 'P1' }]}
    dates={['2026-10-26', '2026-10-27']}
    shiftMinutes={480}
    shiftStartMinute={420}
    dayOf={(p, d) => (shifts[`${p}|${d}`] === undefined ? undefined : { shifts: shifts[`${p}|${d}`], overtime: [] })}
  />
)
const edit = () => fireEvent.click(screen.getByText('Edit'))
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('PressWeekShifts', () => {
  it('seçilen iş yerinin vardiyalarını gün tarihleriyle gösterir', () => {
    render(view())
    expect(screen.getAllByText('26.10')).toHaveLength(2) // hafta düğmesi + gün başlığı
    // P1 önce (alfabetik): Pzt 3 + Sal 2 vardiya.
    expect(screen.getAllByText('✓')).toHaveLength(5)
    fireEvent.change(screen.getByLabelText('Work center'), { target: { value: 'P2' } })
    expect(screen.getAllByText('✓')).toHaveLength(1)
  })

  it('düzenleme kipi dışında hücre yazmaz', () => {
    render(view())
    fireEvent.click(screen.getByTitle(/P1 27\.10\.2026 shift 3: not working/))
    expect(setDay).not.toHaveBeenCalled()
  })

  it('Edit → hücre tıklaması taslakta kalır, Save hepsini yazar', async () => {
    render(view())
    edit()
    // Salı 3. vardiya kapalı → açılır: [1, 2, 3]; henüz yazılmaz.
    fireEvent.click(screen.getByTitle(/P1 27\.10\.2026 shift 3: not working/))
    expect(setDay).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Save'))
    await flush()
    expect(setDay).toHaveBeenCalledWith({ press: 'P1', date: '2026-10-27', shifts: [1, 2, 3] })
    expect(screen.getByText('Edit')).toBeTruthy() // kip kapandı
  })

  it('Cancel taslağı atar', () => {
    render(view())
    edit()
    fireEvent.click(screen.getByTitle(/P1 27\.10\.2026 shift 3: not working/))
    fireEvent.click(screen.getByText('Cancel'))
    expect(setDay).not.toHaveBeenCalled()
    expect(screen.getAllByText('✓')).toHaveLength(5)
  })

  it('gün kaydı plandan önce gösterilir; ↺ kaydı siler', async () => {
    // Pazartesi yalnız 3. vardiya kaydedildi, plan henüz 3 vardiya görüyor.
    records = [{ press: 'P1', date: '2026-10-26', shifts: [3] }]
    render(view())
    expect(screen.getAllByText('✓')).toHaveLength(3) // Pzt 1 + Sal 2
    expect(screen.getByTitle(/26\.10\.2026 shift 3: working \(applies when the plan is recalculated\)/)).toBeTruthy()
    edit()
    fireEvent.click(screen.getByText('↺'))
    fireEvent.click(screen.getByText('Save'))
    await flush()
    expect(setDay).toHaveBeenCalledWith({ press: 'P1', date: '2026-10-26', shifts: null })
  })

  it('mesai eklenip kaldırılır; Save sırası: önce kaldırma, sonra ekleme', async () => {
    definitions = [{ _id: 'def1', name: 'Night', startMinute: 1380, durationMinutes: 480 }]
    pressOvertime = [{ _id: 'ot1', press: 'P1', date: '2026-10-26', definitionId: 'def1' }]
    // Salı kapatıldı: kapalı günün tamamı mesaiye açıktır.
    records = [{ press: 'P1', date: '2026-10-27', shifts: [] }]
    render(view())
    edit()
    fireEvent.click(screen.getByTitle(/Night on 26\.10\.2026 for P1 — click to remove/))
    fireEvent.change(screen.getByLabelText('Add overtime on 27.10.2026'), { target: { value: 'def1' } })
    fireEvent.click(screen.getByText('Save'))
    await flush()
    expect(removeOvertime).toHaveBeenCalledWith({ id: 'ot1' })
    expect(addOvertime).toHaveBeenCalledWith({ press: 'P1', date: '2026-10-27', definitionId: 'def1' })
    expect(removeOvertime.mock.invocationCallOrder[0]).toBeLessThan(addOvertime.mock.invocationCallOrder[0])
  })

  // Planlamacı 2026-10-29: "günüm zaten dolu, niye oraya mesai açayım — bunu
  // cumartesiye açabilmeliyim". Kapasitesi 0 olan gün plan günlerinde yok,
  // ama haftanın her günü düzenlenebilir.
  it('vardiyaları 24 saati dolduran güne mesai teklif edilmez; kapalı cumartesiye açılır', async () => {
    definitions = [{ _id: 'def1', name: 'Weekend_8h_s1', startMinute: 420, durationMinutes: 480 }]
    render(
      <PressWeekShifts
        presses={[{ name: 'P1' }]}
        // Plan yalnız çalışılan günleri döner: cumartesi–pazar listede yok.
        dates={['2026-10-29', '2026-10-30']}
        shiftMinutes={480}
        shiftStartMinute={420}
        dayOf={(_p, d) => (d <= '2026-10-30' ? { shifts: 3, overtime: [] } : undefined)}
      />,
    )
    edit()
    // Perşembe 3 × 8 saat = 24 saat: mesai açılamaz.
    expect(screen.queryByLabelText('Add overtime on 29.10.2026')).toBeNull()
    expect(screen.getAllByText('shifts cover 24 h').length).toBe(2) // Per + Cum
    // Cumartesi kapalı: bütün gün boş, mesai açılır.
    expect(screen.getAllByText('free 07:00–07:00').length).toBe(2) // Cmt + Paz: bütün gün boş
    fireEvent.change(screen.getByLabelText('Add overtime on 31.10.2026'), { target: { value: 'def1' } })
    fireEvent.click(screen.getByText('Save'))
    await flush()
    expect(addOvertime).toHaveBeenCalledWith({ press: 'P1', date: '2026-10-31', definitionId: 'def1' })
  })

  // Planlamacı 2026-10-29: 06:30–16:10 ve 16:10–01:50 çalışan tesiste
  // 01:50–06:30 (4 s 40 dk) gece uzatma mesaisine açıktır, fazlası değil.
  it('2 × 9 s 40 dk düzeninde gece mesaisi pencereye sığmazsa taslağa girmez', () => {
    definitions = [
      { _id: 'ok', name: 'Night', startMinute: 110, durationMinutes: 280 },
      { _id: 'uzun', name: 'Night+', startMinute: 110, durationMinutes: 340 },
    ]
    render(
      <PressWeekShifts
        presses={[{ name: 'P1' }]}
        dates={['2026-10-26', '2026-10-27']}
        shiftMinutes={580}
        shiftStartMinute={390}
        dayOf={() => ({ shifts: 2, overtime: [] })}
      />,
    )
    edit()
    // Haftanın yedi günü de aynı düzende: ızgaranın dışı mesaiye açık.
    expect(screen.getAllByText('free 01:50–06:30').length).toBe(7)
    fireEvent.change(screen.getByLabelText('Add overtime on 27.10.2026'), { target: { value: 'uzun' } })
    expect(screen.getByText(/24 hours/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Add overtime on 27.10.2026'), { target: { value: 'ok' } })
    fireEvent.click(screen.getByText('Save'))
    expect(addOvertime).toHaveBeenCalledWith({ press: 'P1', date: '2026-10-27', definitionId: 'ok' })
  })
})
