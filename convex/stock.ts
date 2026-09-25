import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { guardedQuery } from './guarded'
import { liveRows } from './sapLive'

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

/** Tek sorguda okunacak en fazla satır — bkz. products.listAll. */
const PLANNING_ROW_LIMIT = 8000

export const list = guardedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(stockValidator),
  handler: async (ctx, args) =>
    (await liveRows(ctx, 'stock')).order('desc').paginate(args.paginationOpts),
})

/** Planlamanın okuduğu eksiksiz stok. Bkz. products.listAll. */
export const listAll = guardedQuery({
  args: {},
  returns: v.object({
    rows: v.array(stockValidator),
    complete: v.boolean(),
  }),
  handler: async (ctx) => {
    const rows = await (await liveRows(ctx, 'stock')).take(PLANNING_ROW_LIMIT + 1)
    return {
      rows: rows.slice(0, PLANNING_ROW_LIMIT),
      complete: rows.length <= PLANNING_ROW_LIMIT,
    }
  },
})
