import { ConvexError, v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'
import { dayOf, hasCalendar, requireDefinedPress, sources } from './overtime'
import { dayShiftsProblem } from '../src/lib/pressCalendar'

/**
 * Gün kaydı: Production Plan → Work calendar'da planlamacının "nihai karar"ı.
 * Bir presin bir üretim gününde hangi vardiyaların çalışacağını tek tek
 * belirler; istisna hafta ve şablonun önüne geçer (src/lib/pressCalendar.ts).
 * Plan yeniden hesaplanınca uygulanır.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

const ISO = /^\d{4}-\d{2}-\d{2}$/

const dayShiftsValidator = v.object({
  _id: v.id('pressDayShifts'),
  _creationTime: v.number(),
  press: v.string(),
  date: v.string(),
  shifts: v.array(v.number()),
})

export const list = guardedQuery({
  args: {},
  returns: v.array(dayShiftsValidator),
  handler: async (ctx) => ctx.db.query('pressDayShifts').collect(),
})

/**
 * Bir pres × günün vardiyalarını yaz. `shifts: null` kaydı siler (gün yine
 * istisna hafta / şablondan gelir). Mesaiyle çakışan vardiya kaydedilmez.
 */
export const setDay = guardedMutation({
  areas: ['planning.calendar'],
  args: { press: v.string(), date: v.string(), shifts: v.union(v.array(v.number()), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const press = args.press.trim()
    if (!press) throw new ConvexError('Work center is required')
    if (!ISO.test(args.date)) throw new ConvexError('Date must be YYYY-MM-DD')
    await requireDefinedPress(ctx, press)
    if (!(await hasCalendar(ctx, press))) {
      throw new ConvexError(`${press} has no Work Calendar pattern yet — define its days and shifts first.`)
    }
    const existing = await ctx.db
      .query('pressDayShifts')
      .withIndex('by_press_date', (q: Ctx) => q.eq('press', press).eq('date', args.date))
      .first()
    if (args.shifts === null) {
      if (existing) await ctx.db.delete(existing._id)
      return null
    }
    const shifts = [...args.shifts].sort((a, b) => a - b)
    const src = await sources(ctx)
    const problem = dayShiftsProblem(shifts, src.shiftMinutes)
    if (problem) throw new ConvexError(problem)
    if (existing) await ctx.db.patch(existing._id, { shifts })
    else await ctx.db.insert('pressDayShifts', { press, date: args.date, shifts })
    // Yaz, sonra denetle: o günün mesaisi açılan vardiyayla çakışırsa geri alınır.
    const day = await dayOf(ctx, press, args.date)
    if (day.problems.length) {
      throw new ConvexError(`Cannot change ${press} ${args.date}: ${day.problems.join(' ')} Remove that overtime first.`)
    }
    return null
  },
})
