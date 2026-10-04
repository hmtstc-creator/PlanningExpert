import { describe, expect, it } from 'vitest'

import { categoryGroups, hallGroups, orgGroups, pressesIn, type WcCostCenter, type WcPress } from './workCenterTree'

const cc: WcCostCenter[] = [
  { code: '4100', name: 'Press A', department: 'Stamping' },
  { code: '4200', name: 'Press B', department: 'Stamping' },
  { code: '5100', name: 'Weld', department: 'Welding' },
  { code: '9000', name: 'Loose' },
]
const wc = (name: string, costCenter?: string, hall = '', category?: string): WcPress => ({ _id: name, name, hall, category, costCenter })
const presses = [wc('PRS-10', '4100', 'Hol 1', 'Transfer'), wc('PRS-2', '4100', 'Hol 1'), wc('PRS-3', '4200', ''), wc('W-1', '5100', 'Hol 2', 'Transfer'), wc('X-1', 'gone'), wc('Y-1')]

describe('workCenterTree', () => {
  it('organizasyon: bölüm → masraf yeri; bağsızlar ayrı', () => {
    const g = orgGroups(presses, cc, ['Stamping', 'Welding', 'Empty'])
    expect(g.departments.map((d) => d.name)).toEqual(['Stamping', 'Welding', 'Empty', ''])
    expect(g.departments[0].costCenters[0].presses.map((p) => p.name)).toEqual(['PRS-2', 'PRS-10'])
    expect(g.departments[3].costCenters.map((c) => c.code)).toEqual(['9000'])
    expect(g.unlinked.map((p) => p.name)).toEqual(['X-1', 'Y-1'])
  })

  it('kategori: boş kategori de görünür', () => {
    const g = categoryGroups(presses, ['Transfer', 'Progressive'])
    expect(g.categories.map((c) => [c.name, c.presses.length])).toEqual([
      ['Transfer', 2],
      ['Progressive', 0],
    ])
    expect(g.none).toHaveLength(4)
  })

  it('hol: holsüzler ayrı', () => {
    const g = hallGroups(presses)
    expect(g.halls.map((h) => h.name)).toEqual(['Hol 1', 'Hol 2'])
    expect(g.none.map((p) => p.name)).toEqual(['PRS-3', 'X-1', 'Y-1'])
  })

  it('düğüm süzgeci', () => {
    expect(pressesIn({ kind: 'department', name: 'Stamping' }, presses, cc).map((p) => p.name)).toEqual(['PRS-2', 'PRS-3', 'PRS-10'])
    expect(pressesIn({ kind: 'unlinked' }, presses, cc).map((p) => p.name)).toEqual(['X-1', 'Y-1'])
    expect(pressesIn({ kind: 'category', name: 'Transfer' }, presses, cc)).toHaveLength(2)
    expect(pressesIn({ kind: 'noHall' }, presses, cc)).toHaveLength(3)
    expect(pressesIn({ kind: 'workCenter', name: 'W-1' }, presses, cc)).toHaveLength(1)
    expect(pressesIn({ kind: 'plant' }, presses, cc)).toHaveLength(6)
  })
})
