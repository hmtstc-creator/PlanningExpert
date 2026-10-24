import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { ConvexError, v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'

const locValidator = v.object({
  _id: v.id('storageLocations'),
  _creationTime: v.number(),
  code: v.string(),
  description: v.optional(v.string()),
  category: v.optional(v.string()),
  countFinished: v.optional(v.boolean()),
  countRaw: v.optional(v.boolean()),
  countProduction: v.optional(v.boolean()),
})

export const list = guardedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(locValidator),
  handler: async (ctx, args) =>
    ctx.db.query('storageLocations').order('desc').paginate(args.paginationOpts),
})

/**
 * Tanımlı tüm depolar. Depo kategorisi hangi stoğun sayılacağını belirler,
 * yani plana doğrudan girer — sayfa sınırında kalan bir depo stoğun yanlış
 * kategoride sayılmasına yol açardı.
 */
export const listAll = guardedQuery({
  args: {},
  returns: v.array(locValidator),
  handler: async (ctx) => ctx.db.query('storageLocations').collect(),
})

export const upsert = guardedMutation({
  areas: ['planning.masterData'],
  args: {
    code: v.string(),
    description: v.optional(v.string()),
    countFinished: v.optional(v.boolean()),
    countRaw: v.optional(v.boolean()),
    countProduction: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const code = args.code.trim()
    if (!code) throw new ConvexError('Storage location code is required')
    const existing = await ctx.db
      .query('storageLocations')
      .withIndex('by_code', (q) => q.eq('code', code))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, {
        description: args.description,
        category: undefined,
        countFinished: args.countFinished,
        countRaw: args.countRaw,
        countProduction: args.countProduction,
      })
    } else {
      await ctx.db.insert('storageLocations', { ...args, code })
    }
    return null
  },
})

export const remove = guardedMutation({
  areas: ['planning.masterData'],
  args: { id: v.id('storageLocations') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  },
})

// ---- Cost center başına depolar ---------------------------------------------

const ccValidator = v.object({
  _id: v.id('costCenterStorage'),
  _creationTime: v.number(),
  costCenter: v.string(),
  production: v.array(v.string()),
  finished: v.array(v.string()),
  raw: v.array(v.string()),
})

/** Her cost center'ın WIP, bitmiş ürün ve hammadde depoları. */
export const listCostCenters = guardedQuery({
  args: {},
  returns: v.array(ccValidator),
  handler: async (ctx) => ctx.db.query('costCenterStorage').collect(),
})

const codes = (list: string[]) => [...new Set(list.map((c) => c.trim()).filter(Boolean))].sort()

/**
 * Bir cost center'ın depolarını yazar. Üç liste de boşsa tanım silinir ve o
 * cost center'ın malzemeleri yine depo tikleriyle sayılır. Kod, fabrikanın
 * organizasyon yapısındaki bir cost center olmalı; depolar Storage Locations
 * listesinde tanımlı olmalı (tanımsız depodaki stok yüklenmez).
 */
export const upsertCostCenter = guardedMutation({
  areas: ['planning.masterData'],
  args: {
    costCenter: v.string(),
    production: v.array(v.string()),
    finished: v.array(v.string()),
    raw: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const costCenter = args.costCenter.trim()
    if (!costCenter) throw new ConvexError('Cost center code is required')
    const known = (ctx.plant.costCenters ?? []).map((c) => c.code)
    if (!known.includes(costCenter)) throw new ConvexError(`${costCenter} is not a cost center of this plant`)
    const production = codes(args.production)
    const finished = codes(args.finished)
    const raw = codes(args.raw)
    const defined = new Set((await ctx.db.query('storageLocations').collect()).map((l) => l.code.trim()))
    const unknown = [...production, ...finished, ...raw].filter((c) => !defined.has(c))
    if (unknown.length) throw new ConvexError(`Define storage location ${[...new Set(unknown)].join(', ')} first`)
    const existing = await ctx.db
      .query('costCenterStorage')
      .withIndex('by_cost_center', (q) => q.eq('costCenter', costCenter))
      .first()
    const empty = !production.length && !finished.length && !raw.length
    if (existing && empty) await ctx.db.delete(existing._id)
    else if (existing) await ctx.db.patch(existing._id, { production, finished, raw })
    else if (!empty) await ctx.db.insert('costCenterStorage', { costCenter, production, finished, raw })
    return null
  },
})
