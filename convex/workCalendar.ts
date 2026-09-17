import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const calendarValidator = v.object({
  _id: v.id('workCalendar'),
  _creationTime: v.number(),
  key: v.string(),
  shiftMinutesPerDay: v.number(),
  workingDays: v.array(v.string()),
  holidays: v.array(v.string()),
})

export const get = query({
  args: {},
  returns: v.union(calendarValidator, v.null()),
  handler: async (ctx) =>
    ctx.db
      .query('workCalendar')
      .withIndex('by_key', (q) => q.eq('key', 'default'))
      .unique(),
})

export const save = mutation({
  args: {
    shiftMinutesPerDay: v.number(),
    workingDays: v.array(v.string()),
    holidays: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('workCalendar')
      .withIndex('by_key', (q) => q.eq('key', 'default'))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, args)
    } else {
      await ctx.db.insert('workCalendar', { key: 'default', ...args })
    }
    return null
  },
})
