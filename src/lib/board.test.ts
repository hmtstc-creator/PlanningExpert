import { describe, expect, it } from 'vitest'

import { attention, childrenOf, declining, departmentOwner, departmentsOf, scopeSeries, seriesFor, type BoardPlant } from './board'
import { isBoardUser, accessFor } from './tenancy'
import { trendSlots, type KpiEntry } from './kpi'

const slots = trendSlots('month', 2026, 3)
const e = (num: number, cc: string, plan: KpiEntry['plan'], actual: KpiEntry['actual']): KpiEntry => ({ period: 'month', year: 2026, num, costCenter: cc, operatorType: 'direct', plan, actual })
const plant = (id: string, company: string, entries: KpiEntry[], oee: BoardPlant['oee'] = []): BoardPlant => ({
  plantId: id, plantName: id, companyId: company, companyName: company, holdingId: 'h', holdingName: 'Group',
  costCenters: [{ code: 'A', name: 'Press A' }, { code: 'B', name: 'Press B' }], entries, oee,
})

describe('Board Dashboard', () => {
  const p1 = plant('P1', 'C1', [e(3, 'A', { presenceHours: 100, productionHours: 80 }, { presenceHours: 100, productionHours: 60 })], [{ costCenter: 'A', good: 1, operatingMin: 50, productionMin: 80, loadingMin: 100, slot: '2026-03' }])
  const p2 = plant('P2', 'C1', [e(3, 'B', { presenceHours: 300, productionHours: 240 }, { presenceHours: 300, productionHours: 270 })], [{ costCenter: 'B', good: 1, operatingMin: 270, productionMin: 300, loadingMin: 300, slot: '2026-03' }])
  const p3 = plant('P3', 'C2', [e(3, 'A', { presenceHours: 100, productionHours: 50 }, { presenceHours: 100, productionHours: 50 })])

  it('grup toplamı toplamlardan; her şirketin kendi planı', () => {
    const r = seriesFor([p1, p2, p3], slots)[2]
    expect(r.plan.efficiency).toBeCloseTo((80 + 240 + 50) / 500)
    expect(r.actual.efficiency).toBeCloseTo((60 + 270 + 50) / 500)
    expect(r.actual.oee).toBeCloseTo((50 + 270) / 400)
  })

  it('kırılım: grup → şirket → plant → masraf yeri', () => {
    expect(childrenOf([p1, p2, p3], {}, slots).map((n) => n.label)).toEqual(['C1', 'C2'])
    expect(childrenOf([p1, p2, p3], { companyId: 'C1' }, slots).map((n) => n.label)).toEqual(['P1', 'P2'])
    const ccs = childrenOf([p1, p2, p3], { companyId: 'C1', plantId: 'P1' }, slots)
    expect(ccs.map((n) => n.label)).toEqual(['Press A', 'Press B'])
    expect(ccs[0].drill).toBeNull()
  })

  it('bölüm seviyesi (K7): plant → bölüm → masraf yeri; bölümsüz olan ayrı düğüm', () => {
    const d: BoardPlant = {
      ...plant('P9', 'C9', [
        e(3, 'A', { presenceHours: 100, productionHours: 80 }, { presenceHours: 100, productionHours: 60 }),
        e(3, 'B', { presenceHours: 100, productionHours: 80 }, { presenceHours: 100, productionHours: 90 }),
        e(3, 'C', { presenceHours: 200, productionHours: 100 }, { presenceHours: 200, productionHours: 100 }),
      ]),
      departments: ['Welding', 'Stamping'],
      costCenters: [
        { code: 'A', name: 'Press A', department: 'Stamping' },
        { code: 'B', name: 'Press B', department: 'Stamping' },
        { code: 'C', name: 'Old line' },
      ],
    }
    // Masraf yeri olmayan Welding gösterilmez; bölümsüz olan en sonda.
    expect(departmentsOf(d)).toEqual(['Stamping', ''])
    const depts = childrenOf([d], { companyId: 'C9', plantId: 'P9' }, slots)
    expect(depts.map((n) => n.label)).toEqual(['Stamping', 'Without a department'])
    expect(depts[0].drill).toEqual({ companyId: 'C9', plantId: 'P9', department: 'Stamping' })
    // Stamping: (60 + 90) ÷ 200 = %75 gerçekleşen, plan (80 + 80) ÷ 200 = %80.
    expect(depts[0].bySlot[2].actual.efficiency).toBeCloseTo(0.75)
    expect(depts[0].bySlot[2].plan.efficiency).toBeCloseTo(0.8)
    const scope = { companyId: 'C9', plantId: 'P9', department: 'Stamping' }
    expect(childrenOf([d], scope, slots).map((n) => n.label)).toEqual(['Press A', 'Press B'])
    expect(scopeSeries([d], scope, slots)[2].actual.efficiency).toBeCloseTo(0.75)
    expect(attention([d], scope, slots, 2, 'efficiency').map((x) => x.label)).toEqual(['Press A'])
    // Bölüm sorumlusu (K7): satırda ve kapsam başlığında; bölümsüz düğümde yok.
    const owned = { ...d, departmentOwners: [{ department: 'Stamping', name: 'Ana Pop' }] }
    expect(childrenOf([owned], { companyId: 'C9', plantId: 'P9' }, slots).map((n) => n.owner)).toEqual(['Ana Pop', undefined])
    expect(departmentOwner(owned, 'Stamping')).toBe('Ana Pop')
    expect(departmentOwner(owned, '')).toBeUndefined()
    // Bölümü olmayan plant bugünkü gibi doğrudan masraf yerlerine iner.
    expect(childrenOf([p1], { companyId: 'C1', plantId: 'P1' }, slots).map((n) => n.label)).toEqual(['Press A', 'Press B'])
  })

  it('dikkat listesi: plana en uzak olan önce; kötüleşen trend', () => {
    const list = attention([p1, p2, p3], {}, slots, 2, 'efficiency')
    expect(list.map((x) => x.label)).toEqual(['C1 · P1'])
    const down = seriesFor([plant('X', 'C', [e(1, 'A', {}, { presenceHours: 100, productionHours: 90 }), e(2, 'A', {}, { presenceHours: 100, productionHours: 80 }), e(3, 'A', {}, { presenceHours: 100, productionHours: 70 })])], slots)
    expect(declining(down, 2, 'efficiency')).toBe(true)
    expect(declining(down, 2, 'overtimePct')).toBe(false)
  })

  it('board görünümü: holding üyesi ya da yalnızca board grubunda', () => {
    const company = { _id: 'C1', holdingId: 'h', status: 'active' as const, modules: ['planning', 'oee', 'kpi'] }
    const h = { _id: 'u', holdingId: 'h' }
    expect(isBoardUser(h, [])).toBe(true)
    expect(accessFor(h, { _id: 'P1', companyId: 'C1' }, company, [])).toEqual({ planning: 'none', oee: 'view', die: 'none', machine: 'none', kpi: 'view' })
    expect(accessFor(h, { _id: 'P9', companyId: 'C9' }, { ...company, _id: 'C9', holdingId: 'other' }, []).kpi).toBe('none')
    const g = { _id: 'g', companyId: 'C1', allPlants: true, plantIds: [], permissions: { kpi: 'view' as const }, board: true }
    expect(isBoardUser({ _id: 'b', companyId: 'C1', groupIds: ['g'] }, [g])).toBe(true)
    expect(isBoardUser({ _id: 'b', companyId: 'C1', groupIds: ['g'], isCreator: true }, [g])).toBe(false)
    expect(isBoardUser({ _id: 'b', companyId: 'C1', groupIds: ['g', 'x'] }, [g, { ...g, _id: 'x', board: false }])).toBe(false)
  })
})
