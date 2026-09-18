import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const recordValidator = v.object({
  _id: v.id('moldMaintenance'),
  _creationTime: v.number(),
  material: v.string(),
  date: v.string(),
  note: v.optional(v.string()),
  createdAt: v.number(),
})

export const list = query({
  args: {},
  returns: v.array(recordValidator),
  handler: async (ctx) => ctx.db.query('moldMaintenance').collect(),
})

export const add = mutation({
  args: {
    material: v.string(),
    date: v.string(),
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const material = args.material.trim()
    if (!material) throw new Error('Material code is required')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error('Maintenance date must be in YYYY-MM-DD format')
    }
    await ctx.db.insert('moldMaintenance', {
      material,
      date: args.date,
      note: args.note?.trim() || undefined,
      createdAt: Date.now(),
    })
    await ctx.db.insert('changeLog', {
      title: `Mold maintenance — ${material}`,
      detail: `Maintenance recorded on ${args.date}; the shot counter restarts from that date.`,
      category: 'maintenance',
      createdAt: Date.now(),
    })
    return null
  },
})

export const remove = mutation({
  args: { id: v.id('moldMaintenance') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  },
})
