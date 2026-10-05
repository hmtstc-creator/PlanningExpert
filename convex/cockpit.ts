import { v } from 'convex/values'

import { ALL_MODULES, guardedQuery } from './guarded'
import { planStatusDoc } from './planQueue'
import { buildCockpit, type CockpitInput } from '../src/lib/cockpit'

/**
 * "Today" paneli (portal ana sayfası, Overview): planın özet dokümanından ve
 * birkaç küçük tablodan karar sinyalleri. Büyük listeler (işler, talep)
 * okunmaz — sayfa her açılışta hızlı kalır. Kural: src/lib/cockpit.ts.
 * Yalnızca kullanıcının izinli modüllerinin sinyalleri döner.
 */
export const today = guardedQuery({
  modules: ALL_MODULES,
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const access = ctx.access
    const input: CockpitInput = { now: Date.now(), plan: null }

    if (access.planning !== 'none') {
      const run = await ctx.db
        .query('planRuns')
        .withIndex('by_status_computed', (q) => q.eq('status', 'ready'))
        .order('desc')
        .first()
      const s = run?.summary as Record<string, any> | undefined
      input.plan = run && s
        ? {
            computedAt: run.computedAt,
            lateItems: s.lateItems ?? [],
            lateLowerBound: s.validation?.summary?.lateLowerBound,
            brokenRules: (s.validation?.rules ?? []).map((r: { label: string; broken: number }) => ({ label: r.label, broken: r.broken })),
            capacity: s.capacity ?? null,
            alarms: s.alarms,
          }
        : null
      const status = await planStatusDoc(ctx)
      input.planError = status?.lastError && status.lastErrorAt ? { message: status.lastError, at: status.lastErrorAt } : null
      const uploads: Record<string, number> = {}
      for (const key of ['weeklyDemand', 'stock']) {
        const last = await ctx.db
          .query('sapUploads')
          .withIndex('by_key', (q) => q.eq('key', key))
          .order('desc')
          .first()
        uploads[key] = last?.uploadedAt ?? 0
      }
      input.uploads = uploads
    }
    if (access.machine !== 'none') {
      const open = await ctx.db
        .query('machineProblems')
        .withIndex('by_status', (q) => q.eq('status', 'open'))
        .collect()
      input.openBreakdowns = { total: open.length, stopping: open.filter((b) => b.stopsPress).length }
    }
    if (access.die !== 'none') {
      const open = await ctx.db
        .query('moldProblems')
        .withIndex('by_status', (q) => q.eq('status', 'open'))
        .collect()
      input.openDieProblems = open.length
    }
    return buildCockpit(input)
  },
})
