import { ConvexError, v } from 'convex/values'

import { internal } from './_generated/api'
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
import { addDaysIso, daysFromShifts, lossDayOf, type DowntimeDay } from '../src/lib/oee'
import { dropKeys, planDowntimeDedup, planShiftDedup } from '../src/lib/oeeDedup'
import { eventKey, fromStoredDay, mergeEvents, sameStored, toStoredDay, toStoredLoss } from '../src/lib/oeeStore'
import { stopDayOf } from '../src/lib/oeeReliability'
import { mapAliases } from './workCenterHistory'

/**
 * OEE Trend and Losses — veri.
 *
 * Kural (planlamacı, 2026-09-27): geçmiş hiçbir zaman silinmez. Her yükleme
 * satırı kendi anahtarıyla EKLER ya da GÜNCELLER:
 *   vardiya   tarih + iş merkezi + vardiya grubu
 *   gün       tarih + iş merkezi (vardiyalardan; yoksa Daily KPI)
 *   sipariş   tarih + iş merkezi + vardiya + sipariş (kalıp güncellenir)
 *   duruş     iş merkezi + başlangıç (tarih/saat) + bitiş (tarih/saat); sipariş
 *             anahtara girmez, aynı duruş tek satırdır (2026-10-26, src/lib/oeeDedup.ts)
 *   hafta     yıl + hafta + iş merkezi
 *   ay        yıl + ay + iş merkezi
 * Böylece son iki haftayı tekrar tekrar yüklemek mükerrer kayıt yapmaz. Bir
 * anahtarda birden çok kayıt bulunursa ilki güncellenir, fazlası silinir;
 * eskiden kalan tekrarları "Check duplicates" (`duplicates`) temizler.
 * Kodu değişmiş work center'ın eski kodu yeni koda çevrilir (workCenterHistory.ts).
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
  // Değişmeyen satır yeniden yazılmaz (aynı dosyanın tekrar yüklenmesi).
  if (existing && sameStored(existing, doc)) return
  if (existing) await ctx.db.replace(existing._id, doc)
  else await ctx.db.insert(table, doc)
}

/** Gün × iş merkezi anahtarındaki bütün kayıtlar (indeks sırası: ilk yazılan önce). */
function sameKey(ctx: Ctx, table: string, date: string, workCenter: string): Promise<Ctx[]> {
  return ctx.db
    .query(table)
    .withIndex('by_key', (q: Ctx) => q.eq('date', date).eq('workCenter', workCenter))
    .collect()
}

/** Anahtar başına tek kayıt: ilki güncellenir, fazlası silinir (aynı gün iki kez sayılmasın). */
async function upsertOne(ctx: Ctx, table: string, date: string, workCenter: string, doc: Ctx) {
  const [hit, ...extra] = await sameKey(ctx, table, date, workCenter)
  await upsert(ctx, hit ?? null, table, doc)
  for (const x of extra) await ctx.db.delete(x._id)
}

/** Saklı duruş kaydının yalnızca veri alanları. */
const plainDay = (d: Ctx): DowntimeDay => ({
  date: d.date,
  plant: d.plant,
  plantKey: d.plantKey,
  costCenter: d.costCenter,
  workCenter: d.workCenter,
  events: fromStoredDay(d).events,
})

/**
 * Gün × iş merkezinin duruşlarını yazar; kayıp özeti (oeeLossDays) ve süre
 * histogramı (oeeStopDays) yeniden hesaplanır. Liste boşsa üçü de silinir.
 */
async function writeDowntimeDay(ctx: Ctx, day: DowntimeDay) {
  if (!day.events.length) {
    for (const t of ['oeeDowntimeDays', 'oeeLossDays', 'oeeStopDays']) {
      for (const x of await sameKey(ctx, t, day.date, day.workCenter)) await ctx.db.delete(x._id)
    }
    return
  }
  await upsertOne(ctx, 'oeeDowntimeDays', day.date, day.workCenter, toStoredDay(day))
  await upsertOne(ctx, 'oeeLossDays', day.date, day.workCenter, toStoredLoss(lossDayOf(day)))
  await upsertOne(ctx, 'oeeStopDays', day.date, day.workCenter, stopDayOf(day))
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
  handler: async (ctx, { rows: raw }) => {
    const rows = await mapAliases(ctx.db, raw)
    plantCostCentersOnly(ctx, rows)
    const touched = new Map<string, { date: string; workCenter: string }>()
    for (const r of rows) {
      // Aynı gün + vardiya + makine tek kayıt: en son yüklenen geçerli, fazlası silinir.
      const [hit, ...extra] = await ctx.db
        .query('oeeShifts')
        .withIndex('by_key', (q: Ctx) => q.eq('date', r.date).eq('workCenter', r.workCenter).eq('shiftGroup', r.shiftGroup))
        .collect()
      await upsert(ctx, hit ?? null, 'oeeShifts', r)
      for (const x of extra) await ctx.db.delete(x._id)
      touched.set(`${r.date}|${r.workCenter}`, { date: r.date, workCenter: r.workCenter })
    }
    for (const { date, workCenter } of touched.values()) await refreshDay(ctx, date, workCenter)
    return rows.length
  },
})

/** Gün toplamı (oeeDays) o günün vardiyalarından yeniden hesaplanır. */
async function refreshDay(ctx: Ctx, date: string, workCenter: string) {
  const all = await sameKey(ctx, 'oeeShifts', date, workCenter)
  const [day] = daysFromShifts(all)
  if (day) await upsertOne(ctx, 'oeeDays', date, workCenter, dayDoc(day))
}

/** Daily KPI (geçmiş): o günün vardiya verisi varsa vardiya toplamı geçerlidir. */
export const upsertDaily = guardedMutation({
  areas: ['oee.data'],
  modules: OEE,
  args: { rows: v.array(v.object(dailyFields)) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx, { rows: raw }) => {
    const rows = await mapAliases(ctx.db, raw)
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
  handler: async (ctx, { rows: raw }) => {
    const rows = await mapAliases(ctx.db, raw)
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
  handler: async (ctx, { rows: raw }) => {
    const rows = await mapAliases(ctx.db, raw)
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
  handler: async (ctx, { rows: raw }) => {
    const rows = await mapAliases(ctx.db, raw)
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
 * sayılmasın — planlamacı, 2026-09-28). Dosyada olmayan günlere dokunulmaz,
 * yalnızca aynı duruş (makine + başlangıç + bitiş) önceki / sonraki günün
 * kaydında da varsa oradan çıkar: yeni yüklenen geçerli (2026-10-26).
 * Kayıp özeti ve süre histogramı yeniden hesaplanır.
 */
export const upsertDowntimeDays = guardedMutation({
  areas: ['oee.data'],
  modules: OEE,
  args: { days: v.array(v.object(downtimeDayFields)) },
  returns: v.number(),
  affectsPlan: false,
  handler: async (ctx, { days: raw }) => {
    const days = await mapAliases(ctx.db, raw)
    plantCostCentersOnly(ctx, days)
    for (const incoming of days) {
      const next = fromStoredDay(incoming)
      // Dosyanın kendi içindeki aynı duruş (aynı başlangıç + bitiş) bir kez sayılır: son satır geçerli.
      next.events = mergeEvents([], next.events)
      // Aynı duruş komşu günün kaydında da varsa (eski dosya başka güne yazmış) yeni yüklenen geçerli.
      const keys = new Set(next.events.map(eventKey).filter((k): k is string => k !== null))
      for (const date of [addDaysIso(incoming.date, -1), addDaysIso(incoming.date, 1)]) {
        const [doc] = await sameKey(ctx, 'oeeDowntimeDays', date, incoming.workCenter)
        if (!doc) continue
        const old = plainDay(doc)
        const kept = dropKeys(old.events, keys)
        if (kept.length < old.events.length) await writeDowntimeDay(ctx, { ...old, events: kept })
      }
      await writeDowntimeDay(ctx, next)
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
  args: { step: v.union(v.literal('days'), v.literal('losses'), v.literal('stops')), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ cursor: v.string(), isDone: v.boolean(), count: v.number() }),
  affectsPlan: false,
  handler: async (ctx, { step, cursor }) => {
    if (step === 'days') {
      const page = await ctx.db.query('oeeShifts').withIndex('by_date').paginate({ cursor, numItems: 400 })
      const keys = new Map<string, { date: string; workCenter: string }>()
      for (const r of page.page) keys.set(`${r.date}|${r.workCenter}`, { date: r.date, workCenter: r.workCenter })
      for (const { date, workCenter } of keys.values()) await refreshDay(ctx, date, workCenter)
      return { cursor: page.continueCursor, isDone: page.isDone, count: keys.size }
    }
    // Duruş kayıtları büyük: küçük sayfa.
    const page = await ctx.db.query('oeeDowntimeDays').withIndex('by_date').paginate({ cursor, numItems: 40 })
    if (step === 'stops') {
      // Süre histogramı (MTTR / MTBF sayfası, 2026-10-14): yalnızca eksik olanlar.
      for (const doc of page.page) {
        const hit = await ctx.db
          .query('oeeStopDays')
          .withIndex('by_key', (q: Ctx) => q.eq('date', doc.date).eq('workCenter', doc.workCenter))
          .first()
        if (!hit) await ctx.db.insert('oeeStopDays', stopDayOf(fromStoredDay(doc)))
      }
      return { cursor: page.continueCursor, isDone: page.isDone, count: page.page.length }
    }
    for (const doc of page.page) {
      const lossHit = await ctx.db
        .query('oeeLossDays')
        .withIndex('by_key', (q: Ctx) => q.eq('date', doc.date).eq('workCenter', doc.workCenter))
        .first()
      if (lossHit?.codes && lossHit.partList) continue
      await upsert(ctx, lossHit, 'oeeLossDays', toStoredLoss(lossDayOf(fromStoredDay(doc))))
    }
    return { cursor: page.continueCursor, isDone: page.isDone, count: page.page.length }
  },
})

/**
 * Check duplicates (OEE Data, planlamacı 2026-10-26): saklı veride tekrar
 * satırları sayfa sayfa tarar; `apply` ile siler ve etkilenen gün özetlerini
 * (duruşta kayıp özeti + süre histogramı, vardiyada gün toplamı) yeniden
 * hesaplar. Kural src/lib/oeeDedup.ts. Yalnızca seçili fabrikanın verisi.
 * İstemci `isDone` gelene kadar imleçle çağırır; önce `apply: false` ile tarar.
 */
const findingV = v.object({ date: v.string(), workCenter: v.string(), shiftGroup: v.optional(v.string()), rows: v.number(), minutes: v.number() })

export const duplicates = guardedMutation({
  areas: ['oee.data'],
  modules: OEE,
  args: { kind: v.union(v.literal('downtimes'), v.literal('shifts')), cursor: v.union(v.string(), v.null()), apply: v.boolean() },
  returns: v.object({ cursor: v.string(), isDone: v.boolean(), findings: v.array(findingV), records: v.number() }),
  affectsPlan: false,
  handler: async (ctx, { kind, cursor, apply }) => (kind === 'shifts' ? shiftDuplicates(ctx, cursor, apply) : downtimeDuplicates(ctx, cursor, apply)),
})

async function downtimeDuplicates(ctx: Ctx, cursor: string | null, apply: boolean) {
  // Duruş kayıtları büyük ve her biri önceki günüyle okunur: küçük sayfa.
  const page = await ctx.db.query('oeeDowntimeDays').withIndex('by_date').paginate({ cursor, numItems: 20 })
  const findings: Ctx[] = []
  let records = 0
  for (const x of page.page) {
    const cur = await sameKey(ctx, 'oeeDowntimeDays', x.date, x.workCenter)
    // Aynı gün × makinenin fazla kaydı ilk kayıtla birlikte ele alınır.
    if (!cur.length || cur[0]._id !== x._id) continue
    const prev = await sameKey(ctx, 'oeeDowntimeDays', addDaysIso(x.date, -1), x.workCenter)
    const all = [...prev, ...cur]
    const plan = planDowntimeDedup(
      all.map((d) => ({ id: d._id, date: d.date, workCenter: d.workCenter, events: fromStoredDay(d).events })),
      (date) => date === x.date,
    )
    findings.push(...plan.findings)
    const extraSummaries =
      Math.max(0, (await sameKey(ctx, 'oeeLossDays', x.date, x.workCenter)).length - 1) +
      Math.max(0, (await sameKey(ctx, 'oeeStopDays', x.date, x.workCenter)).length - 1)
    records += extraSummaries
    if (!apply) continue
    for (const id of plan.remove) await ctx.db.delete(id)
    const byId = new Map(all.map((d) => [d._id, d]))
    for (const r of plan.rewrite) await writeDowntimeDay(ctx, { ...plainDay(byId.get(r.id)), events: r.events })
    if ((plan.remove.length || extraSummaries) && !plan.rewrite.some((r) => r.id === x._id)) await writeDowntimeDay(ctx, plainDay(x))
  }
  return { cursor: page.continueCursor, isDone: page.isDone, findings, records }
}

async function shiftDuplicates(ctx: Ctx, cursor: string | null, apply: boolean) {
  const page = await ctx.db.query('oeeShifts').withIndex('by_date').paginate({ cursor, numItems: 150 })
  const findings: Ctx[] = []
  let records = 0
  for (const x of page.page) {
    // Gün × makine bir kez: o anahtarın indeksteki ilk satırıyla.
    const all = await sameKey(ctx, 'oeeShifts', x.date, x.workCenter)
    if (!all.length || all[0]._id !== x._id) continue
    const plan = planShiftDedup(all.map((r) => ({ id: r._id, date: r.date, workCenter: r.workCenter, shiftGroup: r.shiftGroup, loadingMin: r.loadingMin })))
    findings.push(...plan.findings)
    const extraDays = Math.max(0, (await sameKey(ctx, 'oeeDays', x.date, x.workCenter)).length - 1)
    records += extraDays
    if (!apply || (!plan.remove.length && !extraDays)) continue
    for (const id of plan.remove) await ctx.db.delete(id)
    await refreshDay(ctx, x.date, x.workCenter)
  }
  return { cursor: page.continueCursor, isDone: page.isDone, findings, records }
}

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
    // Açık konular ajanı: son yüklü gün bir kez (convex/oeeTopics.ts).
    await ctx.scheduler.runAfter(0, internal.oeeTopics.analyse, { plantId: ctx.plantId })
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
    // Agent Report eşikleri (src/lib/oeeAgent.ts): verilen her değer 0'dan büyük.
    for (const [k, val] of Object.entries(config.agent ?? {})) {
      if (val !== undefined && !(Number.isFinite(val) && val > 0)) throw new ConvexError(`Agent Report: ${k} must be above 0`)
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

/**
 * OEE'de sayılan iş merkezleri (planlamacı, 2026-10-07): Work Center
 * Definitions'ta tanımlı ve fabrikanın bir masraf yerine bağlı olanlar.
 * Tanımsız iş merkezinin (ör. PRS-103) satırları saklı kalır ama hiçbir OEE
 * sayfasında görünmez ve toplamlara (OEE, çalışılan vardiya …) girmez;
 * tanımlanınca geçmişiyle görünür. Hiç tanım yoksa süzülmez (yeni fabrika).
 */
async function oeeWorkCenters(ctx: Ctx): Promise<Set<string> | null> {
  const codes = new Set((ctx.plant?.costCenters ?? []).map((c: Ctx) => c.code))
  const names = (await ctx.db.query('presses').collect()).filter((p: Ctx) => p.costCenter && codes.has(p.costCenter)).map((p: Ctx) => p.name)
  return names.length ? new Set(names) : null
}

export async function definedOnly<T extends { workCenter: string }>(ctx: Ctx, rows: T[]): Promise<T[]> {
  const wcs = await oeeWorkCenters(ctx)
  return wcs ? rows.filter((r) => wcs.has(r.workCenter)) : rows
}

/** Tarih indeksli OEE tabloları (tablo adı parametre: tip burada bilerek gevşek). */
type DatedTable = 'oeeDays' | 'oeeShifts' | 'oeeOrders' | 'oeeLossDays' | 'oeeDowntimeDays' | 'oeeStopDays'

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
      return (await definedOnly(ctx, rows)).map(strip)
    },
  })

/** Gün × iş merkezi (hafta, ay, kutular ve kayıp oranlarının tabanı). */
export const days = byDate('oeeDays')
/** Vardiya satırları (haftanın vardiya grafiği). */
export const shifts = byDate('oeeShifts')
export const orders = byDate('oeeOrders')
export const lossDays = byDate('oeeLossDays')
/** Duruş süresi histogramı (MTTR / MTBF: yıl, 10 hafta, hafta). */
export const stopDays = byDate('oeeStopDays')

/**
 * Planlı duruşların vardiya başına süreleri (Planning → Calendar → Planned stops:
 * çay, yemek, toplantı …). OEE'de "kaç vardiya çalışıldı" = Loading ÷ (vardiya −
 * planlı duruşlar). Planning izni olmayan OEE kullanıcısı da okur; yalnızca süreler.
 */
export const plannedStopMinutes = guardedQuery({
  modules: OEE,
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('plannedStops').collect()
    return rows.map((r: Ctx) => ({ shiftIndex: r.shiftIndex, durationMinutes: r.durationMinutes }))
  },
})

/** Yüklenen haftalık ve aylık satırlar (yılı olmayan eski aylık kayıtlar hariç). */
export const periods = guardedQuery({
  modules: OEE,
  args: {},
  handler: async (ctx) => ({
    weekly: (await definedOnly(ctx, await ctx.db.query('oeeWeekly').collect())).map(strip),
    monthly: (await definedOnly(ctx, await ctx.db.query('oeeMonthly').collect())).filter((m: Ctx) => m.year !== undefined).map(strip),
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
    return (await definedOnly(ctx, rows)).map(strip)
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
    const oldLoss = (d: Ctx) => d && (!d.codes || !d.partList)
    const firstDown = await ctx.db.query('oeeDowntimeDays').withIndex('by_date').order('asc').first()
    const hasStops = async (d: Ctx) =>
      !d ||
      !!(await ctx.db
        .query('oeeStopDays')
        .withIndex('by_key', (q: Ctx) => q.eq('date', d.date).eq('workCenter', d.workCenter))
        .first())
    return {
      needsRebuild: {
        days: !!shifts && (!days || days.from > shifts.from || days.to < shifts.to),
        losses: !!lastDown && (!lastLoss || oldLoss(lastLoss) || oldLoss(firstLoss)),
        stops: !(await hasStops(lastDown)) || !(await hasStops(firstDown)),
      },
      days,
      shifts,
      orders: await span('oeeOrders'),
      downtimes: await span('oeeDowntimeDays'),
      weekly: weekFirst ? { from: `${weekFirst.year}-W${weekFirst.week}`, to: `${(weekLast ?? weekFirst).year}-W${(weekLast ?? weekFirst).week}` } : null,
    }
  },
})
