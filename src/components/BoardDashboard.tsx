import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { MiniTrend } from './KpiDashboard'
import { KpiPeriodPicker, defaultSlot } from './KpiPeriodPicker'
import { PageHeader } from './PageHeader'
import { useQuery } from '../lib/convexTransport'
import {
  BOARD_CARDS,
  BOARD_MEASURES,
  attention,
  childrenOf,
  measureOf,
  plantsInScope,
  seriesFor,
  verdict,
  type BoardPlant,
  type BoardScope,
} from '../lib/board'
import { formatKpi, periodTitle, type KpiMetrics, type KpiPeriod, type KpiResult, type KpiSlot } from '../lib/kpi'
import { usePlant } from '../lib/plantContext'
import { relatedPages } from '../lib/navigation'

/**
 * Board Dashboard: holding → şirket → plant → masraf yeri; seçili kapsamın
 * özet sonuçları, alt kırılım, ısı haritası ve dikkat listesi. Ölçü
 * (OEE, Efficiency, …) kullanıcı seçer. Salt okunur.
 */

const KEY = 'board-view'

function loadView(): { period: KpiPeriod; measure: keyof KpiMetrics } {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? 'null')
    if (v && (v.period === 'month' || v.period === 'week') && BOARD_MEASURES.some((m) => m.key === v.measure)) return v
  } catch {
    // Saklanamıyorsa varsayılan.
  }
  return { period: 'month', measure: 'oee' }
}

export function BoardDashboardPage() {
  const { ctx } = usePlant()
  const [view, setView] = useState(loadView)
  const setPeriod = (period: KpiPeriod) => {
    const next = { ...view, period }
    setView(next)
    setSlot(defaultSlot(period))
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // yalnızca bu oturum
    }
  }
  const setMeasure = (measure: keyof KpiMetrics) => {
    const next = { ...view, measure }
    setView(next)
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // yalnızca bu oturum
    }
  }
  const [slot, setSlot] = useState(() => defaultSlot(view.period))
  const [scope, setScope] = useState<BoardScope>({})
  const data = useQuery(api.board.overview, { period: view.period, year: slot.year, num: slot.num }) as { slots: KpiSlot[]; plants: BoardPlant[] } | undefined

  const slots = data?.slots ?? []
  const current = Math.max(0, slots.findIndex((s) => s.year === slot.year && s.num === slot.num))
  const plants = data?.plants ?? []
  const inScope = plantsInScope(plants, scope)
  const total = useMemo(() => (data ? seriesFor(inScope, slots) : []), [data, scope]) // eslint-disable-line react-hooks/exhaustive-deps
  const children = useMemo(() => (data ? childrenOf(plants, scope, slots) : []), [data, scope]) // eslint-disable-line react-hooks/exhaustive-deps
  const focus = useMemo(() => (data ? attention(plants, scope, slots, current, view.measure) : []), [data, scope, current, view.measure]) // eslint-disable-line react-hooks/exhaustive-deps

  const holdingName = ctx?.holdingName ?? plants.find((p) => p.holdingName)?.holdingName ?? null
  const company = plants.find((p) => p.companyId === scope.companyId)
  const plant = plants.find((p) => p.plantId === scope.plantId)
  const rootLabel = holdingName ?? (new Set(plants.map((p) => p.companyId)).size > 1 ? 'All companies' : (plants[0]?.companyName ?? 'All'))
  const childLevel = scope.plantId ? 'Cost center' : scope.companyId ? 'Plant' : 'Company'
  const m = measureOf(view.measure)

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title="Board Dashboard"
        summary="Results and trends — group, company, plant and cost center at a glance."
        links={relatedPages('/board')}
        info={
          <>
            <p>
              Start at the whole group and click a row to go one level down: company → plant → cost center. The cards show
              the selected scope; the table, heat map and attention list its next level.
            </p>
            <p>
              Totals add hours and pieces first and calculate every ratio once — never an average of percentages. A group
              total uses each company's own plan. Actual OEE comes from the OEE data.
            </p>
            <p>Green ▲ / red ▼: better / worse than plan in the direction of the measure. Grey: no plan.</p>
          </>
        }
      />

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border p-3 text-sm">
        <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Period">
          {(['month', 'week'] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={view.period === p}
              onClick={() => setPeriod(p)}
              className={`rounded px-3 py-1 text-xs font-semibold ${view.period === p ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'}`}
            >
              {p === 'month' ? 'Monthly' : 'Weekly'}
            </button>
          ))}
        </div>
        <KpiPeriodPicker period={view.period} value={slot} onChange={setSlot} />
        <label className="text-xs text-muted-foreground">
          Measure (table, heat map, attention)
          <select className="mt-1 block rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground" value={view.measure} onChange={(e) => setMeasure(e.target.value as keyof KpiMetrics)}>
            {BOARD_MEASURES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <nav className="mt-4 flex flex-wrap items-center gap-1 text-sm" aria-label="Scope">
        <button type="button" className={scope.companyId ? 'underline' : 'font-semibold'} onClick={() => setScope({})}>
          {rootLabel}
        </button>
        {company && (
          <>
            <span className="text-muted-foreground">▸</span>
            <button type="button" className={scope.plantId ? 'underline' : 'font-semibold'} onClick={() => setScope({ companyId: company.companyId })}>
              {company.companyName}
            </button>
          </>
        )}
        {plant && (
          <>
            <span className="text-muted-foreground">▸</span>
            <span className="font-semibold">{plant.plantName}</span>
          </>
        )}
        <span className="ml-2 text-xs text-muted-foreground">· {periodTitle(view.period, slot.year, slot.num)}</span>
      </nav>

      {!data ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : plants.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No plant with KPI or OEE permission.</p>
      ) : (
        <div className="kpi-paper mt-4 space-y-4 rounded-lg p-4">
          <section className="board-cards">
            {BOARD_CARDS.map((key) => (
              <BoardCard key={key} measure={key} series={total} slots={slots} current={current} />
            ))}
          </section>

          <section>
            <h2 className="text-sm font-semibold">
              {m.label} by {childLevel.toLowerCase()} — {periodTitle(view.period, slot.year, slot.num)}
            </h2>
            <BreakdownTable nodes={children} measure={view.measure} slots={slots} current={current} level={childLevel} onDrill={setScope} />
          </section>

          <section>
            <h2 className="text-sm font-semibold">
              Heat map — {m.label}, {view.period === 'month' ? `${slot.year} by month` : 'last 13 weeks'}
            </h2>
            <HeatMap nodes={children} measure={view.measure} slots={slots} current={current} level={childLevel} />
          </section>

          <section>
            <h2 className="text-sm font-semibold">Attention — {m.label}</h2>
            {focus.length === 0 ? (
              <p className="mt-1 text-sm" style={{ color: 'var(--kpi-muted)' }}>
                Nothing below plan and nothing worsening three periods in a row.
              </p>
            ) : (
              <ol className="mt-1 space-y-1 text-sm">
                {focus.map((f) => (
                  <li key={f.label} className="flex flex-wrap items-baseline gap-2">
                    <b>{f.label}</b>
                    <span className="tabular-nums">
                      {formatKpi(f.result.actual[view.measure], m.unit)} vs plan {formatKpi(f.result.plan[view.measure], m.unit)}
                    </span>
                    {f.rel !== null && f.rel < 0 && <span className="kpi-bad">▼ {(Math.abs(f.rel) * 100).toFixed(1)}% worse than plan</span>}
                    {f.declining && <span className="kpi-bad">↘ worse three periods in a row</span>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function BoardCard({ measure, series, slots, current }: { measure: keyof KpiMetrics; series: KpiResult[]; slots: KpiSlot[]; current: number }) {
  const row = measureOf(measure)
  const r = series[current]
  if (!r) return null
  const { gap, good } = verdict(r, measure)
  const gapText = gap === null ? '—' : `${gap > 0 ? '▲ +' : gap < 0 ? '▼ ' : ''}${row.unit === '%' ? `${(gap * 100).toFixed(1)} pts` : formatKpi(gap, row.unit)}`
  return (
    <div className="kpi-card">
      <div className="kpi-card-label">{row.card ?? row.label}</div>
      <div className="kpi-card-main">
        <span className="kpi-card-value">{formatKpi(r.actual[measure], row.unit)}</span>
        <span className="kpi-card-plan">plan {formatKpi(r.plan[measure], row.unit)}</span>
      </div>
      <div className={`kpi-card-gap ${good === null ? '' : good ? 'kpi-good' : 'kpi-bad'}`}>
        {gapText}
        {good !== null && <span> {good ? 'better' : 'worse'}</span>}
      </div>
      <div className="board-trend">
        <MiniTrend slots={slots} actual={series.map((x) => x.actual[measure])} plan={series.map((x) => x.plan[measure])} current={current} unit={row.unit} label={row.label} />
      </div>
    </div>
  )
}

function BreakdownTable({
  nodes,
  measure,
  slots,
  current,
  level,
  onDrill,
}: {
  nodes: ReturnType<typeof childrenOf>
  measure: keyof KpiMetrics
  slots: KpiSlot[]
  current: number
  level: string
  onDrill: (s: BoardScope) => void
}) {
  const row = measureOf(measure)
  if (!nodes.length) return <p className="mt-1 text-sm" style={{ color: 'var(--kpi-muted)' }}>No {level.toLowerCase()} defined.</p>
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="kpi-table" style={{ tableLayout: 'auto' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>{level}</th>
            <th>Actual</th>
            <th>Plan</th>
            <th>Gap</th>
            <th style={{ width: 300 }}>Trend</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => {
            const r = n.bySlot[current]
            const { gap, good } = verdict(r, measure)
            return (
              <tr key={n.key}>
                <td style={{ textAlign: 'left' }}>{n.label}</td>
                <td>{formatKpi(r.actual[measure], row.unit)}</td>
                <td>{formatKpi(r.plan[measure], row.unit)}</td>
                <td className={good === null ? '' : good ? 'kpi-good' : 'kpi-bad'}>
                  {gap === null ? '—' : `${gap > 0 ? '▲' : gap < 0 ? '▼' : ''} ${row.unit === '%' ? `${(gap * 100).toFixed(1)} pts` : formatKpi(gap, row.unit)}`}
                </td>
                <td style={{ height: 56, padding: 0 }}>
                  <div className="board-trend" style={{ width: 300, height: 56 }}>
                    <MiniTrend slots={slots} actual={n.bySlot.map((x) => x.actual[measure])} plan={n.bySlot.map((x) => x.plan[measure])} current={current} unit={row.unit} label={`${n.label} ${row.label}`} />
                  </div>
                </td>
                <td>
                  {n.drill && (
                    <button type="button" className="underline" onClick={() => onDrill(n.drill!)}>
                      open ›
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function HeatMap({ nodes, measure, slots, current, level }: { nodes: ReturnType<typeof childrenOf>; measure: keyof KpiMetrics; slots: KpiSlot[]; current: number; level: string }) {
  const row = measureOf(measure)
  if (!nodes.length) return null
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="kpi-table" style={{ tableLayout: 'auto' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>{level}</th>
            {slots.map((s, i) => (
              <th key={`${s.year}-${s.num}`} style={i === current ? { color: 'var(--kpi-ink)' } : { fontWeight: 500 }}>
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => (
            <tr key={n.key}>
              <td style={{ textAlign: 'left' }}>{n.label}</td>
              {n.bySlot.map((r, i) => {
                const { good } = verdict(r, measure)
                const a = r.actual[measure]
                return (
                  <td
                    key={i}
                    title={`${slots[i].label}: actual ${formatKpi(a, row.unit)} · plan ${formatKpi(r.plan[measure], row.unit)}`}
                    className={good === null ? '' : good ? 'kpi-heat-good' : 'kpi-heat-bad'}
                    style={i === current ? { fontWeight: 700 } : undefined}
                  >
                    {a === null ? '' : `${good === null ? '' : good ? '▲ ' : '▼ '}${formatKpi(a, row.unit)}`}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
