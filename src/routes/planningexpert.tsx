import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo } from 'react'

import { api } from '../../convex/_generated/api'
import { Cockpit } from '../components/Cockpit'
import { PageHeader } from '../components/PageHeader'
import { DataCoveragePanel } from '../components/plan/DataCoveragePanel'
import { LateJobs } from '../components/plan/LateJobs'
import { IndependentCheck, OptimisationPanel } from '../components/plan/PlanChecks'
import { AlarmBanner, PlanCheck, PlanDataLine } from '../components/plan/PlanPanels'
import { PlanDiffPanel, PressPlanPanel, SectionTitle, UnplannedPanel, UrgentRawPanel } from '../components/plan/PlanTables'
import { dayMonth, minutesAgo, usePlanState } from '../components/plan/usePlanState'
import { useMutation, useQuery } from '../lib/convexTransport'
import { isoWeekLabel } from '../lib/dates'
import { relatedPages } from '../lib/navigation'
import { type PlanDataSources } from '../lib/sapUploads'
import { type LocationFlags } from '../lib/stockLocations'

export const Route = createFileRoute('/planningexpert')({
  component: HomePage,
})

/**
 * Overview: planın tam özeti (planlamacı, 2026-10-19). Bugünün kararları,
 * ana sayılar, geciken malzemeler, pres bazında plan, hammadde, planlanamayan
 * talep, onaylı plana göre değişiklik ve planın denetimleri burada; Production
 * Plan sayfasında yalnızca Gantt ve araçları kalır.
 */
function HomePage() {
  const { run, latestSnapshot, nowMs, engineJobs, planDiff, recalculating, stale, failedLast, planStatus } = usePlanState()
  const requestNow = useMutation(api.planRuns.requestNow)

  const demandResult = useQuery(api.demand.listAllWeekly)
  const weekly = useMemo(() => demandResult?.rows ?? [], [demandResult])
  const productsResult = useQuery(api.products.listAll)
  const stockResult = useQuery(api.stock.listAll)
  const locations = (useQuery(api.storageLocations.listAll) ?? []) as LocationFlags[]
  const calendar = useQuery(api.workCalendar.get)
  const shiftSettings = useQuery(api.pressCalendar.getGlobalSettings)
  const presses = (useQuery(api.presses.list) ?? []) as { name: string }[]
  const calendarReady = !!calendar && !!shiftSettings

  // Toplam bakiye (gecikmiş talep) — planın ilk önceliği budur.
  const backlogQty = useMemo(() => weekly.reduce((sum, w) => sum + Math.abs(w.overdue ?? 0), 0), [weekly])
  const plannedQty = engineJobs.reduce((s, j) => s + j.quantity, 0)
  const lateCount = run?.lateItems?.length ?? engineJobs.filter((j) => j.late).length
  const unplannedCount = run?.unplanned.length ?? 0
  const dates = run?.days.map((d) => d.date).sort() ?? []
  const week = run?.thisWeekCapacity
  const dataReady = (productsResult?.rows.length ?? 0) > 0 && weekly.length > 0 && (stockResult?.rows.length ?? 0) > 0

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Overview"
        summary="The plan at a glance: today's decisions, late materials, the plan per work center and its checks."
        links={relatedPages('/planningexpert')}
      />

      {/* Planın durumu */}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-sm">
        {run ? (
          <span className="text-muted-foreground">
            Plan calculated <strong className="text-foreground">{minutesAgo(run.computedAt, nowMs)}</strong>
            {dates.length > 0 && ` · ${dayMonth(dates[0])} – ${dayMonth(dates[dates.length - 1])}`} · {run.horizonWeeks} weeks
          </span>
        ) : run === null ? (
          <span className="text-muted-foreground">No plan yet — calculate one.</span>
        ) : (
          <span className="text-muted-foreground">Loading the plan…</span>
        )}
        {recalculating && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Calculating…</span>}
        {stale && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
            Data changed {minutesAgo(planStatus!.dataChangedAt!, nowMs)} — not up to date
          </span>
        )}
        {failedLast && <span className="text-xs text-destructive">Last calculation failed: {planStatus?.lastError}</span>}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => void requestNow({})}
            disabled={recalculating}
            className={`h-9 rounded-lg px-3 text-sm font-medium disabled:opacity-50 ${
              stale || run === null ? 'bg-foreground text-background hover:opacity-90' : 'border border-input hover:bg-muted'
            }`}
          >
            {recalculating ? 'Calculating…' : 'Calculate plan'}
          </button>
          <Link to="/planlama" className="flex h-9 items-center rounded-lg border border-input px-3 text-sm font-medium hover:bg-muted">
            Open plan chart →
          </Link>
        </div>
      </div>
      {run && <PlanDataLine sources={(run as { dataSources?: PlanDataSources }).dataSources} />}

      {(run?.truncatedInputs.length ?? 0) > 0 && (
        <p className="mt-4 rounded-lg border-2 border-destructive bg-destructive/10 p-3 text-sm text-foreground">
          <strong className="text-destructive">This plan is incomplete — do not approve it.</strong> There are more rows in{' '}
          {run!.truncatedInputs.join(', ')} than one query can read, so part of the data did not reach the planner.
        </p>
      )}
      {(run?.pressesWithoutCalendar?.length ?? 0) > 0 && (
        <p className="mt-4 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-foreground">
          <strong className="text-destructive">
            {run!.pressesWithoutCalendar!.length} work center(s) have no Work Calendar pattern: {run!.pressesWithoutCalendar!.join(', ')}.
          </strong>{' '}
          Nothing is planned on them until their days and shifts are set on the{' '}
          <Link to="/takvim" className="underline">
            Work Calendar
          </Link>
          .
        </p>
      )}

      <Cockpit className="mt-6" />

      {/* Ana sayılar */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Backlog" value={Math.round(backlogQty).toLocaleString('en-GB')} hint="overdue demand — the plan’s first priority" to="/siparisler" danger={backlogQty > 0} />
        <Kpi label="Late materials" value={lateCount} hint="not ready when needed" danger={lateCount > 0} to="#late" />
        <Kpi label="Unplanned" value={unplannedCount} hint="demand without a place" danger={unplannedCount > 0} to="#unplanned" />
        <Kpi label="Planned jobs" value={engineJobs.length.toLocaleString('en-GB')} hint={(run?.frozenCount ?? 0) > 0 ? `+ ${run!.frozenCount.toLocaleString('en-GB')} frozen or approved` : 'engine plan, none frozen'} to="#by-work-center" />
        <Kpi label="Planned qty" value={plannedQty.toLocaleString('en-GB')} hint="pcs in the horizon" to="#by-work-center" />
        <Kpi
          label="Approved plan"
          value={latestSnapshot ? `${latestSnapshot.jobCount} jobs` : 'none'}
          hint={latestSnapshot ? `approved ${new Date(latestSnapshot.createdAt).toLocaleDateString('en-GB')}` : 'not approved yet'}
          to="/planlama"
        />
      </div>
      {run && (week?.full ?? 0) > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          This week ({isoWeekLabel(new Date(`${run.horizonStart}T00:00:00`))}):{' '}
          <strong className="text-foreground">{Math.round(week!.remaining / 60).toLocaleString('en-GB')} h</strong> still available of{' '}
          {Math.round(week!.full / 60).toLocaleString('en-GB')} h.
          {run.capacityFactor !== 1 && ` Capacity adjusted by the measured attainment rate: ${Math.round(run.capacityFactor * 100)} %.`}
          {run.dailyUntil && ` Sales days from ZPP_DAILY up to ${run.dailyUntil}, then the weekly ZPP.`}
        </p>
      )}

      {run && (
        <>
          <div id="late" className="scroll-mt-20">
            <LateJobs run={run} jobs={engineJobs.filter((j) => j.late)} shiftMinutes={run.shiftMinutes} shiftStartMinute={run.shiftStartMinute} />
          </div>

          <div id="by-work-center" className="mt-6 scroll-mt-20">
            <PressPlanPanel run={run} />
          </div>

          {/* Boş olan kısa kalır: ikisinden biri boşsa yan yana, ikisi de doluysa alt alta (tablolar geniş). */}
          <div className={`mt-6 grid grid-cols-1 gap-6 ${run.unplanned.length === 0 || !run.rawNeeds.some((r) => r.shortFrom) ? 'lg:grid-cols-2' : ''}`}>
            <div id="unplanned" className="scroll-mt-20">
              <UnplannedPanel run={run} />
            </div>
            <UrgentRawPanel run={run} />
          </div>

          {planDiff && planDiff.changes.length > 0 && latestSnapshot && (
            <div className="mt-6">
              <PlanDiffPanel diff={planDiff} approvedAt={latestSnapshot.createdAt} />
            </div>
          )}
          {latestSnapshot?.truncated && (
            <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              The approved plan of {new Date(latestSnapshot.createdAt).toLocaleString('en-GB')} was too large to store in full,
              so it cannot be compared with the current plan. Approve again to get a comparable plan.
            </p>
          )}

          {/* Planın denetimleri */}
          <section className="mt-10">
            <SectionTitle title="Plan checks" />
            {run.alarms && <AlarmBanner alarms={run.alarms} />}
            {run.dataCoverage && <DataCoveragePanel coverage={run.dataCoverage} />}
            {run.warnings.length > 0 && (
              <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-medium text-amber-900">Engine notes</p>
                <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-amber-800">
                  {run.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {run.audit && <PlanCheck audit={run.audit} jobCount={run.jobs.length} />}
            {run.validation && <IndependentCheck v={run.validation} />}
            {run.optimisation && <OptimisationPanel opt={run.optimisation} />}
          </section>
        </>
      )}

      <section className="mt-10">
        <SectionTitle title="Daily workflow" />
        <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <StepItem n={1} done={weekly.length > 0} title="Upload SAP data" desc="ZPP and ZPP_DAILY → Demand, MB52 → Stock" to="/siparisler" />
          <StepItem n={2} done={locations.length > 0} title="Check storage locations" desc="Which stock do we really have?" to="/depolar" />
          <StepItem n={3} done={presses.length > 0} title="Define work centers" desc="Which work center is in which hall — the crane constraint" to="/makineler" />
          <StepItem n={4} done={calendarReady} title="Verify the work calendar" desc="Shifts, working days, breaks, holidays — then Save all settings" to="/takvim" />
          <StepItem n={5} done={!!latestSnapshot} title="Review and approve the plan" desc="The plan is generated automatically; you review and approve" to="/planlama" />
          <StepItem n={6} done={false} title="Upload actuals and compare" desc="MB51 → performance factor and mold life" to="/performans" />
        </ol>
      </section>

      {!dataReady && productsResult !== undefined && (
        <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          All three data sets are required for the system to work fully: master data, ZPP demand and MB52 stock.
        </p>
      )}
    </div>
  )
}

function Kpi({
  label,
  value,
  hint,
  to,
  danger,
}: {
  label: string
  value: number | string
  hint: string
  to: string
  danger?: boolean
}) {
  const cls = `block h-full rounded-xl border p-4 transition-colors hover:bg-muted/40 ${danger ? 'border-red-200 bg-red-50' : 'border-border bg-card'}`
  const body = (
    <>
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${danger ? 'text-red-700' : 'text-foreground'}`}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </>
  )
  // Sayfa içi bağlantı (#late …) yönlendirici değil, düz bağlantıdır.
  return to.startsWith('#') ? (
    <a href={to} className={cls}>
      {body}
    </a>
  ) : (
    <Link to={to} className={cls}>
      {body}
    </Link>
  )
}

function StepItem({ n, done, title, desc, to }: { n: number; done: boolean; title: string; desc: string; to: string }) {
  return (
    <li>
      <Link to={to} className="flex h-full items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/40">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            done ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'
          }`}
        >
          {done ? '✓' : n}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">{title}</span>
          <span className="block text-xs text-muted-foreground">{desc}</span>
        </span>
      </Link>
    </li>
  )
}
