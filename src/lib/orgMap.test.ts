import { describe, expect, it } from 'vitest'

import { dropAction, duplicatePlants, findNodes, nodeEdits, peopleGraph, plantLocaleHint, removeAction, structureGraph, warningsOf, type MapGroup, type MapUser } from './orgMap'
import type { OrgCompany, OrgHolding } from './orgTree'

const holdings: OrgHolding[] = [{ _id: 'h1', name: 'Group A' }]
const companies: OrgCompany[] = [
  {
    _id: 'c1',
    name: 'Metal Stamping',
    status: 'active',
    modules: [],
    holdingId: 'h1',
    plants: [
      {
        _id: 'p1',
        companyId: 'c1',
        name: 'Stamping',
        departments: ['Press'],
        costCenters: [
          { code: '100', name: 'Line 1', department: 'Press' },
          { code: '200', name: 'Line 2' },
        ],
        workCenters: [{ name: 'P1', costCenter: '100' }, { name: 'P9' }],
      },
      { _id: 'p2', companyId: 'c1', name: 'stamping ', departments: [] },
    ],
  },
  { _id: 'c2', name: 'Hala5', status: 'active', modules: [], plants: [] },
]
const none = () => false

describe('structureGraph', () => {
  const g = structureGraph(holdings, companies, none)
  const node = (id: string) => g.nodes.find((n) => n.id === id)!

  it('puts every level in its own column, parents between their children', () => {
    expect(node('h:h1').x).toBeLessThan(node('c:c1').x)
    expect(node('c:c1').x).toBeLessThan(node('p:p1').x)
    expect(node('cc:p1:100').x).toBeLessThan(node('wc:p1:P1').x)
    const kids = g.edges.filter((e) => e.source === 'p:p1').map((e) => node(e.target).y)
    expect(node('p:p1').y).toBe((Math.min(...kids) + Math.max(...kids)) / 2)
  })

  it('shows the gaps: no holding, same-named plants, loose cost centers and work centers', () => {
    expect(g.edges.some((e) => e.source === 'h:' && e.target === 'c:c2')).toBe(true)
    expect(duplicatePlants(companies[0])).toEqual(new Set(['p1', 'p2']))
    expect(node('p:p2').warnings.join()).toContain('same name')
    expect(node('cc:p1:200').ref).toMatchObject({ kind: 'costCenter', department: undefined })
    expect(g.edges.some((e) => e.source === 'd:p1:' && e.target === 'cc:p1:200')).toBe(true)
    expect(g.edges.some((e) => e.source === 'cc:p1:' && e.target === 'wc:p1:P9')).toBe(true)
    // Hepsi tek listede: No holding, iki plant, bölümsüz plant, Without a department, No cost center.
    expect(warningsOf(g).length).toBe(6)
  })

  it('a closed node hides its children and still reports their issues', () => {
    const closed = structureGraph(holdings, companies, (id) => id === 'p:p1')
    expect(closed.nodes.some((n) => n.id === 'cc:p1:100')).toBe(false)
    expect(closed.nodes.find((n) => n.id === 'p:p1')!.warnings.join()).toContain('2 issues inside')
  })

  it('drag and drop: company → holding (General), cost center → department of the same plant', () => {
    const ctx = { canLinkHoldings: true, edges: g.edges }
    expect(dropAction(node('c:c2'), node('h:h1'), ctx)).toMatchObject({ kind: 'companyHolding', companyId: 'c2', holdingId: 'h1' })
    expect(dropAction(node('c:c1'), node('h:h1'), ctx)).toBeNull() // zaten orada
    expect(dropAction(node('c:c2'), node('h:h1'), { ...ctx, canLinkHoldings: false })).toBeNull()
    expect(dropAction(node('cc:p1:200'), node('d:p1:Press'), ctx)).toMatchObject({ kind: 'costCenterDepartment', code: '200', department: 'Press' })
    expect(dropAction(node('cc:p1:100'), node('d:p1:Press'), ctx)).toBeNull()
    expect(dropAction(node('cc:p1:200'), node('d:p1:'), ctx)).toBeNull() // sanal kutu hedef değil
    expect(dropAction(node('p:p1'), node('c:c2'), ctx)).toBeNull() // plant taşınmaz
  })

  it('finds nodes by name or code', () => {
    expect(findNodes(g.nodes, 'STAMP').map((n) => n.id)).toEqual(expect.arrayContaining(['p:p1', 'p:p2', 'c:c1']))
    expect(findNodes(g.nodes, '200').map((n) => n.id)).toContain('cc:p1:200')
  })
})

describe('peopleGraph', () => {
  const groups: MapGroup[] = [
    { _id: 'g1', name: 'Planners', allPlants: false, plantIds: ['p1'] },
    { _id: 'g2', name: 'Managers', allPlants: true, plantIds: [] },
  ]
  const users: MapUser[] = [
    { _id: 'u1', name: 'Ayşe', active: true, isCreator: false, groupIds: ['g1'] },
    { _id: 'u2', name: 'Can', active: true, isCreator: false, groupIds: [] },
    { _id: 'u3', name: 'Deniz', active: true, isCreator: true, groupIds: [] },
  ]
  const g = peopleGraph(companies[0], users, groups)
  const node = (id: string) => g.nodes.find((n) => n.id === id)!

  it('reads left to right: plant → group → user; an all-plants group hangs from the company', () => {
    expect(g.edges.filter((e) => e.kind === 'access').map((e) => e.id).sort()).toEqual(['c:c1>g:g2', 'p:p1>g:g1'])
    expect(g.edges.filter((e) => e.kind === 'member').map((e) => e.id)).toEqual(['g:g1>u:u1'])
    // Hiçbir kenar sağdan sola dönmez.
    for (const e of g.edges) expect(node(e.source).x, e.id).toBeLessThan(node(e.target).x)
    expect(node('u:u2').warnings[0]).toContain('In no group')
    expect(node('u:u3').warnings).toEqual([])
  })

  it('drag adds a link, clicking a line removes it; all-plants groups are left alone', () => {
    const ctx = { canLinkHoldings: false, edges: g.edges, users, groups }
    expect(dropAction(node('u:u2'), node('g:g1'), ctx)).toMatchObject({ kind: 'userGroup', userId: 'u2', groupId: 'g1', add: true })
    expect(dropAction(node('u:u1'), node('g:g1'), ctx)).toBeNull()
    expect(dropAction(node('g:g1'), node('p:p2'), ctx)).toMatchObject({ kind: 'groupPlant', plantId: 'p2', add: true })
    expect(dropAction(node('g:g2'), node('p:p2'), ctx)).toBeNull()
    const member = g.edges.find((e) => e.id === 'g:g1>u:u1')!
    expect(removeAction(member, g.nodes, groups)).toMatchObject({ kind: 'userGroup', userId: 'u1', groupId: 'g1', add: false })
    expect(removeAction(g.edges.find((e) => e.id === 'p:p1>g:g1')!, g.nodes, groups)).toMatchObject({ kind: 'groupPlant', groupId: 'g1', plantId: 'p1', add: false })
    expect(removeAction(g.edges.find((e) => e.id === 'c:c1>g:g2')!, g.nodes, groups)).toBeNull()
  })
})

describe('nodeEdits', () => {
  it('holding and company are edited only by General', () => {
    expect(nodeEdits({ kind: 'holding', id: 'h1' }, true)).toEqual({ rename: true, add: 'company', remove: true })
    expect(nodeEdits({ kind: 'holding', id: 'h1' }, false)).toEqual({ rename: false, add: null, remove: false })
    expect(nodeEdits({ kind: 'company', id: 'c1' }, false)).toEqual({ rename: false, add: 'plant', remove: false })
  })
  it('plant, department and cost center can be edited; cost center has no child to add', () => {
    expect(nodeEdits({ kind: 'plant', id: 'p1', companyId: 'c1' }, false).add).toBe('department')
    expect(nodeEdits({ kind: 'department', plantId: 'p1', name: 'Press' }, false).add).toBe('costCenter')
    expect(nodeEdits({ kind: 'costCenter', plantId: 'p1', code: '171' }, false)).toEqual({ rename: true, add: null, remove: true })
  })
  it('work centers, groups, users and virtual boxes point elsewhere', () => {
    expect(nodeEdits({ kind: 'workCenter', plantId: 'p1', name: 'P1' }, true).elsewhere).toBe('Work Center Definitions')
    expect(nodeEdits({ kind: 'user', id: 'u1', companyId: 'c1' }, true).elsewhere).toBe('Users & permissions')
    expect(nodeEdits({ kind: 'virtual' }, true)).toEqual({ rename: false, add: null, remove: false })
  })
})

describe('plantLocaleHint', () => {
  it('takes country and time zone from a plant of the company', () => {
    const c: OrgCompany = { ...companies[0], plants: [{ _id: 'p9', companyId: 'c1', name: 'X', country: 'RO', timeZone: 'Europe/Bucharest' }] }
    expect(plantLocaleHint(c)).toEqual({ country: 'RO', timeZone: 'Europe/Bucharest' })
    expect(plantLocaleHint({ ...c, plants: [] })).toEqual({ country: '', timeZone: '' })
  })
})
