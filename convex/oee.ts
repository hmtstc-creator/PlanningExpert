import { ConvexError, v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'
import {
  configFields,
  dailyFields,
  downtimeDayFields,
  monthlyFields,
  orderFields,
  shiftFields,
  weeklyFields,
} from './oeeValidators'
import { daysFromShifts, lossDayOf } from '../src/lib/oee'
import { fromStoredDay, mergeEvents, toStoredDay, toStoredLoss } from '../src/lib/oeeStore'

/**
 * OEE Trend and Losses — veri.
 *
 * Kural (planlamacı, 2026-09-27): geçmiş hiçbir zaman silinmez. Her yükleme
 * satırı kendi anahtarıyla EKLER ya da GÜNCELLER:
 *   vardiya   tarih + iş merkezi + vardiya grubu
 *   gün       tarih + iş merkezi (vardiyalardan; yoksa Daily KPI)
 *   sipariş   tarih + iş merkezi + vardiya + sipariş + ekipman
 *   duruş     iş merkezi + başlangıç tarihi/saati + sipariş (gün kaydında birleşir)
 *   hafta     yıl + hafta + iş merkezi
 *   ay        yıl + ay + iş merkezi
 * Böylece son iki haftayı tekrar tekrar yüklemek mükerrer kayıt yapmaz.
 * Plan bu veriyi okumaz: `affectsPlan: false`.
 */

// Convex'in üretilen tipleri bu ortamda yok; gevşek tiplenmiş.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

const ISO = /^\d{4}-\d{2}-\d{2}$/
/** Duruş olaylarını okuyan sorgu en çok bu kadar gün kapsar (okuma sınırı). */
const MAX_EVENT_DAYS = 8

function checkRange(from?: string, to?: string) {
  if (!from || !to || !ISO.test(from) || !ISO.test(to) || from > to) {
    throw new ConvexError('Date range must be YYYY-MM-DD, from ≤ to')
  }
}

async function upsert(ctx: Ctx, existing: Ctx | null, table: string, doc: Ctx) {
  if (existing) await ctx.db.replace(existing._id, doc)
  else await ctx.db.insert(table, doc)
}

const dayDoc = (d: Ctx) => ({
  date: d.date,
  plantKey: d.plantKey,
  responsible: d.responsible,
  costCenter: d.costCenter,
  workCenter: d.workCenter,
  source: d.source,
  good: d.good,
  scrap: d.scrap,
  reject: d.reject,
  scheduledMin: d.scheduledMin,
  unscheduledMin: d.unscheduledMin,
  operatingMin: d.operatingMin,
  productionMin: d.productionMin,
  loadingMin: d.loadingMin,
})

/** Vardiyalar: ekle ya da güncelle; etkilenen günlerin toplamı yeniden hesaplanır. */
export const upsertShifts = guardedMutation({
  args: { rows: v.array(v.object(shiftFields)) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx: Ctx, { rows }: Ctx) => {
    const touched = new Map<string, { date: string; workCenter: string }>()
    for (const r of rows) {
      const hit = await ctx.db
        .query('oeeShifts')
        .withIndex('by_key', (q: Ctx) => q.eq('date', r.date).eq('workCenter', r.workCenter).eq('shiftGroup', r.shiftGroup))
        .first()
      await upsert(ctx, hit, 'oeeShifts', r)
      touched.set(`${r.date}|${r.workCenter}`, { date: r.date, workCenter: r.workCenter })
    }
    for (const { date, workCenter } of touched.values()) {
      const all = await ctx.db
        .query('oeeShifts')
        .withIndex('by_key', (q: Ctx) => q.eq('date', date).eq('workCenter', workCenter))
        .collect()
      const [day] = daysFromShifts(all)
      const hit = await ctx.db
        .query('oeeDays')
        .withIndex('by_key', (q: Ctx) => q.eq('date', date).eq('workCenter', workCenter))
        .first()
      if (day) await upsert(ctx, hit, 'oeeDays', dayDoc(day))
    }
    return rows.length
  },
})

/** Daily KPI (geçmiş): o günün vardiya verisi varsa vardiya toplamı geçerlidir. */
export const upsertDaily = guardedMutation({
  args: { rows: v.array(v.object(dailyFields)) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx: Ctx, { rows }: Ctx) => {
    let n = 0
    for (const r of rows) {
      const hit = await ctx.db
        .query('oeeDays')
        .withIndex('by_key', (q: Ctx) => q.eq('date', r.date).eq('workCenter', r.workCenter))
        .first()
      if (hit?.source === 'shiftly') continue
      await upsert(ctx, hit, 'oeeDays', dayDoc({ ...r, source: 'daily' }))
      n++
    }
    return n
  },
})

export const upsertOrders = guardedMutation({
  args: { rows: v.array(v.object(orderFields)) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx: Ctx, { rows }: Ctx) => {
    for (const r of rows) {
      const hit = await ctx.db
        .query('oeeOrders')
        .withIndex('by_key', (q: Ctx) =>
          q.eq('date', r.date).eq('workCenter', r.workCenter).eq('shift', r.shift).eq('order', r.order).eq('equipment', r.equipment),
        )
        .first()
      await upsert(ctx, hit, 'oeeOrders', r)
    }
    return rows.length
  },
})

export const upsertWeekly = guardedMutation({
  args: { rows: v.array(v.object(weeklyFields)) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx: Ctx, { rows }: Ctx) => {
    for (const r of rows) {
      const hit = await ctx.db
        .query('oeeWeekly')
        .withIndex('by_key', (q: Ctx) => q.eq('year', r.year).eq('week', r.week).eq('workCenter', r.workCenter))
        .first()
      const { source: _legacy, ...doc } = r
      await upsert(ctx, hit, 'oeeWeekly', doc)
    }
    return rows.length
  },
})

export const upsertMonthly = guardedMutation({
  args: { rows: v.array(v.object({ ...monthlyFields, year: v.number() })) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx: Ctx, { rows }: Ctx) => {
    for (const r of rows) {
      const same = await ctx.db
        .query('oeeMonthly')
        .withIndex('by_key', (q: Ctx) => q.eq('workCenter', r.workCenter).eq('monthKey', r.monthKey))
        .collect()
      // Yılı olmayan eski kayıt da aynı ay sayılır ve yıl eklenerek güncellenir.
      const hit = same.find((m: Ctx) => m.year === r.year) ?? same.find((m: Ctx) => m.year === undefined) ?? null
      await upsert(ctx, hit, 'oeeMonthly', r)
    }
    return rows.length
  },
})

/**
 * Duruşlar: aynı gün × iş merkezinin eski duruşlarıyla birleşir (aynı duruş
 * güncellenir, yenisi eklenir, eskisi silinmez); kayıp özeti yeniden hesaplanır.
 */
export const upsertDowntimeDays = guardedMutation({
  args: { days: v.array(v.object(downtimeDayFields)) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx: Ctx, { days }: Ctx) => {
    for (const incoming of days) {
      const hit = await ctx.db
        .query('oeeDowntimeDays')
        .withIndex('by_key', (q: Ctx) => q.eq('date', incoming.date).eq('workCenter', incoming.workCenter))
        .first()
      const next = fromStoredDay(incoming)
      if (hit) next.events = mergeEvents(fromStoredDay(hit).events, next.events)
      const stored = toStoredDay(next)
      await upsert(ctx, hit, 'oeeDowntimeDays', stored)
      const lossHit = await ctx.db
        .query('oeeLossDays')
        .withIndex('by_key', (q: Ctx) => q.eq('date', incoming.date).eq('workCenter', incoming.workCenter))
        .first()
      await upsert(ctx, lossHit, 'oeeLossDays', toStoredLoss(lossDayOf(next)))
    }
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

// ---- ayarlar --------------------------------------------------------------------

export const settings = guardedQuery({
  args: {},
  handler: async (ctx: Ctx) => {
    const doc = await ctx.db
      .query('oeeSettings')
      .withIndex('by_key', (q: Ctx) => q.eq('key', 'default'))
      .first()
    if (!doc) return null
    const { _id, _creationTime, key: _key, updatedAt, updatedBy, ...config } = doc
    return { config, updatedAt, updatedBy }
  },
})

export const saveSettings = guardedMutation({
  args: { config: v.object(configFields) },
  returns: v.null(),
  affectsPlan: false,
  handler: async (ctx: Ctx, { config }: Ctx) => {
    if (!(config.startupRunMin > 0) || !(config.trendWeeks > 0) || !(config.topN > 0)) {
      throw new ConvexError('Production after setup, trend weeks and list size must be above 0')
    }
    const names = new Set(config.areas.map((a: Ctx) => a.name))
    const missing = config.costCenters.filter((c: Ctx) => !names.has(c.area)).map((c: Ctx) => c.code)
    if (missing.length) throw new ConvexError(`Choose an area for cost center ${missing.join(', ')}`)
    const doc = { key: 'default', ...config, updatedAt: Date.now(), updatedBy: ctx.sessionUser?.name }
    const hit = await ctx.db
      .query('oeeSettings')
      .withIndex('by_key', (q: Ctx) => q.eq('key', 'default'))
      .first()
    await upsert(ctx, hit, 'oeeSettings', doc)
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

const byDate = (table: string) =>
  guardedQuery({
    args: { from: v.string(), to: v.string() },
    handler: async (ctx: Ctx, { from, to }: Ctx) => {
      checkRange(from, to)
      const rows = await ctx.db
        .query(table)
        .withIndex('by_date', (q: Ctx) => q.gte('date', from).lte('date', to))
        .collect()
      return rows.map(strip)
    },
  })

/** Gün × iş merkezi (hafta, ay, kutular ve kayıp oranlarının tabanı). */
export const days = byDate('oeeDays')
/** Vardiya satırları (haftanın vardiya grafiği). */
export const shifts = byDate('oeeShifts')
export const orders = byDate('oeeOrders')
export const lossDays = byDate('oeeLossDays')

/** Yüklenen haftalık ve aylık satırlar (yılı olmayan eski aylık kayıtlar hariç). */
export const periods = guardedQuery({
  args: {},
  handler: async (ctx: Ctx) => ({
    weekly: (await ctx.db.query('oeeWeekly').collect()).map(strip),
    monthly: (await ctx.db.query('oeeMonthly').collect()).filter((m: Ctx) => m.year !== undefined).map(strip),
  }),
})

/** Duruş satırları — en çok 8 gün (setup analizi ve veri görünümü). */
export const downtimeDays = guardedQuery({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx: Ctx, { from, to }: Ctx) => {
    checkRange(from, to)
    const n = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1
    if (n > MAX_EVENT_DAYS) throw new ConvexError(`Downtime rows can be read for at most ${MAX_EVENT_DAYS} days at a time`)
    const rows = await ctx.db
      .query('oeeDowntimeDays')
      .withIndex('by_date', (q: Ctx) => q.gte('date', from).lte('date', to))
      .collect()
    return rows.map(strip)
  },
})

/** Hangi tarihler yüklü: her tür için ilk ve son gün. */
export const coverage = guardedQuery({
  args: {},
  handler: async (ctx: Ctx) => {
    const span = async (table: string) => {
      const first = await ctx.db.query(table).withIndex('by_date').order('asc').first()
      const last = await ctx.db.query(table).withIndex('by_date').order('desc').first()
      return first ? { from: first.date, to: last.date } : null
    }
    const weekFirst = await ctx.db.query('oeeWeekly').withIndex('by_week').order('asc').first()
    const weekLast = await ctx.db.query('oeeWeekly').withIndex('by_week').order('desc').first()
    return {
      days: await span('oeeDays'),
      shifts: await span('oeeShifts'),
      orders: await span('oeeOrders'),
      downtimes: await span('oeeDowntimeDays'),
      weekly: weekFirst ? { from: `${weekFirst.year}-W${weekFirst.week}`, to: `${weekLast.year}-W${weekLast.week}` } : null,
    }
  },
})
