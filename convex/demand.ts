import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const periodValidator = v.object({ label: v.string(), qty: v.number() })

const weeklyValidator = v.object({
  _id: v.id('demandWeekly'),
  _creationTime: v.number(),
  material: v.string(),
  stockInStorage: v.optional(v.number()),
  overdue: v.optional(v.number()),
  periods: v.array(periodValidator),
  uploadedAt: v.number(),
})

export const listWeekly = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(weeklyValidator),
  handler: async (ctx, args) =>
    ctx.db.query('demandWeekly').order('desc').paginate(args.paginationOpts),
})

export const replaceWeekly = mutation({
  args: {
    rows: v.array(
      v.object({
        material: v.string(),
        stockInStorage: v.optional(v.number()),
        overdue: v.optional(v.number()),
        periods: v.array(periodValidator),
      }),
    ),
  },
  returns: v.object({ count: v.number() }),
  handler: async (ctx, { rows }) => {
    const existing = await ctx.db.query('demandWeekly').collect()
    for (const doc of existing) await ctx.db.delete(doc._id)
    const now = Date.now()
    for (const row of rows) {
      if (!row.material.trim()) continue
      await ctx.db.insert('demandWeekly', { ...row, uploadedAt: now })
    }
    return { count: rows.length }
  },
})

const dailyValidator = v.object({
  _id: v.id('demandDaily'),
  _creationTime: v.number(),
  material: v.string(),
  stockInStorage: v.optional(v.number()),
  overdue: v.optional(v.number()),
  periods: v.array(periodValidator),
  uploadedAt: v.number(),
})

export const listDaily = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(dailyValidator),
  handler: async (ctx, args) =>
    ctx.db.query('demandDaily').order('desc').paginate(args.paginationOpts),
})

export const replaceDaily = mutation({
  args: {
    rows: v.array(
      v.object({
        material: v.string(),
        stockInStorage: v.optional(v.number()),
        overdue: v.optional(v.number()),
        periods: v.array(periodValidator),
      }),
    ),
  },
  returns: v.object({ count: v.number() }),
  handler: async (ctx, { rows }) => {
    const existing = await ctx.db.query('demandDaily').collect()
    for (const doc of existing) await ctx.db.delete(doc._id)
    const now = Date.now()
    for (const row of rows) {
      if (!row.material.trim()) continue
      await ctx.db.insert('demandDaily', { ...row, uploadedAt: now })
    }
    return { count: rows.length }
  },
})
