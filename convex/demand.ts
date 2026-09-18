import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { filterRows, knownMaterialCodes } from './uploadFilter'

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
  returns: v.object({
    count: v.number(),
    skippedUnknownMaterial: v.number(),
    skippedUnknownLocation: v.number(),
    unknownMaterials: v.array(v.string()),
    unknownLocations: v.array(v.string()),
  }),
  handler: async (ctx, { rows }) => {
    // Only materials this press shop actually makes are worth storing.
    const { kept, report } = filterRows<(typeof rows)[number]>({
      rows,
      materialOf: (r) => r.material,
      knownMaterials: await knownMaterialCodes(ctx),
    })

    const existing = await ctx.db.query('demandWeekly').collect()
    await Promise.all(existing.map((doc) => ctx.db.delete(doc._id)))
    const now = Date.now()
    await Promise.all(kept.map((row) => ctx.db.insert('demandWeekly', { ...row, uploadedAt: now })))
    return { count: kept.length, ...report }
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
  returns: v.object({
    count: v.number(),
    skippedUnknownMaterial: v.number(),
    skippedUnknownLocation: v.number(),
    unknownMaterials: v.array(v.string()),
    unknownLocations: v.array(v.string()),
  }),
  handler: async (ctx, { rows }) => {
    // Only materials this press shop actually makes are worth storing.
    const { kept, report } = filterRows<(typeof rows)[number]>({
      rows,
      materialOf: (r) => r.material,
      knownMaterials: await knownMaterialCodes(ctx),
    })

    const existing = await ctx.db.query('demandDaily').collect()
    await Promise.all(existing.map((doc) => ctx.db.delete(doc._id)))
    const now = Date.now()
    await Promise.all(kept.map((row) => ctx.db.insert('demandDaily', { ...row, uploadedAt: now })))
    return { count: kept.length, ...report }
  },
})
