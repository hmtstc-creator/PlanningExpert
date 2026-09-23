import { createFileRoute, Link } from '@tanstack/react-router'
import { usePaginatedQuery } from '../lib/convexTransport'
import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/siparisler')({
  component: SiparislerPage,
})

function SiparislerPage() {
  const { results: weekly, status: weeklyStatus } = usePaginatedQuery(
    api.demand.listWeekly,
    {},
    { initialNumItems: 200 },
  )
  const { results: daily, status: dailyStatus } = usePaginatedQuery(
    api.demand.listDaily,
    {},
    { initialNumItems: 200 },
  )

  const [view, setView] = useState<'weekly' | 'daily'>('weekly')
  const [highRunnerThreshold, setHighRunnerThreshold] = useState('1500')

  const rows = view === 'weekly' ? weekly : daily
  const loading = view === 'weekly' ? weeklyStatus === 'LoadingFirstPage' : dailyStatus === 'LoadingFirstPage'

  const periodLabels = useMemo(() => {
    const first = rows.find((r) => r.periods.length > 0)
    return first ? first.periods.map((p) => p.label) : []
  }, [rows])

  const threshold = Number(highRunnerThreshold) || 0

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Demand</h1>
      <p className="mt-2 text-muted-foreground">
        Net requirements from the SAP ZPP (weekly) and ZPP_DAILY (daily)
        reports — negative values represent the shortfall that must be
        produced.
      </p>

      <p className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
        ZPP (weekly) and ZPP_DAILY (daily) demand is uploaded on the{' '}
        <Link to="/sapdata" className="font-medium text-foreground underline hover:no-underline">
          SAP Data
        </Link>{' '}
        page.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <div className="flex gap-2">
          <button
            onClick={() => setView('weekly')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === 'weekly' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
          >
            Weekly view
          </button>
          <button
            onClick={() => setView('daily')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === 'daily' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
          >
            Daily view
          </button>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-muted-foreground">High runner threshold (weekly avg. qty):</label>
          <input
            type="number"
            className="w-24 rounded-md border border-input bg-background px-2 py-1"
            value={highRunnerThreshold}
            onChange={(e) => setHighRunnerThreshold(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="sticky left-0 bg-muted px-3 py-2 font-medium">Materyal</th>
              <th className="px-3 py-2 font-medium">Stok</th>
              <th className="px-3 py-2 font-medium">Overdue</th>
              {view === 'weekly' && <th className="px-3 py-2 font-medium">Class</th>}
              {periodLabels.map((label) => (
                <th key={label} className="whitespace-nowrap px-3 py-2 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={4 + periodLabels.length}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={4 + periodLabels.length}>
                  No data uploaded yet.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const weeklyAvg =
                r.periods.length > 0
                  ? r.periods.reduce((s, p) => s + Math.abs(p.qty), 0) / r.periods.length
                  : 0
              const isHighRunner = weeklyAvg >= threshold
              return (
                <tr key={r._id} className="border-t border-border">
                  <td className="sticky left-0 bg-background px-3 py-2 font-medium text-foreground">
                    {r.material}
                  </td>
                  <td className="px-3 py-2 text-foreground">{r.stockInStorage ?? '—'}</td>
                  <td className={`px-3 py-2 ${((r.overdue ?? 0) < 0) ? 'text-destructive' : 'text-foreground'}`}>
                    {r.overdue ?? 0}
                  </td>
                  {view === 'weekly' && (
                    <td className="px-3 py-2">
                      {isHighRunner ? (
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                          High Runner
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Normal</span>
                      )}
                    </td>
                  )}
                  {r.periods.map((p, i) => (
                    <td
                      key={i}
                      className={`px-3 py-2 ${p.qty < 0 ? 'text-destructive' : 'text-muted-foreground'}`}
                    >
                      {p.qty}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
