import { describe, expect, it } from 'vitest'

import { computePlan, type PlanInputs } from './planPipeline'
import { buildDemandSchedule, type ProductSpec } from './planning'
import { validatePlan } from './planValidator'

// Slayt 1 (2026-10-28): ZPP_DAILY yüklüyse SAP'nin günlük taahhüdü önce
// planlanır; haftalık ZPP'den gelen talep "uzun vade" lotudur ve yalnızca
// kalan boş kapasiteyi doldurur.

// Pazartesi 14 Eylül 2026, 07:00 Romanya — vardiya yeni başladı.
const MONDAY_0700 = Date.UTC(2026, 8, 14, 4, 0)

const daily = (material: string, days: [string, number][]) => ({
  material,
  periods: days.map(([label, qty]) => ({ label, qty: -qty })),
})

// Tek pres, günde tek vardiya (480 dk), 10 adet/dk, emniyet stoğu 2 gün.
// D: ZPP_DAILY'de Çarşamba 7000 adet (teslim Çar 08:00 → 700 dk üretim +
// 30 dk setup, Pazartesi + Salı + Çarşamba ilk saat = 1020 dk içinde).
// L: ZPP_DAILY'de yok, yalnızca haftalık ZPP'de W38 = 4000 (400 dk + 30).
// Önce L basılsaydı (430 dk) D 1160. dakikada biterdi: müşteri dururdu.
function plant(withDaily: boolean): PlanInputs {
  return {
    products: [
      { code: 'D', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104' },
      { code: 'L', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104' },
    ],
    weeklyDemand: [
      { material: 'D', overdue: 0, periods: [{ label: 'W38', qty: -7000 }] },
      { material: 'L', overdue: 0, periods: [{ label: 'W38', qty: -4000 }] },
    ],
    // ZPP_DAILY 18.09'a kadar (W38'in tamamı) — L'nin satırı yok.
    dailyDemand: withDaily ? [daily('D', [['2026-09-16', 7000], ['2026-09-18', 0]])] : [],
    stock: [],
    locations: [],
    presses: [{ name: '104', hall: 'H1' }],
    templates: [{ press: '104', workingDays: 5, shiftsPerDay: 1, overtimeShifts: 0 }],
    settings: { timeZone: 'Europe/Bucharest', shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 2, safetyStockDays: 2 },
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

describe('ZPP_DAILY first, weekly ZPP fills the free capacity', () => {
  it('places every daily lot first; the long-term lot only takes what is left', () => {
    const inputs = plant(true)
    const run = computePlan(inputs, MONDAY_0700)
    const d = run.jobs.find((j) => j.material === 'D')!
    const l = run.jobs.find((j) => j.material === 'L')!
    // D başta, zamanında (7000 adet, Çar 08:00'e hazır).
    expect(d.quantity).toBe(7000)
    expect(d.date).toBe('2026-09-14')
    expect(d.setupStartMinute).toBe(0)
    expect(d.late).toBe(false)
    expect(d.longTerm).toBeUndefined()
    // L uzun vade: D bittikten sonra (Salı), geç sayılmaz.
    expect(l.longTerm).toBe(true)
    expect(l.phase).toBe('fill')
    expect(l.late).toBe(false)
    expect(l.date).toBe('2026-09-15')
    expect(l.setupStartMinute).toBeGreaterThanOrEqual(730 - 480)
    expect(run.jobs.some((j) => j.late)).toBe(false)
    expect(l.reason).toContain('long-term')

    // Doğrulayıcı kendi kuralıyla: L'nin Pazartesi eksiği yalnızca uzun vade
    // adedidir, müşteri duruşu sayılmaz; D hiç eksiye düşmez.
    const v = validatePlan(inputs, run, MONDAY_0700)
    expect(v.summary.realStockouts).toBe(0)
    expect(v.summary.longTermShort).toBe(1)
    expect(v.summary.verdicts['engine-missed']).toBe(0)
  })

  it('without ZPP_DAILY nothing is long-term (behaviour unchanged)', () => {
    const run = computePlan(plant(false), MONDAY_0700)
    expect(run.jobs.some((j) => j.longTerm)).toBe(false)
    expect(run.unplanned.some((u) => u.longTerm)).toBe(false)
  })

  it('a long-term lot left without capacity never outranks a daily lot', () => {
    // Haftalık W39'da L için 50.000 adet (5000 dk): 2 haftalık ufka (4800 dk) sığmaz.
    const inputs = plant(true)
    inputs.weeklyDemand = [
      inputs.weeklyDemand[0],
      { material: 'L', overdue: 0, periods: [{ label: 'W38', qty: -4000 }, { label: 'W39', qty: -50000 }] },
    ]
    const run = computePlan(inputs, MONDAY_0700)
    const d = run.jobs.find((j) => j.material === 'D')!
    expect(d.late).toBe(false)
    expect(d.setupStartMinute).toBe(0)
    expect(run.unplanned.length).toBeGreaterThan(0)
    expect(run.unplanned.every((u) => u.longTerm)).toBe(true)
  })
})

describe('a week half covered by ZPP_DAILY is split, not mixed', () => {
  // ZPP_DAILY Çarşamba'ya kadar: Pzt 1000 + Çar 1000. Haftalık W38 = 5000 →
  // kalan 3000 Per–Cum (uzun vade). Rulo 2500 adet.
  const products = new Map<string, ProductSpec>([
    ['M', { code: 'M', moldCavities: 1, spm: 10, setupMinutes: 30, grossWeight: 1, coilWeight: 2500, mainMachine: '104' }],
  ])
  const row = {
    material: 'M',
    overdue: 0,
    periods: [{ label: 'W38', qty: -5000 }],
    stock: 0,
    daily: [
      { date: '2026-09-14', qty: 1000 },
      { date: '2026-09-16', qty: 1000 },
    ],
  }
  const options = {
    baseMonday: new Date(2026, 8, 14),
    horizonWeeks: 1,
    today: '2026-09-14',
    dailyUntil: '2026-09-16',
  }

  it('daily part: one coil for 2000; its 500 spare pcs reduce the long-term lot', () => {
    const lots = buildDemandSchedule([row], products, options)
    expect(lots.map((l) => [l.bucketLabel, l.qty, !!l.longTerm])).toEqual([
      ['W38', 2500, false],
      ['W38 LT', 2500, true],
    ])
    // Günlük lotun teslim noktaları yalnızca ZPP_DAILY günleri (Per–Cum değil).
    expect(lots[0].checkpoints?.map((c) => c.date)).toEqual(['2026-09-14', '2026-09-16'])
    expect(lots[0].phase).toBe('urgent')
    expect(lots[1].phase).toBe('fill')
    expect(lots[1].dueDate).toBe('2026-09-17')
  })

  it('without ZPP_DAILY the week stays one lot', () => {
    const { daily: _daily, ...weeklyOnly } = row
    void _daily
    const lots = buildDemandSchedule([weeklyOnly], products, { ...options, dailyUntil: null })
    expect(lots.map((l) => [l.bucketLabel, l.qty, !!l.longTerm])).toEqual([['W38', 5000, false]])
  })
})
