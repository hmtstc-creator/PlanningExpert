import { v } from 'convex/values'

import { ALL_MODULES, guardedQuery } from './guarded'
import type { LockedDb } from './lockedDbTypes'
import { planStatusDoc } from './planQueue'
import { buildCockpit, type CockpitInput, type Signal, type TodayThresholds } from '../src/lib/cockpit'
import { TODAY_DEFAULTS } from '../src/lib/settingsDefaults'
import type { Access } from '../src/lib/tenancy'

/** Plant'in Today eşikleri: kaydedilen, yoksa TODAY_DEFAULTS. */
export async function todayThresholds(db: LockedDb): Promise<TodayThresholds> {
  const s = await db.query('todaySettings').withIndex('by_plant').first()
  return {
    sapStaleHours: s?.sapStaleHours ?? TODAY_DEFAULTS.sapStaleHours,
    planStaleHours: s?.planStaleHours ?? TODAY_DEFAULTS.planStaleHours,
    overloadPercent: s?.overloadPercent ?? TODAY_DEFAULTS.overloadPercent,
    bottleneckWeeks: s?.bottleneckWeeks ?? TODAY_DEFAULTS.bottleneckWeeks,
  }
}

/**
 * Plant'in Today sinyalleri (panel ve günlük özet aynı hesabı kullanır).
 * Yalnızca `access`te açık modüllerin sinyalleri; planın yalnızca özet
 * dokümanı okunur — büyük listeler değil.
 */
export async function cockpitSignals(ctx: { db: LockedDb }, access: Access, now = Date.now()): Promise<Signal[]> {
  const db = ctx.db
  const input: CockpitInput = { now, plan: null }
  if (access.planning !== 'none') {
    const run = await db
      .query('planRuns')
      .withIndex('by_status_computed', (q) => q.eq('status', 'ready'))
      .order('desc')
      .first()
    const s = run?.summary as Record<string, any> | undefined
    input.plan =
      run && s
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
    input.planChangedAt = status?.dataChangedAt ?? null
    const uploads: Record<string, number> = {}
    for (const key of ['weeklyDemand', 'stock']) {
      const last = await db
        .query('sapUploads')
        .withIndex('by_key', (q) => q.eq('key', key))
        .order('desc')
        .first()
      uploads[key] = last?.uploadedAt ?? 0
    }
    input.uploads = uploads
  }
  if (access.machine !== 'none') {
    const open = await db
      .query('machineProblems')
      .withIndex('by_status', (q) => q.eq('status', 'open'))
      .collect()
    input.openBreakdowns = { total: open.length, stopping: open.filter((b) => b.stopsPress).length }
  }
  if (access.die !== 'none') {
    const open = await db
      .query('moldProblems')
      .withIndex('by_status', (q) => q.eq('status', 'open'))
      .collect()
    input.openDieProblems = open.length
  }
  return buildCockpit(input, await todayThresholds(db))
}

/**
 * "Today" paneli (portal ana sayfası, Overview): kullanıcının izinli
 * modüllerinin karar sinyalleri. Kural: src/lib/cockpit.ts.
 */
export const today = guardedQuery({
  modules: ALL_MODULES,
  args: {},
  returns: v.any(),
  handler: async (ctx) => cockpitSignals(ctx, ctx.access),
})
