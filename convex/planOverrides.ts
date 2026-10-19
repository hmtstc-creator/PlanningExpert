import { ConvexError, v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'

const overrideValidator = v.object({
  _id: v.id('planOverrides'),
  _creationTime: v.number(),
  material: v.string(),
  kind: v.string(),
  press: v.optional(v.string()),
  date: v.optional(v.string()),
  bucket: v.optional(v.string()),
  qty: v.optional(v.number()),
  note: v.optional(v.string()),
  createdAt: v.number(),
})

export const list = guardedQuery({
  args: {},
  returns: v.array(overrideValidator),
  handler: async (ctx) => ctx.db.query('planOverrides').collect(),
})

/**
 * Bir malzeme için müdahale kaydeder. Aynı malzemenin önceki sıra / pres
 * kuralı varsa değiştirilir — bir malzemenin aynı anda tek böyle kuralı olur.
 * Adet kuralları (`setQuantity`) ayrıdır ve korunur.
 */
export const set = guardedMutation({
  areas: ['planning.plan'],
  args: {
    material: v.string(),
    kind: v.string(),
    press: v.optional(v.string()),
    date: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const material = args.material.trim()
    if (!material) throw new ConvexError('Material code is required')
    if (!['exclude', 'pin', 'priority'].includes(args.kind)) {
      throw new ConvexError(`Unknown override type: ${args.kind}`)
    }
    if (args.kind === 'pin' && !args.press?.trim()) {
      throw new ConvexError('A work center must be selected to pin a material')
    }

    const existing = await ctx.db
      .query('planOverrides')
      .withIndex('by_material', (q) => q.eq('material', material))
      .collect()
    await Promise.all(existing.filter((e) => e.kind !== 'quantity').map((e) => ctx.db.delete(e._id)))

    await ctx.db.insert('planOverrides', {
      material,
      kind: args.kind,
      press: args.press?.trim() || undefined,
      date: args.date?.trim() || undefined,
      note: args.note?.trim() || undefined,
      createdAt: Date.now(),
    })

    await ctx.db.insert('changeLog', {
      title: `Plan override — ${material}`,
      detail:
        args.kind === 'exclude'
          ? 'Excluded from planning'
          : args.kind === 'priority'
            ? 'Moved to the front of the queue'
            : `Pinned to work center ${args.press}${args.date ? ` (${args.date})` : ''}`,
      category: 'decision',
      createdAt: Date.now(),
    })
    return null
  },
})

/**
 * Bir lotun adedini elle sabitler (Plan grafiğinde işe tıklayıp). Lot,
 * malzeme + talep kovasıyla tanınır; plan yeniden hesaplanınca motor bu
 * adedi rulo / minimum lota yuvarlar, farkı sonraki lotlara aktarır.
 */
export const setQuantity = guardedMutation({
  areas: ['planning.plan'],
  args: {
    material: v.string(),
    bucket: v.string(),
    qty: v.number(),
    /** Grafikteki eski adet — yalnızca Change Log için. */
    previousQty: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const material = args.material.trim()
    const bucket = args.bucket.trim()
    if (!material || !bucket) throw new ConvexError('Material and lot are required')
    if (!Number.isFinite(args.qty) || args.qty < 0) throw new ConvexError('Quantity must be 0 or more')
    const qty = Math.round(args.qty)

    const existing = await ctx.db
      .query('planOverrides')
      .withIndex('by_material', (q) => q.eq('material', material))
      .collect()
    await Promise.all(
      existing.filter((e) => e.kind === 'quantity' && e.bucket === bucket).map((e) => ctx.db.delete(e._id)),
    )
    await ctx.db.insert('planOverrides', { material, kind: 'quantity', bucket, qty, createdAt: Date.now() })
    await ctx.db.insert('changeLog', {
      title: `Plan override — ${material}`,
      detail:
        `Lot ${bucket}: quantity set to ${qty.toLocaleString('en-GB')} pcs` +
        (args.previousQty !== undefined ? ` (was ${Math.round(args.previousQty).toLocaleString('en-GB')})` : ''),
      category: 'decision',
      createdAt: Date.now(),
    })
    return null
  },
})

/** Tek bir kuralı kaldırır (Plan overrides listesindeki "Remove"). */
export const remove = guardedMutation({
  areas: ['planning.plan'],
  args: { id: v.id('planOverrides') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (row) await ctx.db.delete(id)
    return null
  },
})

export const clear = guardedMutation({
  areas: ['planning.plan'],
  args: { material: v.string() },
  returns: v.null(),
  handler: async (ctx, { material }) => {
    const existing = await ctx.db
      .query('planOverrides')
      .withIndex('by_material', (q) => q.eq('material', material))
      .collect()
    await Promise.all(existing.map((e) => ctx.db.delete(e._id)))
    return null
  },
})
