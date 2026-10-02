import { ConvexError, v } from 'convex/values'

import { internal } from './_generated/api'
import { internalMutation } from './_generated/server'
import { TABLES, userMutation, userQuery } from './guarded'
import { isPlantTable } from './plantDb'
import { MODULES, canManageCompany, isPlatform } from '../src/lib/tenancy'

/**
 * Platform ve şirket yapısı (docs/plant-genisletme.md, v3):
 * - General: şirket açar, askıya alır, modül (kiralama paketi) açar/kapar,
 *   bütün şirketleri görür.
 * - Creator: kendi şirketine fabrika ekler ve fabrikayı düzenler.
 * - Fabrikada modül kapatmak (disabledModules) General'in işidir.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** Askıya alınan şirketin verisi bu kadar gün sonra kalıcı silinebilir. */
export const DELETE_AFTER_DAYS = 90

const moduleList = v.array(v.union(...MODULES.map((m) => v.literal(m))))

/**
 * Ülke (ISO kodu, resmi tatiller için) ve saat dilimi (IANA) fabrikanın tek
 * kaynağıdır; kodda fabrikaya özel varsayılan yok — açılışta istenir.
 */
function checkLocale(country: string, timeZone: string) {
  const c = country.trim().toUpperCase()
  const tz = timeZone.trim()
  if (!/^[A-Z]{2}$/.test(c)) throw new ConvexError('Country: a two-letter code, e.g. RO, TR, DE')
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
  } catch {
    throw new ConvexError('Time zone: an IANA name, e.g. Europe/Bucharest, Europe/Istanbul')
  }
  if (!tz) throw new ConvexError('Time zone is required')
  return { country: c, timeZone: tz }
}

function requirePlatform(me: Any) {
  if (!isPlatform(me)) throw new ConvexError('Only a General can do this')
}

/** General: bütün şirketler; creator: kendi şirketi. Fabrikaları ve kullanıcı sayısıyla. */
export const companies = userQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx: Any) => {
    const me = ctx.sessionUser
    const all: Any[] = isPlatform(me)
      ? await ctx.db.query('companies').collect()
      : me.isCreator && me.companyId
        ? [await ctx.db.get(me.companyId)].filter(Boolean)
        : []
    const out: Any[] = []
    for (const c of all) {
      const plants = await ctx.db
        .query('plants')
        .withIndex('by_company', (q: Any) => q.eq('companyId', c._id))
        .collect()
      const users = await ctx.db
        .query('users')
        .withIndex('by_company', (q: Any) => q.eq('companyId', c._id))
        .collect()
      out.push({
        ...c,
        plants,
        userCount: users.length,
        creators: users.filter((u: Any) => u.isCreator).map((u: Any) => u.name),
      })
    }
    return out
  },
})

export const createCompany = userMutation({
  args: { name: v.string(), modules: moduleList },
  returns: v.id('companies'),
  handler: async (ctx: Any, { name, modules }: Any) => {
    requirePlatform(ctx.sessionUser)
    if (!name.trim()) throw new ConvexError('A company name is required')
    return ctx.db.insert('companies', { name: name.trim(), status: 'active', modules, createdAt: Date.now() })
  },
})

/**
 * Ad, modüller, durum. Askıya alınca herkes salt okunur görür; silme tarihi
 * 90 gün sonrası. Yeniden açılınca silme tarihi kalkar.
 */
export const updateCompany = userMutation({
  args: { id: v.id('companies'), name: v.string(), modules: moduleList, status: v.union(v.literal('active'), v.literal('suspended')) },
  returns: v.null(),
  handler: async (ctx: Any, args: Any) => {
    requirePlatform(ctx.sessionUser)
    const c = await ctx.db.get(args.id)
    if (!c) throw new ConvexError('Company not found')
    if (!args.name.trim()) throw new ConvexError('A company name is required')
    const now = Date.now()
    const status =
      args.status === c.status
        ? {}
        : args.status === 'suspended'
          ? { suspendedAt: now, deleteAfter: now + DELETE_AFTER_DAYS * 86_400_000 }
          : { suspendedAt: undefined, deleteAfter: undefined }
    await ctx.db.patch(args.id, { name: args.name.trim(), modules: args.modules, status: args.status, ...status })
    return null
  },
})

/** Fabrika ekler: General ya da şirketin creator'ı. Boş başlar (veri ve ayar yok). */
export const createPlant = userMutation({
  args: {
    companyId: v.id('companies'),
    name: v.string(),
    code: v.optional(v.string()),
    country: v.string(),
    timeZone: v.string(),
  },
  returns: v.id('plants'),
  handler: async (ctx: Any, args: Any) => {
    if (!canManageCompany(ctx.sessionUser, args.companyId)) throw new ConvexError('Only a creator of this company can add a plant')
    const company = await ctx.db.get(args.companyId)
    if (!company) throw new ConvexError('Company not found')
    if (company.status !== 'active') throw new ConvexError('The company is suspended')
    if (!args.name.trim()) throw new ConvexError('A plant name is required')
    const locale = checkLocale(args.country, args.timeZone)
    return ctx.db.insert('plants', {
      companyId: args.companyId,
      name: args.name.trim(),
      code: args.code?.trim() || undefined,
      ...locale,
      createdAt: Date.now(),
    })
  },
})

export const updatePlant = userMutation({
  args: {
    id: v.id('plants'),
    name: v.string(),
    code: v.optional(v.string()),
    country: v.optional(v.string()),
    timeZone: v.optional(v.string()),
    /** Yalnızca General değiştirebilir. */
    disabledModules: v.optional(moduleList),
  },
  returns: v.null(),
  handler: async (ctx: Any, args: Any) => {
    const me = ctx.sessionUser
    const plant = await ctx.db.get(args.id)
    if (!plant) throw new ConvexError('Plant not found')
    if (!canManageCompany(me, plant.companyId)) throw new ConvexError('Only a creator of this company can change the plant')
    if (!args.name.trim()) throw new ConvexError('A plant name is required')
    const patch: Any = {
      name: args.name.trim(),
      code: args.code?.trim() || undefined,
      ...(args.country?.trim() || args.timeZone?.trim()
        ? checkLocale(args.country ?? plant.country ?? '', args.timeZone ?? plant.timeZone ?? '')
        : {}),
    }
    if (args.disabledModules !== undefined) {
      const same = JSON.stringify([...args.disabledModules].sort()) === JSON.stringify([...(plant.disabledModules ?? [])].sort())
      if (!same) {
        requirePlatform(me)
        patch.disabledModules = args.disabledModules
      }
    }
    await ctx.db.patch(args.id, patch)
    return null
  },
})

// ---- Aşama 6: dışa aktarım ve kalıcı silme -----------------------------------------

/** Dışa aktarılmayan, yeniden hesaplanan tablolar (plan sonucu). */
const DERIVED_TABLES = new Set(['planRuns', 'planRunChunks', 'planStatus'])

async function requireCompanyExport(ctx: Any, companyId: string) {
  if (!canManageCompany(ctx.sessionUser, companyId)) throw new ConvexError('Only a creator of this company or a General can export it')
  const company = await ctx.db.get(companyId)
  if (!company) throw new ConvexError('Company not found')
  return company
}

/** Dışa aktarımın tabloları (fabrikaya ait, hesaplanmayan). */
export const exportTables = userQuery({
  args: { companyId: v.id('companies') },
  returns: v.array(v.string()),
  handler: async (ctx: Any, { companyId }: Any) => {
    await requireCompanyExport(ctx, companyId)
    return TABLES.filter((t) => isPlantTable(t) && !DERIVED_TABLES.has(t))
  },
})

/**
 * Bir fabrikanın bir tablosundan bir sayfa (ekran sayfa sayfa toplayıp tek
 * JSON dosyası indirir). Kiralama bitince ya da yedek için.
 */
export const exportPage = userQuery({
  args: { companyId: v.id('companies'), plantId: v.id('plants'), table: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: v.any(),
  handler: async (ctx: Any, { companyId, plantId, table, cursor }: Any) => {
    await requireCompanyExport(ctx, companyId)
    const plant = await ctx.db.get(plantId)
    if (!plant || plant.companyId !== companyId) throw new ConvexError('Plant not found')
    if (!isPlantTable(table) || DERIVED_TABLES.has(table) || !TABLES.includes(table)) throw new ConvexError(`Unknown table ${table}`)
    const r = await ctx.db
      .query(table)
      .withIndex('by_plant', (q: Any) => q.eq('plantId', plantId))
      .paginate({ cursor, numItems: table === 'oeeDowntimeDays' ? 20 : 200 })
    return { page: r.page, isDone: r.isDone, continueCursor: r.continueCursor }
  },
})

/**
 * Kalıcı silme: yalnızca General, şirket askıdayken ve silme tarihi
 * (askıya alındıktan 90 gün sonra) geçtiyse; şirket adı yazılarak onaylanır.
 * Önce kullanıcılar, gruplar ve fabrikalar kalkar (kimse giremez), sonra
 * fabrika verisi arka planda parça parça silinir. Geri alınamaz.
 */
export const deleteCompany = userMutation({
  args: { id: v.id('companies'), confirmName: v.string() },
  returns: v.null(),
  handler: async (ctx: Any, { id, confirmName }: Any) => {
    requirePlatform(ctx.sessionUser)
    const c = await ctx.db.get(id)
    if (!c) throw new ConvexError('Company not found')
    if (c.status !== 'suspended' || !c.deleteAfter) throw new ConvexError('Suspend the company first')
    if (Date.now() < c.deleteAfter) throw new ConvexError(`The data can be deleted after ${new Date(c.deleteAfter).toISOString().slice(0, 10)}`)
    if (confirmName.trim() !== c.name) throw new ConvexError('Type the company name exactly to confirm')
    const plants: Any[] = await ctx.db
      .query('plants')
      .withIndex('by_company', (q: Any) => q.eq('companyId', id))
      .collect()
    const users: Any[] = await ctx.db
      .query('users')
      .withIndex('by_company', (q: Any) => q.eq('companyId', id))
      .collect()
    for (const u of users) {
      if (u.platformRole) {
        await ctx.db.patch(u._id, { companyId: undefined, isCreator: undefined, groupIds: undefined })
        continue
      }
      const sessions: Any[] = await ctx.db
        .query('sessions')
        .withIndex('by_user', (q: Any) => q.eq('userId', u._id))
        .collect()
      for (const s of sessions) await ctx.db.delete(s._id)
      await ctx.db.delete(u._id)
    }
    const groups: Any[] = await ctx.db
      .query('userGroups')
      .withIndex('by_company', (q: Any) => q.eq('companyId', id))
      .collect()
    for (const g of groups) await ctx.db.delete(g._id)
    for (const p of plants) await ctx.db.delete(p._id)
    await ctx.db.delete(id)
    await ctx.db.insert('platformState', {
      key: `purge:${id}`,
      value: { companyName: c.name, plantIds: plants.map((p) => p._id), tableIndex: 0, deleted: 0, done: false },
      updatedAt: Date.now(),
    })
    await ctx.scheduler.runAfter(0, internal.platform.purge, { key: `purge:${id}` })
    return null
  },
})

/** Silinen şirketin fabrika verisini parça parça siler (fotoğraflar dahil). */
export const purge = internalMutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx: Any, { key }: Any) => {
    const state = await ctx.db
      .query('platformState')
      .withIndex('by_key', (q: Any) => q.eq('key', key))
      .first()
    if (!state || state.value.done) return null
    const tables = TABLES.filter(isPlantTable)
    let { tableIndex, deleted } = state.value
    let budget = 300
    while (tableIndex < tables.length && budget > 0) {
      const table = tables[tableIndex]
      let emptied = true
      let checked = 0
      for (const plantId of state.value.plantIds) {
        checked++
        const docs: Any[] = await ctx.db
          .query(table)
          .withIndex('by_plant', (q: Any) => q.eq('plantId', plantId))
          .take(Math.min(budget, table === 'planRunChunks' || table === 'oeeDowntimeDays' ? 5 : 100))
        for (const d of docs) {
          for (const photo of d.photos ?? []) await ctx.storage.delete(photo).catch(() => {})
          await ctx.db.delete(d._id)
        }
        deleted += docs.length
        budget -= Math.max(docs.length, 1)
        if (docs.length) emptied = false
        if (budget <= 0) break
      }
      // Tablo ancak bütün fabrikalarda boşsa geçilir.
      if (emptied && checked === state.value.plantIds.length) tableIndex++
      else break
    }
    const done = tableIndex >= tables.length
    await ctx.db.patch(state._id, { value: { ...state.value, tableIndex, deleted, done }, updatedAt: Date.now() })
    if (!done) await ctx.scheduler.runAfter(0, internal.platform.purge, { key })
    return null
  },
})
