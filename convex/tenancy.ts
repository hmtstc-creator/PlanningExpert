import { ConvexError, v } from 'convex/values'

import { internal } from './_generated/api'
import { internalMutation } from './_generated/server'
import { TABLES, activePlant, userMutation, userQuery, visiblePlants } from './guarded'
import { isPlantTable } from './plantDb'
import { LEGACY_ROLE_GROUPS, MODULES, isPlatform, uniformPermissions } from '../src/lib/tenancy'

/**
 * Şirket / fabrika bağlamı ve tek seferlik geçiş (docs/plant-genisletme.md).
 *
 * Geçiş: fabrika anahtarından önceki bütün veri "Company 1 / Plant 1"e
 * taşınır. En eski aktif admin site sahibi (owner) olur; bütün adminler
 * şirketin creator'ı; diğer roller aynı adlı gruba (Planners, Maintenance,
 * Viewers) girer — bugünkü yetkiler korunur. Kayıtlar arka planda parça
 * parça işaretlenir; bitene kadar fabrika verisi okunmaz (guarded.ts).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const MIGRATION_KEY = 'plantMigration'

/**
 * Fabrika anahtarından ÖNCEKİ tek kurulumun koddaki varsayılanları. Kod artık
 * fabrikaya özel değer tutmuyor (aşama 5); bu kurulumun bugünkü davranışı
 * bozulmasın diye geçişte bir kez veriye yazılır: ülke ve saat dilimi Plant
 * 1'e, depo tikleri Storage Locations'a. Yeni fabrikalarda kullanılmaz.
 */
const LEGACY_INSTALL = {
  country: 'RO',
  timeZone: 'Europe/Bucharest',
  /** Tiksiz hâlde bitmiş ürün + hammadde sayılan depolar; ilki üretim girişi. */
  countedLocations: ['2009', '1009'],
  productionLocation: '2009',
}

/** Eski kurulumun depo kurallarını açık tike çevirir (anahtarsız kayıtlar). */
async function writeLegacyLocationTicks(db: Any) {
  const rows: Any[] = await db
    .query('storageLocations')
    .withIndex('by_plant', (q: Any) => q.eq('plantId', undefined))
    .collect()
  const isDefault = (code: string) => LEGACY_INSTALL.countedLocations.includes(code.trim())
  for (const l of rows) {
    await db.patch(l._id, {
      countFinished: l.countFinished ?? isDefault(l.code),
      countRaw: l.countRaw ?? (l.category === 'raw_material' || isDefault(l.code)),
      countProduction: l.countProduction ?? l.code.trim() === LEGACY_INSTALL.productionLocation,
    })
  }
  for (const code of LEGACY_INSTALL.countedLocations) {
    if (rows.some((l) => l.code.trim() === code)) continue
    await db.insert('storageLocations', {
      code,
      countFinished: true,
      countRaw: true,
      countProduction: code === LEGACY_INSTALL.productionLocation,
    })
  }
}

/** Bir çağrıda en çok kaç kayıt işaretlenir; büyük kayıtlı tablolarda daha az. */
const BATCH: Record<string, number> = { planRunChunks: 2, oeeDowntimeDays: 10, planSnapshots: 4, planRuns: 20 }
const DEFAULT_BATCH = 200
const BUDGET = 400

async function stateDoc(db: Any) {
  return db
    .query('platformState')
    .withIndex('by_key', (q: Any) => q.eq('key', MIGRATION_KEY))
    .first()
}

const plantTables = () => TABLES.filter(isPlantTable)

/** Geçişin durumu — giriş yapan herkes görür (ekranda ilerleme). */
export const migrationStatus = userQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx: Any) => {
    const state = await stateDoc(ctx.db)
    const tables = plantTables()
    if (!state) return { started: false, done: false, progress: 0 }
    const { done, tableIndex = 0, marked = 0 } = state.value ?? {}
    return { started: true, done: !!done, progress: done ? 1 : tableIndex / tables.length, marked }
  },
})

/**
 * Geçişi başlatır (ilk giriş yapan kişinin ekranı çağırır; tekrar çağrılması
 * zararsız). Şirket ve fabrika yoksa kurar, kullanıcıları dönüştürür, kayıt
 * işaretlemeyi arka planda başlatır.
 */
export const startMigration = userMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx: Any) => {
    const db = ctx.db
    if (await stateDoc(db)) return null
    const now = Date.now()
    const legacySettings = await db
      .query('globalShiftSettings')
      .withIndex('by_key', (q: Any) => q.eq('plantId', undefined).eq('key', 'default'))
      .first()
    const companyId = await db.insert('companies', { name: 'Company 1', status: 'active', modules: [...MODULES], createdAt: now })
    const plantId = await db.insert('plants', {
      companyId,
      name: 'Plant 1',
      country: legacySettings?.country || LEGACY_INSTALL.country,
      timeZone: legacySettings?.timeZone || LEGACY_INSTALL.timeZone,
      // Masraf yerlerini creator tanımlar (program doldurmaz).
      costCenters: [],
      createdAt: now,
    })
    await writeLegacyLocationTicks(db)
    const groupIds = new Map<string, string>()
    for (const g of LEGACY_ROLE_GROUPS) {
      groupIds.set(
        g.role,
        await db.insert('userGroups', { companyId, name: g.name, allPlants: true, plantIds: [], permissions: uniformPermissions(g.level), createdAt: now }),
      )
    }
    const users: Any[] = await db.query('users').collect()
    const admins = users.filter((u) => u.role === 'admin' && u.active).sort((a, b) => a.createdAt - b.createdAt)
    const owner = admins[0] ?? users.find((u) => u._id === ctx.sessionUser._id)
    for (const u of users) {
      if (u.platformRole || u.companyId) continue
      if (owner && u._id === owner._id) {
        await db.patch(u._id, { platformRole: 'owner', companyId, isCreator: true, role: 'owner' })
      } else if (u.role === 'admin') {
        await db.patch(u._id, { companyId, isCreator: true, role: 'creator' })
      } else {
        const g = groupIds.get(u.role) ?? groupIds.get('viewer')!
        await db.patch(u._id, { companyId, groupIds: [g], role: 'member' })
      }
    }
    await db.insert('platformState', { key: MIGRATION_KEY, value: { done: false, plantId, tableIndex: 0, marked: 0 }, updatedAt: now })
    await ctx.scheduler.runAfter(0, internal.tenancy.backfill, {})
    return null
  },
})

/** Fabrika anahtarı olmayan kayıtları Plant 1'e işaretler; bitene kadar kendini yeniden kurar. */
export const backfill = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx: Any) => {
    const state = await stateDoc(ctx.db)
    if (!state || state.value.done) return null
    const tables = plantTables()
    let { tableIndex, marked } = state.value
    const { plantId } = state.value
    let budget = BUDGET
    while (tableIndex < tables.length && budget > 0) {
      const table = tables[tableIndex]
      const n = Math.min(BATCH[table] ?? DEFAULT_BATCH, budget)
      const docs = await ctx.db
        .query(table)
        .withIndex('by_plant', (q: Any) => q.eq('plantId', undefined))
        .take(n)
      for (const d of docs) await ctx.db.patch(d._id, { plantId })
      marked += docs.length
      budget -= Math.max(docs.length, 1)
      if (docs.length < n) tableIndex++
      // Büyük kayıtlarda bir çağrıda tek tablo parçası.
      if (BATCH[table] && docs.length === n) break
    }
    const done = tableIndex >= tables.length
    await ctx.db.patch(state._id, { value: { ...state.value, tableIndex, marked, done }, updatedAt: Date.now() })
    if (done) await ctx.scheduler.runAfter(0, internal.planEngine.recompute, { trigger: 'plant migration', plantId })
    else await ctx.scheduler.runAfter(0, internal.tenancy.backfill, {})
    return null
  },
})

/**
 * Oturumun bağlamı: kullanıcının seviyesi, görebildiği fabrikalar ve seçili
 * fabrikadaki modül izinleri. Menü ve fabrika seçici bunu okur.
 */
export const context = userQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx: Any) => {
    const user = ctx.sessionUser
    const state = await stateDoc(ctx.db)
    const base = {
      platformRole: user.platformRole ?? null,
      isCreator: user.isCreator === true,
      companyId: user.companyId ?? null,
    }
    if (!state?.value?.done) return { ...base, migration: { started: !!state, done: false }, plants: [], active: null }
    const plants = await visiblePlants(ctx.db, user)
    const active = await activePlant(ctx.db, user, ctx.session)
    return {
      ...base,
      migration: { started: true, done: true },
      plants: plants.map((p) => ({
        _id: p.plant._id,
        name: p.plant.name,
        companyId: p.company._id,
        companyName: p.company.name,
        companyStatus: p.company.status,
      })),
      active: active
        ? {
            plantId: active.plant._id,
            plantName: active.plant.name,
            companyId: active.company._id,
            companyName: active.company.name,
            companyStatus: active.company.status,
            country: active.plant.country ?? '',
            costCenters: active.plant.costCenters ?? [],
            timeZone: active.plant.timeZone ?? '',
            access: active.access,
            // Askıdaki şirket: salt okunur; silinme tarihi.
            deleteAfter: active.company.deleteAfter ?? null,
          }
        : null,
    }
  },
})

/** Fabrika seçici: oturumun fabrikasını değiştirir (yalnızca yetkili fabrika). */
export const selectPlant = userMutation({
  args: { plantId: v.id('plants') },
  returns: v.null(),
  handler: async (ctx: Any, { plantId }: Any) => {
    const plants = await visiblePlants(ctx.db, ctx.sessionUser)
    if (!plants.some((p) => p.plant._id === plantId)) throw new ConvexError('You have no access to this plant')
    await ctx.db.patch(ctx.session._id, { plantId })
    return null
  },
})

/**
 * Saat başı hesap: her aktif şirketin PlanningExpert'i açık fabrikaları,
 * birer dakika arayla (hepsi aynı anda başlamasın). Birinin hatası diğerini
 * durdurmaz — her hesap ayrı iş.
 */
export const recomputeAll = internalMutation({
  args: { trigger: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx: Any, { trigger }: Any) => {
    const state = await stateDoc(ctx.db)
    if (!state?.value?.done) return null
    const plants: Any[] = await ctx.db.query('plants').collect()
    let i = 0
    for (const plant of plants) {
      const company = await ctx.db.get(plant.companyId)
      if (!company || company.status !== 'active' || !company.modules.includes('planning')) continue
      if ((plant.disabledModules ?? []).includes('planning')) continue
      await ctx.scheduler.runAfter(i++ * 60_000, internal.planEngine.recompute, { trigger, plantId: plant._id })
    }
    return null
  },
})

export { isPlatform }
