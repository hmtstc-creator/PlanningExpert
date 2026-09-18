import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const productValidator = v.object({
  _id: v.id('products'),
  _creationTime: v.number(),
  code: v.string(),
  coProduct: v.optional(v.string()),
  moldCavities: v.number(),
  spm: v.number(),
  rawMaterialCode: v.string(),
  coilWeight: v.number(),
  grossWeight: v.optional(v.number()),
  setupMinutes: v.number(),
  coilSetupMinutes: v.optional(v.number()),
  mainMachine: v.string(),
  altMachine1: v.optional(v.string()),
  altMachine2: v.optional(v.string()),
  altMachine3: v.optional(v.string()),
  altMachine4: v.optional(v.string()),
  maxShots: v.optional(v.number()),
  name: v.string(),
  material: v.string(),
  cycleTimeSeconds: v.number(),
})

const productArgs = {
  code: v.string(),
  coProduct: v.optional(v.string()),
  moldCavities: v.optional(v.number()),
  spm: v.optional(v.number()),
  rawMaterialCode: v.optional(v.string()),
  coilWeight: v.optional(v.number()),
  grossWeight: v.optional(v.number()),
  setupMinutes: v.optional(v.number()),
  coilSetupMinutes: v.optional(v.number()),
  mainMachine: v.optional(v.string()),
  altMachine1: v.optional(v.string()),
  altMachine2: v.optional(v.string()),
  altMachine3: v.optional(v.string()),
  altMachine4: v.optional(v.string()),
  maxShots: v.optional(v.number()),
  name: v.optional(v.string()),
  material: v.optional(v.string()),
  cycleTimeSeconds: v.optional(v.number()),
}

function withDefaults<T extends Record<string, unknown>>(doc: T) {
  return {
    ...doc,
    moldCavities: (doc.moldCavities as number | undefined) ?? 0,
    spm: (doc.spm as number | undefined) ?? 0,
    rawMaterialCode: (doc.rawMaterialCode as string | undefined) ?? '',
    coilWeight: (doc.coilWeight as number | undefined) ?? 0,
    setupMinutes: (doc.setupMinutes as number | undefined) ?? 0,
    mainMachine: (doc.mainMachine as string | undefined) ?? '',
    name: (doc.name as string | undefined) ?? '',
    material: (doc.material as string | undefined) ?? '',
    cycleTimeSeconds: (doc.cycleTimeSeconds as number | undefined) ?? 0,
  }
}

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(productValidator),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('products')
      .order('desc')
      .paginate(args.paginationOpts)
    return { ...result, page: result.page.map(withDefaults) }
  },
})

export const create = mutation({
  args: productArgs,
  returns: v.id('products'),
  handler: async (ctx, args) => {
    const code = args.code.trim()
    if (!code) throw new Error('Referans kodu zorunludur')
    const { name: _n, material: _m, cycleTimeSeconds: _c, ...rest } = args
    return ctx.db.insert('products', { ...rest, code })
  },
})

export const bulkUpsert = mutation({
  args: { rows: v.array(v.object(productArgs)) },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, { rows }) => {
    let inserted = 0
    let updated = 0
    for (const row of rows) {
      const code = row.code.trim()
      if (!code) continue
      const { name: _n, material: _m, cycleTimeSeconds: _c, ...rest } = row
      const data = { ...rest, code }
      const existing = await ctx.db
        .query('products')
        .withIndex('by_code', (q) => q.eq('code', code))
        .first()
      if (existing) {
        await ctx.db.patch(existing._id, data)
        updated++
      } else {
        await ctx.db.insert('products', data)
        inserted++
      }
    }
    return { inserted, updated }
  },
})

export const remove = mutation({
  args: { id: v.id('products') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  },
})
