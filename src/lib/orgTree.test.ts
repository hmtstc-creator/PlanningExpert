import { describe, expect, it } from 'vitest'

import {
  addCostCenter,
  countsOf,
  departmentsOf,
  editCostCenter,
  orphanCompanies,
  plantAccessRows,
  removeDepartment,
  renameDepartment,
  structureIssues,
  unassignedOf,
  unlinkedWorkCenters,
  workCentersOf,
  type OrgCompany,
  type OrgGroup,
  type OrgPlant,
} from './orgTree'

const plant: OrgPlant = {
  _id: 'p1',
  companyId: 'c1',
  name: 'Romania',
  departments: ['Stamping', 'Welding'],
  costCenters: [
    { code: 'A', name: 'Press A', department: 'Stamping' },
    { code: 'B', name: 'Press B', department: 'Stamping' },
    { code: 'OLD', name: 'Legacy' },
  ],
  workCenters: [{ name: 'PRS-106', costCenter: 'A' }, { name: 'PRS-107', costCenter: 'A' }, { name: 'PRS-108' }, { name: 'PRS-109', costCenter: 'GONE' }],
}
const company: OrgCompany = { _id: 'c1', name: 'Metal', status: 'active', modules: ['planning', 'oee', 'kpi'], holdingId: 'h1', plants: [plant] }

describe('organizasyon ağacı', () => {
  it('bölümler sırasıyla masraf yerleriyle; bölümsüzler ayrı', () => {
    expect(departmentsOf(plant).map((d) => [d.name, d.costCenters.map((c) => c.code)])).toEqual([
      ['Stamping', ['A', 'B']],
      ['Welding', []],
    ])
    expect(unassignedOf(plant).map((c) => c.code)).toEqual(['OLD'])
    expect(countsOf([company])).toEqual({ companies: 1, plants: 1, departments: 2, costCenters: 3, workCenters: 4 })
    expect(workCentersOf(plant, 'A').map((w) => w.name)).toEqual(['PRS-106', 'PRS-107'])
    // Bağsız ya da fabrikada olmayan koda bağlı work center.
    expect(unlinkedWorkCenters(plant).map((w) => w.name)).toEqual(['PRS-108', 'PRS-109'])
  })

  it('eksikler tepeden aşağı: holding’siz şirket, boş holding, aynı adlı plant, boş bölüm, bölümsüz masraf yeri', () => {
    const loose: OrgCompany = { ...company, _id: 'c2', name: 'Hala5', holdingId: undefined, plants: [{ _id: 'p2', companyId: 'c2', name: 'Smartcar' }] }
    const twin: OrgCompany = { ...company, _id: 'c3', name: 'Twin', plants: [{ _id: 'p3', companyId: 'c3', name: 'Stamping', departments: ['X'], costCenters: [{ code: 'X1', name: 'X1', department: 'X' }] }, { _id: 'p4', companyId: 'c3', name: 'stamping ', departments: ['X'], costCenters: [{ code: 'X2', name: 'X2', department: 'X' }] }] }
    const holdings = [{ _id: 'h1', name: 'Group' }, { _id: 'h2', name: 'Empty' }]
    expect(orphanCompanies(holdings, [company, loose]).map((c) => c.name)).toEqual(['Hala5'])
    expect(structureIssues(holdings, [company, loose, twin]).map((i) => i.text)).toEqual([
      'Hala5 has no holding — link it to one',
      'Empty has no company yet',
      'Metal › Romania › Welding: no cost center yet',
      'Metal › Romania: 1 cost center without a department',
      'Metal › Romania: 2 work centers without a cost center (PRS-108, PRS-109)',
      'Hala5 › Smartcar: no department yet',
      'Twin: two plants are named stamping  — merge or rename one',
    ])
  })

  it('bölüm adı değişince masraf yerleri yeni adla gelir; masraf yeri bölüm değiştirir', () => {
    const r = renameDepartment(plant, 'Stamping', ' Press shop ')
    expect(r.departments).toEqual(['Press shop', 'Welding'])
    expect(r.costCenters.filter((c) => c.department === 'Press shop').map((c) => c.code)).toEqual(['A', 'B'])
    expect(editCostCenter(plant, 'OLD', { department: 'Welding' }).costCenters.find((c) => c.code === 'OLD')?.department).toBe('Welding')
    expect(removeDepartment(plant, 'Welding').departments).toEqual(['Stamping'])
    expect(addCostCenter(plant, { code: ' C ', name: '', department: 'Welding' }).costCenters.at(-1)).toEqual({ code: 'C', name: 'C', department: 'Welding' })
  })

  it('plant’i gören kullanıcılar: creator her şeyi, grup üyesi grubunun izniyle; kapsamayan grup görünmez', () => {
    const groups: OrgGroup[] = [
      { _id: 'g1', companyId: 'c1', name: 'Plant manager', allPlants: false, plantIds: ['p1'], permissions: { oee: 'edit', kpi: 'view' } },
      { _id: 'g2', companyId: 'c1', name: 'Other plant', allPlants: false, plantIds: ['p9'], permissions: { planning: 'edit' } },
    ]
    const users = [
      { _id: 'u1', name: 'zeynep', active: true, isCreator: false, groupIds: ['g1', 'g2'] },
      { _id: 'u2', name: 'ahmet', active: true, isCreator: true, groupIds: [] },
      { _id: 'u3', name: 'can', active: true, isCreator: false, groupIds: ['g2'] },
    ]
    const rows = plantAccessRows(plant, company, users, groups)
    expect(rows.map((r) => [r.user.name, r.via])).toEqual([
      ['ahmet', ['Creator']],
      ['zeynep', ['Plant manager']],
    ])
    // Şirketin kiralamadığı modül (die) creator'da da yok.
    expect(rows[0].access).toEqual({ planning: 'edit', oee: 'edit', die: 'none', machine: 'none', kpi: 'edit' })
    expect(rows[1].access).toEqual({ planning: 'none', oee: 'edit', die: 'none', machine: 'none', kpi: 'view' })
  })
})
