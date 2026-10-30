import { ConvexError, v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'

/**
 * Operatör planı, uzun vade (Work Calendar → Capacity overview): 'operator'
 * modelli bir cost center'ın hafta × operatör sayısı (o hafta sahadaki kişi,
 * vardiyalara bölünmez). Gün × vardiya adam sayısı (operatorHeadcount)
 * girilmemiş günlerde motor vardiya başına floor(haftalık ÷ 3) kullanır;
 * Capacity dashboard kapasiteyi bununla sınırlar (src/lib/operatorCapacity.ts).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

const ISO = /^\d{4}-\d{2}-\d{2}$/

const weeklyValidator = v.object({
  _id: v.id('operatorWeekly'),
  _creationTime: v.number(),
  costCenter: v.string(),
  weekStart: v.string(),
  operators: v.number(),
})

export const list = guardedQuery({
  args: {},
  returns: v.array(weeklyValidator),
  handler: async (ctx) => ctx.db.query('operatorWeekly').collect(),
})

/** Operatör modelli bir cost center mı? Değilse yazılmaz (yanlışlıkla girilen sayı planı değiştirmesin). */
function requireOperatorCostCenter(ctx: Ctx, code: string) {
  const cc = ((ctx.plant?.costCenters ?? []) as { code: string; planningModel?: string }[]).find((c) => c.code === code)
  if (!cc) throw new ConvexError(`${code} is not a cost center of this plant`)
  if (cc.planningModel !== 'operator') {
    throw new ConvexError(`${code} uses the shift plan — switch it to "Operator plan" on Company settings first`)
  }
}

/** Pazartesi mi? (UTC gününe göre; tarih ISO). */
const isMonday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 1

async function existingRow(ctx: Ctx, costCenter: string, weekStart: string) {
  const rows = await ctx.db
    .query('operatorWeekly')
    .withIndex('by_cc_week', (q: Ctx) => q.eq('costCenter', costCenter).eq('weekStart', weekStart))
    .collect()
  return rows[0] ?? null
}

/** Bir cost center × haftanın operatör sayısını yazar (aynı anahtar varsa günceller). */
export const upsert = guardedMutation({
  areas: ['planning.calendar'],
  args: { costCenter: v.string(), weekStart: v.string(), operators: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const costCenter = args.costCenter.trim()
    if (!ISO.test(args.weekStart) || !isMonday(args.weekStart)) throw new ConvexError('Week start must be a Monday (YYYY-MM-DD)')
    if (!Number.isInteger(args.operators) || args.operators < 0 || args.operators > 9999) {
      throw new ConvexError('Operators must be a whole number between 0 and 9999')
    }
    requireOperatorCostCenter(ctx, costCenter)
    const existing = await existingRow(ctx, costCenter, args.weekStart)
    if (existing) await ctx.db.patch(existing._id, { operators: args.operators })
    else await ctx.db.insert('operatorWeekly', { costCenter, weekStart: args.weekStart, operators: args.operators })
    return null
  },
})

/** Kaydı siler: o hafta yine makine × 3 vardiya (ya da gün × vardiya ızgarası) geçerli olur. */
export const remove = guardedMutation({
  areas: ['planning.calendar'],
  args: { costCenter: v.string(), weekStart: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await existingRow(ctx, args.costCenter.trim(), args.weekStart)
    if (existing) await ctx.db.delete(existing._id)
    return null
  },
})
