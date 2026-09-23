import { createFileRoute, Link } from '@tanstack/react-router'
import { usePaginatedQuery } from '../lib/convexTransport'
import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/gerceklesen')({
  component: GerceklesenPage,
})

function GerceklesenPage() {
  const { results: rows, status } = usePaginatedQuery(
    api.actualProduction.list,
    {},
    { initialNumItems: 500 },
  )
  const [search, setSearch] = useState('')

  const byMaterial = useMemo(() => {
    const map = new Map<string, { qty: number; lastDate: string }>()
    for (const r of rows) {
      const current = map.get(r.material) ?? { qty: 0, lastDate: '' }
      map.set(r.material, {
        qty: current.qty + r.quantity,
        lastDate: r.postingDate > current.lastDate ? r.postingDate : current.lastDate,
      })
    }
    return Array.from(map.entries())
      .map(([material, v]) => ({ material, ...v }))
      .sort((a, b) => b.qty - a.qty)
  }, [rows])

  const filtered = byMaterial.filter((r) =>
    r.material.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Actual Production</h1>
      <p className="mt-2 text-muted-foreground">
        Movements from the SAP MB51 report. This data is used to compare
        actual production against the plan and to measure real press
        performance.
      </p>

      <p className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
        The MB51 movement report is uploaded on the{' '}
        <Link to="/sapdata" className="font-medium text-foreground underline hover:no-underline">
          SAP Data
        </Link>{' '}
        page.
      </p>

      <div className="mt-6 flex items-center gap-3">
        <input
          className="w-64 rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Search material…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-sm text-muted-foreground">
          {byMaterial.length} materials · {rows.length} movement rows
        </span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Materyal</th>
              <th className="px-3 py-2 font-medium">Total produced</th>
              <th className="px-3 py-2 font-medium">Son hareket</th>
            </tr>
          </thead>
          <tbody>
            {status === 'LoadingFirstPage' && (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={3}>
                  Loading…
                </td>
              </tr>
            )}
            {status !== 'LoadingFirstPage' && filtered.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={3}>
                  No MB51 data uploaded yet.
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.material} className="border-t border-border">
                <td className="px-3 py-2 font-medium text-foreground">{r.material}</td>
                <td className="px-3 py-2 text-foreground">
                  {r.qty.toLocaleString('en-GB')}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.lastDate ? new Date(r.lastDate).toLocaleDateString('en-GB') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
