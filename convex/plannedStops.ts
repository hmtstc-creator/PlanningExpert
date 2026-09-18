import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const stopValidator = v.object({
  _id: v.id('plannedStops'),
  _creationTime: v.number(),
  shiftIndex: v.number(),
  name: v.string(),
  kind: v.string(),
  startMinute: v.number(),
  durationMinutes: v.number(),
})

const KINDS = ['handover', 'tea', 'meal', 'maintenance', 'other']

export const list = query({
  args: {},
  returns: v.array(stopValidator),
  handler: async (ctx) => ctx.db.query('plannedStops').collect(),
})

export const add = mutation({
  args: {
    shiftIndex: v.number(),
    name: v.string(),
    kind: v.string(),
    startMinute: v.number(),
    durationMinutes: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const name = args.name.trim()
    if (!name) throw new Error('Stop name is required')
    if (!KINDS.includes(args.kind)) throw new Error(`Unknown stop type: ${args.kind}`)
    if (args.shiftIndex < 1 || args.shiftIndex > 3) {
      throw new Error('Shift must be 1, 2 or 3')
    }
    if (args.startMinute < 0 || args.startMinute >= 24 * 60) {
      throw new Error('Start time must be within the day')
    }
    if (args.durationMinutes <= 0) throw new Error('Duration must be greater than zero')

    await ctx.db.insert('plannedStops', { ...args, name })
    return null
  },
})

export const update = mutation({
  args: {
    id: v.id('plannedStops'),
    name: v.optional(v.string()),
    kind: v.optional(v.string()),
    startMinute: v.optional(v.number()),
    durationMinutes: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { id, ...patch }) => {
    if (patch.kind && !KINDS.includes(patch.kind)) {
      throw new Error(`Unknown stop type: ${patch.kind}`)
    }
    if (patch.durationMinutes !== undefined && patch.durationMinutes <= 0) {
      throw new Error('Duration must be greater than zero')
    }
    await ctx.db.patch(id, patch)
    return null
  },
})

export const remove = mutation({
  args: { id: v.id('plannedStops') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  },
})
