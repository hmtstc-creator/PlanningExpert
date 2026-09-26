import { ConvexError, v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'
import { patternProblem } from '../src/lib/pressCalendar'
import { SETTINGS_DEFAULTS } from '../src/lib/settingsDefaults'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function shiftMinutesOf(ctx: any): Promise<number> {
  const settings = await ctx.db
    .query('globalShiftSettings')
    .withIndex('by_key', (q: any) => q.eq('key', 'default')) // eslint-disable-line @typescript-eslint/no-explicit-any
    .first()
  return settings?.shiftMinutes ?? SETTINGS_DEFAULTS.shiftMinutes
}

const recurringValidator = v.array(v.object({ dayKey: v.string(), definitionId: v.id('overtimeDefinitions') }))

const globalSettingsValidator = v.union(
  v.object({
    _id: v.id('globalShiftSettings'),
    _creationTime: v.number(),
    key: v.string(),
    shiftMinutes: v.number(),
    overtimeShiftMinutes: v.number(),
    country: v.string(),
    setupGapMinutes: v.optional(v.number()),
    coilSetupGapMinutes: v.optional(v.number()),
    concurrentSetupsPerHall: v.optional(v.number()),
    shiftStartMinute: v.optional(v.number()),
    capacityFactor: v.optional(v.number()),
    planningHorizonWeeks: v.optional(v.number()),
    breakMinutesPerShift: v.optional(v.number()),
    frozenDays: v.optional(v.number()),
    safetyStockDays: v.optional(v.number()),
    timeZone: v.optional(v.string()),
    maxSetupsPlantWideNormal: v.optional(v.number()),
    maxSetupsPlantWide: v.optional(v.number()),
    setupsCrossShifts: v.optional(v.boolean()),
    pullForwardDays: v.optional(v.number()),
    deliveryCutoffMinute: v.optional(v.number()),
    utilisationTarget: v.optional(v.number()),
    maxScenarios: v.optional(v.number()),
    rawCoverageDays: v.optional(v.number()),
    rawOrderExtraKg: v.optional(v.number()),
    rawOrderMailTo: v.optional(v.array(v.string())),
    rawOrderMailCc: v.optional(v.array(v.string())),
    rawUrgentDays: v.optional(v.number()),
    acceptedPerformanceRate: v.optional(v.number()),
    migratedSetupGap10: v.optional(v.boolean()),
    migratedCalendarV2: v.optional(v.boolean()),
  }),
  v.null(),
)

export const getGlobalSettings = guardedQuery({
  args: {},
  returns: globalSettingsValidator,
  handler: async (ctx) =>
    ctx.db
      .query('globalShiftSettings')
      .withIndex('by_key', (q) => q.eq('key', 'default'))
      .first(),
})

export const saveGlobalSettings = guardedMutation({
  args: {
    shiftMinutes: v.number(),
    overtimeShiftMinutes: v.number(),
    country: v.string(),
    setupGapMinutes: v.optional(v.number()),
    coilSetupGapMinutes: v.optional(v.number()),
    concurrentSetupsPerHall: v.optional(v.number()),
    shiftStartMinute: v.optional(v.number()),
    capacityFactor: v.optional(v.number()),
    planningHorizonWeeks: v.optional(v.number()),
    breakMinutesPerShift: v.optional(v.number()),
    frozenDays: v.optional(v.number()),
    safetyStockDays: v.optional(v.number()),
    timeZone: v.optional(v.string()),
    maxSetupsPlantWideNormal: v.optional(v.number()),
    maxSetupsPlantWide: v.optional(v.number()),
    setupsCrossShifts: v.optional(v.boolean()),
    pullForwardDays: v.optional(v.number()),
    deliveryCutoffMinute: v.optional(v.number()),
    utilisationTarget: v.optional(v.number()),
    maxScenarios: v.optional(v.number()),
    rawCoverageDays: v.optional(v.number()),
    rawOrderExtraKg: v.optional(v.number()),
    rawOrderMailTo: v.optional(v.array(v.string())),
    rawOrderMailCc: v.optional(v.array(v.string())),
    rawUrgentDays: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('globalShiftSettings')
      .withIndex('by_key', (q) => q.eq('key', 'default'))
      .first()
    // Günde vardiya × süre 24 saati geçemez: kayıtlı her pres düzeni yeni
    // vardiya süresiyle kontrol edilir.
    const patterns = [
      ...(await ctx.db.query('pressTemplates').collect()).map((t) => ({ ...t, where: t.press })),
      ...(await ctx.db.query('pressWeekOverrides').collect()).map((o) => ({ ...o, where: `${o.press} week ${o.weekStart}` })),
    ]
    for (const p of patterns) {
      const problem = patternProblem(p, args.shiftMinutes)
      if (problem) throw new ConvexError(`${p.where}: ${problem}`)
    }
    if (args.rawUrgentDays !== undefined && (!Number.isInteger(args.rawUrgentDays) || args.rawUrgentDays < 1 || args.rawUrgentDays > 30)) {
      throw new ConvexError('Urgent raw material days must be a whole number between 1 and 30')
    }
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
    overtimeShifts: v.optional(v.number()),
    recurringOvertime: v.optional(recurringValidator),
  }),
  v.null(),
)

export const getTemplate = guardedQuery({
  args: { press: v.string() },
  returns: templateValidator,
  handler: async (ctx, { press }) =>
    ctx.db
      .query('pressTemplates')
      .withIndex('by_press', (q) => q.eq('press', press))
      .first(),
})

export const listTemplates = guardedQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('pressTemplates'),
      _creationTime: v.number(),
      press: v.string(),
      workingDays: v.number(),
      shiftsPerDay: v.number(),
      overtimeShifts: v.optional(v.number()),
      recurringOvertime: v.optional(recurringValidator),
    }),
  ),
  handler: async (ctx) => ctx.db.query('pressTemplates').collect(),
})

export const saveTemplate = guardedMutation({
  args: {
    press: v.string(),
    workingDays: v.number(),
    shiftsPerDay: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const press = args.press.trim()
    if (!press) throw new ConvexError('Press name is required')
    const defined = await ctx.db
      .query('presses')
      .withIndex('by_name', (q) => q.eq('name', press))
      .first()
    if (!defined) throw new ConvexError(`${press} is not defined on Press Definitions — define the press first.`)
    const problem = patternProblem(args, await shiftMinutesOf(ctx))
    if (problem) throw new ConvexError(problem)
    const existing = await ctx.db
      .query('pressTemplates')
      .withIndex('by_press', (q) => q.eq('press', press))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, {
        workingDays: args.workingDays,
        shiftsPerDay: args.shiftsPerDay,
        overtimeShifts: undefined,
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
  overtimeShifts: v.optional(v.number()),
})

export const listOverrides = guardedQuery({
  args: { press: v.string() },
  returns: v.array(overrideValidator),
  handler: async (ctx, { press }) =>
    ctx.db
      .query('pressWeekOverrides')
      .withIndex('by_press_week', (q) => q.eq('press', press))
      .collect(),
})

export const saveOverride = guardedMutation({
  args: {
    press: v.string(),
    weekStart: v.string(),
    workingDays: v.number(),
    shiftsPerDay: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const press = args.press.trim()
    if (!press) throw new ConvexError('Press name is required')
    const defined = await ctx.db
      .query('presses')
      .withIndex('by_name', (q) => q.eq('name', press))
      .first()
    if (!defined) throw new ConvexError(`${press} is not defined on Press Definitions — define the press first.`)
    const problem = patternProblem(args, await shiftMinutesOf(ctx))
    if (problem) throw new ConvexError(problem)
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
        overtimeShifts: undefined,
      })
    } else {
      await ctx.db.insert('pressWeekOverrides', { ...args, press })
    }
    return null
  },
})

export const clearOverride = guardedMutation({
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
/**
 * Capacity Dashboard A görünümünün kabul edilen performans oranı. Planı
 * değiştirmez (plan parça performansını master data'dan okur).
 */
export const saveAcceptedPerformanceRate = guardedMutation({
  args: { rate: v.number() },
  returns: v.null(),
  affectsPlan: false,
  handler: async (ctx, { rate }) => {
    if (!Number.isFinite(rate) || rate < 0.05 || rate > 2) {
      throw new ConvexError('The accepted rate must be between 5 % and 200 %.')
    }
    const existing = await ctx.db
      .query('globalShiftSettings')
      .withIndex('by_key', (q) => q.eq('key', 'default'))
      .first()
    if (!existing) throw new ConvexError('Save the Work Calendar settings once first.')
    await ctx.db.patch(existing._id, { acceptedPerformanceRate: rate })
    return null
  },
})

export const setCapacityFactor = guardedMutation({
  args: { capacityFactor: v.number() },
  returns: v.null(),
  handler: async (ctx, { capacityFactor }) => {
    if (capacityFactor <= 0 || capacityFactor > 2) {
      throw new ConvexError('Capacity factor must be between 0 and 2')
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
        country: 'RO',
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
export const listAllOverrides = guardedQuery({
  args: {},
  returns: v.array(overrideValidator),
  handler: async (ctx) => ctx.db.query('pressWeekOverrides').collect(),
})

/** Raw Material Coverage sayfasının ayarları: yalnızca bu iki alan yazılır. */
export const saveRawCoverageSettings = guardedMutation({
  args: { rawCoverageDays: v.number(), rawOrderExtraKg: v.number() },
  returns: v.null(),
  affectsPlan: false,
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.rawCoverageDays) || args.rawCoverageDays < 1 || args.rawCoverageDays > 90) {
      throw new ConvexError('Coverage days must be between 1 and 90')
    }
    if (!Number.isFinite(args.rawOrderExtraKg) || args.rawOrderExtraKg < 0 || args.rawOrderExtraKg > 100_000) {
      throw new ConvexError('Extra kg must be between 0 and 100 000')
    }
    const existing = await ctx.db
      .query('globalShiftSettings')
      .withIndex('by_key', (q) => q.eq('key', 'default'))
      .first()
    const patch = { rawCoverageDays: Math.round(args.rawCoverageDays), rawOrderExtraKg: Math.round(args.rawOrderExtraKg) }
    if (existing) await ctx.db.patch(existing._id, patch)
    else throw new ConvexError('Save the Work Calendar settings once first')
    return null
  },
})

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

/** Hammadde sipariş mailinin alıcıları (To) ve bilgi grubu (CC) — bir kez tanımlanır. */
export const saveRawOrderRecipients = guardedMutation({
  args: { to: v.array(v.string()), cc: v.array(v.string()) },
  returns: v.null(),
  affectsPlan: false,
  handler: async (ctx, args) => {
    const clean = (list: string[]) => Array.from(new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean)))
    const to = clean(args.to)
    const cc = clean(args.cc).filter((e) => !to.includes(e))
    const bad = [...to, ...cc].filter((e) => !EMAIL.test(e))
    if (bad.length > 0) throw new ConvexError(`Not an e-mail address: ${bad.join(', ')}`)
    if (to.length + cc.length > 50) throw new ConvexError('At most 50 addresses')
    const existing = await ctx.db
      .query('globalShiftSettings')
      .withIndex('by_key', (q) => q.eq('key', 'default'))
      .first()
    if (!existing) throw new ConvexError('Save the Work Calendar settings once first')
    await ctx.db.patch(existing._id, { rawOrderMailTo: to, rawOrderMailCc: cc })
    return null
  },
})
