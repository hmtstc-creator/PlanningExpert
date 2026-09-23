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
import { groupPlanWeeks, type PlanRun, type SnapshotJob } from '../lib/planPipeline'
import { fixForUnplanned } from '../lib/unplannedFix'

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

      <p className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
        <strong className="text-foreground">Minimum lot is one full coil.</strong> A coil
        that is mounted is run out, so quantities are rounded up to whole coils and the
        surplus covers the following weeks rather than triggering a second coil. Materials
        with no coil or gross weight in master data are planned to the exact requirement.
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
          <strong className="text-foreground">{frozenCount} jobs are frozen</strong> —
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
          label="Late jobs"
          value={lateCount.toLocaleString('en-GB')}
          warn={lateCount > 0}
        />
      </div>

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

      {weeks.map((week) => (
        <div key={week.weekStart} className="mt-8">
          <h2 className="text-sm font-semibold text-foreground">
            {isoWeekLabel(new Date(`${week.weekStart}T00:00:00`))}{' '}
            <span className="font-normal text-muted-foreground">
              · {new Date(`${week.dates[0]}T00:00:00`).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
              })}
              –
              {new Date(
                `${week.dates[week.dates.length - 1]}T00:00:00`,
              ).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}{' '}
              · {week.jobs.length} jobs
            </span>
          </h2>

          <div className="mt-2">
            <WeekGantt
              dates={week.dates}
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
                  days: week.dates.map((d) => ({
                    date: d,
                    shifts: shiftsByPressDate.get(`${p.name}|${d}`) ?? 0,
                    capacityMinutes: capacityByPressDate.get(`${p.name}|${d}`) ?? 0,
                  })),
                }),
              )}
              jobs={[
                ...week.jobs.map(
                  (j): WeekGanttJob => ({
                    date: j.date,
                    press: j.press,
                    material: j.material,
                    quantity: j.quantity,
                    late: j.late,
                    frozen: j.frozen,
                    setupStartMinute: j.setupStartMinute,
                    endMinute: j.endMinute,
                    segments: j.segments,
                  }),
                ),
                ...ganttMaintenance.filter((m) => week.dates.includes(m.date)),
              ]}
            />
          </div>

          {week.idlePresses.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              <strong className="text-foreground">Idle this week:</strong>{' '}
              {week.idlePresses.map((p) => `${p.name} (${p.reason})`).join(' · ')}
            </p>
          )}

          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Show job list ({week.jobs.length})
            </summary>
            <div className="mt-2 overflow-x-auto rounded-lg border border-border">
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      ))}

      {rawNeeds.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-foreground">
            Raw material requirement ({rawNeeds.length} items)
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Calculated from the planned quantity × gross weight per piece, and
            compared with unrestricted stock in raw material locations.
            Co-products are not counted twice — they come out of the same grams
            as the part they fall with.
          </p>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Raw material</th>
                  <th className="px-3 py-2 font-medium">Required (kg)</th>
                  <th className="px-3 py-2 font-medium">Stock (kg)</th>
                  <th className="px-3 py-2 font-medium">Short (kg)</th>
                  <th className="px-3 py-2 font-medium">Used by</th>
                </tr>
              </thead>
              <tbody>
                {rawNeeds.map((r) => (
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
