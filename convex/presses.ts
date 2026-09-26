import { ConvexError, v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'

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
})

export const list = guardedQuery({
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const name = args.name.trim()
    if (!name) throw new ConvexError('Press name is required')
    const existing = await ctx.db
      .query('presses')
      .withIndex('by_name', (q) => q.eq('name', name))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, {
        hall: args.hall,
        category: args.category,
        feedsCoil: args.feedsCoil,
        // Tonaj kaldırıldı: eski değer kayıtta kalmasın.
        tonnage: undefined,
        frozenDays: args.frozenDays,
      })
    } else {
      await ctx.db.insert('presses', { ...args, name })
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
