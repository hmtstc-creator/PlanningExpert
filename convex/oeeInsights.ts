import { ConvexError, v } from 'convex/values'

import { internal } from './_generated/api'
import { internalAction } from './_generated/server'
import { aiConfigured, aiModel, askJson } from './aiClient'
import { OEE, guardedMutation, guardedQuery, plantInternalMutation, plantInternalQuery } from './guarded'
import { definedOnly } from './oee'
import { localNow } from '../src/lib/digest'
import { EMPTY_CONFIG, addDaysIso, costCenterName, type DayRow, type OeeConfig, type OrderRow, type ShiftRow } from '../src/lib/oee'
import { INSIGHT_SYSTEM, insightSignals, insightUserMessage, lossCodeMeanings, parseInsightAnswer, rangeDays, ruleFindings, undefinedLossCodes } from '../src/lib/oeeInsights'
import { fromStoredLosses, type StoredLossDay } from '../src/lib/oeeStore'
import { fromStoredStops, type StoredStopDay } from '../src/lib/oeeReliability'

/**
 * OEE Agent Insights (docs/oee-agent-report.md → Agent Insights): masraf yeri /
 * iş yeri / tarih aralığı için 3–5 "standart raporda görünmeyen" tespit.
 * Sinyaller koddan (src/lib/oeeInsights.ts), seçim ve yorum yapay zekâdan
 * (convex/aiClient.ts); yapay zekâ yoksa en güçlü 3 sinyal.
 * Rapor kaydedilir; aynı filtre aynı gün yeniden istenirse kayıttan gelir.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

/** En uzun aralık (okuma sınırı): 13 hafta. */
const MAX_DAYS = 91
const AI_TIMEOUT_MS = 90_000
const ISO = /^\d{4}-\d{2}-\d{2}$/

const strip = ({ _id, _creationTime, plantId: _p, ...rest }: Ctx) => ({ ...rest, id: _id })

// ---- sayfa ---------------------------------------------------------------------------

export const list = guardedQuery({
  modules: OEE,
  args: {},
  handler: async (ctx) => {
    const rows = await (ctx.db as Ctx).query('oeeInsightReports').withIndex('by_created').order('desc').take(20)
    return { reports: rows.map(strip), aiConfigured: aiConfigured() }
  },
})

export const get = guardedQuery({
  modules: OEE,
  args: { id: v.id('oeeInsightReports') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    return row ? strip(row) : null
  },
})

/** Rapor iste: aynı filtre ve aralık bugün yapıldıysa o (force = yeniden oluştur). */
export const request = guardedMutation({
  areas: ['oee.data'],
  modules: OEE,
  args: { costCenter: v.string(), workCenter: v.string(), from: v.string(), to: v.string(), force: v.optional(v.boolean()) },
  returns: v.id('oeeInsightReports'),
  affectsPlan: false,
  handler: async (ctx, a) => {
    if (!ISO.test(a.from) || !ISO.test(a.to) || a.from > a.to) throw new ConvexError('Date range must be YYYY-MM-DD, from ≤ to')
    if (rangeDays(a.from, a.to) > MAX_DAYS) throw new ConvexError(`The range can be at most ${MAX_DAYS / 7} weeks`)
    if (!a.costCenter) throw new ConvexError('Choose a cost center')
    const today = localNow(Date.now(), ctx.plant?.timeZone ?? 'UTC').date
    const same = await (ctx.db as Ctx)
      .query('oeeInsightReports')
      .withIndex('by_filter', (q: Ctx) => q.eq('costCenter', a.costCenter).eq('workCenter', a.workCenter).eq('from', a.from).eq('to', a.to).eq('day', today))
      .collect()
    const live = same.find((r: Ctx) => r.status === 'running')
    if (live) return live._id
    const done = same.filter((r: Ctx) => r.status === 'done').sort((x: Ctx, y: Ctx) => y.createdAt - x.createdAt)[0]
    if (done && !a.force) return done._id
    const id = await ctx.db.insert('oeeInsightReports', {
      costCenter: a.costCenter,
      workCenter: a.workCenter,
      from: a.from,
      to: a.to,
      day: today,
      status: 'running',
      progress: 'Reading the data…',
      createdAt: Date.now(),
      createdBy: ctx.sessionUser?.name,
    })
    await ctx.scheduler.runAfter(0, internal.oeeInsights.build, { plantId: ctx.plantId, id })
    return id
  },
})

// ---- rapor ---------------------------------------------------------------------------

export const reportHead = plantInternalQuery({
  args: { id: v.id('oeeInsightReports') },
  handler: async (ctx: Ctx, { id }: { id: string }) => {
    const row = await ctx.db.get(id)
    const settings = await ctx.db.query('oeeSettings').withIndex('by_key', (q: Ctx) => q.eq('key', 'default')).first()
    const { _id, _creationTime, key: _k, updatedAt: _u, updatedBy: _b, plantId: _p, ...config } = settings ?? {}
    return row && { costCenter: row.costCenter, workCenter: row.workCenter, from: row.from, to: row.to, config: { ...EMPTY_CONFIG, ...config } }
  },
})

/** Bir haftalık dilim, seçime göre süzülmüş; kişi alanı (responsible) dönmez. */
export const slice = plantInternalQuery({
  args: { from: v.string(), to: v.string(), costCenter: v.string(), workCenter: v.string() },
  handler: async (ctx: Ctx, a: { from: string; to: string; costCenter: string; workCenter: string }) => {
    const plant = await ctx.db.get(ctx.plantId)
    const scoped = { ...ctx, plant }
    const range = (table: string) => ctx.db.query(table).withIndex('by_date', (q: Ctx) => q.gte('date', a.from).lte('date', a.to)).collect()
    const inSel = (r: Ctx) => r.costCenter === a.costCenter && (!a.workCenter || r.workCenter === a.workCenter)
    const clean = ({ _id, _creationTime, plantId: _p, responsible: _r, ...rest }: Ctx) => rest
    const days: DayRow[] = (await definedOnly(scoped, await range('oeeDays'))).filter(inSel).map(clean)
    const wcs = new Set(days.map((d) => d.workCenter))
    const losses: StoredLossDay[] = (await definedOnly(scoped, await range('oeeLossDays'))).filter(inSel).map(clean)
    const shifts: ShiftRow[] = (await definedOnly(scoped, await range('oeeShifts'))).filter(inSel).map(clean)
    // Siparişte masraf yeri yok: seçimin iş yerleri (gün verisinden).
    const orders: OrderRow[] = (await range('oeeOrders')).filter((o: Ctx) => wcs.has(o.workCenter)).map(clean)
    // Süre histogramı: kısa duruşlar (< eşik) yalnız mikro duruş sinyaline (src/lib/oeeShortStops.ts).
    const stops: StoredStopDay[] = (await definedOnly(scoped, await range('oeeStopDays'))).filter(inSel).map(clean)
    return { days, losses, shifts, orders, stops }
  },
})

export const save = plantInternalMutation({
  args: { id: v.id('oeeInsightReports'), patch: v.any() },
  handler: async (ctx: Ctx, { id, patch }: { id: string; patch: Record<string, unknown> }) => {
    if (await ctx.db.get(id)) await ctx.db.patch(id, patch)
    return null
  },
})

export const build = internalAction({
  args: { plantId: v.id('plants'), id: v.id('oeeInsightReports') },
  returns: v.null(),
  handler: async (ctx, { plantId, id }) => {
    const progress = (text: string) => ctx.runMutation(internal.oeeInsights.save, { plantId, id, patch: { progress: text } })
    try {
      const head: Ctx = await ctx.runQuery(internal.oeeInsights.reportHead, { plantId, id })
      if (!head) return null
      const config: OeeConfig = head.config
      const data = { days: [] as DayRow[], losses: [] as StoredLossDay[], shifts: [] as ShiftRow[], orders: [] as OrderRow[], stops: [] as StoredStopDay[] }
      const weeks = Math.ceil(rangeDays(head.from, head.to) / 7)
      for (let w = 0; w < weeks; w++) {
        const from = addDaysIso(head.from, 7 * w)
        const to = [addDaysIso(from, 6), head.to].sort()[0]
        await progress(`Reading week ${w + 1} of ${weeks}…`)
        const part: Ctx = await ctx.runQuery(internal.oeeInsights.slice, { plantId, from, to, costCenter: head.costCenter, workCenter: head.workCenter })
        data.days.push(...part.days)
        data.losses.push(...part.losses)
        data.shifts.push(...part.shifts)
        data.orders.push(...part.orders)
        data.stops.push(...part.stops)
      }
      if (!data.days.length) {
        await ctx.runMutation(internal.oeeInsights.save, {
          plantId,
          id,
          patch: { status: 'done', source: 'rules', findings: [], signalCount: 0, note: 'No OEE data in this selection and range', progress: undefined, finishedAt: Date.now() },
        })
        return null
      }
      await progress('Computing the signals…')
      const losses = fromStoredLosses(data.losses)
      const signals = insightSignals({ from: head.from, to: head.to, config, ...data, losses, stops: fromStoredStops(data.stops) })
      // Veride geçip Loss groups'ta tanımlı olmayan kodlar: sayfa uyarır, yapay zekâ işaretli görür.
      const undefinedCodes = undefinedLossCodes(losses, config)
      let findings = ruleFindings(signals)
      let source = 'rules'
      let note = signals.length ? '' : 'No signal strong enough in this range'
      if (signals.length) {
        await progress(`Asking the AI about ${Math.min(signals.length, 20)} signals…`)
        const codes = lossCodeMeanings(
          config,
          undefinedCodes.map((x) => x.code),
        )
        const ai = await askJson(
          INSIGHT_SYSTEM,
          insightUserMessage({ costCenter: costCenterName(head.costCenter, config), workCenter: head.workCenter, from: head.from, to: head.to, codes }, signals),
          AI_TIMEOUT_MS,
        )
        const picked = ai.answer === null ? [] : parseInsightAnswer(ai.answer, signals)
        if (picked.length) {
          findings = picked
          source = 'ai'
          note = ai.note
        } else note = ai.answer === null ? ai.note : 'AI answer could not be used — the rules decided'
      }
      await ctx.runMutation(internal.oeeInsights.save, {
        plantId,
        id,
        patch: { status: 'done', source, model: source === 'ai' ? aiModel() : undefined, findings, signalCount: signals.length, undefinedCodes, note, progress: undefined, finishedAt: Date.now() },
      })
    } catch (e) {
      await ctx.runMutation(internal.oeeInsights.save, {
        plantId,
        id,
        patch: { status: 'failed', note: `Failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300), progress: undefined, finishedAt: Date.now() },
      })
    }
    return null
  },
})
