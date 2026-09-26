import { describe, expect, it } from 'vitest'

import { buildRawRequirements, rawMrp } from './rawMrp'

const weeks = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'].map((start, i) => ({ start, label: `W${39 + i}` }))

describe('raw material MRP (plan independent)', () => {
  it('nets finished stock first-in-first-out, then converts to kg', () => {
    const plan = buildRawRequirements({
      products: [{ code: 'A', rawMaterialCode: 'R1', grossWeight: 2 }],
      weeklyDemand: [{ material: 'A', overdue: -100, periods: [{ label: 'W39', qty: -500 }, { label: 'W40', qty: -1000 }] }],
      finishedStock: new Map([['A', 400]]),
      rawStock: new Map([['R1', 1000]]),
      weeks,
    })
    // Talep 600 / 1000; stok 400 → net 200 / 1000 → 400 kg / 2000 kg.
    expect(plan.items[0].needKg).toEqual([400, 2000, 0, 0])
    expect(plan.items[0].stockKg).toBe(1000)
  })

  it('co-products: the pair is pressed once, steel counted on the primary part only', () => {
    const plan = buildRawRequirements({
      products: [
        { code: 'L', coProduct: 'R', rawMaterialCode: 'S1', grossWeight: 1, moldCavities: 1 },
        { code: 'R', rawMaterialCode: 'S1', grossWeight: 1, moldCavities: 1 },
      ],
      weeklyDemand: [
        { material: 'L', periods: [{ label: 'W39', qty: -300 }] },
        { material: 'R', periods: [{ label: 'W39', qty: -500 }] },
      ],
      finishedStock: new Map(),
      rawStock: new Map(),
      weeks,
    })
    // 500 vuruş (büyük olan) × 1 kg; R ikinci kez sayılmaz.
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0].needKg[0]).toBe(500)
    expect(plan.items[0].materials).toEqual(['L'])
  })

  it('lists parts whose need cannot be converted to steel', () => {
    const plan = buildRawRequirements({
      products: [{ code: 'A', grossWeight: 2 }],
      weeklyDemand: [{ material: 'A', periods: [{ label: 'W39', qty: -10 }] }, { material: 'X', periods: [{ label: 'W39', qty: -5 }] }],
      finishedStock: new Map(),
      rawStock: new Map(),
      weeks,
    })
    expect(plan.missingSpec).toEqual([
      { material: 'A', pieces: 10, reason: 'no raw material code' },
      { material: 'X', pieces: 5, reason: 'not in master data' },
    ])
  })

  it('every week end holds the next N working days (10 = 2 weeks) and each order gets the extra', () => {
    // 7 000 kg/hafta, 5 iş günü. 10 iş günü emniyet = sonraki iki haftanın tüketimi.
    const r = rawMrp(
      { rawMaterial: 'R1', materials: ['A'], stockKg: 0, needKg: [7000, 7000, 7000, 7000] },
      { coverageDays: 10, extraKg: 500, workingDaysPerWeek: 5 },
    )
    // Hafta 1: tüketim 7 000 + emniyet 14 000 = 21 000 → 21 500 sipariş.
    expect(r.rows[0].safetyKg).toBe(14000)
    expect(r.rows[0].orderKg).toBe(21500)
    expect(r.rows[0].stockEndKg).toBe(14500)
    // Hafta 2: 14 500 başı; gereken 21 000 → 6 500 + 500 = 7 000.
    expect(r.rows[1].orderKg).toBe(7000)
    // Son haftalar: ZPP'den sonrası talep yok, emniyet de yok → sipariş yok.
    expect(r.rows[2].safetyKg).toBe(7000)
    expect(r.rows[2].orderKg).toBe(0)
    expect(r.rows[3].safetyKg).toBe(0)
    expect(r.rows[3].orderKg).toBe(0)
    for (const row of r.rows) expect(row.stockEndKg).toBeGreaterThanOrEqual(row.safetyKg)
  })

  it('no demand, no order — nothing is forecast beyond the last ZPP week', () => {
    const none = rawMrp({ rawMaterial: 'R1', materials: [], stockKg: 0, needKg: [0, 0, 0, 0] }, { coverageDays: 10, extraKg: 500 })
    expect(none.totalOrderKg).toBe(0)
    const once = rawMrp({ rawMaterial: 'R1', materials: [], stockKg: 0, needKg: [7000, 0, 0, 0] }, { coverageDays: 10, extraKg: 500 })
    expect(once.rows.map((r) => r.orderKg)).toEqual([7500, 0, 0, 0])
  })

  it('in-transit coils arrive in their ETA week and replace an order', () => {
    const plan = buildRawRequirements({
      products: [{ code: 'A', rawMaterialCode: 'R1', grossWeight: 1 }],
      weeklyDemand: [{ material: 'A', periods: weeks.map((w) => ({ label: w.label, qty: -7000 })) }],
      finishedStock: new Map(),
      rawStock: new Map([['R1', 21000]]),
      inTransit: [
        { material: 'R1', quantityKg: 7000, eta: '2026-09-30', poNumber: 'PO1' },
        { material: 'R1', quantityKg: 1000 },
        { material: 'R1', quantityKg: 5000, eta: '2026-12-01' },
      ],
      weeks,
    })
    const item = plan.items[0]
    // Tarihsiz → ilk hafta; 30 Eylül → ikinci hafta; ufkun ötesi yürütmeye girmez.
    expect(item.inTransitKg).toEqual([1000, 7000, 0, 0])
    expect(item.inTransit?.map((l) => l.week)).toEqual([0, 1, -1])
    const r = rawMrp(item, { coverageDays: 10, extraKg: 500, workingDaysPerWeek: 5 })
    // 21 000 + 1 000 stok, hafta 1 için 21 000 gerekir → sipariş yok; hafta 2'de
    // 15 000 + 7 000 yoldan = 22 000 ≥ 7 000 + 7 000 → yine yok.
    expect(r.rows[0].orderKg).toBe(0)
    expect(r.rows[1].inTransitKg).toBe(7000)
    expect(r.rows[1].orderKg).toBe(0)
    expect(r.totalOrderKg).toBe(0)
    expect(r.totalInTransitKg).toBe(8000)
  })

  it('no order while stock covers need + safety; weeks of cover without orders', () => {
    const r = rawMrp({ rawMaterial: 'R1', materials: [], stockKg: 20000, needKg: [3500, 3500, 3500, 3500] }, { coverageDays: 10, extraKg: 500 })
    expect(r.rows[0].orderKg).toBe(0)
    expect(r.coversWeeks).toBeNull()
    const short = rawMrp({ rawMaterial: 'R1', materials: [], stockKg: 5000, needKg: [3500, 3500, 3500, 3500] }, { coverageDays: 10, extraKg: 500 })
    expect(short.coversWeeks).toBe(1.4)
  })
})

describe('raw material MRP in the plan output', () => {
  it('uses demand minus finished stock, not the planned coils', async () => {
    const { computePlan } = await import('./planPipeline')
    const run = computePlan(
      {
        products: [{ code: 'A', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104', rawMaterialCode: 'R1', grossWeight: 1, coilWeight: 6000 }],
        weeklyDemand: [{ material: 'A', overdue: -100, periods: [{ label: 'W38', qty: -1000 }, { label: 'W39', qty: -2000 }] }],
        stock: [
          { material: 'A', storageLocation: '2009', unrestricted: 600 },
          { material: 'R1', storageLocation: '1009', unrestricted: 1500 },
          // Tanımlı ama "Raw material" tiki olmayan depo: sayılmaz.
          { material: 'R1', storageLocation: 'QC', unrestricted: 900 },
          // Tiki olan depo: sayılır.
          { material: 'R1', storageLocation: 'RAW', unrestricted: 200 },
        ],
        locations: [
          { code: 'QC', category: 'quality' },
          { code: 'RAW', category: 'finished_goods', countRaw: true, countFinished: false },
        ],
        presses: [{ name: '104', hall: 'H1' }],
        templates: [{ press: '104', workingDays: 5, shiftsPerDay: 1, overtimeShifts: 0 }],
        settings: { shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 2, maxScenarios: 2 },
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
      },
      Date.UTC(2026, 8, 14, 4, 0),
    )
    const r1 = run.rawRequirements!.items.find((i) => i.rawMaterial === 'R1')!
    // Plan 6 000'lik rulo basar; MRP ise talep − stok: 1 100 − 600 = 500, sonra 2 000.
    expect(r1.needKg).toEqual([500, 2000])
    expect(r1.stockKg).toBe(1700)
  })
})
