import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const stockValidator = v.object({
  _id: v.id('stock'),
  _creationTime: v.number(),
  material: v.string(),
  plant: v.optional(v.string()),
  storageLocation: v.optional(v.string()),
  unrestricted: v.optional(v.number()),
  qualityInspection: v.optional(v.number()),
  restricted: v.optional(v.number()),
  blocked: v.optional(v.number()),
  returns: v.optional(v.number()),
  transit: v.optional(v.number()),
  uploadedAt: v.number(),
})

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(stockValidator),
  handler: async (ctx, args) =>
    ctx.db.query('stock').order('desc').paginate(args.paginationOpts),
})

export const replaceAll = mutation({
  args: {
    rows: v.array(
      v.object({
        material: v.string(),
        plant: v.optional(v.string()),
        storageLocation: v.optional(v.string()),
        unrestricted: v.optional(v.number()),
        qualityInspection: v.optional(v.number()),
        restricted: v.optional(v.number()),
        blocked: v.optional(v.number()),
        returns: v.optional(v.number()),
        transit: v.optional(v.number()),
      }),
    ),
  },
  returns: v.object({ count: v.number() }),
  handler: async (ctx, { rows }) => {
    const existing = await ctx.db.query('stock').collect()
    for (const doc of existing) await ctx.db.delete(doc._id)
    const now = Date.now()
    for (const row of rows) {
      if (!row.material.trim()) continue
      await ctx.db.insert('stock', { ...row, uploadedAt: now })
    }
    return { count: rows.length }
  },
})
