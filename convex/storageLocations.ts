import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const locValidator = v.object({
  _id: v.id('storageLocations'),
  _creationTime: v.number(),
  code: v.string(),
  description: v.optional(v.string()),
  category: v.string(),
})

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(locValidator),
  handler: async (ctx, args) =>
    ctx.db.query('storageLocations').order('desc').paginate(args.paginationOpts),
})

export const upsert = mutation({
  args: {
    code: v.string(),
    description: v.optional(v.string()),
    category: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const code = args.code.trim()
    if (!code) throw new Error('Depo kodu zorunludur')
    const existing = await ctx.db
      .query('storageLocations')
      .withIndex('by_code', (q) => q.eq('code', code))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, {
        description: args.description,
        category: args.category,
      })
    } else {
      await ctx.db.insert('storageLocations', { ...args, code })
    }
    return null
  },
})

export const remove = mutation({
  args: { id: v.id('storageLocations') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  },
})
