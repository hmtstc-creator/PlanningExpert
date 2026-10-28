import { ConvexError, v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'

/**
 * Planlamacının pres bazında müdahalesi, "Recalculate"den önce:
 *
 *   - Plan başlangıcı (gün + saat): pres o andan önce yeni iş almaz.
 *     Operatör yokluğu, hammadde yokluğu gibi durumlar için. O andan önce
 *     başlayan onaylı işler serbest bırakılır ve yeniden planlanır.
 *   - Geride / ileride (dakika): hat plana uyamadı. Onaylı işler (donmuş ve
 *     şu an çalışan) o kadar kaydırılır; geride ise aradaki süre "Behind plan"
 *     olarak kapatılır.
 *
 * Belirtilmeyen pres için plan her zamanki gibi şu andan başlar.
 */

const rowValidator = v.object({
  _id: v.id('pressPlanStarts'),
  _creationTime: v.number(),
  press: v.string(),
  holdFromDate: v.optional(v.string()),
  holdFromMinute: v.optional(v.number()),
  fromDate: v.optional(v.string()),
  fromMinute: v.optional(v.number()),
  reason: v.optional(v.string()),
  delayMinutes: v.optional(v.number()),
  updatedBy: v.optional(v.string()),
  updatedAt: v.number(),
})

const DATE = /^\d{4}-\d{2}-\d{2}$/

export const list = guardedQuery({
  args: {},
  returns: v.array(rowValidator),
  handler: async (ctx) => await ctx.db.query('pressPlanStarts').collect(),
})

export const set = guardedMutation({
  areas: ['planning.plan'],
  args: {
    press: v.string(),
    // Kapalı aralığın başlangıcı; boşsa şu an. Bitiş = fromDate/fromMinute.
    holdFromDate: v.optional(v.string()),
    holdFromMinute: v.optional(v.number()),
    fromDate: v.optional(v.string()),
    fromMinute: v.optional(v.number()),
    reason: v.optional(v.string()),
    delayMinutes: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const press = args.press.trim()
    if (!press) throw new ConvexError('Work center is required')
    for (const date of [args.fromDate, args.holdFromDate]) {
      if (date !== undefined && !DATE.test(date)) throw new ConvexError('Date must be YYYY-MM-DD')
    }
    for (const minute of [args.fromMinute, args.holdFromMinute]) {
      if (minute !== undefined && (!Number.isFinite(minute) || minute < 0 || minute >= 1440)) {
        throw new ConvexError('Time must be between 00:00 and 23:59')
      }
    }
    if (args.holdFromDate && !args.fromDate) throw new ConvexError('Set the end of the closed period too')
    if (
      args.holdFromDate &&
      args.fromDate &&
      `${args.holdFromDate}|${String(args.holdFromMinute ?? 0).padStart(4, '0')}` >= `${args.fromDate}|${String(args.fromMinute ?? 0).padStart(4, '0')}`
    ) {
      throw new ConvexError('The start must be before the end')
    }
    if (args.delayMinutes !== undefined && (!Number.isFinite(args.delayMinutes) || Math.abs(args.delayMinutes) > 7 * 1440)) {
      throw new ConvexError('Delay must be at most 7 days either way')
    }
    const doc = {
      press,
      holdFromDate: args.fromDate ? args.holdFromDate : undefined,
      holdFromMinute: args.fromDate && args.holdFromDate ? (args.holdFromMinute ?? 0) : undefined,
      fromDate: args.fromDate,
      fromMinute: args.fromDate ? (args.fromMinute ?? 0) : undefined,
      reason: args.reason?.trim().slice(0, 200) || undefined,
      delayMinutes: args.delayMinutes ? Math.round(args.delayMinutes) : undefined,
      updatedBy: ctx.sessionUser?.name,
      updatedAt: Date.now(),
    }
    const existing = await ctx.db
      .query('pressPlanStarts')
      .withIndex('by_press', (q) => q.eq('press', press))
      .first()
    const empty = !doc.fromDate && !doc.delayMinutes
    if (existing) {
      if (empty) await ctx.db.delete(existing._id)
      else await ctx.db.replace(existing._id, doc)
    } else if (!empty) {
      await ctx.db.insert('pressPlanStarts', doc)
    }
    return null
  },
})

export const clearAll = guardedMutation({
  areas: ['planning.plan'],
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    for (const row of await ctx.db.query('pressPlanStarts').collect()) await ctx.db.delete(row._id)
    return null
  },
})
