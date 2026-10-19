import { useEffect, useMemo, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { useQuery } from '../../lib/convexTransport'
import { diffPlans } from '../../lib/planDiff'
import { groupPlanWeeks, type PlanRun, type SnapshotJob } from '../../lib/planPipeline'
import { SETTINGS_DEFAULTS } from '../../lib/settingsDefaults'

export interface PlanStatus {
  requestedAt?: number
  scheduledFor?: number
  runningSince?: number
  dataChangedAt?: number
  lastRunAt?: number
  lastError?: string
  lastErrorAt?: number
}

export type LatestSnapshot = { createdAt: number; truncated?: boolean; jobCount: number; jobs: SnapshotJob[] }

export function minutesAgo(ms: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${minutes % 60} min ago`
}

export function dayMonth(iso: string | undefined): string {
  if (!iso) return ''
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

/**
 * Son hesaplanan plan ve durumu — Production Plan (Gantt) ile Overview (özet)
 * aynı veriyi aynı kurallarla okur (planlamacı, 2026-10-19: özet ve tablolar
 * Overview'da, Plan sayfasında yalnızca Gantt ve araçları).
 */
export function usePlanState() {
  const run = useQuery(api.planRuns.latest) as PlanRun | null | undefined
  const planStatus = useQuery(api.planRuns.status) as PlanStatus | null | undefined
  const latestSnapshot = useQuery(api.planSnapshots.latest) as LatestSnapshot | null | undefined

  // Şimdiki zaman çizgisi canlı kalır; plan yalnızca "Calculate plan" ile yenilenir.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const shiftMinutes = run?.shiftMinutes ?? SETTINGS_DEFAULTS.shiftMinutes
  const shiftStartMinute = run?.shiftStartMinute ?? SETTINGS_DEFAULTS.shiftStartMinute

  /** Motorun yeni planı — dondurulmuş taahhütler hariç. */
  const engineJobs = useMemo(() => (run?.jobs ?? []).filter((j) => !j.frozen), [run])
  const weeks = useMemo(() => (run ? groupPlanWeeks(run) : []), [run])

  // Onaylı planla canlı planın farkı — "onayladığımdan bu yana ne değişti".
  // Kırpılmış bir onaylı planla karşılaştırmak yalan söyler: saklanmayan işler
  // "plandan düştü" gibi görünür.
  const planDiff = useMemo(() => {
    if (!latestSnapshot || !run || latestSnapshot.truncated) return null
    return diffPlans(latestSnapshot.jobs, engineJobs)
  }, [latestSnapshot, run, engineJobs])

  // Girdi değişti ama yeni hesap henüz gelmedi: ekrandaki plan eskidir.
  const recalculating =
    planStatus != null &&
    ((planStatus.runningSince !== undefined && nowMs - planStatus.runningSince < 10 * 60_000) ||
      (planStatus.scheduledFor !== undefined && planStatus.scheduledFor > nowMs - 60_000))
  // Son hesaptan sonra plan girdisi değişti (elle hesaplanana kadar plan güncel değil).
  const stale = !!run && !recalculating && (planStatus?.dataChangedAt ?? 0) > run.computedAt
  const failedLast =
    planStatus?.lastError !== undefined && (planStatus.lastErrorAt ?? 0) > (planStatus.lastRunAt ?? 0)

  return {
    run,
    planStatus,
    latestSnapshot,
    nowMs,
    shiftMinutes,
    shiftStartMinute,
    engineJobs,
    weeks,
    planDiff,
    recalculating,
    stale,
    failedLast,
  }
}
