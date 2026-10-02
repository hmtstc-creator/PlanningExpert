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
})
