import { ConvexError, v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'
import {
  downtimeDayFields,
  lossDayFields,
  monthlyFields,
  orderFields,
  shiftFields,
  weeklyFields,
} from './oeeValidators'
import { archiveRows, mergeWeekly } from '../src/lib/oee'
import { WEEKLY_ARCHIVE, WEEKLY_ARCHIVE_YEAR } from '../src/lib/oeeWeeklyArchive'

/**
 * OEE Trend and Losses — veri. Planlamacı sistemden indirdiği dosyayı
 * yükler; sayfa gerekli sayfaları okur (Daily KPI alınmaz, vardiyadan
 * hesaplanır). Yükleme kuralı: dosyadaki tarih aralığı eskisinin yerine
 * geçer, daha eski tarihler saklanır — böylece geçmiş birikir. Monthly KPI
 * her yüklemede komple yenilenir; haftalık satırlar hafta bazında.
 * Plan bu veriyi okumaz: `affectsPlan: false`.
 */

// Convex'in üretilen tipleri bu ortamda yok; gevşek tiplenmiş.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

const ISO = /^\d{4}-\d{2}-\d{2}$/
/**
 * Bir silme çağrısında en çok bu kadar kayıt (işlem sınırları için). Duruş
 * günleri büyük kayıtlar (yüzlerce duruş) olduğundan onlarda daha az.
 */
const DELETE_BATCH = 400
const DELETE_BATCH_BIG = 40
/** Duruş olaylarını okuyan sorgu en çok bu kadar gün kapsar (okuma sınırı). */
const MAX_EVENT_DAYS = 8

const kindValidator = v.union(
  v.literal('shifts'),
  v.literal('orders'),
  v.literal('downtimes'),
  v.literal('losses'),
  v.literal('weekly'),
  v.literal('monthly'),
)

const TABLE: Record<string, string> = {
  shifts: 'oeeShifts',
  orders: 'oeeOrders',
  downtimes: 'oeeDowntimeDays',
  losses: 'oeeLossDays',
  weekly: 'oeeWeekly',
  monthly: 'oeeMonthly',
}

function checkRange(from?: string, to?: string) {
  if (!from || !to || !ISO.test(from) || !ISO.test(to) || from > to) {
    throw new ConvexError('Date range must be YYYY-MM-DD, from ≤ to')
  }
}

/**
 * Yükleme öncesi silme: tarih aralığı (vardiya, sipariş, duruş), hafta
 * listesi (haftalık) ya da hepsi (aylık). Parça parça: `more` true dönerse
 * tekrar çağrılır.
 */
export const clearRange = guardedMutation({
  args: {
    kind: kindValidator,
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    weeks: v.optional(v.array(v.object({ year: v.number(), week: v.number() }))),
  },
  returns: v.object({ deleted: v.number(), more: v.boolean() }),
  affectsPlan: false,
  handler: async (ctx: Ctx, { kind, from, to, weeks }: Ctx) => {
    const table = TABLE[kind]
    const limit = kind === 'downtimes' ? DELETE_BATCH_BIG : DELETE_BATCH
    let docs: Ctx[] = []
    if (kind === 'monthly') {
      docs = await ctx.db.query(table).take(limit + 1)
    } else if (kind === 'weekly') {
      for (const w of weeks ?? []) {
        if (docs.length > limit) break
        const hit = await ctx.db
          .query(table)
          .withIndex('by_week', (q: Ctx) => q.eq('year', w.year).eq('week', w.week))
          .take(limit + 1 - docs.length)
        docs.push(...hit)
      }
    } else {
      checkRange(from, to)
      docs = await ctx.db
        .query(table)
        .withIndex('by_date', (q: Ctx) => q.gte('date', from).lte('date', to))
        .take(limit + 1)
    }
    const batch = docs.slice(0, limit)
    for (const d of batch) await ctx.db.delete(d._id)
    return { deleted: batch.length, more: docs.length > limit }
  },
})

export const insertShifts = guardedMutation({
  args: { rows: v.array(v.object(shiftFields)) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx: Ctx, { rows }: Ctx) => {
    for (const r of rows) await ctx.db.insert('oeeShifts', r)
    return rows.length
  },
})

export const insertOrders = guardedMutation({
  args: { rows: v.array(v.object(orderFields)) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx: Ctx, { rows }: Ctx) => {
    for (const r of rows) await ctx.db.insert('oeeOrders', r)
    return rows.length
  },
})

export const insertWeekly = guardedMutation({
  args: { rows: v.array(v.object(weeklyFields)) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx: Ctx, { rows }: Ctx) => {
    for (const r of rows) await ctx.db.insert('oeeWeekly', r)
    return rows.length
  },
})

export const insertMonthly = guardedMutation({
  args: { rows: v.array(v.object(monthlyFields)) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx: Ctx, { rows }: Ctx) => {
    for (const r of rows) await ctx.db.insert('oeeMonthly', r)
    return rows.length
  },
})

export const insertDowntimeDays = guardedMutation({
  args: { days: v.array(v.object(downtimeDayFields)) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx: Ctx, { days }: Ctx) => {
    for (const d of days) await ctx.db.insert('oeeDowntimeDays', d)
    return days.length
  },
})

export const insertLossDays = guardedMutation({
  args: { days: v.array(v.object(lossDayFields)) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx: Ctx, { days }: Ctx) => {
    for (const d of days) await ctx.db.insert('oeeLossDays', d)
    return days.length
  },
})

export const finishImport = guardedMutation({
  args: {
    fileName: v.string(),
    sheets: v.array(v.array(v.union(v.string(), v.number()))),
    ranges: v.array(v.array(v.string())),
  },
  returns: v.null(),
  affectsPlan: false,
  handler: async (ctx: Ctx, args: Ctx) => {
    await ctx.db.insert('oeeImports', { ...args, uploadedAt: Date.now(), uploadedBy: ctx.sessionUser?.name })
    return null
  },
})

// ---- okuma ----------------------------------------------------------------------

const strip = ({ _id, _creationTime, ...rest }: Ctx) => rest

export const lastImport = guardedQuery({
  args: {},
  handler: async (ctx: Ctx) => {
    const doc = await ctx.db.query('oeeImports').withIndex('by_uploadedAt').order('desc').first()
    return doc ? strip(doc) : null
  },
})

/** Bir tarih aralığının vardiya satırları (dashboard ve kayıplar). */
export const shifts = guardedQuery({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx: Ctx, { from, to }: Ctx) => {
    checkRange(from, to)
    const rows = await ctx.db
      .query('oeeShifts')
      .withIndex('by_date', (q: Ctx) => q.gte('date', from).lte('date', to))
      .collect()
    return rows.map(strip)
  },
})

export const orders = guardedQuery({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx: Ctx, { from, to }: Ctx) => {
    checkRange(from, to)
    const rows = await ctx.db
      .query('oeeOrders')
      .withIndex('by_date', (q: Ctx) => q.gte('date', from).lte('date', to))
      .collect()
    return rows.map(strip)
  },
})

/** Yüklenmiş haftalık satırlar (Weekly KPI / Weekly KPI_fix) ve aylık. */
/**
 * Haftalık (programdaki Weekly KPI_fix arşivi + yüklenenler, bkz.
 * mergeWeekly) ve aylık satırlar.
 */
export const periods = guardedQuery({
  args: {},
  handler: async (ctx: Ctx) => ({
    weekly: mergeWeekly(archiveRows(WEEKLY_ARCHIVE, WEEKLY_ARCHIVE_YEAR), (await ctx.db.query('oeeWeekly').collect()).map(strip)),
    monthly: (await ctx.db.query('oeeMonthly').collect()).map(strip),
  }),
})

export const lossDays = guardedQuery({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx: Ctx, { from, to }: Ctx) => {
    checkRange(from, to)
    const rows = await ctx.db
      .query('oeeLossDays')
      .withIndex('by_date', (q: Ctx) => q.gte('date', from).lte('date', to))
      .collect()
    return rows.map(strip)
  },
})

/** Duruş satırları — en çok bir hafta (setup analizi ve veri görünümü). */
export const downtimeDays = guardedQuery({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx: Ctx, { from, to }: Ctx) => {
    checkRange(from, to)
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1
    if (days > MAX_EVENT_DAYS) throw new ConvexError(`Downtime rows can be read for at most ${MAX_EVENT_DAYS} days at a time`)
    const rows = await ctx.db
      .query('oeeDowntimeDays')
      .withIndex('by_date', (q: Ctx) => q.gte('date', from).lte('date', to))
      .collect()
    return rows.map(strip)
  },
})

/** Veride hangi tarihler var: son gün (varsayılan "dün" yoksa buna göre). */
export const coverage = guardedQuery({
  args: {},
  handler: async (ctx: Ctx) => {
    const first = await ctx.db.query('oeeShifts').withIndex('by_date').order('asc').first()
    const last = await ctx.db.query('oeeShifts').withIndex('by_date').order('desc').first()
    const firstDown = await ctx.db.query('oeeDowntimeDays').withIndex('by_date').order('asc').first()
    const lastDown = await ctx.db.query('oeeDowntimeDays').withIndex('by_date').order('desc').first()
    return {
      shifts: first ? { from: first.date, to: last.date } : null,
      downtimes: firstDown ? { from: firstDown.date, to: lastDown.date } : null,
    }
  },
})
