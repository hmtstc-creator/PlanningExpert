import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery } from '../lib/convexTransport'
import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { isoWeekLabel, plantClock } from '../lib/dates'
import {
  WeekGantt,
  type WeekGanttJob,
  type WeekGanttPress,
} from '../components/WeekGantt'
import { productionDayOf } from '../lib/shiftTimeline'
import { useCurrentUser } from '../lib/currentUser'
import { diffPlans } from '../lib/planDiff'
import {
  groupPlanWeeks,
  RAW_URGENT_DAYS,
  type DataCoverage,
  type LateItem,
  type PlanOptimisation,
  type PlanRun,
  type SnapshotJob,
} from '../lib/planPipeline'
import type { PlanAudit } from '../lib/planAudit'
import type { MaterialVerdictKind, PlanValidation } from '../lib/planValidator'
import type { PlanAlarms } from '../lib/planAlarms'
import type { PlacementDecision } from '../lib/scheduler'
import { fixForUnplanned } from '../lib/unplannedFix'
import {
  SAP_UPLOAD_KEYS,
  SAP_UPLOAD_LABELS,
  formatPlantTime,
  type PlanDataSources,
} from '../lib/sapUploads'

export const Route = createFileRoute('/planlama')({
  component: PlanlamaPage,
})

/**
 * Gün içi dakikayı gerçek saate çevirir. `shiftStartMinute` birinci
 * the start of the first shift (minutes from midnight, e.g. 480 = 08:00).
 * Vardiya numarası da ayrıca gösterilir.
 */
function formatClock(minute: number, shiftMinutes: number, shiftStartMinute: number): string {
  const shiftIndex = Math.floor(minute / shiftMinutes) + 1
  const absolute = (shiftStartMinute + minute) % (24 * 60)
  const h = Math.floor(absolute / 60)
  const m = Math.round(absolute % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} (shift ${shiftIndex})`
}

function minutesAgo(ms: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${minutes % 60} min ago`
}

interface PlanStatus {
  requestedAt?: number
  scheduledFor?: number
  runningSince?: number
  lastRunAt?: number
  lastError?: string
  lastErrorAt?: number
}

function PlanlamaPage() {
  // Plan sunucuda hesaplanıyor (convex/planEngine.ts) ve saklanıyor; sayfa
  // yalnızca son hesabı okur. Girdi değişince sunucu birkaç saniye içinde
  // yeniden hesaplar, yeni sonuç buraya kendiliğinden gelir.
  const run = useQuery(api.planRuns.latest) as PlanRun | null | undefined
  const planStatus = useQuery(api.planRuns.status) as PlanStatus | null | undefined
  const requestNow = useMutation(api.planRuns.requestNow)
  const latestSnapshot = useQuery(api.planSnapshots.latest) as
    | { createdAt: number; truncated?: boolean; jobCount: number; jobs: SnapshotJob[] }
    | null
    | undefined
  const approve = useMutation(api.planSnapshots.approve)
  const overrideRows = (useQuery(api.planOverrides.list) ?? []) as {
    _id: string
    material: string
    kind: string
    press?: string
    date?: string
    note?: string
  }[]
  const setOverride = useMutation(api.planOverrides.set)
  const clearOverride = useMutation(api.planOverrides.clear)

  const { name: currentUser } = useCurrentUser()
  const [approving, setApproving] = useState(false)
  const [approvedAt, setApprovedAt] = useState<string | null>(null)
  const [ovMaterial, setOvMaterial] = useState('')
  const [ovKind, setOvKind] = useState('priority')
  const [ovPress, setOvPress] = useState('')
  const [ovDate, setOvDate] = useState('')

  // Henüz hiç hesap yoksa (ilk kurulum) bir kere iste.
  const askedFirstRun = useRef(false)
  useEffect(() => {
    if (run === null && !askedFirstRun.current) {
      askedFirstRun.current = true
      void requestNow({})
    }
  }, [run, requestNow])

  // Şimdiki zaman çizgisi canlı kalır; plan saat başı ve her değişiklikte
  // sunucuda yenilenir.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const inputsLoading = run === undefined
  const shiftMinutes = run?.shiftMinutes ?? 480
  const shiftStartMinute = run?.shiftStartMinute ?? 420
  const capacityFactor = run?.capacityFactor ?? 1
  const horizonWeeks = run?.horizonWeeks ?? 4
  const globalFrozenDays = run?.globalFrozenDays ?? 0
  const truncatedInputs = run?.truncatedInputs ?? []
  const presses = run?.presses ?? []
  const plannedStops = run?.plannedStops ?? []
  const warnings = run?.warnings ?? []
  const rawNeeds = run?.rawNeeds ?? []
  // Plan sayfasında yalnızca acil hammadde: ilk eksik iş RAW_URGENT_DAYS gün içinde.
  const rawUrgentUntil = run
    ? new Date(Date.parse(`${run.todayIso}T00:00:00Z`) + (RAW_URGENT_DAYS - 1) * 86_400_000).toISOString().slice(0, 10)
    : ''
  const shortRaw = rawNeeds.filter((r) => r.shortageKg > 0 && r.shortFrom)
  const urgentRaw = shortRaw.filter((r) => r.shortFrom!.date <= rawUrgentUntil)
  const laterRaw = shortRaw.length - urgentRaw.length
  const unplanned = run?.unplanned ?? []
  const frozenCount = run?.frozenCount ?? 0
  const thisWeekCapacity = run?.thisWeekCapacity ?? { full: 0, remaining: 0, elapsed: 0 }
  const horizonMonday = new Date(`${run?.horizonStart ?? '1970-01-05'}T00:00:00`)
  const horizonStart = run?.horizonStart ?? ''

  const { date: todayIso, clockMinute: nowClockMinute } = productionDayOf(
    plantClock(nowMs, run?.timeZone),
    shiftStartMinute,
  )

  /** Motorun yeni planı — dondurulmuş taahhütler hariç. */
  const engineJobs = useMemo(() => (run?.jobs ?? []).filter((j) => !j.frozen), [run])
  const weeks = useMemo(() => (run ? groupPlanWeeks(run) : []), [run])
  // Tek, kesintisiz Gantt: bütün haftaların günleri ve işleri bir arada.
  // Haftaya bölünmüş grafikler arasında gidip gelmek izlemeyi yoruyordu.
  const allDates = useMemo(
    () => Array.from(new Set(weeks.flatMap((w) => w.dates))).sort(),
    [weeks],
  )
  const allJobs = useMemo(() => Array.from(new Set(weeks.flatMap((w) => w.jobs))), [weeks])

  const { shiftsByPressDate, capacityByPressDate } = useMemo(() => {
    const shifts = new Map<string, number>()
    const capacity = new Map<string, number>()
    for (const day of run?.days ?? []) {
      shifts.set(`${day.press}|${day.date}`, day.shifts)
      capacity.set(`${day.press}|${day.date}`, day.minutes)
    }
    return { shiftsByPressDate: shifts, capacityByPressDate: capacity }
  }, [run])

  /** Pres bakımları grafikte ayrı çizilir — iş listesine karışmaz. */
  const ganttMaintenance = useMemo<WeekGanttJob[]>(
    () =>
      (run?.maintenance ?? []).map((block) => ({
        date: block.date,
        press: block.press,
        material: block.label,
        quantity: 0,
        late: false,
        setupStartMinute: block.start,
        endMinute: block.end,
        segments: [
          { kind: 'maintenance' as const, date: block.date, start: block.start, end: block.end },
        ],
      })),
    [run],
  )

  // Onaylı planla canlı planın farkı — "onayladığımdan bu yana ne değişti".
  const planDiff = useMemo(() => {
    if (!latestSnapshot || !run) return null
    // Kırpılmış bir onaylı planla karşılaştırmak yalan söyler: saklanmayan
    // işler "plandan düştü" gibi görünür.
    if (latestSnapshot.truncated) return null
    return diffPlans(latestSnapshot.jobs, engineJobs)
  }, [latestSnapshot, run, engineJobs])

  const lateCount = engineJobs.filter((j) => j.late).length
  const totalPlannedQty = engineJobs.reduce((s, j) => s + j.quantity, 0)

  // Girdi değişti ama yeni hesap henüz gelmedi: ekrandaki plan eskidir.
  const recalculating =
    planStatus != null &&
    ((planStatus.runningSince !== undefined && nowMs - planStatus.runningSince < 10 * 60_000) ||
      (planStatus.scheduledFor !== undefined && planStatus.scheduledFor > nowMs - 60_000))
  const failedLast =
    planStatus?.lastError !== undefined &&
    (planStatus.lastErrorAt ?? 0) > (planStatus.lastRunAt ?? 0)

  async function handleApprove() {
    if (!run) return
    setApproving(true)
    try {
      await approve({
        horizonStart,
        approvedBy: currentUser ?? undefined,
        unplannedCount: unplanned.length,
        // Onay, ekranda görünen planın tamamını kaydeder: dondurulmuş
        // taahhütler de bir sonraki onayın temeli olmalı.
        jobs: run.jobs.map((j) => ({
          material: j.material,
          press: j.press,
          hall: j.hall,
          date: j.date,
          phase: j.phase,
          quantity: j.quantity,
          shots: j.shots,
          coilsNeeded: j.coilsNeeded,
          setupStartMinute: j.setupStartMinute,
          endMinute: j.endMinute,
          endDate: j.endDate,
          segments: j.segments.map((seg) => ({
            kind: seg.kind,
            date: seg.date,
            start: seg.start,
            end: seg.end,
          })),
          reason: j.reason,
        })),
      })
      setApprovedAt(new Date().toLocaleString('en-GB'))
    } finally {
      setApproving(false)
    }
  }

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Production Plan</h1>
      <p className="mt-2 text-muted-foreground">
        The plan is generated automatically: backlog first, then the materials
        whose stock runs out soonest, and the remaining capacity is filled with
        the rest of the demand. Crane constraints, mold limits and coil
        calculations are all applied. You only review and approve. Planning
        horizon is {horizonWeeks} weeks (change it on the Work Calendar page).
      </p>

      <PressStartPanel presses={presses.map((p) => p.name)} />

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm">
        {run ? (
          <span className="text-muted-foreground">
            Calculated on the server{' '}
            <strong className="text-foreground">{minutesAgo(run.computedAt, nowMs)}</strong>{' '}
            ({new Date(run.computedAt).toLocaleString('en-GB')})
          </span>
        ) : run === null ? (
          <span className="text-muted-foreground">The first plan is being calculated…</span>
        ) : (
          <span className="text-muted-foreground">Loading the plan…</span>
        )}
        {recalculating && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
            Data changed — recalculating…
          </span>
        )}
        {failedLast && (
          <span className="text-xs text-destructive">
            Last calculation failed: {planStatus?.lastError}
          </span>
        )}
        <button
          onClick={() => void requestNow({})}
          disabled={recalculating}
          className="ml-auto rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          Recalculate now
        </button>
      </div>

      {run && <PlanDataLine sources={(run as { dataSources?: PlanDataSources }).dataSources} />}

      <p className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
        <strong className="text-foreground">Lot size: Min. lot if set, otherwise whole coils.</strong>{' '}
        A mounted coil is run out, so quantities are rounded up to whole coils and the
        surplus covers the following weeks rather than triggering a second coil. Where a{' '}
        <strong className="text-foreground">Min. lot</strong> is set in master data (e.g.
        transfer presses), the lot is at least that many pieces and the coil is ignored.
        Parts with neither are planned to the exact need and flagged. A coil is never cut
        short, not even to save a late job — late jobs are moved forward instead. A
        co-product pair is one job: one stroke makes both parts.
      </p>

      {thisWeekCapacity.full > 0 && (
        <p className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          This week ({isoWeekLabel(horizonMonday)}):{' '}
          <strong className="text-foreground">
            {Math.round(thisWeekCapacity.remaining / 60).toLocaleString('en-GB')} h
          </strong>{' '}
          still available of {Math.round(thisWeekCapacity.full / 60).toLocaleString('en-GB')} h —{' '}
          {Math.round(thisWeekCapacity.elapsed / 60).toLocaleString('en-GB')} h have already
          gone by. Days that have passed and the hours already elapsed today are excluded
          from the plan.
        </p>
      )}

      {capacityFactor !== 1 && (
        <p className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          Capacity is adjusted by the measured attainment rate:{' '}
          <strong className="text-foreground">%{Math.round(capacityFactor * 100)}</strong>.
          You can update this factor on the Performance page.
        </p>
      )}

      {truncatedInputs.length > 0 && (
        <div className="mt-6 rounded-lg border-2 border-destructive bg-destructive/10 p-4">
          <p className="text-sm font-semibold text-destructive">
            This plan is incomplete — do not approve it
          </p>
          <p className="mt-1 text-sm text-foreground">
            There are more rows in {truncatedInputs.join(', ')} than one query can
            read, so part of the data did not reach the planner. Everything shown
            below was planned without it. Reduce the data or split the plant before
            relying on this plan.
          </p>
        </div>
      )}

      {frozenCount > 0 && (
        <p className="mt-6 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          <strong className="text-foreground">{frozenCount} jobs are frozen or running now</strong> —
          taken from the plan approved on{' '}
          {run?.frozenFrom ? new Date(run.frozenFrom).toLocaleString('en-GB') : ''}{' '}
          instead of being recalculated, so the shop floor's preparation is not
          disturbed. They are drawn hatched below and the quantity they produce
          is deducted from the requirement. Change the frozen day count on the
          Work Calendar page, or per press on Press Definitions.
        </p>
      )}

      {globalFrozenDays > 0 && frozenCount === 0 && latestSnapshot === null && (
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Frozen days are set to {globalFrozenDays}, but no plan has been
          approved yet, so there is nothing to freeze. Approve a plan once and
          the near term will stop moving.
        </p>
      )}

      {run?.alarms && <AlarmBanner alarms={run.alarms} />}

      {run?.dataCoverage && <DataCoveragePanel coverage={run.dataCoverage} />}

      {run && ((run.lateRepair?.rounds ?? 0) > 0 || (run.lateItems?.length ?? 0) > 0) && (
        <LateJobs
          run={run}
          jobs={engineJobs.filter((j) => j.late)}
          shiftMinutes={shiftMinutes}
          shiftStartMinute={shiftStartMinute}
        />
      )}

      {run?.dailyUntil && (
        <p className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          Sales days come from <strong className="text-foreground">ZPP_DAILY</strong> up to{' '}
          {run.dailyUntil}; after that the weekly ZPP is spread over working days.
        </p>
      )}

      {warnings.length > 0 && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">Needs attention</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-amber-800">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Planned jobs" value={engineJobs.length.toLocaleString('en-GB')} />
        <Stat label="Planned qty" value={totalPlannedQty.toLocaleString('en-GB')} />
        <Stat
          label="Unplanned"
          value={unplanned.length.toLocaleString('en-GB')}
          warn={unplanned.length > 0}
        />
        <Stat
          label={run?.lateItems ? 'Late materials' : 'Late jobs'}
          value={(run?.lateItems?.length ?? lateCount).toLocaleString('en-GB')}
          warn={(run?.lateItems?.length ?? lateCount) > 0}
        />
      </div>

      {run?.optimisation && <OptimisationPanel opt={run.optimisation} />}

      {run?.validation && <IndependentCheck v={run.validation} />}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void handleApprove()}
          disabled={
            approving ||
            engineJobs.length === 0 ||
            inputsLoading ||
            recalculating ||
            truncatedInputs.length > 0
          }
          title={
            truncatedInputs.length > 0
              ? 'Part of the data did not reach the planner'
              : inputsLoading
                ? 'Still loading the plan'
                : recalculating
                  ? 'The data changed — wait for the plan to be recalculated'
                  : undefined
          }
          className="rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {approving ? 'Approving…' : 'Approve plan'}
        </button>
        {approvedAt && <span className="text-sm text-emerald-600">Approved ✓ {approvedAt}</span>}
        {latestSnapshot && !approvedAt && (
          <span className="text-sm text-muted-foreground">
            Last approved plan: {new Date(latestSnapshot.createdAt).toLocaleString('en-GB')} ·{' '}
            {latestSnapshot.jobCount} jobs
          </span>
        )}
      </div>

      {latestSnapshot?.truncated && (
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          The approved plan of{' '}
          {new Date(latestSnapshot.createdAt).toLocaleString('en-GB')} was too
          large to store in full ({latestSnapshot.jobCount} jobs), so it cannot be
          compared with the plan below — a comparison would report the jobs that
          were not stored as dropped. Approve again to get a comparable plan.
        </p>
      )}

      {planDiff && planDiff.changes.length > 0 && (
        <div className="mt-6 rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold text-foreground">
            Changes since the approved plan
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Approved: {new Date(latestSnapshot!.createdAt).toLocaleString('en-GB')} ·{' '}
            {planDiff.addedCount} new, {planDiff.removedCount} dropped,{' '}
            {planDiff.movedCount} moved, {planDiff.quantityCount} quantity changed,{' '}
            {planDiff.sameCount} unchanged.
          </p>
          <div className="mt-2 max-h-80 overflow-auto rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Material</th>
                  <th className="px-3 py-2 font-medium">Change</th>
                  <th className="px-3 py-2 font-medium">Approved</th>
                  <th className="px-3 py-2 font-medium">Now</th>
                </tr>
              </thead>
              <tbody>
                {planDiff.changes.map((c) => (
                  <tr key={c.material} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium text-foreground">{c.material}</td>
                    <td className="px-3 py-2">
                      <span className={CHANGE_STYLE[c.kind]}>{CHANGE_LABEL[c.kind]}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {c.approvedSlots.length > 0 ? (
                        <>
                          {Math.round(c.approvedQty).toLocaleString('en-GB')} pcs
                          <br />
                          {c.approvedSlots.join(', ')}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {c.currentSlots.length > 0 ? (
                        <>
                          {Math.round(c.currentQty).toLocaleString('en-GB')} pcs
                          <br />
                          {c.currentSlots.join(', ')}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div id="plan-overrides" className="mt-6 scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Plan overrides</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          The plan is always computed by the engine; the rules below are fed in
          as input, so your override persists but the plan still comes out of
          the engine.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Material</span>
            <input
              className="mt-1 w-40 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={ovMaterial}
              onChange={(e) => setOvMaterial(e.target.value)}
              placeholder="Material code"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Rule</span>
            <select
              className="mt-1 w-44 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={ovKind}
              onChange={(e) => setOvKind(e.target.value)}
            >
              <option value="priority">Move to front</option>
              <option value="pin">Pin to press</option>
              <option value="exclude">Exclude from planning</option>
            </select>
          </label>
          {ovKind === 'pin' && (
            <>
              <label className="text-sm">
                <span className="block text-xs text-muted-foreground">Press</span>
                <select
                  className="mt-1 w-36 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={ovPress}
                  onChange={(e) => setOvPress(e.target.value)}
                >
                  <option value="">Select…</option>
                  {presses.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs text-muted-foreground">Day (opt.)</span>
                <input
                  type="date"
                  className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={ovDate}
                  onChange={(e) => setOvDate(e.target.value)}
                />
              </label>
            </>
          )}
          <button
            onClick={() => {
              const material = ovMaterial.trim()
              if (!material) return
              void setOverride({
                material,
                kind: ovKind,
                press: ovKind === 'pin' ? ovPress || undefined : undefined,
                date: ovKind === 'pin' && ovDate ? ovDate : undefined,
              }).then(() => {
                setOvMaterial('')
                setOvDate('')
              })
            }}
            disabled={!ovMaterial.trim() || (ovKind === 'pin' && !ovPress)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Add rule
          </button>
        </div>

        {overrideRows.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {overrideRows.map((o) => (
              <li
                key={o._id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <span className="text-foreground">
                  <strong>{o.material}</strong>{' '}
                  <span className="text-muted-foreground">
                    {o.kind === 'exclude'
                      ? '— excluded from planning'
                      : o.kind === 'priority'
                        ? '— moved to front'
                        : `— pinned to ${o.press}${o.date ? ` (${o.date})` : ''}`}
                  </span>
                </span>
                <button
                  onClick={() => {
                    if (window.confirm(`Remove the planning rule for ${o.material}?`)) {
                      void clearOverride({ material: o.material })
                    }
                  }}
                  className="text-xs text-destructive hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {run?.audit && <PlanCheck audit={run.audit} jobCount={run.jobs.length} />}

      {inputsLoading && (
        <p className="mt-8 text-sm text-muted-foreground">Loading data…</p>
      )}

      {weeks.length === 0 && !inputsLoading && (
        <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No jobs to plan. Make sure ZPP demand, MB52 stock and{' '}
          <Link to="/makineler" className="underline">
            press definitions
          </Link>{' '}
          have been uploaded.
        </p>
      )}

      {weeks.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-foreground">
            Plan{' '}
            <span className="font-normal text-muted-foreground">
              · {dayMonth(allDates[0])} – {dayMonth(allDates[allDates.length - 1])} ·{' '}
              {allJobs.length} jobs
            </span>
          </h2>

          <div className="mt-2">
            <WeekGantt
              dates={allDates}
              // `nowClockMinute` gece yarısından itibaren sayar (gece
              // vardiyasında 1440'ı aşar), grafiğin ekseni de öyle.
              now={{ date: todayIso, clockMinute: nowClockMinute }}
              stops={plannedStops}
              shiftStartMinute={shiftStartMinute}
              shiftMinutes={shiftMinutes}
              presses={presses.map(
                (p): WeekGanttPress => ({
                  name: p.name,
                  hall: p.hall,
                  category: p.category,
                  days: allDates.map((d) => ({
                    date: d,
                    shifts: shiftsByPressDate.get(`${p.name}|${d}`) ?? 0,
                    capacityMinutes: capacityByPressDate.get(`${p.name}|${d}`) ?? 0,
                  })),
                }),
              )}
              jobs={[
                ...allJobs.map(
                  (j): WeekGanttJob => ({
                    date: j.date,
                    press: j.press,
                    material: j.material,
                    quantity: j.quantity,
                    late: j.late,
                    frozen: j.frozen,
                    setupStartMinute: j.setupStartMinute,
                    setupMinutes: j.setupMinutes,
                    endMinute: j.endMinute,
                    segments: j.segments,
                    waitReason: j.waitReason,
                    urgentSetup: j.urgentSetup,
                  }),
                ),
                ...ganttMaintenance,
              ]}
            />
          </div>

          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Job lists by week
          </h3>
          {weeks.map((week) => (
            <details key={week.weekStart} className="mt-2 rounded-lg border border-border">
              <summary className="cursor-pointer px-3 py-2 text-sm text-foreground hover:bg-muted/40">
                <span className="font-semibold">
                  {isoWeekLabel(new Date(`${week.weekStart}T00:00:00`))}
                </span>{' '}
                <span className="text-muted-foreground">
                  · {dayMonth(week.dates[0])} – {dayMonth(week.dates[week.dates.length - 1])} ·{' '}
                  {week.jobs.length} jobs
                  {week.idlePresses.length > 0 &&
                    ` · idle: ${week.idlePresses.map((p) => `${p.name} (${p.reason})`).join(', ')}`}
                </span>
              </summary>
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Day</th>
                    <th className="px-3 py-2 font-medium">Press</th>
                    <th className="px-3 py-2 font-medium">Material</th>
                    <th className="px-3 py-2 font-medium">Required</th>
                    <th className="px-3 py-2 font-medium">Qty</th>
                    <th className="px-3 py-2 font-medium">Shots</th>
                    <th className="px-3 py-2 font-medium">Coils</th>
                    <th className="px-3 py-2 font-medium">Setup start</th>
                    <th className="px-3 py-2 font-medium">End</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                    <th className="px-3 py-2 font-medium" title="Order in which the engine placed the job, and when each eligible press would have finished it at that moment">
                      Why this press
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {week.jobs.map((job, i) => (
                    <tr key={`${job.press}-${job.material}-${i}`} className="border-t border-border">
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {new Date(`${job.date}T00:00:00`).toLocaleDateString('en-GB', {
                          weekday: 'short',
                          day: '2-digit',
                        })}
                      </td>
                      <td className="px-3 py-2 font-medium text-foreground">{job.press}</td>
                      <td className="px-3 py-2 text-foreground">
                        {job.material}
                        {job.coProduct && (
                          <span className="text-muted-foreground"> +{job.coProduct}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className={job.late ? 'text-destructive' : 'text-muted-foreground'}>
                          {job.bucketLabel}
                          {job.late && ' ⚠'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-foreground">
                        {job.quantity.toLocaleString('en-GB')}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {job.shots.toLocaleString('en-GB')}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{job.coilsNeeded}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatClock(job.setupStartMinute, shiftMinutes, shiftStartMinute)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatClock(job.endMinute, shiftMinutes, shiftStartMinute)}
                        {job.spansDays && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (
                            {new Date(`${job.endDate}T00:00:00`).toLocaleDateString('en-GB', {
                              weekday: 'short',
                              day: '2-digit',
                            })}
                            )
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{job.reason}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        <DecisionCell
                          decision={job.decision}
                          chosen={job.frozen ? undefined : job.press}
                          shiftMinutes={shiftMinutes}
                          shiftStartMinute={shiftStartMinute}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </details>
          ))}
        </div>
      )}

      {urgentRaw.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-destructive">
            Raw material — urgent ({urgentRaw.length}): coil stock runs out within the next {RAW_URGENT_DAYS} days
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Planned quantity × gross weight per piece, walked in plan order against the coil
            stock in MB52 (master data raw material codes, every location except Quality and
            Customer). Only coils that stop a job in the next {RAW_URGENT_DAYS} days are listed
            {laterRaw > 0 && ` — ${laterRaw} more run short later in the plan`}. Co-products are
            not counted twice.
          </p>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Raw material</th>
                  <th className="px-3 py-2 font-medium">Required (kg)</th>
                  <th className="px-3 py-2 font-medium">Stock (kg)</th>
                  <th className="px-3 py-2 font-medium">Short (kg)</th>
                  <th className="px-3 py-2 font-medium">First job without coil</th>
                  <th className="px-3 py-2 font-medium">Used by</th>
                </tr>
              </thead>
              <tbody>
                {urgentRaw.map((r) => (
                  <tr key={r.rawMaterial} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">{r.rawMaterial}</td>
                    <td className="px-3 py-2 text-foreground">
                      {Math.round(r.requiredKg).toLocaleString('en-GB')}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {Math.round(r.availableKg).toLocaleString('en-GB')}
                    </td>
                    <td
                      className={`px-3 py-2 font-medium ${
                        r.shortageKg > 0 ? 'text-destructive' : 'text-emerald-600'
                      }`}
                    >
                      {r.shortageKg > 0
                        ? Math.round(r.shortageKg).toLocaleString('en-GB')
                        : 'sufficient'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-foreground">
                      {r.shortFrom ? `${dayMonth(r.shortFrom.date)} · ${r.shortFrom.press} · ${r.shortFrom.material}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.materials.join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {unplanned.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-destructive">
            Unplanned ({unplanned.length})
          </h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-destructive/30">
            <table className="w-full text-left text-sm">
              <thead className="bg-destructive/10 text-destructive">
                <tr>
                  <th className="px-3 py-2 font-medium">Material</th>
                  <th className="px-3 py-2 font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium">Phase</th>
                  <th className="px-3 py-2 font-medium">Required week</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Presses tried</th>
                  <th className="px-3 py-2 font-medium">Fix</th>
                </tr>
              </thead>
              <tbody>
                {unplanned.map((u, i) => {
                  // Her sebebin somut bir çaresi var; listeyi okuyup ne
                  // yapacağını aramak planlamacının işi olmamalı.
                  const fix = fixForUnplanned(u.reason)
                  return (
                    <tr key={`${u.material}-${i}`} className="border-t border-border">
                      <td className="px-3 py-2 font-medium text-foreground">{u.material}</td>
                      <td className="px-3 py-2 text-foreground">
                        {Math.round(u.quantity).toLocaleString('en-GB')}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{u.phase}</td>
                      <td className="px-3 py-2 text-muted-foreground">{u.dueDate}</td>
                      <td className="px-3 py-2 text-muted-foreground">{u.reason}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        <DecisionCell
                          decision={u.decision}
                          shiftMinutes={shiftMinutes}
                          shiftStartMinute={shiftStartMinute}
                        />
                      </td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {fix.to ? (
                          <Link
                            to={fix.to}
                            className="text-foreground underline hover:no-underline"
                          >
                            {fix.label}
                          </Link>
                        ) : (
                          <button
                            onClick={() => {
                              setOvMaterial(u.material)
                              setOvKind('priority')
                              document
                                .getElementById('plan-overrides')
                                ?.scrollIntoView({ behavior: 'smooth' })
                            }}
                            className="text-foreground underline hover:no-underline"
                          >
                            {fix.label}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

const CHANGE_LABEL: Record<string, string> = {
  added: 'new',
  removed: 'dropped',
  moved: 'moved',
  quantity: 'qty changed',
  same: 'unchanged',
}

const CHANGE_STYLE: Record<string, string> = {
  added: 'rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800',
  removed: 'rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive',
  moved: 'rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900',
  quantity: 'rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-900',
  same: 'text-xs text-muted-foreground',
}

/** Kalıp ve makine alarmlarının plan sayfasındaki özeti. */
function AlarmBanner({ alarms }: { alarms: PlanAlarms }) {
  const dies = alarms.dies.filter((d) => d.critical).length
  const machines = alarms.machines.filter((m) => m.critical).length
  const info = alarms.dies.length + alarms.machines.length - dies - machines
  if (dies + machines === 0 && info === 0) return null
  return (
    <div
      className={`mt-6 rounded-lg border p-3 text-sm ${
        dies + machines > 0 ? 'border-destructive bg-destructive/10' : 'border-border bg-muted/50'
      }`}
    >
      {dies + machines > 0 ? (
        <strong className="text-destructive">
          {dies > 0 && `${dies} die(s)`}
          {dies > 0 && machines > 0 && ' and '}
          {machines > 0 && `${machines} press(es)`} holding up deliveries.
        </strong>
      ) : (
        <span className="text-muted-foreground">No die or press is holding up a delivery.</span>
      )}{' '}
      {info > 0 && <span className="text-muted-foreground">{info} more for information. </span>}
      <Link to="/alarms" className="font-medium text-foreground underline">
        See Alarms →
      </Link>
    </div>
  )
}

/**
 * Geç işler: stok bittikten sonra başlayan iş müşteriyi durdurur. Motor bunu
 * bırakmadan önce planı yeniden kurar; burada ne denendiği ve kalan her geç
 * iş için ne yapılabileceği yazar.
 */
function LateJobs({
  run,
  jobs,
  shiftMinutes,
  shiftStartMinute,
}: {
  run: PlanRun
  jobs: PlanRun['jobs']
  shiftMinutes: number
  shiftStartMinute: number
}) {
  const repair = run.lateRepair
  const items = run.lateItems
  const fixed = repair.lateBefore - repair.lateAfter
  const dayName = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    })
  const daysLate = (start: string, due: string) =>
    Math.max(0, Math.round((Date.parse(start) - Date.parse(due)) / 86_400_000))
  // Açık/kapalı tercihi bu tarayıcıda hatırlanır; liste uzunsa sayfayı kaplamasın.
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem(LATE_OPEN_KEY) !== '0'
    } catch {
      return true
    }
  })
  const toggle = () => {
    setOpen((o) => {
      try {
        window.localStorage.setItem(LATE_OPEN_KEY, o ? '0' : '1')
      } catch {
        // Saklama kapalıysa tercih yalnızca bu oturumda kalır.
      }
      return !o
    })
  }
  return (
    <div
      className={`mt-6 rounded-lg border p-4 ${
        (items ?? jobs).length > 0 ? 'border-destructive bg-destructive/10' : 'border-emerald-200 bg-emerald-50/60'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          {items
            ? items.length > 0
              ? `Late materials — ${items.length} not ready by 08:00 on the day they are needed`
              : 'Late materials — none left'
            : jobs.length > 0
              ? `Late jobs — ${jobs.length} would stop the customer`
              : 'Late jobs — none left'}
        </h2>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
        >
          {open ? 'Hide ▴' : 'Show ▾'}
        </button>
      </div>
      {open && items && <LateItemsBody items={items} repair={repair} />}
      {open && !items && (
        <LateJobsBody
          jobs={jobs}
          repair={repair}
          fixed={fixed}
          dayName={dayName}
          daysLate={daysLate}
          shiftMinutes={shiftMinutes}
          shiftStartMinute={shiftStartMinute}
        />
      )}
    </div>
  )
}

const LATE_OPEN_KEY = 'plan-late-jobs-open'

/** Gecikme saatini "61.5 h (2.6 days)" gibi yazar. */
function lateText(hours: number): string {
  const h = Math.round(hours * 10) / 10
  return hours >= 24 ? `${h} h (${(hours / 24).toFixed(1)} days)` : `${h} h`
}

/**
 * Malzeme bazında geç liste: ihtiyaç günü sabah 08:00'e kadar gereken adet
 * hazır olmuyorsa geçtir. Bir malzeme bir kez yazılır (ilk geç lotu).
 */
function LateItemsBody({ items, repair }: { items: LateItem[]; repair: PlanRun['lateRepair'] }) {
  return (
    <>
      <p className="mt-1 text-xs text-muted-foreground">
        A material is late when the quantity the customer needs is not ready by 08:00 on
        the requirement day (backlog and today's need: next working day 08:00). Stock
        counts only in storage locations 2009 and 1009.
        {repair.rounds > 0 &&
          ` The engine re-planned ${repair.rounds} time(s)${
            repair.boosted.length > 0 ? ` and moved ${repair.boosted.length} part(s) forward` : ''
          }; coils are never cut short.`}
      </p>
      {items.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-md border border-destructive/30 bg-background">
          <table className="w-full text-left text-sm">
            <thead className="bg-destructive/10 text-destructive">
              <tr>
                <th className="px-3 py-2 font-medium">Material</th>
                <th className="px-3 py-2 font-medium">Needed by</th>
                <th className="px-3 py-2 text-right font-medium">Needed qty</th>
                <th className="px-3 py-2 font-medium">Ready</th>
                <th className="px-3 py-2 font-medium">Late</th>
                <th className="px-3 py-2 font-medium">Suggestion</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.material} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-medium text-foreground">
                    {item.material}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {item.presses.join(', ')}
                      {item.lots > 1 && ` · ${item.lots} late lots`}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{item.deadline}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {item.neededQuantity.toLocaleString('en-GB')}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{item.ready}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-destructive">
                    {lateText(item.lateHours)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {item.suggestion}{' '}
                    <Link to="/takvim" className="underline">
                      Work Calendar
                    </Link>{' '}
                    ·{' '}
                    <Link to="/referanslar" className="underline">
                      master data
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

type PressStartRow = {
  press: string
  fromDate?: string
  fromMinute?: number
  reason?: string
  delayMinutes?: number
  updatedBy?: string
}

const HOLD_REASONS = ['No operator', 'No raw material', 'Die not ready', 'Other']

const toTime = (m?: number) =>
  m === undefined ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/**
 * Planlamacının müdahalesi, "Recalculate"den önce: bir pres belli bir ana
 * kadar yeni iş almaz (operatör yok, hammadde yok…) ya da hat onaylı plana
 * göre geride/ileride. Belirtilmeyen pres her zamanki gibi şu andan planlanır.
 */
function PressStartPanel({ presses }: { presses: string[] }) {
  const rows = (useQuery(api.pressPlanStarts.list) ?? []) as PressStartRow[]
  const save = useMutation(api.pressPlanStarts.set)
  const clearAll = useMutation(api.pressPlanStarts.clearAll)
  const [open, setOpen] = useState(false)
  const [allDelay, setAllDelay] = useState('')
  const byPress = new Map(rows.map((r) => [r.press, r]))
  const active = rows.filter((r) => r.fromDate || r.delayMinutes)
  const list = Array.from(new Set([...presses, ...rows.map((r) => r.press)])).sort()
  return (
    <div className={`mt-4 rounded-lg border p-3 ${active.length > 0 ? 'border-sky-300 bg-sky-50/60' : 'border-border'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-semibold text-foreground">Plan settings — press start &amp; delays</span>{' '}
          <span className="text-muted-foreground">
            {active.length === 0
              ? '· every press is planned from now'
              : `· ${active
                  .map((r) =>
                    [
                      r.press,
                      r.fromDate ? `from ${r.fromDate} ${toTime(r.fromMinute)}${r.reason ? ` (${r.reason})` : ''}` : '',
                      r.delayMinutes ? `${r.delayMinutes > 0 ? '+' : ''}${Math.round((r.delayMinutes / 60) * 10) / 10} h` : '',
                    ]
                      .filter(Boolean)
                      .join(' '),
                  )
                  .join(' · ')}`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
        >
          {open ? 'Hide ▴' : 'Edit ▾'}
        </button>
      </div>
      {open && (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Plan from</strong>: the press takes no new work
            before this date and time (no operator, no raw material…). Approved jobs on it that
            would start earlier are released and planned again after it.{' '}
            <strong className="text-foreground">Behind / ahead</strong>: the line did not keep to
            the approved plan. +3 h moves the approved (frozen and running) jobs 3 hours later and
            closes the first 3 hours; −2 h brings them forward. Leave empty to plan normally. Each
            save recalculates the plan.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2 text-xs">
            <label>
              <span className="block text-muted-foreground">All presses behind (+) / ahead (−), hours</span>
              <input
                type="number"
                step="0.5"
                value={allDelay}
                onChange={(e) => setAllDelay(e.target.value)}
                className="mt-1 w-28 rounded-md border border-input bg-background px-2 py-1"
              />
            </label>
            <button
              type="button"
              disabled={allDelay.trim() === '' || !Number.isFinite(Number(allDelay))}
              onClick={() => {
                const minutes = Math.round(Number(allDelay) * 60)
                void Promise.all(
                  list.map((press) => {
                    const r = byPress.get(press)
                    return save({ press, fromDate: r?.fromDate, fromMinute: r?.fromMinute, reason: r?.reason, delayMinutes: minutes || undefined })
                  }),
                )
                setAllDelay('')
              }}
              className="rounded-md border border-input bg-background px-3 py-1 font-medium hover:bg-muted disabled:opacity-50"
            >
              Apply to all
            </button>
            {active.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Clear the start and delay settings of every press? The plan is recalculated from now.')) void clearAll({})
                }}
                className="rounded-md border border-input bg-background px-3 py-1 font-medium text-destructive hover:bg-muted"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="mt-3 overflow-x-auto rounded-md border border-border bg-background">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Press</th>
                  <th className="px-3 py-2 font-medium">Plan from (date, time)</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Behind / ahead (h)</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {list.map((press) => (
                  <PressStartRowEditor key={`${press}|${JSON.stringify(byPress.get(press) ?? {})}`} press={press} row={byPress.get(press)} save={save} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function PressStartRowEditor({
  press,
  row,
  save,
}: {
  press: string
  row: PressStartRow | undefined
  save: (args: { press: string; fromDate?: string; fromMinute?: number; reason?: string; delayMinutes?: number }) => Promise<unknown>
}) {
  const [date, setDate] = useState(row?.fromDate ?? '')
  const [time, setTime] = useState(toTime(row?.fromMinute) || '07:00')
  const [reason, setReason] = useState(row?.reason ?? '')
  const [delay, setDelay] = useState(row?.delayMinutes ? String(Math.round((row.delayMinutes / 60) * 10) / 10) : '')
  const [busy, setBusy] = useState(false)
  const minuteOf = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : undefined
  }
  const dirty =
    date !== (row?.fromDate ?? '') ||
    (date !== '' && minuteOf(time) !== row?.fromMinute) ||
    reason !== (row?.reason ?? '') ||
    Math.round(Number(delay || 0) * 60) !== (row?.delayMinutes ?? 0)
  const submit = async (clear = false) => {
    setBusy(true)
    try {
      await save(
        clear
          ? { press }
          : {
              press,
              fromDate: date || undefined,
              fromMinute: date ? minuteOf(time) : undefined,
              reason: reason || undefined,
              delayMinutes: Math.round(Number(delay || 0) * 60) || undefined,
            },
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-1.5 font-medium text-foreground">{press}</td>
      <td className="px-3 py-1.5">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1 text-xs" />{' '}
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!date} className="rounded-md border border-input bg-background px-2 py-1 text-xs disabled:opacity-50" />
      </td>
      <td className="px-3 py-1.5">
        <input
          list="press-hold-reasons"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="No operator…"
          className="w-40 rounded-md border border-input bg-background px-2 py-1 text-xs"
        />
        <datalist id="press-hold-reasons">
          {HOLD_REASONS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </td>
      <td className="px-3 py-1.5">
        <input
          type="number"
          step="0.5"
          value={delay}
          onChange={(e) => setDelay(e.target.value)}
          placeholder="0"
          className="w-20 rounded-md border border-input bg-background px-2 py-1 text-xs"
        />
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-right">
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={() => void submit()}
          className="rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background disabled:opacity-40"
        >
          Save
        </button>{' '}
        {row && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Clear the start and delay settings of ${press}?`)) void submit(true)
            }}
            className="rounded-md border border-input px-2.5 py-1 text-xs font-medium hover:bg-muted"
          >
            Clear
          </button>
        )}
        {row?.updatedBy && <span className="ml-2 text-[11px] text-muted-foreground">{row.updatedBy}</span>}
      </td>
    </tr>
  )
}

const COVERAGE_FILES: { key: keyof DataCoverage['files']; label: string }[] = [
  { key: 'weeklyDemand', label: 'ZPP (weekly demand)' },
  { key: 'dailyDemand', label: 'ZPP_DAILY (daily demand)' },
  { key: 'stock', label: 'MB52 (stock)' },
  { key: 'rawStock', label: 'MB52 (raw material coils)' },
]

/**
 * Master data ana listedir. Master data'da olup yüklenen SAP dosyalarında
 * hiç satırı gelmeyen malzeme alarm verir: ya dosya eksik çekilmiştir ya da
 * kod master data'da farklı yazılmıştır.
 */
function DataCoveragePanel({ coverage }: { coverage: DataCoverage }) {
  const [open, setOpen] = useState(false)
  const alarm = coverage.missingEverywhereCount > 0
  const anyMissing = COVERAGE_FILES.some((f) => coverage.files[f.key].missingCount > 0)
  if (!alarm && !anyMissing) return null
  return (
    <div
      className={`mt-6 rounded-lg border p-4 ${
        alarm ? 'border-destructive bg-destructive/10' : 'border-amber-200 bg-amber-50/70'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          {alarm
            ? `Master data check — ${coverage.missingEverywhereCount} of ${coverage.materials} parts have no row in any SAP file`
            : `Master data check — some parts are missing from a SAP file`}
        </h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
        >
          {open ? 'Hide ▴' : 'Show ▾'}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Master data is the main list: only its parts are kept from the uploaded files. A part in
        master data with no row at all means the file was pulled without it, or its code is
        written differently in master data. It is planned with no demand and no stock.{' '}
        <Link to="/sapdata" className="underline">
          SAP Data
        </Link>{' '}
        ·{' '}
        <Link to="/referanslar" className="underline">
          Master Data
        </Link>
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {COVERAGE_FILES.map(({ key, label }) => {
          const f = coverage.files[key]
          return (
            <li key={key} className={f.missingCount > 0 ? 'text-amber-800' : 'text-emerald-700'}>
              {label}:{' '}
              {!f.uploaded ? 'not uploaded' : f.missingCount > 0 ? `${f.missingCount} parts missing` : 'all parts present'}
            </li>
          )
        })}
      </ul>
      {open && (
        <div className="mt-3 space-y-3 text-xs">
          {alarm && (
            <div>
              <p className="font-medium text-destructive">In no file at all ({coverage.missingEverywhereCount})</p>
              <p className="mt-1 break-words text-foreground">
                {coverage.missingEverywhere.join(', ')}
                {coverage.missingEverywhereCount > coverage.missingEverywhere.length && ' …'}
              </p>
            </div>
          )}
          {COVERAGE_FILES.filter(({ key }) => coverage.files[key].missingCount > 0).map(({ key, label }) => {
            const f = coverage.files[key]
            return (
              <div key={key}>
                <p className="font-medium text-amber-900">
                  Missing from {label} ({f.missingCount})
                </p>
                <p className="mt-1 break-words text-muted-foreground">
                  {f.missing.join(', ')}
                  {f.missingCount > f.missing.length && ' …'}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const VERDICT_TEXT: Record<MaterialVerdictKind, { label: string; tone: string }> = {
  agree: { label: 'Really short', tone: 'text-destructive' },
  'engine-missed': { label: 'Engine missed it', tone: 'text-destructive font-semibold' },
  'engine-false-late': { label: 'False alarm', tone: 'text-amber-700' },
  'explained-unplanned': { label: 'Unplanned', tone: 'text-destructive' },
  'frozen-late': { label: 'Frozen job too late', tone: 'text-amber-700' },
}

/**
 * Bağımsız doğrulama: motordan ayrı bir kod stoğu saat saat yeniden yürütür,
 * kuralları yeniden sayar ve her eksik parça için "hiçbir plan kurtaramaz
 * mıydı?" sorusunu sınar. Motorun kendi denetimi motorun sayılarını
 * tekrarlar; bu ise ham veriden baştan hesaplar.
 */
function IndependentCheck({ v }: { v: PlanValidation }) {
  const [open, setOpen] = useState(false)
  const sm = v.summary
  const rulesOk = sm.rulesBroken === 0
  const engineOk = sm.verdicts['engine-missed'] === 0 && sm.verdicts['engine-false-late'] === 0
  const short = v.materials.filter((m) => m.verdict !== 'engine-false-late' || m.stockouts > 0)
  return (
    <div
      className={`mt-6 rounded-lg border p-4 ${
        rulesOk && engineOk ? 'border-sky-200 bg-sky-50/60' : 'border-destructive bg-destructive/10'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          Independent check —{' '}
          {rulesOk && engineOk ? 'the plan and its late list are confirmed' : 'differences found'}
        </h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
        >
          {open ? 'Hide ▴' : 'Details ▾'}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Separate code, not the planner's, replays stock hour by hour from the SAP files and the
        planned jobs, re-checks every rule, and tests whether any plan could have avoided each
        shortage.
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <CheckStat label="Parts really short (stock replay)" value={sm.realStockouts} warn={sm.realStockouts > 0} />
        <CheckStat
          label="Minimum any plan can reach"
          value={sm.lateLowerBound}
          hint={`press load ${sm.lateLowerBoundBy.press} · setup crew ${sm.lateLowerBoundBy.setupCrew} · hall crane ${sm.lateLowerBoundBy.hallCrane}`}
        />
        <CheckStat
          label="Late list vs replay"
          value={sm.verdicts['engine-missed'] + sm.verdicts['engine-false-late']}
          hint={`${sm.verdicts['engine-missed']} missed · ${sm.verdicts['engine-false-late']} false alarms`}
          warn={!engineOk}
        />
        <CheckStat label="Rules broken" value={sm.rulesBroken} warn={!rulesOk} hint={sm.rulesFailed.join(', ') || 'none'} />
        <CheckStat label="Setups (plan / minimum)" value={`${sm.setups.plan} / ${sm.setups.lowerBound}`} />
        <CheckStat label="Production time (plan / max possible)" value={`${sm.utilisation.plan}% / ${sm.utilisation.upperBound}%`} />
        <CheckStat
          label="Idle waiting for the setup crew"
          value={`${Math.round(v.efficiency.idleHours.waitingCrew)} h`}
          warn={v.efficiency.idleHours.waitingCrew > 0}
          hint={`next ${v.efficiency.windowDays} days`}
        />
        <CheckStat label="Data to check" value={sm.dataSuspect} warn={sm.dataSuspect > 0} />
      </dl>
      {open && (
        <div className="mt-4 space-y-4">
          {short.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border bg-background">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Part</th>
                    <th className="px-3 py-2 font-medium">Verdict</th>
                    <th className="px-3 py-2 font-medium">First short</th>
                    <th className="px-3 py-2 text-right font-medium">Short pcs</th>
                    <th className="px-3 py-2 font-medium">Could any plan avoid it?</th>
                    <th className="px-3 py-2 font-medium">Data to check</th>
                  </tr>
                </thead>
                <tbody>
                  {short.slice(0, 100).map((m) => (
                    <tr key={m.group} className="border-t border-border align-top">
                      <td className="px-3 py-1.5 font-medium text-foreground">{m.group}</td>
                      <td className={`px-3 py-1.5 ${VERDICT_TEXT[m.verdict].tone}`}>{VERDICT_TEXT[m.verdict].label}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{m.firstShortAt ?? '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(m.shortQty).toLocaleString('en-GB')}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">
                        {m.feasibility ? (
                          <>
                            <span
                              className={
                                m.feasibility.verdict === 'capacity-proven'
                                  ? 'font-medium text-foreground'
                                  : m.feasibility.verdict === 'avoidable'
                                    ? 'font-medium text-destructive'
                                    : ''
                              }
                            >
                              {m.feasibility.verdict === 'capacity-proven'
                                ? 'No — '
                                : m.feasibility.verdict === 'avoidable'
                                  ? 'Yes — '
                                  : 'Not proven — '}
                            </span>
                            {m.feasibility.reason}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-amber-800">{m.dataFlags.join(' · ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {v.rules.map((r) => (
              <li key={r.id}>
                <span className={r.broken === 0 ? 'text-emerald-700' : 'text-destructive'}>
                  {r.broken === 0 ? '✓' : '✗'}
                </span>{' '}
                <span className="text-foreground">{r.label}</span>{' '}
                <span className="text-xs text-muted-foreground">
                  ({r.checked.toLocaleString('en-GB')} checked{r.broken > 0 ? `, ${r.broken} broken` : ''})
                </span>
                {r.examples.length > 0 && r.broken > 0 && (
                  <ul className="ml-5 list-disc text-xs text-destructive">
                    {r.examples.slice(0, 5).map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {v.warnings.length > 0 && (
            <ul className="list-inside list-disc text-xs text-muted-foreground">
              {v.warnings.slice(0, 10).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function CheckStat({
  label,
  value,
  hint,
  warn,
}: {
  label: string
  value: number | string
  hint?: string
  warn?: boolean
}) {
  return (
    <div className="rounded-md border border-border bg-background p-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${warn ? 'text-destructive' : 'text-foreground'}`}>
        {typeof value === 'number' ? value.toLocaleString('en-GB') : value}
      </dd>
      {hint && <dd className="text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  )
}

const STOP_TEXT: Record<PlanOptimisation['stoppedBecause'], string> = {
  target: 'target reached',
  noImprovement: 'no better scenario in the last 25 tries',
  limit: 'scenario limit reached',
  time: 'time limit reached',
}

/**
 * Senaryo araması: aynı veriyle farklı sıralama ve pres seçim kurallarıyla
 * planlar kurulur; geç işi en az, doluluğu en yüksek olan seçilir.
 */
function OptimisationPanel({ opt }: { opt: PlanOptimisation }) {
  const reached = opt.achieved >= opt.target
  const pct = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('en-GB')}%`
  const [open, setOpen] = useState(false)
  return (
    <div
      className={`mt-6 rounded-lg border p-4 ${
        reached ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/70'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          Press utilisation {pct(opt.achieved)}{' '}
          <span className="font-normal text-muted-foreground">
            (target {pct(opt.target)}, next {opt.windowDays} days)
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
        >
          {open ? 'Hide ▴' : 'Details ▾'}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {reached
          ? `Target reached. `
          : `Target not reached — the best of ${opt.tried} scenario(s) reaches ${pct(opt.achieved)}. `}
        Tried {opt.tried} scenario(s), stopped: {STOP_TEXT[opt.stoppedBecause]}. Chosen:{' '}
        <strong className="text-foreground">{opt.chosen}</strong> (standard plan {pct(opt.standard)}).
        {opt.localSearch && opt.localSearch.evaluations > 0 &&
          `Local search on the late parts: ${opt.localSearch.evaluations} moves tried, ${opt.localSearch.improvements} kept. `}
        Fewest late items always wins over higher utilisation.
      </p>
      {open && (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="overflow-x-auto rounded-md border border-border bg-background">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Press</th>
                  <th className="px-3 py-2 text-right font-medium">Available h</th>
                  <th className="px-3 py-2 text-right font-medium">Busy h</th>
                  <th className="px-3 py-2 text-right font-medium">Utilisation</th>
                </tr>
              </thead>
              <tbody>
                {opt.perPress.map((p) => (
                  <tr key={p.press} className="border-t border-border">
                    <td className="px-3 py-1.5 font-medium text-foreground">{p.press}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.capacityHours.toFixed(1)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.busyHours.toFixed(1)}</td>
                    <td
                      className={`px-3 py-1.5 text-right tabular-nums ${
                        p.utilisation < opt.target ? 'text-amber-700' : 'text-emerald-700'
                      }`}
                    >
                      {pct(p.utilisation)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded-md border border-border bg-background">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Scenario</th>
                  <th className="px-3 py-2 text-right font-medium">Late</th>
                  <th className="px-3 py-2 text-right font-medium">Late h</th>
                  <th className="px-3 py-2 text-right font-medium">Setups</th>
                  <th className="px-3 py-2 text-right font-medium">Utilisation</th>
                </tr>
              </thead>
              <tbody>
                {opt.scenarios.map((sc) => (
                  <tr
                    key={sc.label}
                    className={`border-t border-border ${sc.label === opt.chosen ? 'font-semibold text-foreground' : ''}`}
                  >
                    <td className="px-3 py-1.5">
                      {sc.label}
                      {sc.label === opt.chosen && ' ✓'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {sc.late}
                      {sc.unplanned > 0 && ` +${sc.unplanned} unplanned`}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(sc.lateHours)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{sc.setups}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{pct(sc.utilisation)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function LateJobsBody({
  jobs,
  repair,
  fixed,
  dayName,
  daysLate,
  shiftMinutes,
  shiftStartMinute,
}: {
  jobs: PlanRun['jobs']
  repair: PlanRun['lateRepair']
  fixed: number
  dayName: (iso: string) => string
  daysLate: (start: string, due: string) => number
  shiftMinutes: number
  shiftStartMinute: number
}) {
  return (
    <>
      <p className="mt-1 text-xs text-muted-foreground">
        The first plan had {repair.lateBefore} job(s) starting after their stock runs
        out. The engine re-planned {repair.rounds} time(s)
        {repair.boosted.length > 0 && `: moved ${repair.boosted.length} part(s) forward`}
        . Every moved job tried all of its presses again; coils are never cut short.{' '}
        {fixed > 0 ? `${fixed} fixed` : 'None could be fixed this way'}
        {jobs.length > 0 ? `, ${jobs.length} still late.` : '.'}
      </p>
      {jobs.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-md border border-destructive/30 bg-background">
          <table className="w-full text-left text-sm">
            <thead className="bg-destructive/10 text-destructive">
              <tr>
                <th className="px-3 py-2 font-medium">Material</th>
                <th className="px-3 py-2 font-medium">Stock runs out</th>
                <th className="px-3 py-2 font-medium">Starts</th>
                <th className="px-3 py-2 font-medium">Late</th>
                <th className="px-3 py-2 font-medium">Presses tried (finish)</th>
                <th className="px-3 py-2 font-medium">What would fix it</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j, i) => (
                <tr key={`${j.material}-${i}`} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-medium text-foreground">{j.material}</td>
                  <td className="px-3 py-2 text-muted-foreground">{dayName(j.dueDate)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {dayName(j.date)} on {j.press}
                  </td>
                  <td className="px-3 py-2 font-medium text-destructive">
                    {daysLate(j.date, j.dueDate)} day(s)
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    <DecisionCell
                      decision={j.decision}
                      chosen={j.press}
                      shiftMinutes={shiftMinutes}
                      shiftStartMinute={shiftStartMinute}
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    Capacity on {j.press} before {dayName(j.dueDate)}: an overtime or
                    weekend shift (
                    <Link to="/takvim" className="underline">
                      Work Calendar
                    </Link>
                    ), tick Flexible press or add another press in its{' '}
                    <Link to="/referanslar" className="underline">
                      master data
                    </Link>
                    , or move a less urgent part off {j.press} (Plan overrides).
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/**
 * Karar izi: iş kaçıncı sırada yerleştirildi ve o an her uygun pres işi ne
 * zaman bitirirdi. Planlamacı "bu parça 105'te daha erken bitmez miydi?"
 * sorusunun cevabını burada okur.
 */
function DecisionCell({
  decision,
  chosen,
  shiftMinutes,
  shiftStartMinute,
}: {
  decision?: PlacementDecision
  chosen?: string
  shiftMinutes: number
  shiftStartMinute: number
}) {
  if (!decision) return <span>—</span>
  return (
    <span className="whitespace-nowrap">
      <span className="mr-1 font-medium text-foreground">#{decision.step}</span>
      {decision.candidates.map((c, i) => (
        <span key={c.press}>
          {i > 0 && ' · '}
          <span className={c.press === chosen ? 'font-semibold text-emerald-700' : undefined}>
            {c.press}
            {c.press === chosen && ' ✓'}{' '}
            {c.endDate !== undefined && c.endMinute !== undefined
              ? `${new Date(`${c.endDate}T00:00:00`).toLocaleDateString('en-GB', {
                  weekday: 'short',
                  day: '2-digit',
                })} ${formatClock(c.endMinute, shiftMinutes, shiftStartMinute).split(' ')[0]}`
              : `(${c.note})`}
          </span>
        </span>
      ))}
    </span>
  )
}

/**
 * Bağımsız plan denetimi: motordan ayrı bir kod, bitmiş planın her işini
 * her kurala karşı yeniden sayar.
 */
function PlanCheck({ audit, jobCount }: { audit: PlanAudit; jobCount: number }) {
  return (
    <div
      className={`mt-6 rounded-lg border p-4 ${
        audit.ok ? 'border-emerald-200 bg-emerald-50/60' : 'border-destructive bg-destructive/10'
      }`}
    >
      <h2 className="text-sm font-semibold text-foreground">
        Plan check {audit.ok ? '— all rules hold' : '— rules broken, do not approve'}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        After every calculation, separate checking code goes through all{' '}
        {jobCount.toLocaleString('en-GB')} jobs again and verifies each rule on its own.
        You do not need to recount the plan by hand. See{' '}
        <Link to="/planlogic" className="underline hover:no-underline">
          Planning Logic
        </Link>
        .
      </p>
      <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
        {audit.rules.map((r) => (
          <li key={r.id}>
            <span className={r.violationCount === 0 ? 'text-emerald-700' : 'text-destructive'}>
              {r.violationCount === 0 ? '✓' : '✗'}
            </span>{' '}
            <span className="text-foreground">{r.label}</span>{' '}
            <span className="text-xs text-muted-foreground">
              ({r.checked.toLocaleString('en-GB')} checked
              {r.violationCount > 0 ? `, ${r.violationCount} broken` : ''})
            </span>
            {r.violations.length > 0 && (
              <ul className="ml-5 list-disc text-xs text-destructive">
                {r.violations.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${warn ? 'text-destructive' : 'text-foreground'}`}>
        {value}
      </p>
    </div>
  )
}

/** Planın hesaplandığı SAP dosyaları — hangi veriyle çalıştığı açık olsun. */
function PlanDataLine({ sources }: { sources: PlanDataSources | undefined }) {
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Calculated with: </span>
      {sources === undefined
        ? 'file details are recorded from the next calculation on'
        : SAP_UPLOAD_KEYS.map((key, i) => {
            const source = sources[key]
            return (
              <span key={key}>
                {i > 0 && ' · '}
                {SAP_UPLOAD_LABELS[key].split(' — ')[1]}{' '}
                {source
                  ? `${source.fileName ?? 'file'} (${formatPlantTime(source.uploadedAt)})`
                  : 'not uploaded'}
              </span>
            )
          })}{' '}
      <Link to="/sapdata" className="underline hover:text-foreground">
        SAP Data →
      </Link>
    </p>
  )
}

function dayMonth(iso: string | undefined): string {
  if (!iso) return ''
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
