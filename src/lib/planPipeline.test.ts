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
