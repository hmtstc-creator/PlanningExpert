// @deprecated Makine tablosu kaldırıldı; makine bilgileri artık `products`
// tablosundaki mainMachine/altMachine alanlarında tutuluyor.
import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'

const machineValidator = v.object({
  _id: v.id('machines'),
  _creationTime: v.number(),
  name: v.string(),
  hall: v.string(),
  hasCrane: v.boolean(),
  tonnage: v.number(),
})

export const list = guardedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(machineValidator),
  handler: async (ctx, args) =>
    ctx.db.query('machines').order('desc').paginate(args.paginationOpts),
})

export const create = guardedMutation({
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

export const bulkUpsert = guardedMutation({
  args: {
    rows: v.array(
      v.object({ name: v.string(), hall: v.string(), hasCrane: v.boolean() }),
    ),
  },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async () => ({ inserted: 0, updated: 0 }),
})

export const remove = guardedMutation({
  args: { id: v.id('machines') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  },
})
