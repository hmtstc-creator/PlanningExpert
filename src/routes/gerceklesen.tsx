import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '../lib/convexTransport'
import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { PageHeader } from '../components/PageHeader'
import { relatedPages } from '../lib/navigation'

export const Route = createFileRoute('/gerceklesen')({
  component: GerceklesenPage,
})

function GerceklesenPage() {
  // Yalnızca üretim hareketleri: üretim deposuna (Storage Locations'ta
  // "Production receipt", varsayılan 2009) 101 girişleri eksi 102 iptalleri.
  const result = useQuery(api.actualProduction.listAll) as
    | { rows: { material: string; postingDate: string; quantity: number }[]; complete: boolean }
    | undefined
  const rows = useMemo(() => result?.rows ?? [], [result])
  const status = result === undefined ? 'LoadingFirstPage' : 'Exhausted'
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
      <PageHeader
        title="Actual Production"
        summary="Production from SAP MB51: 101 receipts minus 102 reversals."
        links={relatedPages('/gerceklesen')}
        info={
          <p>
            Only movements into the production receipt location count (ticked on{' '}
            <Link to="/depolar">Storage Locations</Link>, 2009 by default). Other movements are not
            production. The same figure feeds plan versus actual, press performance and the mould
            shot counters. MB51 is uploaded on <Link to="/sapdata">SAP Data</Link>.
          </p>
        }
      />


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
