import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const pressValidator = v.object({
  _id: v.id('presses'),
  _creationTime: v.number(),
  name: v.string(),
  hall: v.string(),
  category: v.optional(v.string()),
  tonnage: v.optional(v.number()),
  frozenDays: v.optional(v.number()),
})

export const list = query({
  args: {},
  returns: v.array(pressValidator),
  handler: async (ctx) => ctx.db.query('presses').collect(),
})

export const upsert = mutation({
  args: {
    name: v.string(),
    hall: v.string(),
    category: v.optional(v.string()),
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
        tonnage: args.tonnage,
        frozenDays: args.frozenDays,
      })
    } else {
      await ctx.db.insert('presses', { ...args, name })
    }
    return null
  },
})

export const remove = mutation({
  args: { id: v.id('presses') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  },
})
