import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { guardedQuery } from './guarded'
import { liveRows } from './sapLive'

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

/** Tek sorguda okunacak en fazla satır — bkz. products.listAll. */
const PLANNING_ROW_LIMIT = 8000

export const listWeekly = guardedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(weeklyValidator),
  handler: async (ctx, args) =>
    (await liveRows(ctx, 'weeklyDemand')).order('desc').paginate(args.paginationOpts),
})

/** Planlamanın okuduğu eksiksiz haftalık talep. Bkz. products.listAll. */
export const listAllWeekly = guardedQuery({
  args: {},
  returns: v.object({
    rows: v.array(weeklyValidator),
    complete: v.boolean(),
  }),
  handler: async (ctx) => {
    const rows = await (await liveRows(ctx, 'weeklyDemand')).take(PLANNING_ROW_LIMIT + 1)
    return {
      rows: rows.slice(0, PLANNING_ROW_LIMIT),
      complete: rows.length <= PLANNING_ROW_LIMIT,
    }
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

export const listDaily = guardedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(dailyValidator),
  handler: async (ctx, args) =>
    (await liveRows(ctx, 'dailyDemand')).order('desc').paginate(args.paginationOpts),
})
