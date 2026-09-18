import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const overrideValidator = v.object({
  _id: v.id('planOverrides'),
  _creationTime: v.number(),
  material: v.string(),
  kind: v.string(),
  press: v.optional(v.string()),
  date: v.optional(v.string()),
  note: v.optional(v.string()),
  createdAt: v.number(),
})

export const list = query({
  args: {},
  returns: v.array(overrideValidator),
  handler: async (ctx) => ctx.db.query('planOverrides').collect(),
})

/**
 * Bir malzeme için müdahale kaydeder. Aynı malzemenin önceki müdahalesi
 * varsa değiştirilir — bir malzemenin aynı anda tek kuralı olur.
 */
export const set = mutation({
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
    if (!material) throw new Error('Malzeme kodu zorunludur')
    if (!['exclude', 'pin', 'priority'].includes(args.kind)) {
      throw new Error(`Bilinmeyen müdahale türü: ${args.kind}`)
    }
    if (args.kind === 'pin' && !args.press?.trim()) {
      throw new Error('Sabitleme için pres seçilmelidir')
    }

    const existing = await ctx.db
      .query('planOverrides')
      .withIndex('by_material', (q) => q.eq('material', material))
      .collect()
    await Promise.all(existing.map((e) => ctx.db.delete(e._id)))

    await ctx.db.insert('planOverrides', {
      material,
      kind: args.kind,
      press: args.press?.trim() || undefined,
      date: args.date?.trim() || undefined,
      note: args.note?.trim() || undefined,
      createdAt: Date.now(),
    })

    await ctx.db.insert('changeLog', {
      title: `Plan müdahalesi — ${material}`,
      detail:
        args.kind === 'exclude'
          ? 'Planlamadan hariç tutuldu'
          : args.kind === 'priority'
            ? 'Sıranın başına alındı'
            : `${args.press} presine sabitlendi${args.date ? ` (${args.date})` : ''}`,
      category: 'karar',
      createdAt: Date.now(),
    })
    return null
  },
})

export const clear = mutation({
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
