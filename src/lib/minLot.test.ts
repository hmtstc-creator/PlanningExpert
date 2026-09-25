import { describe, expect, it } from 'vitest'

import { computeRunPlan, lotRuleOf, piecesPerCoil } from './planning'
import { computePlan, type PlanInputs } from './planPipeline'

// Pazartesi 14 Eylül 2026, 07:00 Romanya.
const MONDAY_0700 = Date.UTC(2026, 8, 14, 4, 0)

function plant(product: Record<string, unknown>, overdue: number, nextWeek = 0): PlanInputs {
  return {
    products: [{ code: 'T', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '106', ...product }],
    weeklyDemand: [{ material: 'T', overdue: -overdue, periods: [{ label: 'W38', qty: 0 }, { label: 'W39', qty: nextWeek }] }],
    stock: [],
    locations: [],
    presses: [{ name: '106', hall: 'Transfer', feedsCoil: false }],
    templates: [{ press: '106', workingDays: 5, shiftsPerDay: 3, overtimeShifts: 0 }],
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

const total = (run: ReturnType<typeof computePlan>) => run.jobs.reduce((s, j) => s + j.quantity, 0)

describe('Min. lot replaces the coil', () => {
  it('lot rule: min. lot if set, else coil, else missing', () => {
    expect(lotRuleOf({ code: 'A', minLotQty: 2000, coilWeight: 1, grossWeight: 0.3 })).toBe('minLot')
    expect(lotRuleOf({ code: 'A', coilWeight: 8000, grossWeight: 2 })).toBe('coil')
    expect(lotRuleOf({ code: 'A', coilWeight: 1, grossWeight: 0.3 })).toBe('missing')
    expect(lotRuleOf({ code: 'A' })).toBe('missing')
  })

  it('a 1 kg placeholder coil is never split into tiny coils', () => {
    const spec = { code: 'A', coilWeight: 1, grossWeight: 0.3, spm: 10 }
    expect(piecesPerCoil(spec)).toBe(0)
    const run = computeRunPlan(spec, 1000)
    expect(run.coilsNeeded).toBe(0)
    expect(run.coilRunMinutes).toHaveLength(1)
  })

  it('raises a small need to the min. lot', () => {
    const run = computePlan(plant({ minLotQty: 2000, coilWeight: 1, grossWeight: 0.3 }, 300), MONDAY_0700)
    expect(total(run)).toBe(2000)
    expect(run.jobs[0].reason).toContain('min. lot 2,000')
    expect(run.jobs[0].coilsNeeded).toBe(0)
  })

  it('produces exactly the need above the min. lot (not a multiple)', () => {
    const run = computePlan(plant({ minLotQty: 2000 }, 2500), MONDAY_0700)
    expect(total(run)).toBe(2500)
  })

  it('the surplus covers the following week', () => {
    // 300 bakiye → 2000 basılır; gelecek haftanın 1000'i artandan karşılanır.
    const run = computePlan(plant({ minLotQty: 2000 }, 300, 1000), MONDAY_0700)
    expect(total(run)).toBe(2000)
    expect(run.jobs).toHaveLength(1)
  })

  it('ignores the coil when a min. lot is set', () => {
    const run = computePlan(plant({ minLotQty: 2000, coilWeight: 8000, grossWeight: 2 }, 300), MONDAY_0700)
    expect(total(run)).toBe(2000)
  })

  it('warns when a part has neither a min. lot nor a real coil', () => {
    const run = computePlan(plant({ coilWeight: 1, grossWeight: 0.3 }, 300), MONDAY_0700)
    expect(total(run)).toBe(300)
    expect(run.warnings.some((w) => w.includes('neither a Min. lot nor a real coil weight') && w.includes('T'))).toBe(true)
    expect(run.jobs[0].reason).toContain('no Min. lot')
  })

  it('does not warn for a part with a real coil', () => {
    const run = computePlan(plant({ coilWeight: 6000, grossWeight: 1 }, 300), MONDAY_0700)
    expect(total(run)).toBe(6000)
    expect(run.warnings.some((w) => w.includes('neither a Min. lot'))).toBe(false)
  })
})
