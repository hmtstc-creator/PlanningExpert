import { createFileRoute, Link } from '@tanstack/react-router'
import { usePaginatedQuery, useQuery } from '../lib/convexTransport'
import { useMemo } from 'react'

import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  const { results: products } = usePaginatedQuery(api.products.list, {}, { initialNumItems: 300 })
  const { results: weekly } = usePaginatedQuery(api.demand.listWeekly, {}, { initialNumItems: 300 })
  const { results: stockRows } = usePaginatedQuery(api.stock.list, {}, { initialNumItems: 500 })
  const { results: locations } = usePaginatedQuery(api.storageLocations.list, {}, { initialNumItems: 100 })
  const calendar = useQuery(api.workCalendar.get)
  const presses = (useQuery(api.presses.list) ?? []) as { name: string; hall: string }[]
  const snapshot = useQuery(api.planSnapshots.latest)

  const locCategory = useMemo(
    () => new Map(locations.map((l) => [l.code, l.category])),
    [locations],
  )

  const availableStock = useMemo(() => {
    let total = 0
    for (const s of stockRows) {
      const cat = s.storageLocation
        ? locCategory.get(s.storageLocation) ?? 'finished_goods'
        : 'finished_goods'
      if (cat === 'finished_goods' || cat === 'production_area') total += s.unrestricted ?? 0
    }
    return total
  }, [stockRows, locCategory])

  const productCodes = useMemo(() => new Set(products.map((p) => p.code)), [products])

  // Toplam bakiye (gecikmiş talep) — planın ilk önceliği budur.
  const backlogQty = useMemo(
    () => weekly.reduce((sum, w) => sum + Math.abs(w.overdue ?? 0), 0),
    [weekly],
  )

  // Ufuktaki toplam talep (ZPP kovalarının toplamı).
  const horizonDemandQty = useMemo(
    () =>
      weekly.reduce(
        (sum, w) => sum + w.periods.reduce((s, p) => s + Math.abs(p.qty), 0),
        0,
      ),
    [weekly],
  )

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

    const unknownMaterials = weekly.filter((w) => !productCodes.has(w.material))
    if (unknownMaterials.length > 0) {
      list.push({
        level: 'medium',
        text: `${unknownMaterials.length} materials in demand have no master data record — they are skipped in planning.`,
        link: '/referanslar',
      })
    }

    const undefinedLocs = new Set<string>()
    for (const s of stockRows) {
      if (s.storageLocation && !locCategory.has(s.storageLocation)) undefinedLocs.add(s.storageLocation)
    }
    if (undefinedLocs.size > 0) {
      list.push({
        level: 'medium',
        text: `${undefinedLocs.size} storage locations are not defined yet — they count as stock by default.`,
        link: '/depolar',
      })
    }

    if (!calendar) {
      list.push({
        level: 'medium',
        text: 'No work calendar defined — durations fall back to 8 hours/day.',
        link: '/takvim',
      })
    }

    if (presses.length === 0) {
      list.push({
        level: 'high',
        text: 'No presses defined — a plan cannot be produced.',
        link: '/makineler',
      })
    }

    const missingMaxShots = products.filter((p) => !p.maxShots).length
    if (missingMaxShots > 0) {
      list.push({
        level: 'medium',
        text: `${missingMaxShots} materials have no max shot limit — mold life cannot be tracked.`,
        link: '/kaliplar',
      })
    }

    const overdueCount = weekly.filter((w) => (w.overdue ?? 0) < 0).length
    if (overdueCount > 0) {
      list.push({
        level: 'high',
        text: `${overdueCount} materials have overdue demand.`,
        link: '/siparisler',
      })
    }

    return list
  }, [products, weekly, stockRows, locCategory, calendar, productCodes, presses])

  const dataReady = products.length > 0 && weekly.length > 0 && stockRows.length > 0

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground">Production Planning</h1>
      <p className="mt-2 text-muted-foreground">
        Press shop production planning — daily status overview
      </p>

      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Materials" value={products.length} hint="with a master data record" to="/referanslar" />
        <StatCard label="Presses" value={presses.length} hint={`${new Set(presses.map((p) => p.hall)).size} halls`} to="/makineler" />
        <StatCard
          label="Backlog"
          value={Math.round(backlogQty).toLocaleString('en-GB')}
          hint="overdue demand — the plan\u2019s first priority"
          to="/siparisler"
          danger={backlogQty > 0}
        />
        <StatCard
          label="Warnings"
          value={warnings.length}
          hint={warnings.some((w) => w.level === 'high') ? 'critical items' : 'review'}
          to="/planlama"
          danger={warnings.some((w) => w.level === 'high')}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Demand records" value={weekly.length} hint="ZPP materials" to="/siparisler" />
        <StatCard
          label="Demand in horizon"
          value={Math.round(horizonDemandQty).toLocaleString('en-GB')}
          hint="sum of ZPP buckets"
          to="/siparisler"
        />
        <StatCard
          label="Available stock"
          value={Math.round(availableStock).toLocaleString('en-GB')}
          hint="locations counted in planning"
          to="/stoklar"
        />
        <StatCard
          label="Approved plan"
          value={snapshot ? `${snapshot.jobCount} jobs` : 'none'}
          hint={
            snapshot
              ? new Date(snapshot.createdAt).toLocaleDateString('en-GB')
              : 'not approved yet'
          }
          to="/planlama"
        />
      </div>

      {warnings.length > 0 && (
        <section className="mt-8">
          <h2 className="font-semibold text-foreground">Needs attention</h2>
          <div className="mt-3 space-y-2">
            {warnings.map((w, i) => (
              <Link
                key={i}
                to={w.link ?? '/'}
                className={`flex items-start gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/40 ${
                  w.level === 'high' ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                <span className="mt-0.5">{w.level === 'high' ? '🔴' : '🟡'}</span>
                <span>{w.text}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-semibold text-foreground">Daily workflow</h2>
        <ol className="mt-3 space-y-2">
          <StepItem n={1} done={weekly.length > 0} title="Upload SAP data" desc="ZPP and ZPP_DAILY → Demand, MB52 → Stock" to="/siparisler" />
          <StepItem n={2} done={locations.length > 0} title="Check storage locations" desc="Which stock do we really have?" to="/depolar" />
          <StepItem n={3} done={presses.length > 0} title="Define presses" desc="Which press is in which hall — the crane constraint" to="/makineler" />
          <StepItem n={4} done={!!calendar} title="Verify the work calendar" desc="Shifts, working days, breaks, holidays" to="/takvim" />
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
    <Link to={to} className={`rounded-lg border p-4 transition-colors hover:bg-muted/40 ${danger ? 'border-red-200 bg-red-50' : 'border-border'}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${danger ? 'text-red-700' : 'text-foreground'}`}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </Link>
  )
}

function StepItem({ n, done, title, desc, to }: { n: number; done: boolean; title: string; desc: string; to: string }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40">
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
