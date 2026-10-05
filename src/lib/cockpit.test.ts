import { describe, expect, it } from 'vitest'

import { buildCockpit, type CockpitInput } from './cockpit'

const H = 3_600_000
const now = Date.UTC(2026, 9, 5, 10)

const base = (over: Partial<NonNullable<CockpitInput['plan']>> = {}): CockpitInput => ({
  now,
  plan: { computedAt: now - 0.5 * H, lateItems: [], brokenRules: [], capacity: null, alarms: { dies: [], machines: [] }, ...over },
  uploads: { weeklyDemand: now - 2 * H, stock: now - 3 * H },
  openBreakdowns: { total: 0, stopping: 0 },
  openDieProblems: 0,
})

describe('Today paneli', () => {
  it('her şey yolundaysa tek yeşil satır', () => {
    const s = buildCockpit(base())
    expect(s.map((x) => [x.key, x.level])).toEqual([['late', 'ok']])
  })

  it('geç parçalar: toplam saat, en kötüsü başta, kaçınılamayan pay', () => {
    const s = buildCockpit(
      base({
        lateItems: [
          { material: 'A', presses: ['P1'], lateHours: 4, deadline: 'Tue', suggestion: 'overtime' },
          { material: 'B', presses: ['P2'], lateHours: 20, deadline: 'Mon', suggestion: 'move to P3' },
        ],
        lateLowerBound: 1,
      }),
    )
    const late = s.find((x) => x.key === 'late')!
    expect(late.level).toBe('critical')
    expect(late.title).toContain('2 parts late — 24 h')
    expect(late.items![0].text).toContain('B on P2')
    expect(late.detail).toContain('1 of them no plan can save')
  })

  it('darboğaz: yalnızca yakın haftalarda kapasiteyi aşan; takvimsiz talep de', () => {
    const s = buildCockpit(
      base({
        capacity: {
          weeks: [{ label: 'W41' }, { label: 'W42' }, { label: 'W43' }],
          presses: [
            { press: 'P1', capacity: [100, 100, 100], demand: [90, 130, 500] },
            { press: 'P2', capacity: [0, 0, 0], demand: [5, 0, 0] },
          ],
        },
      }),
    )
    const b = s.find((x) => x.key === 'bottleneck')!
    expect(b.items!.map((i) => i.text)).toEqual(['P2 — W41', 'P1 — W42'])
    // W43'teki aşım (3. hafta) yakın dönem değil.
    expect(b.title).toContain('2 work centers')
  })

  it('bayat SAP verisi ve hiç yüklenmemiş kaynak', () => {
    const s = buildCockpit({ ...base(), uploads: { weeklyDemand: now - 50 * H, stock: 0 } })
    const f = s.find((x) => x.key === 'freshness')!
    expect(f.level).toBe('critical')
    expect(f.items).toEqual([
      { text: 'Demand (ZPP)', sub: 'uploaded 2 days ago' },
      { text: 'Stock (MB52)', sub: 'never uploaded' },
    ])
  })

  it('plan hatası ve bayat plan en üstte', () => {
    const s = buildCockpit({ ...base({ computedAt: now - 5 * H }), planError: { message: 'boom', at: now - H } })
    expect(s[0].key).toBe('planError')
    expect(s.some((x) => x.key === 'planStale')).toBe(true)
    // Hatadan sonra başarılı hesap: hata gösterilmez.
    expect(buildCockpit({ ...base(), planError: { message: 'old', at: now - 2 * H } }).some((x) => x.key === 'planError')).toBe(false)
  })

  it('planlama izni yoksa plan sinyali yok; bakım sinyalleri yine görünür', () => {
    const s = buildCockpit({ now, plan: null, uploads: null, openBreakdowns: { total: 3, stopping: 1 }, openDieProblems: 2 })
    expect(s.map((x) => x.key)).toEqual(['breakdowns', 'dieProblems'])
  })
})
