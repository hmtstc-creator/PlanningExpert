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

const snapshotValidator = v.object({
  _id: v.id('planSnapshots'),
  _creationTime: v.number(),
  createdAt: v.number(),
  approvedBy: v.optional(v.string()),
  horizonStart: v.string(),
  jobCount: v.number(),
  unplannedCount: v.number(),
  truncated: v.optional(v.boolean()),
  jobs: v.array(jobValidator),
})

/**
 * Convex doküman boyut sınırı ~1 MB. Her iş kaydı yaklaşık 200 bayt,
 * dolayısıyla 2000 iş güvenli bir üst sınır. Bunun üstü kırpılır ve
 * `truncated` ile işaretlenir — jobCount yine gerçek sayıyı gösterir.
 */
const MAX_STORED_JOBS = 2000

export const latest = query({
  args: {},
  returns: v.union(snapshotValidator, v.null()),
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
    const truncated = args.jobs.length > MAX_STORED_JOBS
    const id = await ctx.db.insert('planSnapshots', {
      createdAt: Date.now(),
      approvedBy: args.approvedBy,
      horizonStart: args.horizonStart,
      jobCount: args.jobs.length,
      unplannedCount: args.unplannedCount,
      truncated,
      jobs: truncated ? args.jobs.slice(0, MAX_STORED_JOBS) : args.jobs,
    })
    await ctx.db.insert('changeLog', {
      title: `Plan approved — ${args.jobs.length} jobs`,
      detail:
        `${args.jobs.length} jobs planned from ${args.horizonStart} onwards, ` +
        `${args.unplannedCount} items could not be planned.` +
        (truncated ? ` (Only the first ${MAX_STORED_JOBS} jobs were stored.)` : ''),
      category: 'decision',
      author: args.approvedBy,
      createdAt: Date.now(),
    })
    return id
  },
})
