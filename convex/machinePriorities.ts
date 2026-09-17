// @deprecated Öncelik matrisi kaldırıldı; ana/alternatif makine bilgileri
// artık `products` tablosunun kendi alanlarında tutuluyor.
import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const priorityValidator = v.object({
  _id: v.id('machinePriorities'),
  _creationTime: v.number(),
  productCode: v.string(),
  machineName: v.string(),
  priority: v.number(),
})

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(priorityValidator),
  handler: async (ctx, args) =>
    ctx.db
      .query('machinePriorities')
      .order('desc')
      .paginate(args.paginationOpts),
})

export const create = mutation({
  args: { productCode: v.string(), machineName: v.string(), priority: v.number() },
  returns: v.id('machinePriorities'),
  handler: async (ctx, args) => ctx.db.insert('machinePriorities', args),
})

export const bulkInsert = mutation({
  args: {
    rows: v.array(
      v.object({
        productCode: v.string(),
        machineName: v.string(),
        priority: v.number(),
      }),
    ),
  },
  returns: v.object({ inserted: v.number() }),
  handler: async () => ({ inserted: 0 }),
})

export const remove = mutation({
  args: { id: v.id('machinePriorities') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  },
})

export const clearAll = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const rows = await ctx.db.query('machinePriorities').take(500)
    for (const row of rows) await ctx.db.delete(row._id)
    return null
  },
})
