import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { guardedQuery } from './guarded'
import { liveRows } from './sapLive'
import { isFinishedStockRowFor } from '../src/lib/stockLocations'
import { loadStockScope } from './stockScope'

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

/**
 * Planın saydığı bitmiş ürün stoğu, malzeme başına: her parça kendi cost
 * center'ının depolarıyla (WIP + bitmiş), tanımı yoksa depo tikleriyle.
 * Demand sayfasının stok sütunu bunu gösterir.
 */
export const planStock = guardedQuery({
  args: {},
  returns: v.object({
    rows: v.array(v.object({ material: v.string(), quantity: v.number() })),
    complete: v.boolean(),
  }),
  handler: async (ctx) => {
    const rows = await (await liveRows(ctx, 'stock')).take(PLANNING_ROW_LIMIT + 1)
    const scope = await loadStockScope(ctx)
    const map = new Map<string, number>()
    for (const r of rows.slice(0, PLANNING_ROW_LIMIT)) {
      if (isFinishedStockRowFor(scope, r.material, r.storageLocation)) map.set(r.material, (map.get(r.material) ?? 0) + (r.unrestricted ?? 0))
    }
    return {
      rows: [...map].map(([material, quantity]) => ({ material, quantity })),
      complete: rows.length <= PLANNING_ROW_LIMIT,
    }
  },
})
