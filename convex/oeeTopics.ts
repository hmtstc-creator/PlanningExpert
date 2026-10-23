import { ConvexError, v } from 'convex/values'

import { internal } from './_generated/api'
import { internalAction } from './_generated/server'
import { aiConfigured, askJson } from './aiClient'
import { OEE, guardedMutation, guardedQuery, plantInternalMutation, plantInternalQuery } from './guarded'
import { definedOnly } from './oee'
import { localNow } from '../src/lib/digest'
import { EMPTY_CONFIG, type DayRow, type OeeConfig } from '../src/lib/oee'
import { fromStoredLosses, type StoredLossDay } from '../src/lib/oeeStore'
import {
  AI_SYSTEM,
  TOPIC_DEFAULTS,
  aiUserMessage,
  compactDays,
  decideTopics,
  parseAiAnswer,
  shouldRun,
  topicCandidates,
  weekWindow,
  type GroupDay,
} from '../src/lib/oeeTopics'

/**
 * OEE açık konular ajanı (docs/oee-agent-report.md → OEE open topics).
 *
 * OEE yüklemesi bitince (oee.finishImport) son KAPANMIŞ gün (bugünden önceki
 * son yüklü gün, fabrika saati) BİR KEZ incelenir; kural: shouldRun
 * (src/lib/oeeTopics.ts). Gün kapanmadan başlamış çalışma sayılmaz. Açık konu
 * yeniden yazılmaz; yalnızca lastDay / seenDays güncellenir.
 *
 * Yapay zekâ: convex/aiClient.ts (AI_API_KEY; yoksa kurallar karar verir).
 *
 * Gönderilen: masraf yeri / iş yeri / kayıp grubu adları ve dakikalar; kişi verisi yok.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

const AI_TIMEOUT_MS = 45_000

const strip = ({ _id, _creationTime, ...rest }: Ctx) => rest

// ---- sayfa ---------------------------------------------------------------------------

export const list = guardedQuery({
  modules: OEE,
  args: { status: v.string() },
  handler: async (ctx, { status }) => {
    const rows = await (ctx.db as Ctx).query('oeeTopics').withIndex('by_status', (q: Ctx) => q.eq('status', status)).collect()
    return rows
      .map((r: Ctx) => ({ ...strip(r), id: r._id }))
      .sort((a: Ctx, b: Ctx) => b.lastDay.localeCompare(a.lastDay) || b.createdAt - a.createdAt)
  },
})

export const runs = guardedQuery({
  modules: OEE,
  args: {},
  handler: async (ctx) => {
    const rows = await (ctx.db as Ctx).query('oeeTopicRuns').withIndex('by_day').order('desc').take(10)
    return { runs: rows.map(strip), aiConfigured: aiConfigured() }
  },
})

export const close = guardedMutation({
  areas: ['oee.data'],
  modules: OEE,
  args: { id: v.id('oeeTopics'), note: v.string() },
  returns: v.null(),
  affectsPlan: false,
  handler: async (ctx, { id, note }) => {
    const row = await ctx.db.get(id)
    if (!row) throw new ConvexError('Topic not found')
    const text = note.trim()
    if (!text) throw new ConvexError('Write what was done or why it is closed')
    await ctx.db.patch(id, { status: 'closed', closedAt: Date.now(), closedBy: ctx.sessionUser?.name, closeNote: text.slice(0, 500) })
    return null
  },
})

export const reopen = guardedMutation({
  areas: ['oee.data'],
  modules: OEE,
  args: { id: v.id('oeeTopics') },
  returns: v.null(),
  affectsPlan: false,
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (!row) throw new ConvexError('Topic not found')
    // Aynı anahtarla açık konu varsa ikinci kez açılmaz.
    const open = await (ctx.db as Ctx).query('oeeTopics').withIndex('by_key', (q: Ctx) => q.eq('key', row.key)).collect()
    if (open.some((r: Ctx) => r.status === 'open')) throw new ConvexError('This topic is already open')
    await ctx.db.patch(id, { status: 'open', closedAt: undefined, closedBy: undefined, closeNote: undefined })
    return null
  },
})

/** Elle başlatma (ilk kurulum ya da başarısız gün): gün yine bir kez işlenir. */
export const runNow = guardedMutation({
  areas: ['oee.data'],
  modules: OEE,
  args: {},
  returns: v.null(),
  affectsPlan: false,
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.oeeTopics.analyse, { plantId: ctx.plantId })
    return null
  },
})

// ---- ajan ----------------------------------------------------------------------------

/** Son yüklü gün; o gün işlenmişse null. Gün sahiplenilir (iki yükleme yarışmasın). */
export const claimDay = plantInternalMutation({
  args: {},
  handler: async (ctx: Ctx) => {
    // Yalnızca kapanmış gün: bugünden (fabrika saati) önceki son yüklü gün.
    const now = Date.now()
    const plant = await ctx.db.get(ctx.plantId)
    const tz = plant?.timeZone ?? 'UTC'
    const today = localNow(now, tz).date
    const last = await ctx.db.query('oeeDays').withIndex('by_date', (q: Ctx) => q.lt('date', today)).order('desc').first()
    if (!last) return null
    const day: string = last.date
    const run = await ctx.db.query('oeeTopicRuns').withIndex('by_day', (q: Ctx) => q.eq('day', day)).first()
    const state = run && { status: run.status, startedAt: run.startedAt, startedDate: localNow(run.startedAt, tz).date }
    if (!shouldRun(day, today, state ?? null, now)) return null
    if (run) await ctx.db.patch(run._id, { status: 'running', startedAt: now, finishedAt: undefined, note: undefined })
    else await ctx.db.insert('oeeTopicRuns', { day, status: 'running', startedAt: now })
    const settings = await ctx.db.query('oeeSettings').withIndex('by_key', (q: Ctx) => q.eq('key', 'default')).first()
    const { _id, _creationTime, key: _k, updatedAt: _u, updatedBy: _b, plantId: _p, ...config } = settings ?? {}
    const open = await ctx.db.query('oeeTopics').withIndex('by_status', (q: Ctx) => q.eq('status', 'open')).collect()
    return { day, config: { ...EMPTY_CONFIG, ...config }, openKeys: open.map((r: Ctx) => r.key) }
  },
})

/** Bir haftanın sıkıştırılmış verisi (okuma sınırı için hafta hafta). */
export const weekRows = plantInternalQuery({
  args: { from: v.string(), to: v.string(), config: v.any() },
  handler: async (ctx: Ctx, { from, to, config }: { from: string; to: string; config: OeeConfig }) => {
    const plant = await ctx.db.get(ctx.plantId)
    const scoped = { ...ctx, plant }
    const range = (table: string) => ctx.db.query(table).withIndex('by_date', (q: Ctx) => q.gte('date', from).lte('date', to)).collect()
    const days: DayRow[] = await definedOnly(scoped, await range('oeeDays'))
    const losses: StoredLossDay[] = await definedOnly(scoped, await range('oeeLossDays'))
    return compactDays(days, fromStoredLosses(losses), config)
  },
})

export const record = plantInternalMutation({
  args: { day: v.string(), adds: v.any(), seen: v.array(v.string()), candidates: v.number(), note: v.string(), status: v.string() },
  handler: async (ctx: Ctx, a: { day: string; adds: Ctx[]; seen: string[]; candidates: number; note: string; status: string }) => {
    const now = Date.now()
    let updated = 0
    for (const key of a.seen) {
      const rows = await ctx.db.query('oeeTopics').withIndex('by_key', (q: Ctx) => q.eq('key', key)).collect()
      const open = rows.find((r: Ctx) => r.status === 'open')
      if (!open || open.lastDay >= a.day) continue
      await ctx.db.patch(open._id, { lastDay: a.day, seenDays: open.seenDays + 1 })
      updated++
    }
    let added = 0
    for (const t of a.adds) {
      const rows = await ctx.db.query('oeeTopics').withIndex('by_key', (q: Ctx) => q.eq('key', t.key)).collect()
      if (rows.some((r: Ctx) => r.status === 'open')) continue
      await ctx.db.insert('oeeTopics', { ...t, firstDay: a.day, lastDay: a.day, seenDays: 1, status: 'open', createdAt: now })
      added++
    }
    const run = await ctx.db.query('oeeTopicRuns').withIndex('by_day', (q: Ctx) => q.eq('day', a.day)).first()
    const patch = { status: a.status, finishedAt: now, candidates: a.candidates, added, updated, note: a.note.slice(0, 300) }
    if (run) await ctx.db.patch(run._id, patch)
    return null
  },
})

/** Yükleme sonrası (oee.finishImport) ya da elle (runNow). */
export const analyse = internalAction({
  args: { plantId: v.id('plants') },
  returns: v.null(),
  handler: async (ctx, { plantId }) => {
    const claim: Ctx = await ctx.runMutation(internal.oeeTopics.claimDay, { plantId })
    if (!claim) return null
    const { day, config, openKeys } = claim
    try {
      const rows: GroupDay[] = []
      for (let k = 0; k <= TOPIC_DEFAULTS.lookbackWeeks; k++) {
        rows.push(...((await ctx.runQuery(internal.oeeTopics.weekRows, { plantId, ...weekWindow(day, k), config })) as GroupDay[]))
      }
      const candidates = topicCandidates(day, rows, config, new Set(openKeys))
      const fresh = candidates.filter((x) => !x.open).slice(0, TOPIC_DEFAULTS.maxCandidates)
      const ai = fresh.length ? await askJson(AI_SYSTEM, aiUserMessage(day, fresh), AI_TIMEOUT_MS) : { answer: null, note: 'No new candidate' }
      const verdicts = ai.answer === null ? null : parseAiAnswer(ai.answer, fresh.map((x) => x.key))
      const adds = decideTopics(fresh, verdicts).map((d) => ({
        key: d.candidate.key,
        costCenter: d.candidate.costCenter,
        workCenter: d.candidate.workCenter,
        group: d.candidate.group,
        groupLabel: d.candidate.groupLabel,
        title: d.title,
        analysis: d.analysis || undefined,
        action: d.action || undefined,
        evidence: d.evidence,
        source: d.source,
      }))
      const seen = candidates.filter((x) => x.open).map((x) => x.key)
      const note = verdicts && verdicts.size < fresh.length ? `${ai.note}; ${fresh.length - verdicts.size} by the rules` : ai.note
      await ctx.runMutation(internal.oeeTopics.record, { plantId, day, adds, seen, candidates: candidates.length, note, status: 'done' })
    } catch (e) {
      const note = `Failed: ${e instanceof Error ? e.message : String(e)}`
      await ctx.runMutation(internal.oeeTopics.record, { plantId, day, adds: [], seen: [], candidates: 0, note, status: 'failed' })
    }
    return null
  },
})
