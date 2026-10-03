import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery } from '../lib/convexTransport'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { isoWeekLabel, plantClock } from '../lib/dates'
import { WeekGantt, type WeekGanttJob, type WeekGanttPress } from '../components/WeekGantt'
import { productionDayOf } from '../lib/shiftTimeline'
import { useCurrentUser } from '../lib/currentUser'
import { diffPlans } from '../lib/planDiff'
import { groupPlanWeeks, RAW_URGENT_DAYS, type PlanRun, type SnapshotJob } from '../lib/planPipeline'
import { fixForUnplanned } from '../lib/unplannedFix'
import { type PlanDataSources } from '../lib/sapUploads'
import { SETTINGS_DEFAULTS } from '../lib/settingsDefaults'
import { InfoTip, PageHeader } from '../components/PageHeader'
import { relatedPages } from '../lib/navigation'
import { formatClock } from '../components/plan/format'
import { DataCoveragePanel } from '../components/plan/DataCoveragePanel'
import { DecisionCell, LateJobs } from '../components/plan/LateJobs'
import { IndependentCheck, OptimisationPanel } from '../components/plan/PlanChecks'
import { AlarmBanner, PlanCheck, PlanDataLine, Stat } from '../components/plan/PlanPanels'
import { PressStartPanel } from '../components/plan/PressStartPanel'
export const Route = createFileRoute('/planlama')({
  component: PlanlamaPage,
})

/**
 * Gün içi dakikayı gerçek saate çevirir. `shiftStartMinute` birinci
 * the start of the first shift (minutes from midnight, e.g. 480 = 08:00).
 * Vardiya numarası da ayrıca gösterilir.
 */
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
  const shiftMinutes = run?.shiftMinutes ?? SETTINGS_DEFAULTS.shiftMinutes
  const shiftStartMinute = run?.shiftStartMinute ?? SETTINGS_DEFAULTS.shiftStartMinute
  const capacityFactor = run?.capacityFactor ?? SETTINGS_DEFAULTS.capacityFactor
  const horizonWeeks = run?.horizonWeeks ?? 4
  const globalFrozenDays = run?.globalFrozenDays ?? 0
  const truncatedInputs = run?.truncatedInputs ?? []
  const presses = run?.presses ?? []
  const plannedStops = run?.plannedStops ?? []
  const warnings = run?.warnings ?? []
  const rawNeeds = run?.rawNeeds ?? []
  // Plan sayfasında yalnızca acil hammadde: ilk eksik iş RAW_URGENT_DAYS iş günü
  // içinde. Sınır motordan gelir (tek hesap); eski planlarda bugünden sayılır.
  const rawUrgentUntil = run?.rawUrgentUntil ?? run?.todayIso ?? ''
  const rawUrgentDays = run?.rawUrgentDays ?? RAW_URGENT_DAYS
  // Toplamda yetse de yoldaki rulo geç geliyorsa iş durur: ilk eksik iş esas.
  const shortRaw = rawNeeds.filter((r) => r.shortFrom)
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

  const { shiftsByPressDate, capacityByPressDate, overtimeByPressDate } = useMemo(() => {
    const shifts = new Map<string, number>()
    const capacity = new Map<string, number>()
    const overtime = new Map<string, { start: number; end: number; name?: string }[]>()
    for (const day of run?.days ?? []) {
      shifts.set(`${day.press}|${day.date}`, day.shifts)
      capacity.set(`${day.press}|${day.date}`, day.minutes)
      if (day.overtime?.length) overtime.set(`${day.press}|${day.date}`, day.overtime)
    }
    return { shiftsByPressDate: shifts, capacityByPressDate: capacity, overtimeByPressDate: overtime }
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
      <PageHeader
        title="Production Plan"
        summary={`Generated automatically — you review and approve. Horizon: ${horizonWeeks} weeks.`}
        links={relatedPages('/planlama')}
        info={
          <>
            <p>
              The plan is generated automatically: backlog first, then the materials whose stock
              runs out soonest, and the remaining capacity is filled with the rest of the demand.
              Crane constraints, mould limits and coil calculations are all applied. The planning
              horizon is changed on the <Link to="/takvim">Work Calendar</Link>.
            </p>
            <p>
              <b>Lot size: Min. lot if set, otherwise whole coils.</b> A mounted coil is run out, so
              quantities are rounded up to whole coils and the surplus covers the following weeks
              rather than triggering a second coil. Where a <b>Min. lot</b> is set in master data
              (e.g. transfer work centers), the lot is at least that many pieces and the coil is ignored.
              Parts with neither are planned to the exact need and flagged. A coil is never cut
              short, not even to save a late job — late jobs are moved forward instead. A co-product
              pair is one job: one stroke makes both parts.
            </p>
            <p>
              <Link to="/planlogic">Planning Logic</Link> explains every rule.
            </p>
          </>
        }
      />

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

      {thisWeekCapacity.full > 0 && (
        <p className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          This week ({isoWeekLabel(horizonMonday)}):{' '}
          <strong className="text-foreground">
            {Math.round(thisWeekCapacity.remaining / 60).toLocaleString('en-GB')} h
          </strong>{' '}
          still available of {Math.round(thisWeekCapacity.full / 60).toLocaleString('en-GB')} h —{' '}
          {Math.round(thisWeekCapacity.elapsed / 60).toLocaleString('en-GB')} h have already
          gone by.{' '}
          <InfoTip label="About this week's hours">
            Days that have passed and the hours already elapsed today are excluded from the plan.
          </InfoTip>
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
          {run?.frozenFrom ? new Date(run.frozenFrom).toLocaleString('en-GB') : ''}.{' '}
          <InfoTip label="About frozen jobs">
            They are taken from the approved plan instead of being recalculated, so the shop floor's
            preparation is not disturbed. They are drawn hatched below and the quantity they produce
            is deducted from the requirement. Change the frozen day count on the{' '}
            <Link to="/takvim">Work Calendar</Link>, or per work center on{' '}
            <Link to="/makineler">Work Center Definitions</Link>.
          </InfoTip>
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

      {(run?.pressesWithoutCalendar?.length ?? 0) > 0 && (
        <div className="mt-4 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm">
          <p className="font-semibold text-destructive">
            {run!.pressesWithoutCalendar!.length} work center(s) have no Work Calendar pattern:{' '}
            {run!.pressesWithoutCalendar!.join(', ')}
          </p>
          <p className="mt-1 text-xs text-foreground">
            These work centers get no capacity and nothing is planned on them until their days and shifts
            are defined on the{' '}
            <Link to="/takvim" className="underline">
              Work Calendar
            </Link>{' '}
            page.
          </p>
        </div>
      )}

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
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          Plan overrides
          <InfoTip label="About plan overrides">
            The plan is always computed by the engine; the rules below are fed in as input, so your
            override persists but the plan still comes out of the engine.
          </InfoTip>
        </h2>

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
              <option value="pin">Pin to work center</option>
              <option value="exclude">Exclude from planning</option>
            </select>
          </label>
          {ovKind === 'pin' && (
            <>
              <label className="text-sm">
                <span className="block text-xs text-muted-foreground">Work center</span>
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
            work center definitions
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
                    overtime: overtimeByPressDate.get(`${p.name}|${d}`),
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
                    <th className="px-3 py-2 font-medium">Work center</th>
                    <th className="px-3 py-2 font-medium">Material</th>
                    <th className="px-3 py-2 font-medium">Required</th>
                    <th className="px-3 py-2 font-medium">Qty</th>
                    <th className="px-3 py-2 font-medium">Shots</th>
                    <th className="px-3 py-2 font-medium">Coils</th>
                    <th className="px-3 py-2 font-medium">Setup start</th>
                    <th className="px-3 py-2 font-medium">End</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                    <th className="px-3 py-2 font-medium" title="Order in which the engine placed the job, and when each eligible work center would have finished it at that moment">
                      Why this work center
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
            Raw material — urgent ({urgentRaw.length}): coil stock runs out within the next {rawUrgentDays} working days
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {laterRaw > 0 && `${laterRaw} more run short later in the plan.`}
            <InfoTip label="About urgent raw material">
              Planned quantity × gross weight per piece, walked in plan order against the coil stock
              in MB52 (locations ticked Raw material on <Link to="/depolar">Storage Locations</Link>)
              plus the coils in transit from their arrival day. Only coils that stop a job in the
              next {rawUrgentDays} working days are listed (set on the{' '}
              <Link to="/takvim">Work Calendar</Link>). Co-products are not counted twice. The full
              requirement is on <Link to="/hammadde">Raw Material Coverage</Link>.
            </InfoTip>
          </p>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Raw material</th>
                  <th className="px-3 py-2 font-medium">Required (kg)</th>
                  <th className="px-3 py-2 font-medium">Stock (kg)</th>
                  <th className="px-3 py-2 font-medium">In transit (kg)</th>
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
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.inTransitKg ? Math.round(r.inTransitKg).toLocaleString('en-GB') : '—'}
                    </td>
                    <td className="px-3 py-2 font-medium text-destructive">
                      {r.shortageKg > 0
                        ? Math.round(r.shortageKg).toLocaleString('en-GB')
                        : 'in transit arrives too late'}
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
                  <th className="px-3 py-2 font-medium">Work centers tried</th>
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

function dayMonth(iso: string | undefined): string {
  if (!iso) return ''
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
