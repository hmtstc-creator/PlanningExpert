import { describe, expect, it } from 'vitest'

import {
  NO_ORG_FILTER,
  UNASSIGNED,
  costCenterOf,
  departmentOf,
  orgFilterActive,
  planOrgOptions,
  pruneOrgSelection,
  visibleWorkCenters,
  type OrgCostCenter,
  type OrgPress,
} from './planOrgFilter'

// Press bölümü: iki pres hattı + bir cycle hattı; Assembly bölümü: yalnız
// cycle (nut welding) — pres planına girmez. Bir pres de masraf yerisiz.
const costCenters: OrgCostCenter[] = [
  { code: '1100', name: 'Press line', department: 'Press' },
  { code: '1200', name: 'Transfer', department: 'Press' },
  { code: '2100', name: 'Nut welding', department: 'Assembly' },
  { code: '9900', name: 'Unassigned CC' },
]
const departments = ['Press', 'Assembly']
const presses: OrgPress[] = [
  { name: 'P1', costCenter: '1100', rateModel: 'stroke' },
  { name: 'P2', costCenter: '1100', rateModel: 'stroke' },
  { name: 'T1', costCenter: '1200', rateModel: 'stroke' },
  { name: 'R1', costCenter: '1200', rateModel: 'cycle' },
  { name: 'NW1', costCenter: '2100', rateModel: 'cycle' },
  { name: 'X1', costCenter: '9900', rateModel: 'stroke' },
  { name: 'Z1', rateModel: 'stroke' },
  { name: 'Z2', costCenter: '7777', rateModel: 'stroke' },
]

describe('planOrgFilter: iş yerinin yeri', () => {
  it('masraf yeri yok ya da plant\'te tanımlı değil → UNASSIGNED', () => {
    expect(costCenterOf({ name: 'P1', costCenter: '1100' }, costCenters)).toBe('1100')
    expect(costCenterOf({ name: 'Z1' }, costCenters)).toBe(UNASSIGNED)
    expect(costCenterOf({ name: 'Z2', costCenter: '7777' }, costCenters)).toBe(UNASSIGNED)
  })

  it('bölüm masraf yerinden gelir; bölümsüz masraf yeri UNASSIGNED', () => {
    expect(departmentOf({ name: 'P1', costCenter: '1100' }, costCenters)).toBe('Press')
    expect(departmentOf({ name: 'NW1', costCenter: '2100' }, costCenters)).toBe('Assembly')
    expect(departmentOf({ name: 'X1', costCenter: '9900' }, costCenters)).toBe(UNASSIGNED)
    expect(departmentOf({ name: 'Z1' }, costCenters)).toBe(UNASSIGNED)
  })
})

describe('planOrgFilter: görünür iş yerleri', () => {
  it('süzgeç kapalıysa hepsi görünür', () => {
    expect(orgFilterActive(NO_ORG_FILTER)).toBe(false)
    expect(visibleWorkCenters(presses, costCenters, NO_ORG_FILTER).size).toBe(presses.length)
  })

  it('bölüm seçimi o bölümün iş yerlerini bırakır', () => {
    const names = visibleWorkCenters(presses, costCenters, { department: 'Press', costCenters: [] })
    expect([...names].sort()).toEqual(['P1', 'P2', 'R1', 'T1'])
  })

  it('cost center seçimi çoklu — birden çok masraf yeri birlikte görünür', () => {
    const names = visibleWorkCenters(presses, costCenters, { department: 'Press', costCenters: ['1200'] })
    expect([...names].sort()).toEqual(['R1', 'T1'])
    const two = visibleWorkCenters(presses, costCenters, { department: '', costCenters: ['1100', '2100'] })
    expect([...two].sort()).toEqual(['NW1', 'P1', 'P2'])
  })

  it('bölümsüzler seçilebilir: masraf yerisiz ve tanımsız kodlu iş yerleri', () => {
    const names = visibleWorkCenters(presses, costCenters, { department: UNASSIGNED, costCenters: [] })
    expect([...names].sort()).toEqual(['X1', 'Z1', 'Z2'])
    const noCc = visibleWorkCenters(presses, costCenters, { department: '', costCenters: [UNASSIGNED] })
    expect([...noCc].sort()).toEqual(['Z1', 'Z2'])
  })
})

describe('planOrgFilter: seçenekler', () => {
  it('bölüm listesi plant sırasında, sayılar plan içi / plan dışı ayrı', () => {
    const { departments: opts } = planOrgOptions(presses, costCenters, departments, NO_ORG_FILTER)
    expect(opts.map((o) => o.value)).toEqual(['Press', 'Assembly', UNASSIGNED])
    expect(opts[0]).toMatchObject({ label: 'Press', planned: 3, other: 1 })
    // Nut welding yalnız cycle: bölümde planlanacak iş yeri yok.
    expect(opts[1]).toMatchObject({ label: 'Assembly', planned: 0, other: 1 })
    expect(opts[2]).toMatchObject({ label: 'Without a department', planned: 3, other: 0 })
  })

  it('iş yeri olmayan bölüm / masraf yeri listeye girmez', () => {
    const { departments: opts, costCenters: cc } = planOrgOptions(
      [{ name: 'P1', costCenter: '1100', rateModel: 'stroke' }],
      costCenters,
      [...departments, 'Maintenance'],
      NO_ORG_FILTER,
    )
    expect(opts.map((o) => o.value)).toEqual(['Press'])
    expect(cc.map((o) => o.value)).toEqual(['1100'])
  })

  it('masraf yeri listesi seçili bölüme daralır', () => {
    const { costCenters: cc } = planOrgOptions(presses, costCenters, departments, { department: 'Press', costCenters: [] })
    expect(cc.map((o) => o.value)).toEqual(['1100', '1200'])
    expect(cc[0].label).toBe('1100 — Press line')
  })

  it('bölüm değişince o bölümde olmayan masraf yeri seçimi düşer', () => {
    const options = planOrgOptions(presses, costCenters, departments, { department: 'Assembly', costCenters: [] })
    expect(pruneOrgSelection({ department: 'Assembly', costCenters: ['1100', '2100'] }, options)).toEqual({
      department: 'Assembly',
      costCenters: ['2100'],
    })
    // Hepsi geçerliyse aynı nesne döner (gereksiz render olmaz).
    const keep = { department: 'Assembly', costCenters: ['2100'] }
    expect(pruneOrgSelection(keep, options)).toBe(keep)
  })

  it('tanımdan silinen bölüm seçiliyse süzgeç kapanır', () => {
    const options = planOrgOptions(presses, costCenters, departments, { department: 'Welding', costCenters: ['1100'] })
    expect(pruneOrgSelection({ department: 'Welding', costCenters: ['1100'] }, options)).toEqual(NO_ORG_FILTER)
  })
})
