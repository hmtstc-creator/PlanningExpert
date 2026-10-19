import { v } from 'convex/values'

import { todayThresholds } from './cockpit'
import { ALL_MODULES, guardedQuery } from './guarded'
import { planStatusDoc } from './planQueue'
import { currentUploads } from './sapUploads'
import { PLAN_APPROVED_TITLE, buildFeed, buildFreshness, type TopicRecord, type UpdatesInput } from '../src/lib/updates'

/** Son kaç takip konusu okunur (yeniden eskiye; docs/updates.md). */
const TOPICS_READ = 50
/** Plan onayı aranan son Change Log kaydı sayısı. */
const CHANGES_READ = 200
/** Okunan son OEE yüklemesi sayısı. */
const OEE_IMPORTS_READ = 10

/**
 * Portal ana sayfasının "Updates" paneli (docs/updates.md): son olaylar ve
 * her verinin son yayını. Yalnızca kişinin okuyabildiği modüller; kayıtların
 * kendi listeleriyle aynı izin (Die konuları Die ya da Planning, arızalar
 * Machine ya da Planning). Okumalar küçük ve indeksli — büyük doküman
 * (planSnapshots, plan parçaları) okunmaz. Kural: src/lib/updates.ts.
 */
export const feed = guardedQuery({
  modules: ALL_MODULES,
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const db = ctx.db
    const { access } = ctx
    const now = Date.now()
    const input: UpdatesInput = { now }
    const sees = (m: keyof typeof access) => access[m] !== 'none'

    if (sees('planning')) {
      const run = await db
        .query('planRuns')
        .withIndex('by_status_computed', (q) => q.eq('status', 'ready'))
        .order('desc')
        .first()
      const status = await planStatusDoc(ctx)
      const approval = (await db.query('changeLog').withIndex('by_created').order('desc').take(CHANGES_READ)).find(
        (c) => c.category === 'decision' && c.title.startsWith(PLAN_APPROVED_TITLE),
      )
      input.plan = {
        computedAt: run?.computedAt ?? null,
        dataChangedAt: status?.dataChangedAt ?? null,
        approvedAt: approval?.createdAt ?? null,
        approvedBy: approval?.author,
      }
      input.sap = await currentUploads(ctx)
    }

    if (sees('oee')) {
      const imports = await db.query('oeeImports').withIndex('by_uploadedAt').order('desc').take(OEE_IMPORTS_READ)
      const lastDay = await db.query('oeeDays').withIndex('by_date').order('desc').first()
      input.oee = {
        imports: imports.map((i) => ({ fileName: i.fileName, uploadedAt: i.uploadedAt, uploadedBy: i.uploadedBy })),
        dataTo: lastDay?.date ?? null,
      }
    }

    if (sees('die') || sees('planning')) {
      const rows = await db.query('moldProblems').order('desc').take(TOPICS_READ)
      input.dieTopics = rows.map(
        (r): TopicRecord => ({
          id: r._id,
          subject: `${r.material} ${r.operation}`,
          problemType: r.problemType,
          reportedAt: r.reportedAt,
          reportedBy: r.reportedBy,
          status: r.status,
          solvedAt: r.solvedAt,
          solvedBy: r.solvedBy,
          solution: r.solution,
          press: r.press,
          action: r.action,
        }),
      )
    }

    if (sees('machine') || sees('planning')) {
      const rows = await db.query('machineProblems').order('desc').take(TOPICS_READ)
      input.breakdowns = rows.map(
        (r): TopicRecord => ({
          id: r._id,
          subject: r.press,
          problemType: r.problemType,
          reportedAt: r.reportedAt,
          reportedBy: r.reportedBy,
          status: r.status,
          solvedAt: r.solvedAt,
          solvedBy: r.solvedBy,
          solution: r.solution,
          stopsPress: r.stopsPress,
        }),
      )
    }

    return { now, freshness: buildFreshness(input, await todayThresholds(db)), feed: buildFeed(input) }
  },
})
