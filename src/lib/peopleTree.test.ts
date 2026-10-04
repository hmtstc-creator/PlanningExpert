import { describe, expect, it } from 'vitest'

import { draftAreaLevel, groupDraft, groupPayload, groupRow, peopleTree, userAreas, type PeopleGroup, type PeopleUser } from './peopleTree'

const planners: PeopleGroup = {
  _id: 'g1',
  name: 'Planners',
  allPlants: true,
  plantIds: [],
  permissions: { planning: 'view' },
  areas: { 'planning.calendar': 'edit' },
}
const users: PeopleUser[] = [
  { _id: 'u1', name: 'zeynep', active: true, isCreator: false, groupIds: ['g1'] },
  { _id: 'u2', name: 'ahmet', active: true, isCreator: true, groupIds: [] },
  { _id: 'u3', name: 'can', active: true, isCreator: false, groupIds: ['gone'] },
  { _id: 'u4', name: 'gen', active: true, isCreator: false, groupIds: [], platformRole: 'general' },
]

describe('peopleTree', () => {
  it('creatorlar, gruplar ve grubu olmayanlar; platform kullanıcıları yok', () => {
    const t = peopleTree(users, [planners])
    expect(t.creators.map((u) => u.name)).toEqual(['ahmet'])
    expect(t.groups[0].members.map((u) => u.name)).toEqual(['zeynep'])
    expect(t.noGroup.map((u) => u.name)).toEqual(['can'])
  })

  it('grup taslağı: modülle aynı alan yazılmaz, farklı olan yazılır', () => {
    const d = groupDraft(planners)
    expect(d.modules.planning).toBe('view')
    expect(d.areas['planning.calendar']).toBe('edit')
    expect(d.areas['planning.masterData']).toBe('')
    expect(draftAreaLevel(d, 'planning.masterData')).toBe('view')
    // Modül "edit" olunca takvimin ayrıca yazılması gereksizleşir.
    const p = groupPayload({ ...d, modules: { ...d.modules, planning: 'edit' } })
    expect(p.areas).toEqual({})
    expect(groupPayload(d).areas).toEqual({ 'planning.calendar': 'edit' })
  })

  it('matris satırı ve kullanıcının etkin izni', () => {
    expect(groupRow(planners)['planning.calendar']).toBe('edit')
    expect(groupRow(planners)['planning.sapData']).toBe('view')
    const company = { _id: 'c1', status: 'active' as const, modules: ['planning', 'oee'] }
    const a = userAreas(users[0], 'c1', { _id: 'p1', companyId: 'c1' }, company, [planners])
    expect(a['planning.calendar']).toBe('edit')
    expect(a['oee.data']).toBe('none')
    const cr = userAreas(users[1], 'c1', { _id: 'p1', companyId: 'c1' }, company, [])
    expect(cr['oee.settings']).toBe('edit')
    // Kiralanmamış modül: creator da göremez.
    expect(cr['kpi.entry']).toBe('none')
  })
})
