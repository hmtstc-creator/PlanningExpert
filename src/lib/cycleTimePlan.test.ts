import { describe, expect, it } from 'vitest'

import { computePlan, type PlanInputs } from './planPipeline'

// Kullanıcı kararı 2026-10-29: bütün parçalar ve iş yerleri çevrim süresiyle
// (dakika / adet) planlanır; nut welding (APR-6xx) da plana girer.

// Pazartesi 14 Eylül 2026, 07:00 Romanya.
const MONDAY_0700 = Date.UTC(2026, 8, 14, 4, 0)

function plant(product: Record<string, unknown>, overdue: number): PlanInputs {
  return {
    products: [{ code: 'NUT', setupMinutes: 0, mainMachine: 'APR-601', ...product }],
    weeklyDemand: [{ material: 'NUT', overdue: -overdue, periods: [{ label: 'W38', qty: 0 }] }],
    stock: [],
    locations: [],
    presses: [{ name: 'APR-601', hall: '', feedsCoil: false, rateModel: 'cycle' } as PlanInputs['presses'][number]],
    templates: [{ press: 'APR-601', workingDays: 5, shiftsPerDay: 3, overtimeShifts: 0 }],
    settings: { timeZone: 'Europe/Bucharest', shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 2, safetyStockDays: 1 },
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

const verdictFlags = (run: ReturnType<typeof computePlan>) =>
  (run.validation?.materials ?? []).flatMap((m) => m.dataFlags)

describe('çevrim süresiyle plan (nut welding)', () => {
  it('yalnız çevrim süreli, rulosuz parça: 1200 adet × 0,25 dk = 300 dk, uyarısız', () => {
    const run = computePlan(plant({ cycleMinutes: 0.25 }, 1200), MONDAY_0700)
    expect(run.jobs).toHaveLength(1)
    const job = run.jobs[0]
    expect(job.press).toBe('APR-601')
    expect(job.quantity).toBe(1200)
    expect(job.shots).toBe(1200)
    expect(job.runMinutes).toBe(300)
    expect(job.reason).toContain('exact quantity (cycle time, no coil)')
    // Rulo / sac verisi yok ama çevrim süresi var: "no coil data" gürültüsü yok.
    expect(run.warnings.some((w) => w.includes('neither a Min. lot'))).toBe(false)
    expect(verdictFlags(run).some((f) => f.includes('lot size unknown') || f.includes('no cycle time'))).toBe(false)
  })

  it('Min. lot varsa o uygulanır', () => {
    const run = computePlan(plant({ cycleMinutes: 0.25, minLotQty: 2000 }, 300), MONDAY_0700)
    expect(run.jobs.reduce((s, j) => s + j.quantity, 0)).toBe(2000)
    expect(run.jobs[0].runMinutes).toBe(500)
  })

  it('ne çevrim süresi ne SPM: doğrulayıcı "no cycle time" der', () => {
    const run = computePlan(plant({}, 100), MONDAY_0700)
    expect(verdictFlags(run).some((f) => f.includes('NUT: no cycle time in master data.'))).toBe(true)
  })

  it('doğrulayıcı süre kuralında çevrim süresini kullanır (R8 kırılmaz)', () => {
    const run = computePlan(plant({ cycleMinutes: 0.25 }, 1200), MONDAY_0700)
    const r8 = run.validation?.rules.find((r) => r.id === 'lot-rules')
    expect(r8?.broken ?? 0).toBe(0)
    expect(r8?.label).toContain('not faster than the cycle time')
  })
})
