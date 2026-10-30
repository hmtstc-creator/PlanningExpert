import { ConvexError, v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'
import { sources } from './overtime'
import { dayShiftsProblem } from '../src/lib/pressCalendar'

/**
 * Operatör planı (Production Plan → Work calendar → Operators): 'operator'
 * modelli bir cost center'ın üretim günü × vardiyadaki adam sayısı. Plan
 * yeniden hesaplanınca adamlar hatlara dağıtılır (src/lib/operatorAllocation.ts);
 * girilmeyen gün × vardiyada takvim geçerlidir, elle gün kaydı her zaman önce gelir.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

const ISO = /^\d{4}-\d{2}-\d{2}$/

const headcountValidator = v.object({
  _id: v.id('operatorHeadcount'),
  _creationTime: v.number(),
  costCenter: v.string(),
  date: v.string(),
  shift: v.number(),
  operators: v.number(),
})

export const list = guardedQuery({
  args: {},
  returns: v.array(headcountValidator),
  handler: async (ctx) => ctx.db.query('operatorHeadcount').collect(),
})

/** Operatör modelli bir cost center mı? Değilse yazılmaz (yanlışlıkla girilen sayı planı değiştirmesin). */
function requireOperatorCostCenter(ctx: Ctx, code: string) {
  const cc = ((ctx.plant?.costCenters ?? []) as { code: string; planningModel?: string }[]).find((c) => c.code === code)
  if (!cc) throw new ConvexError(`${code} is not a cost center of this plant`)
  if (cc.planningModel !== 'operator') {
    throw new ConvexError(`${code} uses the shift plan — switch it to "Operator plan" on Company settings first`)
  }
}

async function existingRow(ctx: Ctx, costCenter: string, date: string, shift: number) {
  const rows = await ctx.db
    .query('operatorHeadcount')
    .withIndex('by_cc_date', (q: Ctx) => q.eq('costCenter', costCenter).eq('date', date))
    .collect()
  return rows.find((r: Ctx) => r.shift === shift) ?? null
}

/** Bir cost center × gün × vardiyanın adam sayısını yazar (aynı anahtar varsa günceller). */
export const upsert = guardedMutation({
  areas: ['planning.calendar'],
  args: { costCenter: v.string(), date: v.string(), shift: v.number(), operators: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const costCenter = args.costCenter.trim()
    if (!ISO.test(args.date)) throw new ConvexError('Date must be YYYY-MM-DD')
    if (!Number.isInteger(args.operators) || args.operators < 0 || args.operators > 999) {
      throw new ConvexError('Operators must be a whole number between 0 and 999')
    }
    requireOperatorCostCenter(ctx, costCenter)
    const problem = dayShiftsProblem([args.shift], (await sources(ctx)).shiftMinutes)
    if (problem) throw new ConvexError(problem)
    const existing = await existingRow(ctx, costCenter, args.date, args.shift)
    if (existing) await ctx.db.patch(existing._id, { operators: args.operators })
    else await ctx.db.insert('operatorHeadcount', { costCenter, date: args.date, shift: args.shift, operators: args.operators })
    return null
  },
})

/** Kaydı siler: o gün × vardiyada yine takvim geçerli olur. */
export const remove = guardedMutation({
  areas: ['planning.calendar'],
  args: { costCenter: v.string(), date: v.string(), shift: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await existingRow(ctx, args.costCenter.trim(), args.date, args.shift)
    if (existing) await ctx.db.delete(existing._id)
    return null
  },
})
