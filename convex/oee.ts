import { ConvexError, v } from 'convex/values'

import { OEE, guardedMutation, guardedQuery } from './guarded'
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
 *   sipariş   tarih + iş merkezi + vardiya + sipariş (kalıp güncellenir)
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
/**
 * Yalnızca seçili fabrikanın masraf yerleri (Plant → Department → Cost center).
 * Ekran zaten süzer; bu sunucu tarafı güvencesi: başka fabrikanın satırı
 * bu fabrikaya yazılamaz.
 */
function plantCostCentersOnly(ctx: Ctx, rows: { costCenter: string }[]) {
  const codes = new Set((ctx.plant?.costCenters ?? []).map((c: Ctx) => c.code))
  const foreign = [...new Set(rows.map((r) => r.costCenter).filter((c) => !codes.has(c)))]
  if (foreign.length) throw new ConvexError(`Cost center ${foreign.join(', ')} is not a cost center of ${ctx.plant?.name ?? 'this plant'}`)
}

export const upsertShifts = guardedMutation({
  areas: ['oee.data'],
  modules: OEE,
  args: { rows: v.array(v.object(shiftFields)) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx, { rows }) => {
    plantCostCentersOnly(ctx, rows)
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
  areas: ['oee.data'],
  modules: OEE,
  args: { rows: v.array(v.object(dailyFields)) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx, { rows }) => {
    plantCostCentersOnly(ctx, rows)
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
  areas: ['oee.data'],
  modules: OEE,
  args: { rows: v.array(v.object(orderFields)) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx, { rows }) => {
    for (const r of rows) {
      // Bir vardiyada bir siparişin tek satırı vardır. Kalıp anahtara girmez: eski
      // dosyada "Equipment" sütununda malzeme kodu vardı; yeni dosya (Var_Equipment =
      // kalıp) aynı satırı yanına ikinci kayıt eklemeden düzeltir (2026-10-06).
      const same = await ctx.db
        .query('oeeOrders')
        .withIndex('by_key', (q: Ctx) => q.eq('date', r.date).eq('workCenter', r.workCenter).eq('shift', r.shift).eq('order', r.order))
        .collect()
      const hit = same.find((o: Ctx) => o.equipment === r.equipment) ?? same[0] ?? null
      await upsert(ctx, hit, 'oeeOrders', r)
      for (const o of same) if (o._id !== hit?._id) await ctx.db.delete(o._id)
    }
    return rows.length
  },
})

export const upsertWeekly = guardedMutation({
  areas: ['oee.data'],
  modules: OEE,
  args: { rows: v.array(v.object(weeklyFields)) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx, { rows }) => {
    plantCostCentersOnly(ctx, rows)
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
  areas: ['oee.data'],
  modules: OEE,
  args: { rows: v.array(v.object({ ...monthlyFields, year: v.number() })) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx, { rows }) => {
    plantCostCentersOnly(ctx, rows)
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
 * Duruşlar: dosyada bulunan her gün × iş merkezinin duruşları dosyadakiyle
 * tamamen yenilenir (sistemde saati değişen ya da bölünen duruş iki kez
 * sayılmasın — planlamacı, 2026-09-28). Dosyada olmayan günlere dokunulmaz.
 * Kayıp özeti yeniden hesaplanır.
 */
export const upsertDowntimeDays = guardedMutation({
  areas: ['oee.data'],
  modules: OEE,
  args: { days: v.array(v.object(downtimeDayFields)) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx, { days }) => {
    plantCostCentersOnly(ctx, days)
    for (const incoming of days) {
      const hit = await ctx.db
        .query('oeeDowntimeDays')
        .withIndex('by_key', (q: Ctx) => q.eq('date', incoming.date).eq('workCenter', incoming.workCenter))
        .first()
      const next = fromStoredDay(incoming)
      // Dosyanın kendi içindeki aynı satır bir kez sayılır.
      next.events = mergeEvents([], next.events)
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

/**
 * İlk sürümle yüklenen veride gün toplamları (oeeDays) ve yeni biçim kayıp
 * özetleri yoktur. Bu adım saklı vardiya ve duruşlardan onları kurar; hiçbir
 * şey silinmez, tekrar çalışması zararsızdır. İstemci `isDone` gelene kadar
 * imleçle çağırır.
 */
export const rebuildStored = guardedMutation({
  areas: ['oee.data'],
  modules: OEE,
  args: { step: v.union(v.literal('days'), v.literal('losses')), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ cursor: v.string(), isDone: v.boolean(), count: v.number() }),
  affectsPlan: false,
  handler: async (ctx, { step, cursor }) => {
    if (step === 'days') {
      const page = await ctx.db.query('oeeShifts').withIndex('by_date').paginate({ cursor, numItems: 400 })
      const keys = new Map<string, { date: string; workCenter: string }>()
      for (const r of page.page) keys.set(`${r.date}|${r.workCenter}`, { date: r.date, workCenter: r.workCenter })
      for (const { date, workCenter } of keys.values()) {
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
      return { cursor: page.continueCursor, isDone: page.isDone, count: keys.size }
    }
    // Duruş kayıtları büyük: küçük sayfa.
    const page = await ctx.db.query('oeeDowntimeDays').withIndex('by_date').paginate({ cursor, numItems: 40 })
    for (const doc of page.page) {
      const lossHit = await ctx.db
        .query('oeeLossDays')
        .withIndex('by_key', (q: Ctx) => q.eq('date', doc.date).eq('workCenter', doc.workCenter))
        .first()
      if (lossHit?.codes) continue
      await upsert(ctx, lossHit, 'oeeLossDays', toStoredLoss(lossDayOf(fromStoredDay(doc))))
    }
    return { cursor: page.continueCursor, isDone: page.isDone, count: page.page.length }
  },
})

export const finishImport = guardedMutation({
  areas: ['oee.data'],
  modules: OEE,
  args: {
    fileName: v.string(),
    sheets: v.array(v.array(v.union(v.string(), v.number()))),
    ranges: v.array(v.array(v.string())),
  },
  returns: v.null(),
  affectsPlan: false,
  handler: async (ctx, args) => {
    await ctx.db.insert('oeeImports', { ...args, uploadedAt: Date.now(), uploadedBy: ctx.sessionUser?.name })
    return null
  },
})

// ---- ayarlar --------------------------------------------------------------------

export const settings = guardedQuery({
  modules: OEE,
  args: {},
  handler: async (ctx) => {
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
  areas: ['oee.settings'],
  modules: OEE,
  args: { config: v.object(configFields) },
  returns: v.null(),
  affectsPlan: false,
  handler: async (ctx, { config }) => {
    if (!(config.startupRunMin > 0) || !(config.trendWeeks > 0) || !(config.topN > 0)) {
      throw new ConvexError('Production after setup, trend weeks and list size must be above 0')
    }
    // Alan = bölüm (K3): bölümler ve masraf yeri ataması Organization'dan gelir; burada denetlenmez.
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
  modules: OEE,
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db.query('oeeImports').withIndex('by_uploadedAt').order('desc').first()
    return doc ? strip(doc) : null
  },
})

/** Tarih indeksli OEE tabloları (tablo adı parametre: tip burada bilerek gevşek). */
type DatedTable = 'oeeDays' | 'oeeShifts' | 'oeeOrders' | 'oeeLossDays' | 'oeeDowntimeDays'

const byDate = (table: DatedTable) =>
  guardedQuery({
    modules: OEE,
    args: { from: v.string(), to: v.string() },
    handler: async (ctx, { from, to }) => {
      checkRange(from, to)
      const rows = await (ctx.db as Ctx)
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
  modules: OEE,
  args: {},
  handler: async (ctx) => ({
    weekly: (await ctx.db.query('oeeWeekly').collect()).map(strip),
    monthly: (await ctx.db.query('oeeMonthly').collect()).filter((m: Ctx) => m.year !== undefined).map(strip),
  }),
})

/** Duruş satırları — en çok 8 gün (setup analizi ve veri görünümü). */
export const downtimeDays = guardedQuery({
  modules: OEE,
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
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
  modules: OEE,
  args: {},
  handler: async (ctx) => {
    const span = async (table: DatedTable) => {
      const db = ctx.db as Ctx
      const first = await db.query(table).withIndex('by_date').order('asc').first()
      const last = await db.query(table).withIndex('by_date').order('desc').first()
      return first ? { from: first.date as string, to: (last ?? first).date as string } : null
    }
    const weekFirst = await ctx.db.query('oeeWeekly').withIndex('by_week').order('asc').first()
    const weekLast = await ctx.db.query('oeeWeekly').withIndex('by_week').order('desc').first()
    // İlk sürümle yüklenmiş veri: vardiya var ama gün yok, ya da kayıp özeti eski biçimde.
    const lastLoss = await ctx.db.query('oeeLossDays').withIndex('by_date').order('desc').first()
    const firstLoss = await ctx.db.query('oeeLossDays').withIndex('by_date').order('asc').first()
    const lastDown = await ctx.db.query('oeeDowntimeDays').withIndex('by_date').order('desc').first()
    const days = await span('oeeDays')
    const shifts = await span('oeeShifts')
    const oldLoss = (d: Ctx) => d && !d.codes
    return {
      needsRebuild: {
        days: !!shifts && (!days || days.from > shifts.from || days.to < shifts.to),
        losses: !!lastDown && (!lastLoss || oldLoss(lastLoss) || oldLoss(firstLoss)),
      },
      days,
      shifts,
      orders: await span('oeeOrders'),
      downtimes: await span('oeeDowntimeDays'),
      weekly: weekFirst ? { from: `${weekFirst.year}-W${weekFirst.week}`, to: `${(weekLast ?? weekFirst).year}-W${(weekLast ?? weekFirst).week}` } : null,
    }
  },
})
