import { v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'

const pressValidator = v.object({
  _id: v.id('presses'),
  _creationTime: v.number(),
  name: v.string(),
  hall: v.string(),
  category: v.optional(v.string()),
  feedsCoil: v.optional(v.boolean()),
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
 * silinir. Bu kasıtlıdır, çünkü tonaj gibi alanların "boşalt" hâli ancak
 * böyle ifade edilebilir. Çağıran taraf her zaman eksiksiz kayıt
 * göndermelidir; kısmi gönderim diğer alanları sessizce uçurur.
 */
export const upsert = guardedMutation({
  args: {
    name: v.string(),
    hall: v.string(),
    category: v.optional(v.string()),
    feedsCoil: v.optional(v.boolean()),
    tonnage: v.optional(v.number()),
    frozenDays: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const name = args.name.trim()
    if (!name) throw new Error('Press name is required')
    const existing = await ctx.db
      .query('presses')
      .withIndex('by_name', (q) => q.eq('name', name))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, {
        hall: args.hall,
        category: args.category,
        feedsCoil: args.feedsCoil,
        tonnage: args.tonnage,
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
