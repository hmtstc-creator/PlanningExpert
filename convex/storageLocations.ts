import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { ConvexError, v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'

const locValidator = v.object({
  _id: v.id('storageLocations'),
  _creationTime: v.number(),
  code: v.string(),
  description: v.optional(v.string()),
  category: v.optional(v.string()),
  countFinished: v.optional(v.boolean()),
  countRaw: v.optional(v.boolean()),
  countProduction: v.optional(v.boolean()),
})

export const list = guardedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(locValidator),
  handler: async (ctx, args) =>
    ctx.db.query('storageLocations').order('desc').paginate(args.paginationOpts),
})

/**
 * Tanımlı tüm depolar. Depo kategorisi hangi stoğun sayılacağını belirler,
 * yani plana doğrudan girer — sayfa sınırında kalan bir depo stoğun yanlış
 * kategoride sayılmasına yol açardı.
 */
export const listAll = guardedQuery({
  args: {},
  returns: v.array(locValidator),
  handler: async (ctx) => ctx.db.query('storageLocations').collect(),
})

export const upsert = guardedMutation({
  args: {
    code: v.string(),
    description: v.optional(v.string()),
    countFinished: v.optional(v.boolean()),
    countRaw: v.optional(v.boolean()),
    countProduction: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const code = args.code.trim()
    if (!code) throw new ConvexError('Storage location code is required')
    const existing = await ctx.db
      .query('storageLocations')
      .withIndex('by_code', (q) => q.eq('code', code))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, {
        description: args.description,
        category: undefined,
        countFinished: args.countFinished,
        countRaw: args.countRaw,
        countProduction: args.countProduction,
      })
    } else {
      await ctx.db.insert('storageLocations', { ...args, code })
    }
    return null
  },
})

export const remove = guardedMutation({
  args: { id: v.id('storageLocations') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  },
})
