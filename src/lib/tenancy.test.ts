import { describe, expect, it } from 'vitest'

import { accessFor, allows, canManageCompany, type CompanyLike, type GroupLike, type PlantLike } from './tenancy'
import { boardAllows, moduleOfPath } from './plantContext'

const company: CompanyLike = { _id: 'c1', status: 'active', modules: ['planning', 'oee', 'die', 'machine'] }
const p1: PlantLike = { _id: 'p1', companyId: 'c1' }
const p2: PlantLike = { _id: 'p2', companyId: 'c1', disabledModules: ['oee'] }
const board: GroupLike = { _id: 'g1', companyId: 'c1', allPlants: true, plantIds: [], permissions: { planning: 'view', oee: 'view' } }
const eng: GroupLike = { _id: 'g2', companyId: 'c1', allPlants: false, plantIds: ['p1'], permissions: { planning: 'edit' } }

describe('yetki kuralları', () => {
  it('gruplar birleşir, en geniş izin geçerli; fabrika kapsamı', () => {
    const u = { _id: 'u', companyId: 'c1', groupIds: ['g1', 'g2'] }
    expect(accessFor(u, p1, company, [board, eng])).toEqual({ planning: 'edit', oee: 'view', die: 'none', machine: 'none', kpi: 'none' })
    // p2'de mühendis grubu yok; OEE bu fabrikada kapalı.
    expect(accessFor(u, p2, company, [board, eng])).toEqual({ planning: 'view', oee: 'none', die: 'none', machine: 'none', kpi: 'none' })
  })

  it('creator şirketin her yerinde düzenler; başka şirkette hiçbir şey', () => {
    const cr = { _id: 'c', companyId: 'c1', isCreator: true }
    expect(allows(accessFor(cr, p1, company, []), ['die'], 'edit')).toBe(true)
    expect(accessFor(cr, { _id: 'x', companyId: 'c2' }, { ...company, _id: 'c2' }, [])).toEqual({ planning: 'none', oee: 'none', die: 'none', machine: 'none', kpi: 'none' })
    expect(canManageCompany(cr, 'c1')).toBe(true)
    expect(canManageCompany(cr, 'c2')).toBe(false)
  })

  it('askıdaki şirket salt okunur; kapalı modül görünmez; platform her şeyi görür', () => {
    const cr = { _id: 'c', companyId: 'c1', isCreator: true }
    expect(accessFor(cr, p1, { ...company, status: 'suspended' }, []).planning).toBe('view')
    expect(accessFor(cr, p1, { ...company, modules: ['planning'] }, []).oee).toBe('none')
    expect(accessFor({ _id: 'g', platformRole: 'general' }, p2, company, []).oee).toBe('edit')
  })

  it('sayfanın modülü yoldan', () => {
    expect(moduleOfPath('/oee/losses')).toBe('oee')
    expect(moduleOfPath('/die-followup/problems')).toBe('die')
    expect(moduleOfPath('/planlama')).toBe('planning')
    expect(moduleOfPath('/platform')).toBe(null)
    expect(moduleOfPath('/')).toBe(null)
    expect(moduleOfPath('/compare')).toBe(null)
    expect(moduleOfPath('/admin')).toBe(null)
    expect(moduleOfPath('/settings')).toBe(null)
    expect(moduleOfPath('/account')).toBe(null)
    expect(moduleOfPath('/tani')).toBe(null)
  })

  it('board görünümü: dashboard\'lar, hesap ve teşhis açık; giriş sayfaları kapalı', () => {
    expect(boardAllows('/board')).toBe(true)
    expect(boardAllows('/account')).toBe(true)
    expect(boardAllows('/tani/')).toBe(true)
    expect(boardAllows('/settings')).toBe(false)
    expect(boardAllows('/kpi/monthly/entry')).toBe(false)
  })
})
