import { ConvexError, v } from 'convex/values'

import { ALL_MODULES, guardedMutation, guardedQuery, type GuardedMutationCtx, type GuardedQueryCtx } from './guarded'
import { renameEverywhere, usageText, whereUsed } from './workCenterRefs'

const pressValidator = v.object({
  _id: v.id('presses'),
  _creationTime: v.number(),
  name: v.string(),
  hall: v.string(),
  category: v.optional(v.string()),
  feedsCoil: v.optional(v.boolean()),
  /** @deprecated Kaldırıldı; eski kayıtlarda kalmış olabilir, okunmaz. */
  tonnage: v.optional(v.number()),
  frozenDays: v.optional(v.number()),
  costCenter: v.optional(v.string()),
})

export const list = guardedQuery({
  modules: ALL_MODULES,
  args: {},
  returns: v.array(pressValidator),
  handler: async (ctx) => ctx.db.query('presses').collect(),
})

/**
 * Presi adına göre ekler ya da günceller.
 *
 * DİKKAT: kayıt tümüyle değiştirilir — gönderilmeyen isteğe bağlı alan
 * silinir. Bu kasıtlıdır, çünkü dondurulmuş gün gibi alanların "boşalt" hâli ancak
 * böyle ifade edilebilir. Çağıran taraf her zaman eksiksiz kayıt
 * göndermelidir; kısmi gönderim diğer alanları sessizce uçurur.
 */
export const upsert = guardedMutation({
  args: {
    name: v.string(),
    hall: v.string(),
    category: v.optional(v.string()),
    feedsCoil: v.optional(v.boolean()),
    frozenDays: v.optional(v.number()),
    costCenter: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const name = args.name.trim()
    if (!name) throw new ConvexError('Work center name is required')
    // Hol isteğe bağlı: boşsa work center kimseyle vinç paylaşmaz
    // (src/lib/hall.ts). Kodda varsayılan hol adı yok.
    const hall = args.hall.trim()
    const category = args.category?.trim() || undefined
    const existing = await ctx.db
      .query('presses')
      .withIndex('by_name', (q) => q.eq('name', name))
      .first()
    // Her work center fabrikanın bir masraf yerine bağlıdır. Yeni kayıt
    // masraf yerisiz açılmaz, bağlı olan boşaltılamaz; eski bağsız kayıt
    // düzeltilene kadar kalabilir (ekranda uyarı).
    const costCenter = args.costCenter?.trim() || undefined
    const codes = new Set(((ctx as { plant?: { costCenters?: { code: string }[] } }).plant?.costCenters ?? []).map((c) => c.code))
    if (costCenter && !codes.has(costCenter)) {
      throw new ConvexError(`${costCenter} is not a cost center of this plant — add it on Company settings first`)
    }
    if (!costCenter && (!existing || existing.costCenter)) {
      throw new ConvexError(`Choose the cost center of ${name} — every work center belongs to one`)
    }
    // Kategori listesi veriden gelir: yeni yazılan kategori listeye girer.
    if (category) await ensureCategory(ctx.db, category)
    if (existing) {
      await ctx.db.patch(existing._id, {
        hall,
        category,
        feedsCoil: args.feedsCoil,
        // Tonaj kaldırıldı: eski değer kayıtta kalmasın.
        tonnage: undefined,
        frozenDays: args.frozenDays,
        costCenter,
      })
    } else {
      await ctx.db.insert('presses', { ...args, name, hall, category, costCenter })
    }
    return null
  },
})

/**
 * Work center'ı siler — yalnızca hiçbir yerde kullanılmıyorsa (master data,
 * takvim, mesai, bakım, arıza, plan …). Kullanılıyorsa nerede olduğunu
 * söyler; kayıtlar sahipsiz kalmaz.
 */
export const remove = guardedMutation({
  args: { id: v.id('presses') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const press = await ctx.db.get(id)
    // Başka plant'in kaydı görünmez: kilitli veritabanıyla aynı hata.
    if (!press) throw new ConvexError('Record not found')
    const usage = await whereUsed(ctx.db, press.name)
    if (usage.length) throw new ConvexError(`${usageText(press.name, usage)} — move or remove those first, or change its code instead`)
    await ctx.db.delete(id)
    return null
  },
})

/** Work center'ın kullanıldığı yerler (silmeden önce ekranda gösterilir). */
export const usage = guardedQuery({
  modules: ALL_MODULES,
  args: { name: v.string() },
  returns: v.array(v.object({ label: v.string(), count: v.number() })),
  handler: async (ctx, { name }) => whereUsed(ctx.db, name),
})

/**
 * Work center kodunu değiştirir (ör. yazım hatası, SAP'de yeni kod): kayıt ve
 * bağlı bütün kayıtlar (master data, takvim, mesai, bakım, arıza, plan
 * müdahaleleri, vinç grupları) birlikte. Yüklenen OEE verisi ve plan arşivi
 * eski koduyla kalır (geçmiş değişmez).
 */
export const rename = guardedMutation({
  args: { id: v.id('presses'), to: v.string() },
  returns: v.number(),
  handler: async (ctx, { id, to }) => {
    const press = await ctx.db.get(id)
    if (!press) throw new ConvexError('Work center not found')
    const name = to.trim()
    if (!name) throw new ConvexError('Enter the new code')
    if (name === press.name) return 0
    const clash = await ctx.db
      .query('presses')
      .withIndex('by_name', (q) => q.eq('name', name))
      .first()
    if (clash) throw new ConvexError(`${name} already exists`)
    const changed = await renameEverywhere(ctx.db, press.name, name)
    await ctx.db.patch(id, { name })
    await ctx.db.insert('changeLog', {
      title: `Work center code changed — ${press.name} → ${name}`,
      detail: `${changed} linked record(s) updated. Uploaded OEE data and plan archives keep the old code.`,
      category: 'system',
      author: (ctx as { sessionUser?: { name?: string } }).sessionUser?.name,
      createdAt: Date.now(),
    })
    return changed
  },
})

/**
 * OEE verisinde work center'ın hangi masraf yeriyle geldiği (son haftalık
 * kayıtlardan). Work Center Definitions'taki bağı teyit etmek için: tanımla
 * veri farklıysa ekranda gösterilir; program kendiliğinden düzeltmez.
 */
export const costCentersSeen = guardedQuery({
  // Sayfa (Work Center Definitions) her modüle açık; yalnızca kod çiftleri döner.
  modules: ALL_MODULES,
  args: {},
  returns: v.array(v.object({ workCenter: v.string(), costCenter: v.string() })),
  handler: async (ctx) => {
    const rows = await ctx.db.query('oeeWeekly').withIndex('by_week').order('desc').take(1500)
    const seen = new Map<string, string>()
    // En yeni kayıt kazanır.
    for (const r of rows) if (r.workCenter && r.costCenter && !seen.has(r.workCenter)) seen.set(r.workCenter, r.costCenter)
    return [...seen].map(([workCenter, costCenter]) => ({ workCenter, costCenter }))
  },
})

// ---- Kategoriler (hatlar) ----------------------------------------------------
//
// Kategori work center'ları hatta toplar: Gantt onunla gruplar, Capacity
// Dashboard aynı kategorideki work center'ları toplar. Liste koda gömülü
// değildir: plant'in seçim listesinde ('workCenterCategory') tutulur ve Work
// Center Definitions sayfasında yönetilir; kullanılan ama listede olmayan eski
// değerler de listede görünür.

const CATEGORY_KIND = 'workCenterCategory'

type Db = GuardedMutationCtx['db']

async function categoryRows(db: GuardedQueryCtx['db']) {
  return db
    .query('lookups')
    .withIndex('by_kind', (q) => q.eq('kind', CATEGORY_KIND))
    .collect()
}

async function ensureCategory(db: Db, name: string) {
  const rows = await categoryRows(db)
  if (rows.some((r) => r.value.toLowerCase() === name.toLowerCase())) return
  await db.insert('lookups', { kind: CATEGORY_KIND, value: name, sortOrder: rows.length, createdAt: Date.now() })
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Plant'in kategorileri: listedekiler (sırasıyla) + kullanılıp listede olmayanlar. */
export const categories = guardedQuery({
  modules: ALL_MODULES,
  args: {},
  returns: v.array(v.object({ name: v.string(), listed: v.boolean() })),
  handler: async (ctx) => {
    const rows = (await categoryRows(ctx.db)).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.value.localeCompare(b.value))
    const out = rows.map((r) => ({ name: r.value, listed: true }))
    for (const p of await ctx.db.query('presses').collect()) {
      const c = p.category?.trim()
      if (c && !out.some((o) => o.name === c)) out.push({ name: c, listed: false })
    }
    return out
  },
})

export const addCategory = guardedMutation({
  affectsPlan: false,
  args: { name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const name = args.name.trim()
    if (!name) throw new ConvexError('Enter the category name')
    const rows = await categoryRows(ctx.db)
    const same = rows.find((r) => sameText(r.value, name))
    if (same) throw new ConvexError(`${same.value} already exists`)
    await ensureCategory(ctx.db, name)
    return null
  },
})

/**
 * Kategorinin adını değiştirir: listedeki kayıt ve o kategorideki bütün work
 * center'lar birlikte. Yeni ad zaten varsa iki kategori birleşir.
 */
export const renameCategory = guardedMutation({
  args: { from: v.string(), to: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const from = args.from.trim()
    const to = args.to.trim()
    if (!to) throw new ConvexError('Enter the new name')
    if (from === to) return 0
    let changed = 0
    for (const p of await ctx.db.query('presses').collect()) {
      if (p.category?.trim() === from) {
        await ctx.db.patch(p._id, { category: to })
        changed++
      }
    }
    const rows = await categoryRows(ctx.db)
    const old = rows.find((r) => r.value === from)
    const target = rows.find((r) => r.value !== from && sameText(r.value, to))
    if (old && target) await ctx.db.delete(old._id)
    else if (old) await ctx.db.patch(old._id, { value: to })
    else await ensureCategory(ctx.db, to)
    return changed
  },
})

/** Kategoriyi listeden siler — yalnızca hiçbir work center'da kullanılmıyorsa. */
export const removeCategory = guardedMutation({
  affectsPlan: false,
  args: { name: v.string() },
  returns: v.null(),
  handler: async (ctx, { name }) => {
    const users = (await ctx.db.query('presses').collect()).filter((p) => p.category?.trim() === name)
    if (users.length) {
      throw new ConvexError(`${name} is the category of ${users.map((p) => p.name).join(', ')} — move them to another category first`)
    }
    for (const r of await categoryRows(ctx.db)) if (r.value === name) await ctx.db.delete(r._id)
    return null
  },
})
