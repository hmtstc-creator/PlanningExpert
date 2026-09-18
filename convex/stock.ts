import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { filterRows, knownLocationCodes, knownMaterialCodes } from './uploadFilter'

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
  returns: v.object({
    count: v.number(),
    skippedUnknownMaterial: v.number(),
    skippedUnknownLocation: v.number(),
    unknownMaterials: v.array(v.string()),
    unknownLocations: v.array(v.string()),
  }),
  handler: async (ctx, { rows }) => {
    // MB52 covers the whole plant. Only materials in master data and storage
    // locations the user has defined are relevant here.
    const { kept, report } = filterRows<(typeof rows)[number]>({
      rows,
      materialOf: (r) => r.material,
      locationOf: (r) => r.storageLocation,
      knownMaterials: await knownMaterialCodes(ctx),
      knownLocations: await knownLocationCodes(ctx),
    })

    const existing = await ctx.db.query('stock').collect()
    await Promise.all(existing.map((doc) => ctx.db.delete(doc._id)))
    const now = Date.now()
    await Promise.all(kept.map((row) => ctx.db.insert('stock', { ...row, uploadedAt: now })))
    return { count: kept.length, ...report }
  },
})
