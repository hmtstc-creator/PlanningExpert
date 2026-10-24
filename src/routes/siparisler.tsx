import { createFileRoute, Link } from '@tanstack/react-router'
import { usePaginatedQuery, useQuery } from '../lib/convexTransport'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { PageHeader } from '../components/PageHeader'
import { relatedPages } from '../lib/navigation'

export const Route = createFileRoute('/siparisler')({
  component: SiparislerPage,
})

function SiparislerPage() {
  const { results: weekly, status: weeklyStatus, loadMore: loadMoreWeekly } = usePaginatedQuery(
    api.demand.listWeekly,
    {},
    { initialNumItems: 200 },
  )
  const { results: daily, status: dailyStatus, loadMore: loadMoreDaily } = usePaginatedQuery(
    api.demand.listDaily,
    {},
    { initialNumItems: 200 },
  )

  const [view, setView] = useState<'weekly' | 'daily'>('weekly')
  const [highRunnerThreshold, setHighRunnerThreshold] = useState('1500')

  const [search, setSearch] = useState('')
  const term = search.trim().toLowerCase()
  // Sayfa ilk 200 satırı yükler; filtre yazılınca kalan sayfalar da yüklenir ki eşleşme kaçmasın.
  const status = view === 'weekly' ? weeklyStatus : dailyStatus
  useEffect(() => {
    if (!term || status !== 'CanLoadMore') return
    if (view === 'weekly') loadMoreWeekly(200)
    else loadMoreDaily(200)
  }, [term, status, view, loadMoreWeekly, loadMoreDaily])

  const allRows = view === 'weekly' ? weekly : daily
  const rows = term ? allRows.filter((r) => r.material.toLowerCase().includes(term)) : allRows
  // Stok sütunu planın kullandığı stok: MB52, parçanın cost center'ının
  // depoları (tanımı yoksa "Finished goods" tikli depolar). ZPP'nin kendi
  // "Stock in storage" değeri farklı bir kaynaktır ve planda kullanılmaz;
  // iki ayrı sayı göstermemek için burada da yok.
  const stockResult = useQuery(api.stock.planStock) as { rows: { material: string; quantity: number }[] } | undefined
  const planStock = useMemo(
    () => new Map<string, number>((stockResult?.rows ?? []).map((r) => [r.material, r.quantity])),
    [stockResult],
  )
  const loading = view === 'weekly' ? weeklyStatus === 'LoadingFirstPage' : dailyStatus === 'LoadingFirstPage'

  const periodLabels = useMemo(() => {
    const first = allRows.find((r) => r.periods.length > 0)
    return first ? first.periods.map((p) => p.label) : []
  }, [allRows])

  const threshold = Number(highRunnerThreshold) || 0

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Demand"
        summary="Net requirements from ZPP (weekly) and ZPP_DAILY (daily)."
        links={relatedPages('/siparisler')}
        info={
          <p>
            Negative values are the shortfall that must be produced. Both files are uploaded on{' '}
            <Link to="/sapdata">SAP Data</Link>. Where ZPP_DAILY covers a day it overrides the
            weekly ZPP; beyond it the weekly total is spread over the plant's working days.
          </p>
        }
      />


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
        <input
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          placeholder="Filter material…"
          aria-label="Filter material"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="sticky left-0 bg-muted px-3 py-2 font-medium">Material</th>
              <th className="px-3 py-2 font-medium" title="MB52 stock in the locations ticked Finished goods — the stock the plan uses">Stock (plan)</th>
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
                  {allRows.length > 0 ? 'No material matches the filter.' : 'No data uploaded yet.'}
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
                  <td className="px-3 py-2 text-foreground">{stockResult ? (planStock.get(r.material) ?? 0).toLocaleString('en-GB') : '…'}</td>
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
