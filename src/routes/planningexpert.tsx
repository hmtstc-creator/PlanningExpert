import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '../lib/convexTransport'
import { Cockpit } from '../components/Cockpit'
import { useMemo } from 'react'

import { api } from '../../convex/_generated/api'
import { type LocationFlags } from '../lib/stockLocations'
import { PageHeader } from '../components/PageHeader'
import { relatedPages } from '../lib/navigation'

export const Route = createFileRoute('/planningexpert')({
  component: HomePage,
})

function HomePage() {
  // Bu sayfa sayı sayar ve uyarı üretir ("N malzemenin ana makinesi yok").
  // Sayfalı sorguyla bu sayılar sessizce yanlış çıkar: sınırın ötesindeki
  // malzeme hiç görülmez ve uyarı verilmez. Eksiksiz sorgular kullanılır.
  const productsResult = useQuery(api.products.listAll)
  const demandResult = useQuery(api.demand.listAllWeekly)
  const stockResult = useQuery(api.stock.listAll)
  const products = useMemo(() => productsResult?.rows ?? [], [productsResult])
  const weekly = useMemo(() => demandResult?.rows ?? [], [demandResult])
  const stockRows = useMemo(() => stockResult?.rows ?? [], [stockResult])
  const locations = (useQuery(api.storageLocations.listAll) ?? []) as LocationFlags[]

  const truncatedInputs = [
    productsResult && !productsResult.complete ? 'master data' : null,
    demandResult && !demandResult.complete ? 'demand' : null,
    stockResult && !stockResult.complete ? 'stock' : null,
  ].filter((v): v is string => v !== null)
  const calendar = useQuery(api.workCalendar.get)
  const presses = (useQuery(api.presses.list) ?? []) as { name: string; hall: string }[]
  const snapshot = useQuery(api.planSnapshots.latest)
  const shiftSettings = useQuery(api.pressCalendar.getGlobalSettings)
  const templates = (useQuery(api.pressCalendar.listTemplates) ?? []) as { press: string }[]

  // The calendar counts as configured only when both halves exist: the shared
  // shift settings and the work-calendar record holding working days and
  // holidays. Either one missing silently changes how capacity is computed.
  const calendarReady = !!calendar && !!shiftSettings

  // Toplam bakiye (gecikmiş talep) — planın ilk önceliği budur.
  const backlogQty = useMemo(
    () => weekly.reduce((sum, w) => sum + Math.abs(w.overdue ?? 0), 0),
    [weekly],
  )

  // Yalnızca planı engelleyen kurulum eksikleri (planlamacı, 2026-10-19: veri
  // sayıları ve bilgi uyarıları — talepte master data'sı olmayan malzeme,
  // tanımsız depo, max shot, bakiye — Overview'dan kaldırıldı; bakiye kendi
  // kartında, ayrıntılar kendi sayfalarında).
  const warnings = useMemo(() => {
    const list: { level: 'high' | 'medium'; text: string; link?: string }[] = []

    const missingMachine = products.filter((p) => !p.mainMachine || !p.mainMachine.trim())
    if (missingMachine.length > 0) {
      list.push({
        level: 'high',
        text: `${missingMachine.length} materials have no main machine set — they cannot be planned.`,
        link: '/referanslar',
      })
    }

    if (!calendarReady) {
      list.push({
        level: 'medium',
        text: !calendar && !shiftSettings
          ? 'Work calendar not saved yet — open Work Calendar and press "Save all settings".'
          : !shiftSettings
            ? 'Shift settings not saved yet — open Work Calendar and press "Save all settings".'
            : 'Working days and holidays not saved yet — open Work Calendar and press "Save all settings".',
        link: '/takvim',
      })
    }

    if (calendarReady && templates.length === 0) {
      list.push({
        level: 'medium',
        text: 'No work center has a weekly pattern yet — every work center defaults to 1 shift.',
        link: '/takvim',
      })
    }

    if (presses.length === 0) {
      list.push({
        level: 'high',
        text: 'No work centers defined — a plan cannot be produced.',
        link: '/makineler',
      })
    }

    return list
  }, [products, calendar, calendarReady, shiftSettings, templates, presses])

  const dataReady = products.length > 0 && weekly.length > 0 && stockRows.length > 0

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="PlanningExpert — Overview"
        summary="Plant production planning — daily status overview."
        links={relatedPages('/planningexpert')}
      />
      <Cockpit className="mt-4" />

      {truncatedInputs.length > 0 && (
        <p className="mt-4 rounded-lg border-2 border-destructive bg-destructive/10 p-3 text-sm text-foreground">
          <strong className="text-destructive">These numbers are incomplete.</strong>{' '}
          There are more rows in {truncatedInputs.join(', ')} than one query can
          read, so the counts and warnings below leave part of the data out.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard
          label="Backlog"
          value={Math.round(backlogQty).toLocaleString('en-GB')}
          hint="overdue demand — the plan’s first priority"
          to="/siparisler"
          danger={backlogQty > 0}
        />
        <StatCard
          label="Warnings"
          value={warnings.length}
          hint={warnings.length === 0 ? 'none — setup is complete' : 'setup the plan needs — see below'}
          to={warnings[0]?.link ?? '/planlama'}
          danger={warnings.some((w) => w.level === 'high')}
        />
        <StatCard
          label="Approved plan"
          value={snapshot ? `${snapshot.jobCount} jobs` : 'none'}
          hint={snapshot ? `approved ${new Date(snapshot.createdAt).toLocaleDateString('en-GB')}` : 'not approved yet'}
          to="/planlama"
        />
      </div>

      {warnings.length > 0 && (
        <section className="mt-6 space-y-2">
          {warnings.map((w, i) => (
            <Link
              key={i}
              to={w.link ?? '/planningexpert'}
              className={`flex items-start gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/40 ${
                w.level === 'high' ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}
            >
              <span className="mt-0.5">{w.level === 'high' ? '🔴' : '🟡'}</span>
              <span>{w.text}</span>
            </Link>
          ))}
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-foreground">Daily workflow</h2>
        <ol className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <StepItem n={1} done={weekly.length > 0} title="Upload SAP data" desc="ZPP and ZPP_DAILY → Demand, MB52 → Stock" to="/siparisler" />
          <StepItem n={2} done={locations.length > 0} title="Check storage locations" desc="Which stock do we really have?" to="/depolar" />
          <StepItem n={3} done={presses.length > 0} title="Define work centers" desc="Which work center is in which hall — the crane constraint" to="/makineler" />
          <StepItem n={4} done={calendarReady} title="Verify the work calendar" desc="Shifts, working days, breaks, holidays — then Save all settings" to="/takvim" />
          <StepItem n={5} done={!!snapshot} title="Review and approve the plan" desc="The plan is generated automatically; you review and approve" to="/planlama" />
          <StepItem n={6} done={false} title="Upload actuals and compare" desc="MB51 → performance factor and mold life" to="/performans" />
        </ol>
      </section>

      {!dataReady && (
        <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          All three data sets are required for the system to work fully: master
          data, ZPP demand and MB52 stock.
        </p>
      )}
    </div>
  )
}

function StatCard({ label, value, hint, to, danger }: { label: string; value: number | string; hint: string; to: string; danger?: boolean }) {
  return (
    <Link to={to} className={`rounded-xl border p-4 transition-colors hover:bg-muted/40 ${danger ? 'border-red-200 bg-red-50' : 'border-border bg-card'}`}>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${danger ? 'text-red-700' : 'text-foreground'}`}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </Link>
  )
}

function StepItem({ n, done, title, desc, to }: { n: number; done: boolean; title: string; desc: string; to: string }) {
  return (
    <li>
      <Link to={to} className="flex h-full items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/40">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
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
