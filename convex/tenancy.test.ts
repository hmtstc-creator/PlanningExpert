// @vitest-environment edge-runtime
import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import schema from './schema'

/**
 * Fabrika ayrımının uçtan uca testi (docs/plant-genisletme.md): iki şirket,
 * aynı pres adları; her rol başkasının verisini okumayı ve değiştirmeyi
 * dener — hepsi reddedilmeli ya da boş dönmeli.
 */

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts', '!./planEngine.ts', '!./auth.ts'])
const api = anyApi
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

async function session(t: Any, userId: string, token: string) {
  await t.run((ctx: Any) => ctx.db.insert('sessions', { token, userId, createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 }))
  return token
}

async function settle(t: Any) {
  // Geçişin arka plan işlerini bitir (plan motoru bu testte yok: zamanlanmış hesap atlanır).
  for (let i = 0; i < 50; i++) {
    const done = await t.run(async (ctx: Any) => {
      const s = await ctx.db.query('platformState').first()
      return !!s?.value?.done
    })
    if (done) return
    await t.mutation(anyApi.tenancy.backfill, {})
  }
  throw new Error('migration did not finish')
}

/** Fabrika anahtarından önceki bir kurulum: kullanıcılar ve fabrika verisi anahtarsız. */
async function legacyInstall(t: Any) {
  return t.run(async (ctx: Any) => {
    const now = Date.now()
    const admin = await ctx.db.insert('users', { name: 'boss', role: 'admin', active: true, createdAt: now - 10 })
    const admin2 = await ctx.db.insert('users', { name: 'admin2', role: 'admin', active: true, createdAt: now })
    const planner = await ctx.db.insert('users', { name: 'pl', role: 'planner', active: true, createdAt: now })
    const viewer = await ctx.db.insert('users', { name: 'vw', role: 'viewer', active: true, createdAt: now })
    await ctx.db.insert('presses', { name: 'PRS-106', hall: 'H1' })
    await ctx.db.insert('presses', { name: 'PRS-107', hall: 'H1' })
    await ctx.db.insert('globalShiftSettings', { key: 'default', shiftMinutes: 480, overtimeShiftMinutes: 480, country: 'RO', timeZone: 'Europe/Bucharest' })
    return { admin, admin2, planner, viewer }
  })
}

describe('fabrika ayrımı', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('geçiş: eski veri Company 1 / Plant 1, roller korunur', async () => {
    const t = convexTest(schema, modules)
    const u = await legacyInstall(t)
    const boss = await session(t, u.admin, 'boss')
    // Geçiş bitmeden fabrika verisi okunmaz.
    await t.mutation(api.tenancy.startMigration, { token: boss })
    await expect(t.query(api.presses.list, { token: boss })).rejects.toThrow(/being prepared/)
    await settle(t)

    const users: Any = await t.run((ctx: Any) => ctx.db.query('users').collect())
    const by = (n: string) => users.find((x: Any) => x.name === n)
    expect(by('boss').platformRole).toBe('owner')
    expect(by('admin2').isCreator).toBe(true)
    expect(by('admin2').platformRole).toBeUndefined()
    expect(by('pl').groupIds).toHaveLength(1)

    const presses = await t.query(api.presses.list, { token: boss })
    expect(presses.map((p: Any) => p.name).sort()).toEqual(['PRS-106', 'PRS-107'])
    expect(presses[0].plantId).toBeUndefined()
    // Eski anahtarsız kayıt kalmadı.
    const left = await t.run((ctx: Any) => ctx.db.query('presses').withIndex('by_plant', (q: Any) => q.eq('plantId', undefined)).collect())
    expect(left).toEqual([])

    const pl = await session(t, u.planner, 'pl')
    expect((await t.query(api.presses.list, { token: pl })).length).toBe(2)
    await t.mutation(api.presses.upsert, { token: pl, name: 'PRS-108', hall: 'H2' })
    const vw = await session(t, u.viewer, 'vw')
    expect((await t.query(api.presses.list, { token: vw })).length).toBe(3)
    await expect(t.mutation(api.presses.upsert, { token: vw, name: 'PRS-109', hall: 'H2' })).rejects.toThrow(/edit permission/)
    // Tekrar başlatmak zararsız.
    await t.mutation(api.tenancy.startMigration, { token: boss })
    expect(((await t.run((ctx: Any) => ctx.db.query('companies').collect())) as Any[]).length).toBe(1)
  })

  it('iki şirket aynı pres adlarıyla birbirini göremez ve değiştiremez', async () => {
    const t = convexTest(schema, modules)
    const u = await legacyInstall(t)
    const boss = await session(t, u.admin, 'boss')
    await t.mutation(api.tenancy.startMigration, { token: boss })
    await settle(t)

    // General (owner) ikinci şirketi ve fabrikasını açar, creator atar.
    const c2 = await t.mutation(api.platform.createCompany, { token: boss, name: 'Other', modules: ['planning', 'oee', 'die', 'machine'] })
    const p2 = await t.mutation(api.platform.createPlant, { token: boss, companyId: c2, name: 'Bursa', country: 'TR', timeZone: 'Europe/Istanbul' })
    const cr2 = await t.mutation(api.users.add, { token: boss, companyId: c2, name: 'cr2', isCreator: true })
    const other = await session(t, cr2, 'cr2')

    // Yeni fabrika boş başlar; aynı adla pres ekler.
    expect(await t.query(api.presses.list, { token: other })).toEqual([])
    await t.mutation(api.presses.upsert, { token: other, name: 'PRS-106', hall: 'B1' })
    const mine = await t.query(api.presses.list, { token: other })
    expect(mine.map((p: Any) => `${p.name}/${p.hall}`)).toEqual(['PRS-106/B1'])

    // Company 1'in creator'ı Bursa'yı seçemez, Bursa'nın kaydını silemez.
    const a2 = await session(t, u.admin2, 'a2')
    await expect(t.mutation(api.tenancy.selectPlant, { token: a2, plantId: p2 })).rejects.toThrow(/no access/)
    const p1Presses = await t.query(api.presses.list, { token: a2 })
    expect(p1Presses.map((p: Any) => p.hall)).toEqual(['H1', 'H1'])
    await expect(t.mutation(api.presses.remove, { token: a2, id: mine[0]._id })).rejects.toThrow(/not found/)
    await expect(t.mutation(api.presses.remove, { token: other, id: p1Presses[0]._id })).rejects.toThrow(/not found/)
    // Başka şirketin kullanıcısını ve grubunu yönetemez.
    await expect(t.query(api.users.list, { token: a2, companyId: c2 })).rejects.toThrow(/creator of this company/)
    await expect(t.mutation(api.users.update, { token: other, id: u.planner, name: 'x', active: false })).rejects.toThrow(/creator of this company/)
    // General ekleme yalnızca owner'da.
    await expect(t.mutation(api.users.add, { token: other, companyId: null, name: 'g' })).rejects.toThrow(/site owner/)

    // Owner (general) iki fabrikayı da görür ve seçebilir.
    await t.mutation(api.tenancy.selectPlant, { token: boss, plantId: p2 })
    expect((await t.query(api.presses.list, { token: boss })).map((p: Any) => p.hall)).toEqual(['B1'])
    const ctx = await t.query(api.tenancy.context, { token: boss })
    expect(ctx.plants.length).toBe(2)
    expect(ctx.active.plantName).toBe('Bursa')
  })

  it('grup izni modül ve fabrika bazında; askıdaki şirket salt okunur', async () => {
    const t = convexTest(schema, modules)
    const u = await legacyInstall(t)
    const boss = await session(t, u.admin, 'boss')
    await t.mutation(api.tenancy.startMigration, { token: boss })
    await settle(t)
    const { companyId, plants } = await t.query(api.tenancy.context, { token: boss }).then((c: Any) => ({ companyId: c.plants[0].companyId, plants: c.plants }))
    const plant2 = await t.mutation(api.platform.createPlant, { token: boss, companyId, name: 'Plant 2', country: 'RO', timeZone: 'Europe/Bucharest' })
    // Bakım grubu: yalnızca Plant 2, Die düzenler, PlanningExpert yok.
    const g = await t.mutation(api.users.saveGroup, {
      token: boss, companyId, name: 'Die team', allPlants: false, plantIds: [plant2],
      permissions: { planning: 'none', oee: 'none', die: 'edit', machine: 'view' },
    })
    const m = await t.mutation(api.users.add, { token: boss, companyId, name: 'dt', groupIds: [g] })
    const dt = await session(t, m, 'dt')
    const c = await t.query(api.tenancy.context, { token: dt })
    expect(c.plants.map((p: Any) => p.name)).toEqual(['Plant 2'])
    expect(c.active.access).toEqual({ planning: 'none', oee: 'none', die: 'edit', machine: 'view' })
    await expect(t.mutation(api.tenancy.selectPlant, { token: dt, plantId: plants[0]._id })).rejects.toThrow(/no access/)
    await expect(t.query(api.planRuns.status, { token: dt })).rejects.toThrow(/view permission/)
    await t.mutation(api.moldProblems.report, { token: dt, material: 'M1', operation: 'OP10', problemType: 'Burr', occurredAt: '2026-10-01' })
    expect((await t.query(api.moldProblems.list, { token: dt })).length).toBe(1)
    // Plant 1'de bu problem görünmez.
    expect((await t.query(api.moldProblems.list, { token: boss })).length).toBe(0)

    // Şirket askıya alınır: düzenleme yok, okuma var.
    await t.mutation(api.platform.updateCompany, { token: boss, id: companyId, name: 'Company 1', modules: ['planning', 'oee', 'die', 'machine'], status: 'suspended' })
    await expect(t.mutation(api.moldProblems.report, { token: dt, material: 'M2', operation: 'OP10', problemType: 'Burr', occurredAt: '2026-10-01' })).rejects.toThrow(/edit permission/)
    expect((await t.query(api.moldProblems.list, { token: dt })).length).toBe(1)
    // Modül kapatılınca görünmez.
    await t.mutation(api.platform.updateCompany, { token: boss, id: companyId, name: 'Company 1', modules: ['planning', 'oee', 'machine'], status: 'active' })
    await expect(t.query(api.moldProblems.list, { token: dt })).rejects.toThrow(/view permission/)
  })

  it('dışa aktarım yalnızca kendi şirketi; kalıcı silme 90 gün sonra, yalnızca o şirketin verisi', async () => {
    const t = convexTest(schema, modules)
    const u = await legacyInstall(t)
    const boss = await session(t, u.admin, 'boss')
    await t.mutation(api.tenancy.startMigration, { token: boss })
    await settle(t)
    const c2 = await t.mutation(api.platform.createCompany, { token: boss, name: 'Other', modules: ['planning'] })
    const p2 = await t.mutation(api.platform.createPlant, { token: boss, companyId: c2, name: 'Bursa', country: 'TR', timeZone: 'Europe/Istanbul' })
    const cr2 = await t.mutation(api.users.add, { token: boss, companyId: c2, name: 'cr2', isCreator: true })
    const other = await session(t, cr2, 'cr2')
    await t.mutation(api.presses.upsert, { token: other, name: 'PRS-106', hall: 'B1' })

    // Creator kendi şirketini dışa aktarır; başka şirketi aktaramaz.
    const page = await t.query(api.platform.exportPage, { token: other, companyId: c2, plantId: p2, table: 'presses', cursor: null })
    expect(page.page.map((p: Any) => p.hall)).toEqual(['B1'])
    const c1 = (await t.query(api.tenancy.context, { token: boss })).plants.find((p: Any) => p.name === 'Plant 1')
    await expect(t.query(api.platform.exportPage, { token: other, companyId: c1.companyId, plantId: c1._id, table: 'presses', cursor: null })).rejects.toThrow(/creator of this company/)
    await expect(t.query(api.platform.exportPage, { token: other, companyId: c2, plantId: c1._id, table: 'presses', cursor: null })).rejects.toThrow(/Plant not found/)

    // Silme: önce askı, sonra 90 gün.
    await expect(t.mutation(api.platform.deleteCompany, { token: boss, id: c2, confirmName: 'Other' })).rejects.toThrow(/Suspend/)
    await t.mutation(api.platform.updateCompany, { token: boss, id: c2, name: 'Other', modules: ['planning'], status: 'suspended' })
    await expect(t.mutation(api.platform.deleteCompany, { token: boss, id: c2, confirmName: 'Other' })).rejects.toThrow(/after/)
    vi.setSystemTime(Date.now() + 91 * 86_400_000)
    // 91 gün sonra eski oturumlar düşmüştür: yeni oturum.
    await session(t, u.admin, 'boss91')
    await session(t, cr2, 'cr291')
    await expect(t.mutation(api.platform.deleteCompany, { token: 'cr291', id: c2, confirmName: 'Other' })).rejects.toThrow(/General/)
    await expect(t.mutation(api.platform.deleteCompany, { token: 'boss91', id: c2, confirmName: 'other' })).rejects.toThrow(/exactly/)
    await t.mutation(api.platform.deleteCompany, { token: 'boss91', id: c2, confirmName: 'Other' })
    for (let i = 0; i < 100; i++) {
      const done = await t.run(async (ctx: Any) => (await ctx.db.query('platformState').withIndex('by_key', (q: Any) => q.eq('key', `purge:${c2}`)).first())?.value?.done)
      if (done) break
      await t.mutation(anyApi.platform.purge, { key: `purge:${c2}` })
    }
    const left = await t.run(async (ctx: Any) => ({
      presses: (await ctx.db.query('presses').collect()).map((p: Any) => p.hall).sort(),
      users: (await ctx.db.query('users').collect()).map((x: Any) => x.name).sort(),
    }))
    expect(left.presses).toEqual(['H1', 'H1'])
    expect(left.users).not.toContain('cr2')
    // Plant 1 etkilenmedi.
    expect((await t.query(api.presses.list, { token: 'boss91' })).length).toBe(2)
  })

  it('karşılaştırma yalnızca OEE izni olan fabrikaları okur', async () => {
    const t = convexTest(schema, modules)
    const u = await legacyInstall(t)
    const boss = await session(t, u.admin, 'boss')
    await t.mutation(api.tenancy.startMigration, { token: boss })
    await settle(t)
    const c2 = await t.mutation(api.platform.createCompany, { token: boss, name: 'Other', modules: ['planning', 'oee'] })
    const p2 = await t.mutation(api.platform.createPlant, { token: boss, companyId: c2, name: 'Bursa', country: 'TR', timeZone: 'Europe/Istanbul' })
    const day = (plantId: string, op: number) => ({
      plantId, date: '2026-09-21', plantKey: '', responsible: '', costCenter: 'X', workCenter: 'W', source: 'shiftly',
      good: 1, scrap: 0, reject: 0, scheduledMin: 0, unscheduledMin: 0, operatingMin: op, productionMin: 100, loadingMin: 100,
    })
    const p1 = (await t.query(api.tenancy.context, { token: boss })).plants.find((p: Any) => p.name === 'Plant 1')._id
    await t.run(async (ctx: Any) => {
      await ctx.db.insert('oeeDays', day(p1, 60))
      await ctx.db.insert('oeeDays', day(p2, 80))
    })
    const all = await t.query(api.compare.oeeWeeks, { token: boss, endDate: '2026-09-27', weeks: 2 })
    expect(all.plants.map((p: Any) => [p.plantName, Math.round(p.total.oee * 100)])).toEqual([['Plant 1', 60], ['Bursa', 80]])
    // Company 1'in planlamacısı yalnızca kendi fabrikasını görür.
    const pl = await session(t, u.planner, 'pl')
    const mine = await t.query(api.compare.oeeWeeks, { token: pl, endDate: '2026-09-27', weeks: 2 })
    expect(mine.plants.map((p: Any) => p.plantName)).toEqual(['Plant 1'])
  })

  it('board member şirketin bütün fabrikalarını, fabrika müdürü yalnızca kendi fabrikasını görür', async () => {
    const t = convexTest(schema, modules)
    const u = await legacyInstall(t)
    const boss = await session(t, u.admin, 'boss')
    await t.mutation(api.tenancy.startMigration, { token: boss })
    await settle(t)
    const c = await t.query(api.tenancy.context, { token: boss })
    const companyId = c.plants[0].companyId
    const plant1 = c.plants[0]._id
    const plant2 = await t.mutation(api.platform.createPlant, { token: boss, companyId, name: 'Plant 2', country: 'RO', timeZone: 'Europe/Bucharest', costCenters: [{ code: '51010171', name: 'Transfer' }] })
    const board = await t.mutation(api.users.saveGroup, { token: boss, companyId, name: 'Board members', allPlants: true, plantIds: [], permissions: { planning: 'view', oee: 'view', die: 'view', machine: 'view' } })
    const pm = await t.mutation(api.users.saveGroup, { token: boss, companyId, name: 'Plant manager — Plant 2', allPlants: false, plantIds: [plant2], permissions: { planning: 'view', oee: 'edit', die: 'view', machine: 'view' } })
    const b = await session(t, await t.mutation(api.users.add, { token: boss, companyId, name: 'board', groupIds: [board] }), 'board')
    const m = await session(t, await t.mutation(api.users.add, { token: boss, companyId, name: 'pm', groupIds: [pm] }), 'pm')

    expect((await t.query(api.tenancy.context, { token: b })).plants.map((p: Any) => p.name).sort()).toEqual(['Plant 1', 'Plant 2'])
    await expect(t.mutation(api.presses.upsert, { token: b, name: 'X', hall: 'H' })).rejects.toThrow(/edit permission/)
    const pmCtx = await t.query(api.tenancy.context, { token: m })
    expect(pmCtx.plants.map((p: Any) => p.name)).toEqual(['Plant 2'])
    expect(pmCtx.active.costCenters).toEqual([{ code: '51010171', name: 'Transfer' }])
    await expect(t.mutation(api.tenancy.selectPlant, { token: m, plantId: plant1 })).rejects.toThrow(/no access/)
    // Fabrika müdürü kendi fabrikasının presini görür, Plant 1'inkileri göremez.
    expect(await t.query(api.presses.list, { token: m })).toEqual([])
    // Board member de başka şirketi görmez.
    const c2 = await t.mutation(api.platform.createCompany, { token: boss, name: 'Other', modules: ['planning'] })
    await t.mutation(api.platform.createPlant, { token: boss, companyId: c2, name: 'Bursa', country: 'TR', timeZone: 'Europe/Istanbul' })
    expect((await t.query(api.tenancy.context, { token: b })).plants.map((p: Any) => p.companyName)).not.toContain('Other')
  })

  it('aynı adla fabrika açılmaz; fazladan fabrika silinir; yükleme yalnızca fabrikanın masraf yerleri', async () => {
    const t = convexTest(schema, modules)
    const u = await legacyInstall(t)
    const boss = await session(t, u.admin, 'boss')
    await t.mutation(api.tenancy.startMigration, { token: boss })
    await settle(t)
    const c = await t.query(api.tenancy.context, { token: boss })
    const companyId = c.plants[0].companyId
    // Geçiş masraf yeri doldurmaz.
    expect(c.active.costCenters).toEqual([])
    await expect(t.mutation(api.platform.createPlant, { token: boss, companyId, name: 'plant 1', country: 'RO', timeZone: 'Europe/Bucharest' })).rejects.toThrow(/already exists/)
    await expect(t.mutation(api.platform.createCompany, { token: boss, name: 'company 1', modules: [] })).rejects.toThrow(/already exists/)
    const extra = await t.mutation(api.platform.createPlant, { token: boss, companyId, name: 'Extra', country: 'RO', timeZone: 'Europe/Bucharest' })
    await t.mutation(api.tenancy.selectPlant, { token: boss, plantId: extra })
    await t.mutation(api.presses.upsert, { token: boss, name: 'P', hall: 'H' })
    await expect(t.mutation(api.platform.deletePlant, { token: boss, id: extra, confirmName: 'extra' })).rejects.toThrow(/exactly/)
    await t.mutation(api.platform.deletePlant, { token: boss, id: extra, confirmName: 'Extra' })
    for (let i = 0; i < 100; i++) {
      const done = await t.run(async (ctx: Any) => (await ctx.db.query('platformState').withIndex('by_key', (q: Any) => q.eq('key', `purge:plant:${extra}`)).first())?.value?.done)
      if (done) break
      await t.mutation(anyApi.platform.purge, { key: `purge:plant:${extra}` })
    }
    // Oturum Plant 1'e döner, Plant 1'in presleri durur, Extra'nınki silindi.
    const after = await t.query(api.tenancy.context, { token: boss })
    expect(after.active.plantName).toBe('Plant 1')
    expect((await t.query(api.presses.list, { token: boss })).length).toBe(2)
    expect((await t.run((ctx: Any) => ctx.db.query('presses').collect())) as Any[]).toHaveLength(2)
    await expect(t.mutation(api.platform.deletePlant, { token: boss, id: after.active.plantId, confirmName: 'Plant 1' })).rejects.toThrow(/last plant/)

    // Yükleme: fabrikanın masraf yeri olmayan satır reddedilir.
    const row = {
      date: '2026-09-21', plantKey: '', responsible: '', costCenter: '51010171', workCenter: 'PRS-106', shiftGroup: 'UB64', shiftDefinition: '',
      good: 1, scrap: 0, reject: 0, scheduledMin: 0, unscheduledMin: 0, operatingMin: 1, productionMin: 1, loadingMin: 1,
      availability: 0, quality: 0, performance: 0, oee: 0,
    }
    await expect(t.mutation(api.oee.upsertShifts, { token: boss, rows: [row] })).rejects.toThrow(/not a cost center/)
    await t.mutation(api.platform.updatePlant, { token: boss, id: after.active.plantId, name: 'Plant 1', costCenters: [{ code: '51010171', name: 'Transfer' }] })
    await t.mutation(api.oee.upsertShifts, { token: boss, rows: [row] })
  })
})
