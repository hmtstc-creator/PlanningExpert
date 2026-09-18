import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const rowValidator = v.object({
  _id: v.id('actualProduction'),
  _creationTime: v.number(),
  material: v.string(),
  postingDate: v.string(),
  quantity: v.number(),
  plant: v.optional(v.string()),
  storageLocation: v.optional(v.string()),
  movementType: v.optional(v.string()),
  orderNumber: v.optional(v.string()),
  uploadedAt: v.number(),
})

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(rowValidator),
  handler: async (ctx, args) =>
    ctx.db.query('actualProduction').order('desc').paginate(args.paginationOpts),
})

export const replaceAll = mutation({
  args: {
    rows: v.array(
      v.object({
        material: v.string(),
        postingDate: v.string(),
        quantity: v.number(),
        plant: v.optional(v.string()),
        storageLocation: v.optional(v.string()),
        movementType: v.optional(v.string()),
        orderNumber: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({ count: v.number() }),
  handler: async (ctx, { rows }) => {
    const existing = await ctx.db.query('actualProduction').collect()
    await Promise.all(existing.map((doc) => ctx.db.delete(doc._id)))
    const now = Date.now()
    const validRows = rows.filter((row) => row.material.trim())
    await Promise.all(
      validRows.map((row) =>
        ctx.db.insert('actualProduction', { ...row, uploadedAt: now }),
      ),
    )
    return { count: validRows.length }
  },
})
