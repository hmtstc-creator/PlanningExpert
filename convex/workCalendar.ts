import { v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'

const calendarValidator = v.object({
  _id: v.id('workCalendar'),
  _creationTime: v.number(),
  key: v.string(),
  shiftMinutesPerDay: v.number(),
  workingDays: v.array(v.string()),
  holidays: v.array(v.string()),
})

export const get = guardedQuery({
  args: {},
  returns: v.union(calendarValidator, v.null()),
  handler: async (ctx) =>
    ctx.db
      .query('workCalendar')
      .withIndex('by_key', (q) => q.eq('key', 'default'))
      .first(),
})

export const save = guardedMutation({
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
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, args)
    } else {
      await ctx.db.insert('workCalendar', { key: 'default', ...args })
    }
    return null
  },
})
