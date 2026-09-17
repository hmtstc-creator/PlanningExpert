import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const dayValidator = v.object({
  key: v.string(),
  shifts: v.number(),
  overtimeShifts: v.number(),
})

const settingsValidator = v.object({
  _id: v.id('pressCalendarSettings'),
  _creationTime: v.number(),
  press: v.string(),
  shiftMinutes: v.number(),
  overtimeShiftMinutes: v.number(),
  country: v.optional(v.string()),
})

const weekValidator = v.object({
  _id: v.id('pressCalendarWeeks'),
  _creationTime: v.number(),
  press: v.string(),
  weekStart: v.string(),
  days: v.array(dayValidator),
})

export const listSettings = query({
  args: {},
  returns: v.array(settingsValidator),
  handler: async (ctx) => ctx.db.query('pressCalendarSettings').collect(),
})

export const saveSettings = mutation({
  args: {
    press: v.string(),
    shiftMinutes: v.number(),
    overtimeShiftMinutes: v.number(),
    country: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const press = args.press.trim()
    if (!press) throw new Error('Pres adı zorunludur')
    const existing = await ctx.db
      .query('pressCalendarSettings')
      .withIndex('by_press', (q) => q.eq('press', press))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, {
        shiftMinutes: args.shiftMinutes,
        overtimeShiftMinutes: args.overtimeShiftMinutes,
        country: args.country,
      })
    } else {
      await ctx.db.insert('pressCalendarSettings', { ...args, press })
    }
    return null
  },
})

export const listWeeks = query({
  args: { press: v.string() },
  returns: v.array(weekValidator),
  handler: async (ctx, { press }) =>
    ctx.db
      .query('pressCalendarWeeks')
      .withIndex('by_press_week', (q) => q.eq('press', press))
      .collect(),
})

export const saveWeek = mutation({
  args: {
    press: v.string(),
    weekStart: v.string(),
    days: v.array(dayValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const press = args.press.trim()
    if (!press) throw new Error('Pres adı zorunludur')
    const existing = await ctx.db
      .query('pressCalendarWeeks')
      .withIndex('by_press_week', (q) =>
        q.eq('press', press).eq('weekStart', args.weekStart),
      )
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, { days: args.days })
    } else {
      await ctx.db.insert('pressCalendarWeeks', { ...args, press })
    }
    return null
  },
})
