import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const jobValidator = v.object({
  material: v.string(),
  press: v.string(),
  hall: v.string(),
  date: v.string(),
  phase: v.string(),
  quantity: v.number(),
  shots: v.number(),
  coilsNeeded: v.number(),
  setupStartMinute: v.number(),
  endMinute: v.number(),
  reason: v.string(),
})

export const latest = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id('planSnapshots'),
      _creationTime: v.number(),
      createdAt: v.number(),
      approvedBy: v.optional(v.string()),
      horizonStart: v.string(),
      jobCount: v.number(),
      unplannedCount: v.number(),
      jobs: v.array(jobValidator),
    }),
    v.null(),
  ),
  handler: async (ctx) =>
    ctx.db.query('planSnapshots').withIndex('by_created').order('desc').first(),
})

export const approve = mutation({
  args: {
    horizonStart: v.string(),
    unplannedCount: v.number(),
    approvedBy: v.optional(v.string()),
    jobs: v.array(jobValidator),
  },
  returns: v.id('planSnapshots'),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('planSnapshots', {
      createdAt: Date.now(),
      approvedBy: args.approvedBy,
      horizonStart: args.horizonStart,
      jobCount: args.jobs.length,
      unplannedCount: args.unplannedCount,
      jobs: args.jobs,
    })
    await ctx.db.insert('changeLog', {
      title: `Plan onaylandı — ${args.jobs.length} iş`,
      detail: `${args.horizonStart} tarihinden itibaren ${args.jobs.length} iş planlandı, ${args.unplannedCount} kalem planlanamadı.`,
      category: 'karar',
      author: args.approvedBy,
      createdAt: Date.now(),
    })
    return id
  },
})
