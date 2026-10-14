import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useState, type ReactNode } from 'react'

import { api } from '../../../convex/_generated/api'
import { pct } from '../../components/OeeCharts'
import { OeeControls, effectiveScope, useOeeConfig, useOeeSelection } from '../../components/OeePanel'
import { InfoTip, PageHeader } from '../../components/PageHeader'
import { useQuery } from '../../lib/convexTransport'
import { addDaysIso, areaNames, costCentersOf, dieTable, isoWeek, scopeLabel, type DayRow, type DieRow, type OrderRow } from '../../lib/oee'
import { relatedPages } from '../../lib/navigation'

export const Route = createFileRoute('/oee/dies')({
  component: DiesPage,
})

const minutes = (m: number) => (m >= 90 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m)} min`)

/**
 * Dies OEE Trend (Aksiyonlar sunumu, 2026-10-14): Losses Trend'deki kalıp
 * bölümü buraya taşındı. Seçilen haftanın en kötü kalıpları ve en çok hız
 * kaybı; altında aynı kalıpların son haftalardaki OEE'si. Kalıp OEE'si iyi
 * adetle ağırlıklı (Order Based KPI, dosyadaki TOTAL1 gibi).
 */
function DiesPage() {
  const sel = useOeeSelection()
  const { config } = useOeeConfig()
  const weeksN = config.trendWeeks || 10
  const top = config.topN || 10
  const trendFrom = addDaysIso(sel.monday, -7 * (weeksN - 1))
  const dayRows = (useQuery(api.oee.days, { from: trendFrom, to: sel.sunday }) ?? []) as DayRow[]
  const orders = (useQuery(api.oee.orders, { from: trendFrom, to: sel.sunday }) ?? []) as OrderRow[]
  const scope = effectiveScope(sel.scope, areaNames(dayRows, config))
  const label = scopeLabel(scope, config)
  const ccOf = useMemo(() => costCentersOf(dayRows), [dayRows])
  const [press, setPress] = useState('all')

  const weeks = useMemo(
    () =>
      Array.from({ length: weeksN }, (_, i) => {
        const monday = addDaysIso(sel.monday, -7 * (weeksN - 1 - i))
        const rows = dieTable(orders, scope, config, monday, addDaysIso(monday, 6), ccOf)
        return { label: `W${isoWeek(monday).week}`, byKey: new Map(rows.map((r) => [`${r.workCenter}|${r.equipment}`, r])) }
      }),
    [orders, scope, config, sel.monday, weeksN, ccOf],
  )
  const current = useMemo(() => [...(weeks[weeks.length - 1]?.byKey.values() ?? [])], [weeks])
  const presses = [...new Set(current.map((d) => d.workCenter))].sort()
  const list = current.filter((d) => press === 'all' || d.workCenter === press)
  const worst = [...list].filter((d) => d.weightedOee !== null).sort((a, b) => a.weightedOee! - b.weightedOee!).slice(0, top)
  const speed = [...list].sort((a, b) => b.speedLossMin - a.speedLossMin).filter((d) => d.speedLossMin > 0).slice(0, top)
  const dieName = (d: DieRow) => d.equipment || '(no die)'

  return (
    <div className="mx-auto w-full max-w-[297mm] px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Dies OEE Trend"
        summary="The dies of the selected week — worst OEE and most speed loss — and the same dies over the last weeks."
        links={relatedPages('/oee/dies')}
        info={
          <>
            <p>
              Die OEE is weighted by good quantity, as in the file: Σ(OEE × good) ÷ Σ good (Order Based KPI, TOTAL1). Speed loss = Production −
              Operation time of the die&apos;s orders.
            </p>
            <p>Needs the Shiftly Order Based KPI sheet in the uploaded file.</p>
          </>
        }
      />
      <OeeControls selection={sel} rows={dayRows} config={config} />

      {orders.length === 0 && (
        <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No order-based data for these weeks — upload the file with the Shiftly Order Based KPI sheet on{' '}
          <Link to="/oee/data" className="underline">
            OEE Data
          </Link>
          .
        </p>
      )}

      <section className="mt-6 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            Dies — W{sel.week.week} · {label}
            <InfoTip label="About die OEE">
              Die OEE is weighted by good quantity: Σ(OEE × good) ÷ Σ good. Speed loss = Production − Operation time of the die&apos;s orders.
            </InfoTip>
          </h2>
          <select value={press} onChange={(e) => setPress(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1 text-xs">
            <option value="all">All work centers</option>
            {presses.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-2 flex flex-wrap items-start gap-6">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Worst {top} dies by OEE</p>
            <Table
              head={['Die', 'Press', 'Orders', 'Good', 'Loading', 'OEE']}
              rows={worst.map((d) => [dieName(d), d.workCenter, String(d.orders), d.good.toLocaleString('en-GB'), minutes(d.loadingMin), pct(d.weightedOee)])}
            />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Most speed loss</p>
            <Table
              head={['Die', 'Press', 'Good', 'Speed loss', 'OEE']}
              rows={speed.map((d) => [dieName(d), d.workCenter, d.good.toLocaleString('en-GB'), minutes(d.speedLossMin), pct(d.weightedOee)])}
            />
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">
          OEE trend of these dies — last {weeksN} weeks <span className="text-xs font-normal text-muted-foreground">worst of W{sel.week.week} first</span>
        </h2>
        <Table
          head={['Die', 'Press', ...weeks.map((w) => w.label)]}
          rows={worst.map((d) => {
            const key = `${d.workCenter}|${d.equipment}`
            return [
              dieName(d),
              d.workCenter,
              ...weeks.map((w, i) => {
                const r = w.byKey.get(key)
                const v = r?.weightedOee ?? null
                return (
                  <span key={i} className={v === null ? 'text-muted-foreground' : v < 0.5 ? 'font-semibold text-destructive' : ''}>
                    {v === null ? '—' : pct(v)}
                  </span>
                )
              }),
            ]
          })}
        />
      </section>
    </div>
  )
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  if (!rows.length) return <p className="mt-2 text-xs text-muted-foreground">Nothing for this week.</p>
  return (
    <div className="mt-2 w-fit max-w-full overflow-auto rounded-md border border-border">
      <table className="w-auto text-xs">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            {head.map((h, i) => (
              <th key={i} className={`px-2 py-1.5 pr-4 font-medium whitespace-nowrap ${i < 2 ? 'text-left' : 'text-right'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {r.map((c, j) => (
                <td key={j} className={`px-2 py-1 pr-4 whitespace-nowrap ${j === 0 ? 'font-medium text-foreground' : ''} ${j < 2 ? '' : 'text-right tabular-nums'}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
