import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const globalSettingsValidator = v.union(
  v.object({
    _id: v.id('globalShiftSettings'),
    _creationTime: v.number(),
    key: v.string(),
    shiftMinutes: v.number(),
    overtimeShiftMinutes: v.number(),
    country: v.string(),
    setupGapMinutes: v.optional(v.number()),
    concurrentSetupsPerHall: v.optional(v.number()),
    shiftStartMinute: v.optional(v.number()),
    capacityFactor: v.optional(v.number()),
    planningHorizonWeeks: v.optional(v.number()),
    breakMinutesPerShift: v.optional(v.number()),
  }),
  v.null(),
)

export const getGlobalSettings = query({
  args: {},
  returns: globalSettingsValidator,
  handler: async (ctx) =>
    ctx.db
      .query('globalShiftSettings')
      .withIndex('by_key', (q) => q.eq('key', 'default'))
      .first(),
})

export const saveGlobalSettings = mutation({
  args: {
    shiftMinutes: v.number(),
    overtimeShiftMinutes: v.number(),
    country: v.string(),
    setupGapMinutes: v.optional(v.number()),
    concurrentSetupsPerHall: v.optional(v.number()),
    shiftStartMinute: v.optional(v.number()),
    capacityFactor: v.optional(v.number()),
    planningHorizonWeeks: v.optional(v.number()),
    breakMinutesPerShift: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('globalShiftSettings')
      .withIndex('by_key', (q) => q.eq('key', 'default'))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, args)
    } else {
      await ctx.db.insert('globalShiftSettings', { key: 'default', ...args })
    }
    return null
  },
})

const templateValidator = v.union(
  v.object({
    _id: v.id('pressTemplates'),
    _creationTime: v.number(),
    press: v.string(),
    workingDays: v.number(),
    shiftsPerDay: v.number(),
    overtimeShifts: v.number(),
  }),
  v.null(),
)

export const getTemplate = query({
  args: { press: v.string() },
  returns: templateValidator,
  handler: async (ctx, { press }) =>
    ctx.db
      .query('pressTemplates')
      .withIndex('by_press', (q) => q.eq('press', press))
      .first(),
})

export const listTemplates = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('pressTemplates'),
      _creationTime: v.number(),
      press: v.string(),
      workingDays: v.number(),
      shiftsPerDay: v.number(),
      overtimeShifts: v.number(),
    }),
  ),
  handler: async (ctx) => ctx.db.query('pressTemplates').collect(),
})

export const saveTemplate = mutation({
  args: {
    press: v.string(),
    workingDays: v.number(),
    shiftsPerDay: v.number(),
    overtimeShifts: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const press = args.press.trim()
    if (!press) throw new Error('Press name is required')
    const existing = await ctx.db
      .query('pressTemplates')
      .withIndex('by_press', (q) => q.eq('press', press))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, {
        workingDays: args.workingDays,
        shiftsPerDay: args.shiftsPerDay,
        overtimeShifts: args.overtimeShifts,
      })
    } else {
      await ctx.db.insert('pressTemplates', { ...args, press })
    }
    return null
  },
})

const overrideValidator = v.object({
  _id: v.id('pressWeekOverrides'),
  _creationTime: v.number(),
  press: v.string(),
  weekStart: v.string(),
  workingDays: v.number(),
  shiftsPerDay: v.number(),
  overtimeShifts: v.number(),
})

export const listOverrides = query({
  args: { press: v.string() },
  returns: v.array(overrideValidator),
  handler: async (ctx, { press }) =>
    ctx.db
      .query('pressWeekOverrides')
      .withIndex('by_press_week', (q) => q.eq('press', press))
      .collect(),
})

export const saveOverride = mutation({
  args: {
    press: v.string(),
    weekStart: v.string(),
    workingDays: v.number(),
    shiftsPerDay: v.number(),
    overtimeShifts: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const press = args.press.trim()
    if (!press) throw new Error('Press name is required')
    const existing = await ctx.db
      .query('pressWeekOverrides')
      .withIndex('by_press_week', (q) =>
        q.eq('press', press).eq('weekStart', args.weekStart),
      )
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, {
        workingDays: args.workingDays,
        shiftsPerDay: args.shiftsPerDay,
        overtimeShifts: args.overtimeShifts,
      })
    } else {
      await ctx.db.insert('pressWeekOverrides', { ...args, press })
    }
    return null
  },
})

export const clearOverride = mutation({
  args: { press: v.string(), weekStart: v.string() },
  returns: v.null(),
  handler: async (ctx, { press, weekStart }) => {
    const existing = await ctx.db
      .query('pressWeekOverrides')
      .withIndex('by_press_week', (q) =>
        q.eq('press', press).eq('weekStart', weekStart),
      )
      .first()
    if (existing) await ctx.db.delete(existing._id)
    return null
  },
})

/**
 * Yalnızca kapasite düzeltme katsayısını günceller. Performans sayfası
 * ölçülen gerçekleşme oranını buraya yazar; diğer ayarlar korunur.
 */
export const setCapacityFactor = mutation({
  args: { capacityFactor: v.number() },
  returns: v.null(),
  handler: async (ctx, { capacityFactor }) => {
    if (capacityFactor <= 0 || capacityFactor > 2) {
      throw new Error('Capacity factor must be between 0 and 2')
    }
    const existing = await ctx.db
      .query('globalShiftSettings')
      .withIndex('by_key', (q) => q.eq('key', 'default'))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, { capacityFactor })
    } else {
      await ctx.db.insert('globalShiftSettings', {
        key: 'default',
        shiftMinutes: 480,
        overtimeShiftMinutes: 480,
        country: 'TR',
        capacityFactor,
      })
    }
    await ctx.db.insert('changeLog', {
      title: `Capacity factor set to ${(capacityFactor * 100).toFixed(0)}%`,
      detail: 'Planning multiplies available capacity by this factor.',
      category: 'decision',
      createdAt: Date.now(),
    })
    return null
  },
})

/**
 * Every press's week overrides at once.
 *
 * The per-press view needed one press at a time; the capacity grid shows all
 * presses across all weeks, so fetching per press would mean one query per
 * row.
 */
export const listAllOverrides = query({
  args: {},
  returns: v.array(overrideValidator),
  handler: async (ctx) => ctx.db.query('pressWeekOverrides').collect(),
})
