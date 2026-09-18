// @deprecated Makine tablosu kaldırıldı; makine bilgileri artık `products`
// tablosundaki mainMachine/altMachine alanlarında tutuluyor.
import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const machineValidator = v.object({
  _id: v.id('machines'),
  _creationTime: v.number(),
  name: v.string(),
  hall: v.string(),
  hasCrane: v.boolean(),
  tonnage: v.number(),
})

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(machineValidator),
  handler: async (ctx, args) =>
    ctx.db.query('machines').order('desc').paginate(args.paginationOpts),
})

export const create = mutation({
  args: {
    name: v.string(),
    hall: v.string(),
    hasCrane: v.boolean(),
    tonnage: v.optional(v.number()),
  },
  returns: v.id('machines'),
  handler: async (ctx, args) => {
    const name = args.name.trim()
    const hall = args.hall.trim()
    if (!name || !hall) throw new Error('This feature is no longer in use')
    return ctx.db.insert('machines', { name, hall, hasCrane: args.hasCrane, tonnage: 0 })
  },
})

export const bulkUpsert = mutation({
  args: {
    rows: v.array(
      v.object({ name: v.string(), hall: v.string(), hasCrane: v.boolean() }),
    ),
  },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async () => ({ inserted: 0, updated: 0 }),
})

export const remove = mutation({
  args: { id: v.id('machines') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  },
})
