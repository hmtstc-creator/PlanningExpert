import { ConvexError, v } from 'convex/values'

import { ALL_MODULES, guardedMutation, guardedQuery } from './guarded'

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
    // Hol vinç kısıtıdır; kodda varsayılan hol adı yok.
    const hall = args.hall.trim()
    if (!hall) throw new ConvexError(`Enter the hall of ${name} — work centers in one hall share the crane for setups`)
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
      throw new ConvexError(`${costCenter} is not a cost center of this plant — add it on Companies and plants first`)
    }
    if (!costCenter && (!existing || existing.costCenter)) {
      throw new ConvexError(`Choose the cost center of ${name} — every work center belongs to one`)
    }
    if (existing) {
      await ctx.db.patch(existing._id, {
        hall,
        category: args.category,
        feedsCoil: args.feedsCoil,
        // Tonaj kaldırıldı: eski değer kayıtta kalmasın.
        tonnage: undefined,
        frozenDays: args.frozenDays,
        costCenter,
      })
    } else {
      await ctx.db.insert('presses', { ...args, name, hall, costCenter })
    }
    return null
  },
})

export const remove = guardedMutation({
  args: { id: v.id('presses') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
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
