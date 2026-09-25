import { describe, expect, it } from 'vitest'

import { computePlan, type PlanInputs } from './planPipeline'

// Pazartesi 14 Eylül 2026, 07:00 Romanya — vardiya yeni başladı.
const MONDAY_0700 = Date.UTC(2026, 8, 14, 4, 0)

// Tek pres, günde tek vardiya (07:00–15:00), emniyet stoğu 1 gün.
// C'nin bakiyesi önce basılır, C'nin kalıbı takılı kalır. B acil (stoğu
// bugün bitiyor, teslim salı 08:00). C'nin gelecek haftaki lotu dolgu.
function plant(fillQty: number): PlanInputs {
  return {
    products: [
      { code: 'C', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104' },
      { code: 'B', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104' },
    ],
    weeklyDemand: [
      { material: 'C', overdue: -100, periods: [{ label: 'W38', qty: 0 }, { label: 'W39', qty: fillQty }] },
      { material: 'B', overdue: 0, periods: [{ label: 'W38', qty: 50 }] },
    ],
    stock: [],
    locations: [],
    presses: [{ name: '104', hall: 'H1' }],
    templates: [{ press: '104', workingDays: 5, shiftsPerDay: 1, overtimeShifts: 0 }],
    settings: { shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 2, safetyStockDays: 1 },
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
  }
}

const onPress = (run: ReturnType<typeof computePlan>) =>
  [...run.jobs].sort((a, b) => a.date.localeCompare(b.date) || a.setupStartMinute - b.setupStartMinute)

describe('mounted die runs on before an urgent job', () => {
  it('continues the mounted die when the urgent job is still on time — one setup saved', () => {
    const run = computePlan(plant(300), MONDAY_0700)
    const jobs = onPress(run)
    expect(jobs.map((j) => j.material)).toEqual(['C', 'C', 'B'])
    expect(jobs[1].continued).toBe(true)
    expect(jobs[1].mountedFirst).toBe(true)
    expect(jobs[1].setupMinutes).toBe(0)
    expect(jobs[2].late).toBe(false)
    expect(jobs.filter((j) => j.setupMinutes > 0)).toHaveLength(2)
    expect(run.audit?.ok).toBe(true)
  })

  it('keeps the urgent job first when the mounted die would make it late', () => {
    // C'nin dolgusu 500 dk: önce basılsa B salı 08:00'e yetişmez.
    const run = computePlan(plant(5000), MONDAY_0700)
    const jobs = onPress(run)
    const b = jobs.find((j) => j.material === 'B')!
    expect(b.late).toBe(false)
    expect(jobs.some((j) => j.mountedFirst)).toBe(false)
    expect(jobs.map((j) => j.material).slice(0, 2)).toEqual(['C', 'B'])
  })
})
