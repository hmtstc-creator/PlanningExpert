import { describe, expect, it } from 'vitest'

import { plantClock } from './dates'
import { computePlan, groupPlanWeeks, type PlanInputs } from './planPipeline'

// Çarşamba 16 Eylül 2026, Romanya 10:00 (yaz saati, UTC+3 → UTC 07:00).
const NOW = Date.UTC(2026, 8, 16, 7, 0)

function inputs(overrides: Partial<PlanInputs> = {}): PlanInputs {
  return {
    products: [
      {
        code: 'MAM-A',
        moldCavities: 1,
        spm: 20,
        setupMinutes: 30,
        maxShots: 100_000,
        mainMachine: 'PRS-1',
      },
    ],
    weeklyDemand: [{ material: 'MAM-A', overdue: 0, periods: [{ label: 'W38', qty: 2000 }] }],
    stock: [],
    locations: [],
    presses: [
      { name: 'PRS-1', hall: 'H1' },
      { name: 'PRS-2', hall: 'H1' },
    ],
    templates: [
      { press: 'PRS-1', workingDays: 5, shiftsPerDay: 2, overtimeShifts: 0 },
      { press: 'PRS-2', workingDays: 5, shiftsPerDay: 2, overtimeShifts: 0 },
    ],
    settings: { shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 2 },
    workCalendar: null,
    officialHolidays: [],
    latestSnapshot: null,
    plannedStops: [],
    overrides: [],
    moldMaintenance: [],
    readiness: [],
    pressMaintenance: [],
    alarms: [],
    truncatedInputs: [],
    ...overrides,
  }
}

describe('plantClock', () => {
  it('gives the plant wall clock even when the machine runs in another zone', () => {
    // UTC 23:30 → İstanbul ertesi gün 02:30 (başka dilim de verilebilir).
    const d = plantClock(Date.UTC(2026, 8, 15, 23, 30), 'Europe/Istanbul')
    expect(d.getDate()).toBe(16)
    expect(d.getHours()).toBe(2)
    expect(d.getMinutes()).toBe(30)
  })

  it('uses Romanian time by default, summer and winter', () => {
    // Yaz saati UTC+3, kış saati UTC+2.
    expect(plantClock(Date.UTC(2026, 6, 1, 4, 0)).getHours()).toBe(7)
    expect(plantClock(Date.UTC(2026, 11, 1, 4, 0)).getHours()).toBe(6)
  })

  it('falls back to the machine clock for an unknown zone', () => {
    const ms = Date.UTC(2026, 8, 15, 12, 0)
    expect(plantClock(ms, 'Not/AZone').getTime()).toBe(new Date(ms).getTime())
  })
})

describe('computePlan', () => {
  it('plans the demand from the plant day, not the server day', () => {
    const run = computePlan(inputs(), NOW)
    expect(run.todayIso).toBe('2026-09-16')
    expect(run.nowClockMinute).toBe(600)
    expect(run.horizonStart).toBe('2026-09-14')
    expect(run.jobs.length).toBeGreaterThan(0)
    expect(run.jobs.every((j) => j.press === 'PRS-1')).toBe(true)
    // Geçmiş günlere iş konmaz.
    expect(run.jobs.every((j) => j.date >= '2026-09-16')).toBe(true)
  })

  it('treats the night shift as the previous production day', () => {
    // Romanya 02:00 → birinci vardiya 07:00'de başlıyor, gün hâlâ dün.
    const run = computePlan(inputs(), Date.UTC(2026, 8, 16, 23, 0))
    expect(run.todayIso).toBe('2026-09-16')
    expect(run.nowClockMinute).toBe(26 * 60)
  })

  it('survives a JSON round trip, so it can be stored and sent as is', () => {
    const run = computePlan(inputs(), NOW)
    expect(JSON.parse(JSON.stringify(run))).toEqual(run)
  })

  it('holds an alarmed mold out of the plan and says why', () => {
    const run = computePlan(inputs({ alarms: [{ material: 'MAM-A', status: 'open' }] }), NOW)
    expect(run.jobs).toHaveLength(0)
    expect(run.alarmedMolds).toEqual(['MAM-A'])
    expect(run.warnings.some((w) => w.includes('periodic maintenance limit'))).toBe(true)
  })

  it('keeps frozen jobs from the approved plan and deducts what they make', () => {
    const run = computePlan(
      inputs({
        settings: { shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 2, frozenDays: 2 },
        latestSnapshot: {
          createdAt: NOW - 3600_000,
          jobs: [
            {
              material: 'MAM-A',
              press: 'PRS-1',
              hall: 'H1',
              date: '2026-09-16',
              phase: 'backlog',
              quantity: 2000,
              shots: 2000,
              coilsNeeded: 0,
              setupStartMinute: 200,
              endMinute: 330,
              segments: [{ kind: 'run', date: '2026-09-16', start: 200, end: 330 }],
              reason: 'approved',
            },
          ],
        },
      }),
      NOW,
    )
    expect(run.frozenCount).toBe(1)
    expect(run.jobs.filter((j) => j.frozen)).toHaveLength(1)
    // Talebin tamamı dondurulmuş işten karşılanıyor; yeniden planlanmaz.
    expect(run.jobs.filter((j) => !j.frozen)).toHaveLength(0)
  })

  it('books press maintenance as a blocked slot and warns', () => {
    const run = computePlan(
      inputs({
        pressMaintenance: [
          {
            press: 'PRS-1',
            date: '2026-09-17',
            startMinute: 480,
            endMinute: 600,
            reason: 'service',
            status: 'planned',
          },
        ],
      }),
      NOW,
    )
    expect(run.maintenance).toEqual([
      expect.objectContaining({ press: 'PRS-1', date: '2026-09-17' }),
    ])
    expect(run.warnings.some((w) => w.includes('maintenance booked'))).toBe(true)
  })
})

describe('groupPlanWeeks', () => {
  it('groups by week and explains each idle press', () => {
    const run = computePlan(inputs(), NOW)
    const weeks = groupPlanWeeks(run)
    expect(weeks[0].weekStart).toBe('2026-09-14')
    expect(weeks[0].dates[0]).toBe('2026-09-16')
    const idle = weeks[0].idlePresses.find((p) => p.name === 'PRS-2')
    expect(idle?.reason).toBe('no material lists it')
  })
})

describe('stock produced since the last MB52 upload', () => {
  it('counts yesterday\'s approved job until the new stock file arrives', () => {
    // Salı 15 Eylül 10:00. Stok Cuma 11 Eylül yüklendi; onaylı planda
    // Pazartesi 14 Eylül 2000 adet basıldı. Yeni MB52 henüz yok.
    const tuesday = Date.UTC(2026, 8, 15, 7, 0)
    const approvedMonday = {
      material: 'MAM-A',
      press: 'PRS-1',
      hall: 'H1',
      date: '2026-09-14',
      phase: 'backlog',
      quantity: 2000,
      shots: 2000,
      coilsNeeded: 0,
      setupStartMinute: 0,
      endMinute: 200,
      segments: [{ kind: 'run', date: '2026-09-14', start: 0, end: 200 }],
      reason: 'approved',
    }
    const base = inputs({
      stock: [{ material: 'MAM-A', unrestricted: 0, uploadedAt: Date.UTC(2026, 8, 11, 5, 0) }],
      latestSnapshot: { createdAt: Date.UTC(2026, 8, 11, 12, 0), jobs: [approvedMonday] },
    })
    const run = computePlan(base, tuesday)
    expect(run.producedSinceStock).toEqual({ quantity: 2000, jobs: 1, stockDay: '2026-09-11' })
    // 2000 talep o işle karşılandı: yeniden planlanmaz.
    expect(run.jobs).toHaveLength(0)
    expect(run.warnings.some((w) => w.includes('after the last MB52 stock upload'))).toBe(true)

    // Salı sabahı yeni MB52 geldi: iş artık stokta, varsayım devre dışı.
    const fresh = computePlan(
      { ...base, stock: [{ material: 'MAM-A', unrestricted: 2000, uploadedAt: Date.UTC(2026, 8, 15, 5, 0) }] },
      tuesday,
    )
    expect(fresh.producedSinceStock.jobs).toBe(0)
    expect(fresh.jobs).toHaveLength(0)
  })
})


describe('capacity forecast and week overrides', () => {
  it('counts only the hours left this week and adds overtime opened for a week', () => {
    const base = computePlan(inputs(), NOW)
    const press = base.capacity!.presses.find((p) => p.press === 'PRS-1')!
    // 2 × 8 h shifts: Wednesday 10:00 → 5 h left today (first shift 07:00–15:00,
    // second 15:00–23:00 → 13 h left) + Thu + Fri full (32 h) = 45 h.
    expect(press.capacity[0]).toBe(45)
    expect(base.capacity!.weeks[0]).toMatchObject({ start: '2026-09-14', label: 'W38' })

    const withOvertime = computePlan(
      inputs({
        weekOverrides: [{ press: 'PRS-1', weekStart: '2026-09-14', workingDays: 5, shiftsPerDay: 2, overtimeShifts: 2 }],
      }),
      NOW,
    )
    const cap = withOvertime.capacity!.presses.find((p) => p.press === 'PRS-1')!.capacity[0]
    expect(cap).toBe(45 + 16)
    // The plan itself sees the same extra capacity.
    const planMinutes = (r: typeof base) =>
      r.days.filter((d) => d.press === 'PRS-1' && d.date <= '2026-09-20').reduce((s, d) => s + d.minutes, 0)
    expect(planMinutes(withOvertime) - planMinutes(base)).toBe(16 * 60)
  })

  it('turns the week demand into hours on the main press', () => {
    const run = computePlan(inputs(), NOW)
    // 2000 pcs / 1 cavity / 20 spm = 100 min, no performance factor.
    expect(run.capacity!.presses.find((p) => p.press === 'PRS-1')!.demand[0]).toBe(1.67)
  })
})
