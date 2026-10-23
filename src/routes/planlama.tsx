import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery } from '../lib/convexTransport'
import { useMemo, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { plantClock } from '../lib/dates'
import { WeekGantt, type WeekGanttJob, type WeekGanttPress } from '../components/WeekGantt'
import { buildDayTimeline, netToClock, productionDayOf } from '../lib/shiftTimeline'
import { planMove, type MoveTarget } from '../lib/jobMove'
import type { PlanJob } from '../lib/planPipeline'
import { useCurrentUser } from '../lib/currentUser'
import { type PlanDataSources } from '../lib/sapUploads'
import { InfoTip, PageHeader } from '../components/PageHeader'
import { relatedPages } from '../lib/navigation'
import { PlanDataLine } from '../components/plan/PlanPanels'
import { PressStartPanel } from '../components/plan/PressStartPanel'
import { JobDialog, type JobDraft } from '../components/plan/JobDialog'
import { MoveDialog, type MoveDraft } from '../components/plan/MoveDialog'
import { dayMonth, minutesAgo, usePlanState } from '../components/plan/usePlanState'
/** Planın böldüğü lotun parça son eki: "W38 (1/2)". */
const SPLIT_SUFFIX = / \(\d+\/\d+\)$/

export const Route = createFileRoute('/planlama')({
  component: PlanlamaPage,
})

function PlanlamaPage() {
  // Plan sunucuda hesaplanıyor (convex/planEngine.ts) ve saklanıyor; sayfa
  // yalnızca son hesabı okur. Hesap yalnızca elle: "Calculate plan"
  // (planlamacı, 2026-10-07). Bu sayfa Gantt ve araçlarıdır; özet, tablolar ve
  // denetimler Overview'da (planlamacı, 2026-10-19).
  const { run, planStatus, latestSnapshot, nowMs, shiftMinutes, shiftStartMinute, engineJobs, weeks, recalculating, stale, failedLast } =
    usePlanState()
  const requestNow = useMutation(api.planRuns.requestNow)
  const approve = useMutation(api.planSnapshots.approve)
  const overrideRows = (useQuery(api.planOverrides.list) ?? []) as {
    _id: string
    material: string
    kind: string
    press?: string
    date?: string
    bucket?: string
    qty?: number
    note?: string
  }[]
  const setOverride = useMutation(api.planOverrides.set)
  const removeOverride = useMutation(api.planOverrides.remove)
  // Tek tek onaylanan (kilitli) işler.
  const jobLocks = (useQuery(api.planJobLocks.list) ?? []) as {
    _id: string
    material: string
    press: string
    date: string
    setupStartMinute: number
    approvedBy?: string
    createdAt: number
  }[]
  const lockByKey = useMemo(
    () => new Map(jobLocks.map((l) => [`${l.material}|${l.press}|${l.date}|${Math.round(l.setupStartMinute)}`, l])),
    [jobLocks],
  )
  // Grafikte işe tıklanınca açılan pencere: adet, tek iş onayı, hariç tut.
  const [jobDraft, setJobDraft] = useState<JobDraft | null>(null)
  // Sürükle-bırak ya da "Move…": işi başka pres / saate taşıyıp kilitlemek.
  const [moveDraft, setMoveDraft] = useState<MoveDraft | null>(null)
  const quantityRules = useMemo(
    () =>
      new Map(
        overrideRows
          .filter((o) => o.kind === 'quantity' && o.bucket && o.qty !== undefined)
          .map((o) => [`${o.material}|${o.bucket}`, { id: o._id, qty: o.qty! }]),
      ),
    [overrideRows],
  )

  const { name: currentUser } = useCurrentUser()
  const [approving, setApproving] = useState(false)
  const [approvedAt, setApprovedAt] = useState<string | null>(null)
  const [ovMaterial, setOvMaterial] = useState('')
  const [ovKind, setOvKind] = useState('priority')
  const [ovPress, setOvPress] = useState('')
  const [ovDate, setOvDate] = useState('')

  const inputsLoading = run === undefined
  const horizonWeeks = run?.horizonWeeks ?? 4
  const globalFrozenDays = run?.globalFrozenDays ?? 0
  const truncatedInputs = run?.truncatedInputs ?? []
  const presses = run?.presses ?? []
  const plannedStops = run?.plannedStops ?? []
  const unplanned = run?.unplanned ?? []
  const frozenCount = run?.frozenCount ?? 0
  const horizonStart = run?.horizonStart ?? ''
  const planChecksOk = (run?.audit?.ok ?? true) && (run?.validation?.summary.rulesBroken ?? 0) === 0
  const lateCount = run?.lateItems?.length ?? engineJobs.filter((j) => j.late).length

  const { date: todayIso, clockMinute: nowClockMinute } = productionDayOf(
    plantClock(nowMs, run?.timeZone),
    shiftStartMinute,
  )

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

  /** Grafikteki çubuğun plandaki işi ve (kilitliyse) kilidi. */
  const jobOf = (clicked: Pick<WeekGanttJob, 'material' | 'press' | 'date' | 'setupStartMinute'>) => {
    const job = allJobs.find(
      (j) =>
        j.material === clicked.material &&
        j.press === clicked.press &&
        j.date === clicked.date &&
        j.setupStartMinute === clicked.setupStartMinute,
    )
    if (!job) return null
    const lock = job.locked ? lockByKey.get(`${job.material}|${job.press}|${job.date}|${Math.round(job.setupStartMinute)}`) : undefined
    if (job.locked && !lock) return null
    return { job, lock }
  }
  const dayShapeOf = (press: string, date: string) => ({
    shifts: shiftsByPressDate.get(`${press}|${date}`) ?? 0,
    overtime: overtimeByPressDate.get(`${press}|${date}`),
  })
  const checkMove = (job: PlanJob, target: MoveTarget) =>
    planMove({
      segments: job.segments,
      target,
      days: allDates.map((d) => ({ date: d, capacityMinutes: capacityByPressDate.get(`${target.press}|${d}`) ?? 0 })),
      dayShape: dayShapeOf(target.press, target.date),
      shiftStartMinute,
      shiftMinutes,
      stops: plannedStops,
      now: { date: todayIso, clockMinute: nowClockMinute },
      // Yerinde kalanlar: kilitli / dondurulmuş işler ve bakım. Diğerleri yeniden hesapta kayar.
      fixedOnTarget: [
        ...allJobs.filter((j) => j !== job && j.press === target.press && (j.frozen || j.locked)).map((j) => j.segments),
        ...ganttMaintenance.filter((m) => m.press === target.press).map((m) => m.segments),
      ],
    })
  /** "Move…" penceresinin ilk değeri: işin şimdiki başlangıcı (geçmişteyse şu an). */
  const currentStart = (job: PlanJob): MoveTarget => {
    const clock = netToClock(job.setupStartMinute, buildDayTimeline(shiftStartMinute, shiftMinutes, dayShapeOf(job.press, job.date), plannedStops))
    const past = job.date < todayIso || (job.date === todayIso && clock < nowClockMinute)
    return past
      ? { press: job.press, date: todayIso, clockMinute: Math.ceil(nowClockMinute / 5) * 5 }
      : { press: job.press, date: job.date, clockMinute: Math.round(clock / 5) * 5 }
  }

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
          <span className="text-muted-foreground">No plan yet — press Calculate plan.</span>
        ) : (
          <span className="text-muted-foreground">Loading the plan…</span>
        )}
        {recalculating && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Calculating…</span>
        )}
        {stale && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
            Data changed {minutesAgo(planStatus!.dataChangedAt!, nowMs)} — the plan is not up to date, press Calculate plan
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
          className={`ml-auto rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${stale || run === null ? 'bg-foreground text-background hover:opacity-90' : 'border border-input hover:bg-muted'}`}
        >
          {recalculating ? 'Calculating…' : 'Calculate plan'}
        </button>
      </div>

      {run && <PlanDataLine sources={(run as { dataSources?: PlanDataSources }).dataSources} />}

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

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void handleApprove()}
          disabled={
            approving ||
            engineJobs.length === 0 ||
            inputsLoading ||
            recalculating ||
            stale ||
            truncatedInputs.length > 0
          }
          title={
            truncatedInputs.length > 0
              ? 'Part of the data did not reach the planner'
              : inputsLoading
                ? 'Still loading the plan'
                : recalculating
                  ? 'Wait for the calculation to finish'
                  : stale
                    ? 'The data changed — press Calculate plan first'
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
        {run && (
          // Onaydan önce bakılacak özet; ayrıntılar Overview'da.
          <Link
            to="/planningexpert"
            className={`ml-auto rounded-md px-2.5 py-1 text-xs font-medium hover:underline ${
              planChecksOk ? 'bg-emerald-50 text-emerald-800' : 'bg-destructive/10 text-destructive'
            }`}
          >
            {planChecksOk ? 'Plan check: all rules hold ✓' : 'Plan check: rules broken — see Overview'}
            {` · ${lateCount} late · ${unplanned.length} unplanned`}
          </Link>
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
                  frequencyStop: p.frequencyStop,
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
                    bucketLabel: j.bucketLabel,
                    quantityFixed: !j.frozen && quantityRules.has(`${j.material}|${j.bucketLabel}`),
                    locked: j.locked,
                  }),
                ),
                ...ganttMaintenance,
              ]}
              onJobMove={(clicked, target) => {
                const found = jobOf(clicked)
                if (!found || (found.job.frozen && !found.job.locked)) return
                setMoveDraft({ job: found.job, lockId: found.lock?._id, target })
              }}
              onJobClick={(clicked) => {
                const found = jobOf(clicked)
                if (!found) return
                const { job, lock } = found
                // Lot: aynı malzeme + kova; kalıp ömrüyle ya da plan bölmesiyle
                // ("W38 (1/2)") bölünmüşse birden çok iş. Adet değişikliği lotun
                // tamamına uygulanır; motor bölmeyi yeniden dener.
                const lotLabel = job.bucketLabel.replace(SPLIT_SUFFIX, '')
                const lot = engineJobs.filter((j) => j.material === job.material && j.bucketLabel.replace(SPLIT_SUFFIX, '') === lotLabel)
                const lotQuantity = lot.reduce((sum, j) => sum + j.quantity, 0)
                const coils = lot.reduce((sum, j) => sum + (j.coilsNeeded ?? 0), 0)
                setJobDraft({
                  job,
                  bucket: lotLabel,
                  lotQuantity: lotQuantity || job.quantity,
                  lotJobCount: Math.max(1, lot.length),
                  piecesPerCoil: coils > 0 ? lotQuantity / coils : undefined,
                  override: quantityRules.get(`${job.material}|${lotLabel}`),
                  lock: lock && { id: lock._id, approvedBy: lock.approvedBy, createdAt: lock.createdAt },
                })
              }}
            />
            {jobDraft && (
              <JobDialog
                draft={jobDraft}
                onClose={() => setJobDraft(null)}
                onMove={() => {
                  const job = jobDraft.job
                  setJobDraft(null)
                  setMoveDraft({ job, lockId: jobDraft.lock?.id, target: currentStart(job) })
                }}
              />
            )}
            {moveDraft && (
              <MoveDialog
                draft={moveDraft}
                presses={presses.map((p) => ({ name: p.name, hall: p.hall }))}
                dates={allDates}
                shiftStartMinute={shiftStartMinute}
                check={(target) => checkMove(moveDraft.job, target)}
                currentUser={currentUser ?? undefined}
                onClose={() => setMoveDraft(null)}
              />
            )}
          </div>
        </div>
      )}

      <div id="plan-overrides" className="mt-6 scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          Plan overrides
          <InfoTip label="About plan overrides">
            The plan is always computed by the engine; the rules below are fed in as input, so your
            override persists but the plan still comes out of the engine. Click a job on the plan chart
            to change its lot quantity, approve (lock) just that job, or exclude the part.
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
                      ? `— excluded from planning${o.note ? ` (${o.note})` : ''}`
                      : o.kind === 'priority'
                        ? '— moved to front'
                        : o.kind === 'quantity'
                          ? `— lot ${o.bucket}: ${(o.qty ?? 0).toLocaleString('en-GB')} pcs`
                          : `— pinned to ${o.press}${o.date ? ` (${o.date})` : ''}`}
                  </span>
                </span>
                <button
                  onClick={() => {
                    if (window.confirm(`Remove this planning rule for ${o.material}?`)) {
                      void removeOverride({ id: o._id })
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
    </div>
  )
}
