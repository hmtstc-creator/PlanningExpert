// @vitest-environment edge-runtime
import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import schema from './schema'
import { tokenKey } from './sessionStore'

/**
 * Fabrika ayrımının uçtan uca testi (docs/plant-genisletme.md): iki şirket,
 * aynı pres adları; her rol başkasının verisini okumayı ve değiştirmeyi
 * dener — hepsi reddedilmeli ya da boş dönmeli.
 */

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts', '!./planEngine.ts', '!./auth.ts'])
const api = anyApi
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** Oturum, girişin yazdığı biçimde: jetonun karması (sessionStore.ts). */
async function session(t: Any, userId: string, token: string) {
  await t.run((ctx: Any) => ctx.db.insert('sessions', { token: tokenKey(token), userId, createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 }))
  return token
}

/** Şirket bir holding'in altında açılır. */
async function holding(t: Any, token: string, name = 'Group') {
  return t.mutation(anyApi.platform.saveHolding, { token, name })
}

/** Fabrikaya bir bölüm ve masraf yeri (CC) — work center masraf yerisiz açılmaz. */
async function withCostCenter(t: Any, plantId: string, code = 'CC') {
  await t.run((ctx: Any) => ctx.db.patch(plantId, { departments: ['D'], costCenters: [{ code, name: code, department: 'D' }] }))
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
    await withCostCenter(t, (await t.query(api.tenancy.context, { token: pl })).active.plantId)
    await t.mutation(api.presses.upsert, { token: pl, name: 'PRS-108', hall: 'H2', costCenter: 'CC' })
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
    const c2 = await t.mutation(api.platform.createCompany, { token: boss, name: 'Other', modules: ['planning', 'oee', 'die', 'machine'], holdingId: await holding(t, boss, 'H Other') })
    const p2 = await t.mutation(api.platform.createPlant, { token: boss, companyId: c2, name: 'Bursa', country: 'TR', timeZone: 'Europe/Istanbul' })
    const cr2 = await t.mutation(api.users.add, { token: boss, companyId: c2, name: 'cr2', isCreator: true })
    const other = await session(t, cr2, 'cr2')

    // Yeni fabrika boş başlar; aynı adla pres ekler.
    expect(await t.query(api.presses.list, { token: other })).toEqual([])
    await withCostCenter(t, p2)
    await t.mutation(api.presses.upsert, { token: other, name: 'PRS-106', hall: 'B1', costCenter: 'CC' })
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
    expect(c.active.access).toEqual({ planning: 'none', oee: 'none', die: 'edit', machine: 'view', kpi: 'none' })
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
    const c2 = await t.mutation(api.platform.createCompany, { token: boss, name: 'Other', modules: ['planning'], holdingId: await holding(t, boss, 'H Other') })
    const p2 = await t.mutation(api.platform.createPlant, { token: boss, companyId: c2, name: 'Bursa', country: 'TR', timeZone: 'Europe/Istanbul' })
    const cr2 = await t.mutation(api.users.add, { token: boss, companyId: c2, name: 'cr2', isCreator: true })
    const other = await session(t, cr2, 'cr2')
    await withCostCenter(t, p2)
    await t.mutation(api.presses.upsert, { token: other, name: 'PRS-106', hall: 'B1', costCenter: 'CC' })

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
    const c2 = await t.mutation(api.platform.createCompany, { token: boss, name: 'Other', modules: ['planning', 'oee'], holdingId: await holding(t, boss, 'H Other') })
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
    const plant2 = await t.mutation(api.platform.createPlant, { token: boss, companyId, name: 'Plant 2', country: 'RO', timeZone: 'Europe/Bucharest', departments: ['Stamping'], costCenters: [{ code: '51010171', name: 'Transfer', department: 'Stamping' }] })
    const board = await t.mutation(api.users.saveGroup, { token: boss, companyId, name: 'Board members', allPlants: true, plantIds: [], permissions: { planning: 'view', oee: 'view', die: 'view', machine: 'view' } })
    const pm = await t.mutation(api.users.saveGroup, { token: boss, companyId, name: 'Plant manager — Plant 2', allPlants: false, plantIds: [plant2], permissions: { planning: 'view', oee: 'edit', die: 'view', machine: 'view' } })
    const b = await session(t, await t.mutation(api.users.add, { token: boss, companyId, name: 'board', groupIds: [board] }), 'board')
    const m = await session(t, await t.mutation(api.users.add, { token: boss, companyId, name: 'pm', groupIds: [pm] }), 'pm')

    expect((await t.query(api.tenancy.context, { token: b })).plants.map((p: Any) => p.name).sort()).toEqual(['Plant 1', 'Plant 2'])
    await expect(t.mutation(api.presses.upsert, { token: b, name: 'X', hall: 'H' })).rejects.toThrow(/edit permission/)
    const pmCtx = await t.query(api.tenancy.context, { token: m })
    expect(pmCtx.plants.map((p: Any) => p.name)).toEqual(['Plant 2'])
    expect(pmCtx.active.costCenters).toEqual([{ code: '51010171', name: 'Transfer', department: 'Stamping' }])
    await expect(t.mutation(api.tenancy.selectPlant, { token: m, plantId: plant1 })).rejects.toThrow(/no access/)
    // Fabrika müdürü kendi fabrikasının presini görür, Plant 1'inkileri göremez.
    expect(await t.query(api.presses.list, { token: m })).toEqual([])
    // Board member de başka şirketi görmez.
    const c2 = await t.mutation(api.platform.createCompany, { token: boss, name: 'Other', modules: ['planning'], holdingId: await holding(t, boss, 'H Other') })
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
    await expect(t.mutation(api.platform.createCompany, { token: boss, name: 'company 1', modules: [], holdingId: await holding(t, boss, 'H company 1') })).rejects.toThrow(/already exists/)
    const extra = await t.mutation(api.platform.createPlant, { token: boss, companyId, name: 'Extra', country: 'RO', timeZone: 'Europe/Bucharest' })
    await t.mutation(api.tenancy.selectPlant, { token: boss, plantId: extra })
    await withCostCenter(t, extra)
    await t.mutation(api.presses.upsert, { token: boss, name: 'P', hall: 'H', costCenter: 'CC' })
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
    await t.mutation(api.platform.updatePlant, { token: boss, id: after.active.plantId, name: 'Plant 1', departments: ['Stamping'], costCenters: [{ code: '51010171', name: 'Transfer', department: 'Stamping' }] })
    await t.mutation(api.oee.upsertShifts, { token: boss, rows: [row] })

    // Sipariş: aynı tarih + makine + vardiya + sipariş tek kayıttır. Eski dosyada "Equipment"
    // malzeme koduydu; yeni dosya (Var_Equipment = kalıp) aynı satırı düzeltir, yanına eklemez.
    const order = {
      date: '2026-09-21', plant: '5101', plantName: 'Romanya Martur', workCenter: 'PRS-106', shift: 'UB64', order: '6597582',
      equipment: 'M315SP024', material: 'PROGRESSIVE-DIE-6', good: 10, scrap: 0, reject: 0, scheduledMin: 0, unscheduledMin: 0,
      operatingMin: 1, productionMin: 1, loadingMin: 1, availability: 0, quality: 0, performance: 0, oee: 0,
    }
    await t.mutation(api.oee.upsertOrders, { token: boss, rows: [order, { ...order, order: '6597583' }] })
    await t.mutation(api.oee.upsertOrders, { token: boss, rows: [{ ...order, equipment: 'PROGRESSIVE-DIE-6', material: 'M315SP024', good: 12 }] })
    const orders = (await t.query(api.oee.orders, { token: boss, from: '2026-09-21', to: '2026-09-21' })) as Any[]
    expect(orders.map((o) => [o.order, o.equipment, o.material, o.good]).sort()).toEqual([
      ['6597582', 'PROGRESSIVE-DIE-6', 'M315SP024', 12],
      ['6597583', 'M315SP024', 'PROGRESSIVE-DIE-6', 10],
    ])
  })

  it('KPI: yalnızca fabrikanın masraf yerleri; dashboard yalnızca KPI izinli fabrikalar; OEE kök verisi', async () => {
    const t = convexTest(schema, modules)
    const u = await legacyInstall(t)
    const boss = await session(t, u.admin, 'boss')
    await t.mutation(api.tenancy.startMigration, { token: boss })
    await settle(t)
    const c = await t.query(api.tenancy.context, { token: boss })
    const companyId = c.plants[0].companyId
    const p1 = c.active.plantId
    await t.mutation(api.platform.updatePlant, { token: boss, id: p1, name: 'Plant 1', departments: ['Stamping'], costCenters: [{ code: 'CC1', name: 'Press', department: 'Stamping' }] })
    const p2 = await t.mutation(api.platform.createPlant, { token: boss, companyId, name: 'Plant 2', country: 'RO', timeZone: 'Europe/Bucharest', departments: ['Stamping'], costCenters: [{ code: 'CC1', name: 'Press', department: 'Stamping' }] })

    const row = { costCenter: 'CC1', operatorType: 'direct', plan: { presenceHours: 100, overtimeHours: 10, oee: 0.8 }, actual: { presenceHours: 90, overtimeHours: 20 } }
    await expect(t.mutation(api.kpi.save, { token: boss, period: 'month', year: 2026, num: 9, rows: [{ ...row, costCenter: 'X' }] })).rejects.toThrow(/not a cost center/)
    await t.mutation(api.kpi.save, { token: boss, period: 'month', year: 2026, num: 9, rows: [row] })
    // İki satır (Direct + Indirect), sonra birini kaldırma.
    await t.mutation(api.kpi.save, { token: boss, period: 'month', year: 2026, num: 9, rows: [{ ...row, actual: { presenceHours: 95 } }, { ...row, operatorType: 'indirect', plan: { operators: 3, absenteeism: 0.04 } }] })
    let mine = await t.query(api.kpi.entries, { token: boss, period: 'month', year: 2026, num: 9 })
    expect(mine.entries.map((x: Any) => [x.line, x.operatorType])).toEqual([[0, 'direct'], [1, 'indirect']])
    expect(mine.entries[0].actual).toEqual({ presenceHours: 95 })
    await expect(t.mutation(api.kpi.save, { token: boss, period: 'month', year: 2026, num: 9, rows: [{ ...row, plan: { absenteeism: 3.5 } }] })).rejects.toThrow(/percentage/)
    await t.mutation(api.kpi.save, { token: boss, period: 'month', year: 2026, num: 9, rows: [{ ...row, actual: { presenceHours: 95 } }] })
    mine = await t.query(api.kpi.entries, { token: boss, period: 'month', year: 2026, num: 9 })
    expect(mine.entries).toHaveLength(1)
    await t.run(async (ctx: Any) => {
      await ctx.db.insert('oeeDays', { plantId: p1, date: '2026-09-21', plantKey: '', responsible: '', costCenter: 'CC1', workCenter: 'W', source: 'shiftly', good: 5, scrap: 0, reject: 0, scheduledMin: 0, unscheduledMin: 0, operatingMin: 60, productionMin: 90, loadingMin: 100 })
    })
    const d = await t.query(api.kpi.dashboard, { token: boss, period: 'month', year: 2026, num: 9, plantIds: [p1, p2] })
    expect(d.slots).toHaveLength(12)
    expect(d.plants.map((p: Any) => p.entries.length)).toEqual([1, 0])
    expect(d.plants[0].oee).toEqual([{ costCenter: 'CC1', good: 5, operatingMin: 60, productionMin: 90, loadingMin: 100, slot: '2026-09' }])

    // Yalnızca Plant 2'de KPI izni olan kullanıcı Plant 1'i dashboard'a ekleyemez.
    const g = await t.mutation(api.users.saveGroup, { token: boss, companyId, name: 'KPI P2', allPlants: false, plantIds: [p2], permissions: { kpi: 'view' } })
    const k = await session(t, await t.mutation(api.users.add, { token: boss, companyId, name: 'kp', groupIds: [g] }), 'kp')
    await expect(t.query(api.kpi.dashboard, { token: k, period: 'month', year: 2026, num: 9, plantIds: [p1] })).rejects.toThrow(/no KPI access/)
    expect((await t.query(api.kpi.plants, { token: k })).map((p: Any) => p.plantName)).toEqual(['Plant 2'])
    await expect(t.mutation(api.kpi.save, { token: k, period: 'month', year: 2026, num: 9, rows: [row] })).rejects.toThrow(/edit permission/)
  })

  it('KPI yıl görünümü: yalnızca seçili masraf yeri yazılır, boş ay silinir, değişmeyen kayıt korunur', async () => {
    const t = convexTest(schema, modules)
    const u = await legacyInstall(t)
    const boss = await session(t, u.admin, 'boss')
    await t.mutation(api.tenancy.startMigration, { token: boss })
    await settle(t)
    const c = await t.query(api.tenancy.context, { token: boss })
    const p1 = c.active.plantId
    await t.mutation(api.platform.updatePlant, {
      token: boss,
      id: p1,
      name: 'Plant 1',
      departments: ['Stamping'],
      costCenters: [
        { code: 'CC1', name: 'Press', department: 'Stamping' },
        { code: 'CC2', name: 'Weld', department: 'Stamping' },
      ],
    })
    // Başka masraf yerinin aynı ayı (eski sayfadan) — dokunulmamalı.
    await t.mutation(api.kpi.save, { token: boss, period: 'month', year: 2026, num: 1, rows: [{ costCenter: 'CC2', operatorType: 'direct', plan: { operators: 7 }, actual: {} }] })
    const empty = Array.from({ length: 12 }, (_, i) => ({ num: i + 1, rows: [] as Any[] }))
    const months = empty.map((m) =>
      m.num === 1
        ? { ...m, rows: [{ operatorType: 'direct', plan: { operators: 10 }, actual: {} }, { operatorType: 'indirect', plan: { operators: 2 }, actual: {} }] }
        : m.num === 2
          ? { ...m, rows: [{ operatorType: 'indirect', plan: { operators: 3 }, actual: {} }] }
          : m,
    )
    await expect(t.mutation(api.kpi.saveYear, { token: boss, year: 2026, costCenter: 'X', months })).rejects.toThrow(/not a cost center/)
    await t.mutation(api.kpi.saveYear, { token: boss, year: 2026, costCenter: 'CC1', months })
    let y = await t.query(api.kpi.year, { token: boss, year: 2026 })
    const cc1 = (num: number) => y.entries.filter((e: Any) => e.costCenter === 'CC1' && e.num === num).map((e: Any) => [e.line, e.operatorType, e.plan.operators])
    expect(cc1(1)).toEqual([[0, 'direct', 10], [1, 'indirect', 2]])
    expect(cc1(2)).toEqual([[0, 'indirect', 3]])
    expect(y.entries.filter((e: Any) => e.costCenter === 'CC2')).toHaveLength(1)

    // Ocak değişmeden kalır (kim / ne zaman korunur); Şubat boşalınca silinir.
    const before: Any[] = await t.run((ctx: Any) => ctx.db.query('kpiEntries').collect())
    const jan = before.find((e: Any) => e.costCenter === 'CC1' && e.num === 1 && e.line === 0)
    await t.mutation(api.kpi.saveYear, { token: boss, year: 2026, costCenter: 'CC1', months: months.map((m) => (m.num === 2 ? { ...m, rows: [] } : m)) })
    y = await t.query(api.kpi.year, { token: boss, year: 2026 })
    expect(cc1(2)).toEqual([])
    const after: Any = await t.run((ctx: Any) => ctx.db.get(jan._id))
    expect(after.updatedAt).toBe(jan.updatedAt)
    await expect(
      t.mutation(api.kpi.saveYear, { token: boss, year: 2026, costCenter: 'CC1', months: [{ num: 3, rows: [{ operatorType: 'direct', plan: { absenteeism: 4 }, actual: {} }] }] }),
    ).rejects.toThrow(/percentage/)
    await expect(t.mutation(api.kpi.saveYear, { token: boss, year: 2026, costCenter: 'CC1', months: [{ num: 13, rows: [] }] })).rejects.toThrow(/month/)

    // OEE kök verisi ay × masraf yeri.
    await t.run((ctx: Any) =>
      ctx.db.insert('oeeDays', { plantId: p1, date: '2026-03-05', plantKey: '', responsible: '', costCenter: 'CC1', workCenter: 'W', source: 'shiftly', good: 5, scrap: 0, reject: 0, scheduledMin: 0, unscheduledMin: 0, operatingMin: 60, productionMin: 90, loadingMin: 100 }),
    )
    y = await t.query(api.kpi.year, { token: boss, year: 2026 })
    expect(y.oee).toEqual([{ num: 3, costCenter: 'CC1', good: 5, operatingMin: 60, productionMin: 90, loadingMin: 100 }])

    // Haftalık: 13 hafta, yıl geçişi; OEE haftasına göre.
    const w = (year: number, num: number, operators?: number) => ({ year, num, rows: operators ? [{ operatorType: 'direct', plan: { operators }, actual: {} }] : [] })
    await t.mutation(api.kpi.saveRange, { token: boss, period: 'week', costCenter: 'CC1', slots: [w(2025, 52, 6), w(2026, 1, 7)] })
    await expect(t.mutation(api.kpi.saveRange, { token: boss, period: 'week', costCenter: 'CC1', slots: [w(2025, 53, 1)] })).rejects.toThrow(/week/)
    await expect(t.mutation(api.kpi.saveRange, { token: boss, period: 'week', costCenter: 'CC1', slots: [w(2026, 1, 1), w(2026, 1, 2)] })).rejects.toThrow(/twice/)
    await t.run((ctx: Any) =>
      ctx.db.insert('oeeDays', { plantId: p1, date: '2026-01-01', plantKey: '', responsible: '', costCenter: 'CC1', workCenter: 'W', source: 'shiftly', good: 2, scrap: 0, reject: 0, scheduledMin: 0, unscheduledMin: 0, operatingMin: 6, productionMin: 9, loadingMin: 10 }),
    )
    const r = await t.query(api.kpi.range, { token: boss, period: 'week', year: 2026, num: 3 })
    expect(r.slots.map((s: Any) => `${s.year}-${s.num}`).slice(-4)).toEqual(['2025-52', '2026-1', '2026-2', '2026-3'])
    expect(r.entries.map((e: Any) => [e.year, e.num, e.plan.operators])).toEqual([
      [2025, 52, 6],
      [2026, 1, 7],
    ])
    expect(r.oee).toEqual([{ year: 2026, num: 1, costCenter: 'CC1', good: 2, operatingMin: 6, productionMin: 9, loadingMin: 10 }])
    // Aylık kayıtlar haftalık aralıkta görünmez.
    expect(r.entries.every((e: Any) => e.period === 'week')).toBe(true)
  })

  it('vardiyalar: şirket standardı, plant kendi tanımı, denetim ve yetki', async () => {
    const t = convexTest(schema, modules)
    const u = await legacyInstall(t)
    const boss = await session(t, u.admin, 'boss')
    await t.mutation(api.tenancy.startMigration, { token: boss })
    await settle(t)
    const c = await t.query(api.tenancy.context, { token: boss })
    const companyId = c.plants[0].companyId
    const plantId = c.active.plantId
    expect(c.active.shiftSource).toBe('none')
    const std = [
      { number: 2, name: 'Late', start: '14:00', end: '22:00', codes: ['ub62', 'UB65'] },
      { number: 1, name: 'Early', start: '06:00', end: '14:00', codes: ['UB61', 'UB64'] },
    ]
    await t.mutation(api.platform.saveCompanyShifts, { token: boss, companyId, shifts: std })
    let ctx = await t.query(api.tenancy.context, { token: boss })
    expect(ctx.active.shiftSource).toBe('company')
    expect(ctx.active.shifts.map((x: Any) => [x.number, x.codes])).toEqual([
      [1, ['UB61', 'UB64']],
      [2, ['UB62', 'UB65']],
    ])
    await expect(
      t.mutation(api.platform.saveCompanyShifts, { token: boss, companyId, shifts: [...std, { number: 3, name: 'Night', codes: ['UB61'] }] }),
    ).rejects.toThrow(/UB61 is in shift 1 and shift 3/)

    await t.mutation(api.platform.savePlantShifts, { token: boss, plantId, shifts: [{ number: 1, name: 'Day', codes: ['X1'] }] })
    ctx = await t.query(api.tenancy.context, { token: boss })
    expect(ctx.active).toMatchObject({ shiftSource: 'plant', shifts: [{ number: 1, name: 'Day', codes: ['X1'] }] })
    const view = await t.query(api.platform.shiftSettings, { token: boss, companyId })
    expect(view.plants[0].effective.source).toBe('plant')
    // Boş liste: şirket standardına döner.
    await t.mutation(api.platform.savePlantShifts, { token: boss, plantId, shifts: [] })
    ctx = await t.query(api.tenancy.context, { token: boss })
    expect(ctx.active.shiftSource).toBe('company')
    const audit: Any[] = await t.run((x: Any) => x.db.query('auditLog').collect())
    expect(audit.filter((a) => a.action === 'company.shifts' || a.action === 'plant.shifts')).toHaveLength(3)

    // Creator olmayan değiştiremez.
    const vw = await session(t, u.viewer, 'vw')
    await expect(t.mutation(api.platform.saveCompanyShifts, { token: vw, companyId, shifts: std })).rejects.toThrow(/creator/)
    await expect(t.query(api.platform.shiftSettings, { token: vw, companyId })).rejects.toThrow(/creator/)
  })

  it('holding: board üyesi holding şirketlerinin plantlerinde yalnızca KPI ve OEE görür, yazamaz', async () => {
    const t = convexTest(schema, modules)
    const u = await legacyInstall(t)
    const boss = await session(t, u.admin, 'boss')
    await t.mutation(api.tenancy.startMigration, { token: boss })
    await settle(t)
    const c1 = (await t.query(api.tenancy.context, { token: boss })).plants[0].companyId
    const c2 = await t.mutation(api.platform.createCompany, { token: boss, name: 'Other', modules: ['planning', 'oee', 'kpi'], holdingId: await holding(t, boss, 'H Other') })
    await t.mutation(api.platform.createPlant, { token: boss, companyId: c2, name: 'Bursa', country: 'TR', timeZone: 'Europe/Istanbul' })
    const c3 = await t.mutation(api.platform.createCompany, { token: boss, name: 'Outside', modules: ['kpi'], holdingId: await holding(t, boss, 'H Outside') })
    await t.mutation(api.platform.createPlant, { token: boss, companyId: c3, name: 'Far', country: 'DE', timeZone: 'Europe/Berlin' })
    const h = await t.mutation(api.platform.saveHolding, { token: boss, name: 'Group' })
    await t.mutation(api.platform.setCompanyHolding, { token: boss, companyId: c1, holdingId: h })
    await t.mutation(api.platform.setCompanyHolding, { token: boss, companyId: c2, holdingId: h })
    // Holding board üyesini yalnızca General açar.
    const cr = await session(t, u.admin2, 'a2')
    await expect(t.mutation(api.users.add, { token: cr, companyId: null, holdingId: h, name: 'bm' })).rejects.toThrow(/General/)
    const bm = await session(t, await t.mutation(api.users.add, { token: boss, companyId: null, holdingId: h, name: 'bm' }), 'bm')

    const ctx = await t.query(api.tenancy.context, { token: bm })
    expect(ctx.isBoard).toBe(true)
    expect(ctx.holdingName).toBe('Group')
    expect(ctx.plants.map((p: Any) => p.companyName).sort()).toEqual(['Company 1', 'Other'])
    expect(ctx.active.access.planning).toBe('none')
    const board = await t.query(api.board.overview, { token: bm, period: 'month', year: 2026, num: 9 })
    expect(board.plants.map((p: Any) => p.holdingName)).toEqual(['Group', 'Group'])
    expect(board.slots).toHaveLength(12)
    await expect(t.query(api.presses.list, { token: bm })).resolves.toBeDefined()
    await expect(t.mutation(api.presses.upsert, { token: bm, name: 'X', hall: 'H' })).rejects.toThrow(/edit permission/)
    await expect(t.query(api.planRuns.status, { token: bm })).rejects.toThrow(/view permission/)
    // Şirket holding'siz bırakılmaz; başka holding'e taşınınca görünmez.
    await expect(t.mutation(api.platform.setCompanyHolding, { token: boss, companyId: c2, holdingId: null })).rejects.toThrow()
    const h2 = await holding(t, boss, 'Second')
    await t.mutation(api.platform.setCompanyHolding, { token: boss, companyId: c2, holdingId: h2 })
    expect((await t.query(api.tenancy.context, { token: bm })).plants.map((p: Any) => p.companyName)).toEqual(['Company 1'])
    // Şirketi olan holding silinmez; boşalınca silinir.
    await expect(t.mutation(api.platform.removeHolding, { token: boss, id: h2 })).rejects.toThrow(/move them/)
    await t.mutation(api.platform.setCompanyHolding, { token: boss, companyId: c2, holdingId: h })
    await t.mutation(api.platform.removeHolding, { token: boss, id: h2 })
  })

  it('ağaç: şirket holding ister; masraf yeri bir bölüme ait, bölüm boşalmadan silinmez', async () => {
    const t = convexTest(schema, modules)
    const u = await legacyInstall(t)
    const boss = await session(t, u.admin, 'boss')
    await t.mutation(api.tenancy.startMigration, { token: boss })
    await settle(t)
    await expect(t.mutation(api.platform.createCompany, { token: boss, name: 'Loose', modules: [] })).rejects.toThrow()
    const c = await t.query(api.tenancy.context, { token: boss })
    const id = c.active.plantId
    const plant = async (): Promise<Any> => t.run((ctx: Any) => ctx.db.get(id))
    // Eski (bölümden önceki) bölümsüz masraf yeri kalabilir; yenisi bölüm ister.
    await t.run((ctx: Any) => ctx.db.patch(id, { costCenters: [{ code: 'OLD', name: 'Old' }] }))
    await t.mutation(api.platform.updatePlant, { token: boss, id, name: 'Plant 1', costCenters: [{ code: 'OLD', name: 'Old (renamed)' }] })
    await expect(
      t.mutation(api.platform.updatePlant, { token: boss, id, name: 'Plant 1', costCenters: [{ code: 'OLD', name: 'Old' }, { code: 'CC1', name: 'Press' }] }),
    ).rejects.toThrow(/choose its department/)
    await expect(t.mutation(api.platform.updatePlant, { token: boss, id, name: 'Plant 1', departments: ['Stamping', ' stamping '] })).rejects.toThrow(/twice/)
    await expect(
      t.mutation(api.platform.updatePlant, { token: boss, id, name: 'Plant 1', departments: ['Stamping'], costCenters: [{ code: 'CC1', name: 'Press', department: 'Welding' }] }),
    ).rejects.toThrow(/not a department/)
    await t.mutation(api.platform.updatePlant, {
      token: boss, id, name: 'Plant 1', departments: ['Stamping', 'Welding'],
      costCenters: [{ code: 'OLD', name: 'Old', department: 'Welding' }, { code: 'CC1', name: 'Press', department: 'Stamping' }],
    })
    expect((await plant()).costCenters).toEqual([{ code: 'OLD', name: 'Old', department: 'Welding' }, { code: 'CC1', name: 'Press', department: 'Stamping' }])
    // Masraf yeri olan bölüm kaldırılamaz.
    await expect(t.mutation(api.platform.updatePlant, { token: boss, id, name: 'Plant 1', departments: ['Stamping'] })).rejects.toThrow(/still has cost centers/)
    // Ad değişince masraf yerleri yeni adla gelir; kod korunur.
    await t.run((ctx: Any) => ctx.db.patch(id, { code: 'P1' }))
    await t.mutation(api.platform.updatePlant, {
      token: boss, id, name: 'Plant 1', departments: ['Stamping', 'Assembly'],
      costCenters: [{ code: 'OLD', name: 'Old', department: 'Assembly' }, { code: 'CC1', name: 'Press', department: 'Stamping' }],
    })
    expect((await plant()).departments).toEqual(['Stamping', 'Assembly'])
    expect((await plant()).code).toBe('P1')
    // Bağlam masraf yerlerini bölümüyle verir (OEE / KPI kodla okur).
    expect((await t.query(api.tenancy.context, { token: boss })).active.costCenters.map((x: Any) => x.code)).toEqual(['OLD', 'CC1'])
  })
  it('work center bir masraf yerine bağlı: yenisi bağsız açılmaz, bağlı masraf yeri kaldırılamaz', async () => {
    const t = convexTest(schema, modules)
    const u = await legacyInstall(t)
    const boss = await session(t, u.admin, 'boss')
    await t.mutation(api.tenancy.startMigration, { token: boss })
    await settle(t)
    const id = (await t.query(api.tenancy.context, { token: boss })).active.plantId
    await t.mutation(api.platform.updatePlant, {
      token: boss, id, name: 'Plant 1', departments: ['Stamping'],
      costCenters: [{ code: 'TR', name: 'Transfer', department: 'Stamping' }, { code: 'PG', name: 'Progressive', department: 'Stamping' }],
    })
    await expect(t.mutation(api.presses.upsert, { token: boss, name: 'PRS-110', hall: 'H1' })).rejects.toThrow(/Choose the cost center/)
    await expect(t.mutation(api.presses.upsert, { token: boss, name: 'PRS-110', hall: 'H1', costCenter: 'XX' })).rejects.toThrow(/not a cost center of this plant/)
    await t.mutation(api.presses.upsert, { token: boss, name: 'PRS-110', hall: 'H1', costCenter: 'PG' })
    // Geçişten gelen bağsız work center düzeltilene kadar bağsız kaydedilebilir; bağlanınca boşaltılamaz.
    await t.mutation(api.presses.upsert, { token: boss, name: 'PRS-106', hall: 'H2' })
    await t.mutation(api.presses.upsert, { token: boss, name: 'PRS-106', hall: 'H1', costCenter: 'TR' })
    await expect(t.mutation(api.presses.upsert, { token: boss, name: 'PRS-106', hall: 'H1' })).rejects.toThrow(/Choose the cost center/)
    // Ağaç work center'ları masraf yerleriyle verir.
    const companies = await t.query(api.platform.companies, { token: boss })
    expect(companies[0].plants[0].workCenters).toEqual([{ name: 'PRS-106', costCenter: 'TR' }, { name: 'PRS-107' }, { name: 'PRS-110', costCenter: 'PG' }])
    // Work center'ı bağlı masraf yeri kaldırılamaz.
    await expect(
      t.mutation(api.platform.updatePlant, { token: boss, id, name: 'Plant 1', costCenters: [{ code: 'PG', name: 'Progressive', department: 'Stamping' }] }),
    ).rejects.toThrow(/TR still has work centers \(PRS-106\)/)
    // KPI girişi olan masraf yeri de kaldırılamaz.
    await t.mutation(api.platform.updatePlant, {
      token: boss, id, name: 'Plant 1', departments: ['Stamping'],
      costCenters: [{ code: 'TR', name: 'Transfer', department: 'Stamping' }, { code: 'PG', name: 'Progressive', department: 'Stamping' }, { code: 'K', name: 'Kpi only', department: 'Stamping' }],
    })
    await t.run((ctx: Any) => ctx.db.insert('kpiEntries', { plantId: id, period: 'month', year: 2026, num: 9, costCenter: 'K', operatorType: 'direct', plan: {}, actual: {}, updatedAt: Date.now() }))
    await expect(
      t.mutation(api.platform.updatePlant, {
        token: boss, id, name: 'Plant 1',
        costCenters: [{ code: 'TR', name: 'Transfer', department: 'Stamping' }, { code: 'PG', name: 'Progressive', department: 'Stamping' }],
      }),
    ).rejects.toThrow(/K has KPI entries/)
  })
  it('denetim kaydı: platform işlemleri eski → yeni yazılır; creator yalnızca kendi şirketini görür', async () => {
    const t = convexTest(schema, modules)
    const u = await legacyInstall(t)
    const boss = await session(t, u.admin, 'boss')
    await t.mutation(api.tenancy.startMigration, { token: boss })
    await settle(t)
    const ctx0 = await t.query(api.tenancy.context, { token: boss })
    const c1 = ctx0.plants[0].companyId
    const h = await holding(t, boss, 'Group')
    await t.mutation(api.platform.setCompanyHolding, { token: boss, companyId: c1, holdingId: h })
    await t.mutation(api.platform.updatePlant, { token: boss, id: ctx0.active.plantId, name: 'Plant 1', departments: ['Stamping'], costCenters: [{ code: 'TR', name: 'Transfer', department: 'Stamping' }] })
    const g = await t.mutation(api.users.saveGroup, { token: boss, companyId: c1, name: 'Planners', allPlants: true, plantIds: [], permissions: { planning: 'edit' } })
    const z = await t.mutation(api.users.add, { token: boss, companyId: c1, name: 'zeynep', groupIds: [g] })
    await t.mutation(api.users.update, { token: boss, id: z, name: 'zeynep', active: false, isCreator: false, groupIds: [] })
    const c2 = await t.mutation(api.platform.createCompany, { token: boss, name: 'Other', modules: ['planning'], holdingId: h })

    const all = await t.query(api.platform.auditLog, { token: boss })
    const lines = all.map((r: Any) => `${r.action} ${r.target}`)
    expect(lines).toEqual(expect.arrayContaining(['holding.add Group', 'company.holding Company 1', 'plant.update Plant 1', 'group.add Planners', 'user.add zeynep', 'user.update zeynep', 'company.add Other']))
    const upd = all.find((r: Any) => r.action === 'user.update')
    expect(upd.actor).toBe('boss')
    expect(upd.detail).toBe('active: true → false; groups: Planners → —')
    expect(all.find((r: Any) => r.action === 'plant.update').detail).toContain('costCenters: — → TR Transfer (Stamping)')

    // Creator kendi şirketinin kaydını görür; başka şirketi ve platformun tamamını göremez.
    const a2 = await session(t, u.admin2, 'a2')
    const mine = await t.query(api.platform.auditLog, { token: a2, companyId: c1 })
    expect(mine.every((r: Any) => r.target !== 'Other')).toBe(true)
    expect(mine.length).toBeGreaterThan(0)
    await expect(t.query(api.platform.auditLog, { token: a2, companyId: c2 })).rejects.toThrow(/creator of this company/)
    await expect(t.query(api.platform.auditLog, { token: a2 })).rejects.toThrow(/General/)
  })
  it('hata kaydı: ekran hatası ve plan hatası kayda düşer, aynısı sayılır; yalnızca General görür', async () => {
    const t = convexTest(schema, modules)
    const u = await legacyInstall(t)
    const boss = await session(t, u.admin, 'boss')
    await t.mutation(api.tenancy.startMigration, { token: boss })
    await settle(t)
    const pl = await session(t, u.planner, 'pl')
    await t.mutation(api.errors.report, { token: pl, message: 'x is undefined', url: '/planlama', plant: 'Plant 1' })
    await t.mutation(api.errors.report, { token: pl, message: 'x is undefined', url: '/planlama' })
    // Plan motoru hatası (finishRun) da kayda düşer.
    const plantId = (await t.query(api.tenancy.context, { token: boss })).active.plantId
    await t.run((ctx: Any) => ctx.db.insert('planStatus', { plantId, key: 'default' }))
    await t.mutation(anyApi.planRuns.finishRun, { plantId, startedAt: Date.now(), error: 'No capacity' })
    const rows = await t.query(api.errors.list, { token: boss })
    expect(rows.map((r: Any) => [r.source, r.message, r.count, r.user ?? null, r.plant ?? null]).sort()).toEqual([
      ['client', 'x is undefined', 2, 'pl', 'Plant 1'],
      ['planEngine', 'No capacity', 1, null, 'Plant 1'],
    ])
    await expect(t.query(api.errors.list, { token: pl })).rejects.toThrow(/General/)
  })
  it('work center bütünlüğü: kullanımdaki silinmez; kod değişikliği bağlı kayıtlara birlikte yazılır, başka plant\'e dokunmaz', async () => {
    const t = convexTest(schema, modules)
    const u = await legacyInstall(t)
    const boss = await session(t, u.admin, 'boss')
    await t.mutation(api.tenancy.startMigration, { token: boss })
    await settle(t)
    const p1 = (await t.query(api.tenancy.context, { token: boss })).active.plantId
    // Başka şirketin plant'inde aynı kod.
    const c2 = await t.mutation(api.platform.createCompany, { token: boss, name: 'Other', modules: ['planning'], holdingId: await holding(t, boss, 'H') })
    const p2 = await t.mutation(api.platform.createPlant, { token: boss, companyId: c2, name: 'Bursa', country: 'TR', timeZone: 'Europe/Istanbul' })
    await t.run(async (ctx: Any) => {
      await ctx.db.insert('products', { plantId: p1, code: 'M1', mainMachine: 'PRS-106', altMachine1: 'PRS-107' })
      await ctx.db.insert('pressTemplates', { plantId: p1, press: 'PRS-106', workingDays: 5, shiftsPerDay: 2 })
      await ctx.db.insert('craneGroups', { plantId: p1, groupName: 'Hall', machines: ['PRS-106', 'PRS-107'] })
      await ctx.db.insert('presses', { plantId: p2, name: 'PRS-106', hall: 'B' })
      await ctx.db.insert('products', { plantId: p2, code: 'M1', mainMachine: 'PRS-106' })
    })
    const list = await t.query(api.presses.list, { token: boss })
    const p106 = list.find((p: Any) => p.name === 'PRS-106')
    expect(await t.query(api.presses.usage, { token: boss, name: 'PRS-106' })).toEqual([
      { label: 'master data (1 part)', count: 1 },
      { label: 'Work Calendar pattern', count: 1 },
      { label: 'crane groups', count: 1 },
    ])
    await expect(t.mutation(api.presses.remove, { token: boss, id: p106._id })).rejects.toThrow(/PRS-106 is still used in master data \(1 part\), Work Calendar pattern \(1\), crane groups \(1\)/)
    await expect(t.mutation(api.presses.rename, { token: boss, id: p106._id, to: 'PRS-107' })).rejects.toThrow(/already exists/)

    expect(await t.mutation(api.presses.rename, { token: boss, id: p106._id, to: 'PRS-106A' })).toBe(3)
    const after = await t.run(async (ctx: Any) => ({
      product1: (await ctx.db.query('products').collect()).find((p: Any) => p.plantId === p1),
      product2: (await ctx.db.query('products').collect()).find((p: Any) => p.plantId === p2),
      template: await ctx.db.query('pressTemplates').first(),
      crane: await ctx.db.query('craneGroups').first(),
    }))
    expect(after.product1.mainMachine).toBe('PRS-106A')
    expect(after.product1.altMachine1).toBe('PRS-107')
    expect(after.template.press).toBe('PRS-106A')
    expect(after.crane.machines).toEqual(['PRS-106A', 'PRS-107'])
    // Başka plant'in aynı kodu değişmez.
    expect(after.product2.mainMachine).toBe('PRS-106')
    expect((await t.query(api.presses.list, { token: boss })).map((p: Any) => p.name).sort()).toEqual(['PRS-106A', 'PRS-107'])
    // Kullanılmayan work center silinir.
    await t.run(async (ctx: Any) => ctx.db.insert('presses', { plantId: p1, name: 'SPARE', hall: 'H1' }))
    const spare = (await t.query(api.presses.list, { token: boss })).find((p: Any) => p.name === 'SPARE')
    await t.mutation(api.presses.remove, { token: boss, id: spare._id })
  })
  it('parça bütünlüğü: kalıp geçmişi olan parça silinmez, kodu değişmez; makine alanına tanımsız work center yazılmaz', async () => {
    const t = convexTest(schema, modules)
    const u = await legacyInstall(t)
    const boss = await session(t, u.admin, 'boss')
    await t.mutation(api.tenancy.startMigration, { token: boss })
    await settle(t)
    const p1 = (await t.query(api.tenancy.context, { token: boss })).active.plantId
    const ids = await t.run(async (ctx: Any) => {
      const a = await ctx.db.insert('products', { plantId: p1, code: 'M1' })
      const b = await ctx.db.insert('products', { plantId: p1, code: 'M2', coProduct: 'M3' })
      const c = await ctx.db.insert('products', { plantId: p1, code: 'M3' })
      const d = await ctx.db.insert('products', { plantId: p1, code: 'FREE' })
      await ctx.db.insert('moldMaintenance', { plantId: p1, material: 'M1', date: '2026-09-01', createdAt: Date.now() })
      return { a, b, c, d }
    })
    await expect(t.mutation(api.products.remove, { token: boss, id: ids.a })).rejects.toThrow(/M1 is used in die maintenance \(1\)/)
    await expect(t.mutation(api.products.updateField, { token: boss, id: ids.a, field: 'code', value: 'M1X' })).rejects.toThrow(/cannot be changed/)
    await expect(t.mutation(api.products.remove, { token: boss, id: ids.c })).rejects.toThrow(/co-product of other parts \(1\)/)
    await expect(t.mutation(api.products.updateField, { token: boss, id: ids.d, field: 'mainMachine', value: 'PRS-999' })).rejects.toThrow(/not defined on Work Center Definitions/)
    await t.mutation(api.products.updateField, { token: boss, id: ids.d, field: 'mainMachine', value: 'PRS-106' })
    await t.mutation(api.products.updateField, { token: boss, id: ids.d, field: 'code', value: 'FREE2' })
    await t.mutation(api.products.remove, { token: boss, id: ids.d })
  })
})
