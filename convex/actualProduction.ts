import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { filterRows, knownMaterialCodes } from './uploadFilter'

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
  returns: v.object({
    count: v.number(),
    skippedUnknownMaterial: v.number(),
    skippedUnknownLocation: v.number(),
    unknownMaterials: v.array(v.string()),
    unknownLocations: v.array(v.string()),
  }),
  handler: async (ctx, { rows }) => {
    // MB51 covers every movement in the plant; keep only our own materials.
    const { kept, report } = filterRows<(typeof rows)[number]>({
      rows,
      materialOf: (r) => r.material,
      knownMaterials: await knownMaterialCodes(ctx),
    })

    const existing = await ctx.db.query('actualProduction').collect()
    await Promise.all(existing.map((doc) => ctx.db.delete(doc._id)))
    const now = Date.now()
    await Promise.all(
      kept.map((row) => ctx.db.insert('actualProduction', { ...row, uploadedAt: now })),
    )
    return { count: kept.length, ...report }
  },
})
