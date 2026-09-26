import { ConvexError, v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'

const rowValidator = v.object({
  _id: v.id('moldReadiness'),
  _creationTime: v.number(),
  material: v.string(),
  ready: v.boolean(),
  readyDate: v.optional(v.string()),
  readyMinute: v.optional(v.number()),
  reason: v.optional(v.string()),
  updatedBy: v.optional(v.string()),
  updatedAt: v.number(),
})

export const list = guardedQuery({
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
export const set = guardedMutation({
  args: {
    material: v.string(),
    ready: v.boolean(),
    readyDate: v.optional(v.string()),
    /** Hazır olacağı saat, gece yarısından dakika (ör. 600 = 10:00). */
    readyMinute: v.optional(v.number()),
    reason: v.optional(v.string()),
    updatedBy: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const material = args.material.trim()
    if (!material) throw new ConvexError('Material code is required')
    if (!args.ready && args.readyDate && !/^\d{4}-\d{2}-\d{2}$/.test(args.readyDate)) {
      throw new ConvexError('Ready date must be in YYYY-MM-DD format')
    }

    if (
      args.readyMinute !== undefined &&
      (!Number.isFinite(args.readyMinute) || args.readyMinute < 0 || args.readyMinute >= 24 * 60)
    ) {
      throw new ConvexError('Ready time must be between 00:00 and 23:59')
    }

    const patch = {
      material,
      ready: args.ready,
      readyDate: args.ready ? undefined : args.readyDate || undefined,
      readyMinute:
        args.ready || !args.readyDate || args.readyMinute === undefined
          ? undefined
          : Math.round(args.readyMinute),
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
        : `Not available${
            args.readyDate
              ? ` until ${args.readyDate}${
                  args.readyMinute !== undefined
                    ? ` ${String(Math.floor(args.readyMinute / 60)).padStart(2, '0')}:${String(args.readyMinute % 60).padStart(2, '0')}`
                    : ''
                }`
              : ' (no date given)'
          }.` +
          (args.reason ? ` ${args.reason}` : ''),
      category: 'maintenance',
      author: args.updatedBy,
      createdAt: Date.now(),
    })
    return null
  },
})
