import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const rowValidator = v.object({
  _id: v.id('moldReadiness'),
  _creationTime: v.number(),
  material: v.string(),
  ready: v.boolean(),
  readyDate: v.optional(v.string()),
  reason: v.optional(v.string()),
  updatedBy: v.optional(v.string()),
  updatedAt: v.number(),
})

export const list = query({
  args: {},
  returns: v.array(rowValidator),
  handler: async (ctx) => ctx.db.query('moldReadiness').collect(),
})

/**
 * Kalıbın imalata hazır olup olmadığını yazar.
 *
 * Kayıt malzeme başına tektir: hazır olmayan bir kalıbın iki farklı hazır
 * olma tarihi olamaz. Kalıp hazır işaretlenirse tarih temizlenir, yoksa
 * eski tarih kayıtta kalır ve ileride yanıltır.
 */
export const set = mutation({
  args: {
    material: v.string(),
    ready: v.boolean(),
    readyDate: v.optional(v.string()),
    reason: v.optional(v.string()),
    updatedBy: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const material = args.material.trim()
    if (!material) throw new Error('Material code is required')
    if (!args.ready && args.readyDate && !/^\d{4}-\d{2}-\d{2}$/.test(args.readyDate)) {
      throw new Error('Ready date must be in YYYY-MM-DD format')
    }

    const patch = {
      material,
      ready: args.ready,
      readyDate: args.ready ? undefined : args.readyDate || undefined,
      reason: args.ready ? undefined : args.reason?.trim() || undefined,
      updatedBy: args.updatedBy,
      updatedAt: Date.now(),
    }

    const existing = await ctx.db
      .query('moldReadiness')
      .withIndex('by_material', (q) => q.eq('material', material))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, patch)
    } else {
      await ctx.db.insert('moldReadiness', patch)
    }

    await ctx.db.insert('changeLog', {
      title: `Mold ${args.ready ? 'released for production' : 'held'} — ${material}`,
      detail: args.ready
        ? 'The mold is available to the plan again.'
        : `Not available${args.readyDate ? ` until ${args.readyDate}` : ' (no date given)'}.` +
          (args.reason ? ` ${args.reason}` : ''),
      category: 'maintenance',
      author: args.updatedBy,
      createdAt: Date.now(),
    })
    return null
  },
})
