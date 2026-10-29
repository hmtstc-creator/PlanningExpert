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

// Press bölümü: üç pres hattı + bir robot hattı; Assembly bölümü: nut
// welding. Hepsi planlanır (çevrim süresi). Bir pres de masraf yerisiz.
const costCenters: OrgCostCenter[] = [
  { code: '1100', name: 'Press line', department: 'Press' },
  { code: '1200', name: 'Transfer', department: 'Press' },
  { code: '2100', name: 'Nut welding', department: 'Assembly' },
  { code: '9900', name: 'Unassigned CC' },
]
const departments = ['Press', 'Assembly']
const presses: OrgPress[] = [
  { name: 'P1', costCenter: '1100' },
  { name: 'P2', costCenter: '1100' },
  { name: 'T1', costCenter: '1200' },
  { name: 'R1', costCenter: '1200' },
  { name: 'NW1', costCenter: '2100' },
  { name: 'X1', costCenter: '9900' },
  { name: 'Z1' },
  { name: 'Z2', costCenter: '7777' },
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
    const names = visibleWorkCenters(presses, costCenters, { department: 'Press', costCenters: [], workCenters: [] })
    expect([...names].sort()).toEqual(['P1', 'P2', 'R1', 'T1'])
  })

  it('cost center seçimi çoklu — birden çok masraf yeri birlikte görünür', () => {
    const names = visibleWorkCenters(presses, costCenters, { department: 'Press', costCenters: ['1200'], workCenters: [] })
    expect([...names].sort()).toEqual(['R1', 'T1'])
    const two = visibleWorkCenters(presses, costCenters, { department: '', costCenters: ['1100', '2100'], workCenters: [] })
    expect([...two].sort()).toEqual(['NW1', 'P1', 'P2'])
  })

  it('bölümsüzler seçilebilir: masraf yerisiz ve tanımsız kodlu iş yerleri', () => {
    const names = visibleWorkCenters(presses, costCenters, { department: UNASSIGNED, costCenters: [], workCenters: [] })
    expect([...names].sort()).toEqual(['X1', 'Z1', 'Z2'])
    const noCc = visibleWorkCenters(presses, costCenters, { department: '', costCenters: [UNASSIGNED], workCenters: [] })
    expect([...noCc].sort()).toEqual(['Z1', 'Z2'])
  })
})

describe('planOrgFilter: seçenekler', () => {
  it('bölüm listesi plant sırasında; her iş yeri sayılır (plan dışı yok)', () => {
    const { departments: opts } = planOrgOptions(presses, costCenters, departments, NO_ORG_FILTER)
    expect(opts.map((o) => o.value)).toEqual(['Press', 'Assembly', UNASSIGNED])
    expect(opts[0]).toEqual({ value: 'Press', label: 'Press', count: 4 })
    // Nut welding da planlanır: "0 WC + 1 not planned" bir daha çıkmaz.
    expect(opts[1]).toEqual({ value: 'Assembly', label: 'Assembly', count: 1 })
    expect(opts[2]).toMatchObject({ label: 'Without a department', count: 3 })
  })

  it('iş yeri olmayan bölüm / masraf yeri listeye girmez', () => {
    const { departments: opts, costCenters: cc } = planOrgOptions(
      [{ name: 'P1', costCenter: '1100' }],
      costCenters,
      [...departments, 'Maintenance'],
      NO_ORG_FILTER,
    )
    expect(opts.map((o) => o.value)).toEqual(['Press'])
    expect(cc.map((o) => o.value)).toEqual(['1100'])
  })

  it('masraf yeri listesi seçili bölüme daralır', () => {
    const { costCenters: cc } = planOrgOptions(presses, costCenters, departments, { department: 'Press', costCenters: [], workCenters: [] })
    expect(cc.map((o) => o.value)).toEqual(['1100', '1200'])
    expect(cc[0].label).toBe('1100 — Press line')
  })

  it('bölüm değişince o bölümde olmayan masraf yeri seçimi düşer', () => {
    const options = planOrgOptions(presses, costCenters, departments, { department: 'Assembly', costCenters: [], workCenters: [] })
    expect(pruneOrgSelection({ department: 'Assembly', costCenters: ['1100', '2100'], workCenters: [] }, options)).toEqual({
      department: 'Assembly',
      costCenters: ['2100'],
      workCenters: [],
    })
    // Hepsi geçerliyse aynı nesne döner (gereksiz render olmaz).
    const keep = { department: 'Assembly', costCenters: ['2100'], workCenters: [] }
    expect(pruneOrgSelection(keep, options)).toBe(keep)
  })

  it('tanımdan silinen bölüm seçiliyse süzgeç kapanır', () => {
    const options = planOrgOptions(presses, costCenters, departments, { department: 'Welding', costCenters: ['1100'], workCenters: [] })
    expect(pruneOrgSelection({ department: 'Welding', costCenters: ['1100'], workCenters: [] }, options)).toEqual(NO_ORG_FILTER)
  })
})

describe('planOrgFilter: iş yeri kademesi', () => {
  it('iş yeri listesi seçili bölüm + masraf yerine göre daralır', () => {
    const all = planOrgOptions(presses, costCenters, departments, NO_ORG_FILTER)
    expect(all.workCenters).toEqual(['NW1', 'P1', 'P2', 'R1', 'T1', 'X1', 'Z1', 'Z2'])

    const press = planOrgOptions(presses, costCenters, departments, { department: 'Press', costCenters: [], workCenters: [] })
    expect(press.workCenters).toEqual(['P1', 'P2', 'R1', 'T1'])

    const transfer = planOrgOptions(presses, costCenters, departments, { department: 'Press', costCenters: ['1200'], workCenters: [] })
    expect(transfer.workCenters).toEqual(['R1', 'T1'])
  })

  it('iş yeri seçimi listeyi daraltmaz: seçim geri alınabilir kalır', () => {
    const picked = planOrgOptions(presses, costCenters, departments, { department: 'Press', costCenters: [], workCenters: ['P1'] })
    expect(picked.workCenters).toEqual(['P1', 'P2', 'R1', 'T1'])
  })

  it('seçili iş yerleri görünümü daraltır; süzgeç etkin sayılır', () => {
    const selection = { department: '', costCenters: [], workCenters: ['P2', 'NW1'] }
    expect(orgFilterActive(selection)).toBe(true)
    expect([...visibleWorkCenters(presses, costCenters, selection)].sort()).toEqual(['NW1', 'P2'])
  })

  it('bölüm değişince o bölümde olmayan iş yeri seçimi düşer', () => {
    const options = planOrgOptions(presses, costCenters, departments, { department: 'Assembly', costCenters: [], workCenters: [] })
    expect(pruneOrgSelection({ department: 'Assembly', costCenters: [], workCenters: ['P1', 'NW1'] }, options)).toEqual({
      department: 'Assembly',
      costCenters: [],
      workCenters: ['NW1'],
    })
  })
})
