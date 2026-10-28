import { createFileRoute, Link } from '@tanstack/react-router'
import { usePaginatedQuery } from '../lib/convexTransport'
import { Fragment, useEffect, useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { PageHeader } from '../components/PageHeader'
import { relatedPages } from '../lib/navigation'

export const Route = createFileRoute('/stoklar')({
  component: StoklarPage,
})

type StockLine = StockCols & { id: string; plant?: string; location?: string }

type StockCols = { unrestricted: number; quality: number; restricted: number; blocked: number; returns: number; transit: number }

const fmt = (n: number) => n.toLocaleString('en-GB', { maximumFractionDigits: 3 })

function StoklarPage() {
  const { results: rows, status, loadMore } = usePaginatedQuery(
    api.stock.list,
    {},
    { initialNumItems: 500 },
  )
  const [search, setSearch] = useState('')
  const term = search.trim().toLowerCase()
  // Arama yazılınca kalan sayfalar da yüklenir ki eşleşme kaçmasın.
  useEffect(() => {
    if (term && status === 'CanLoadMore') loadMore(500)
  }, [term, status, loadMore])

  // Tek tablo: malzeme başına depo satırları alt alta; birden çok depo varsa altında toplam satırı.
  const groups = useMemo(() => {
    const map = new Map<string, { material: string; total: StockCols; locations: StockLine[] }>()
    for (const r of rows) {
      if (term && !r.material.toLowerCase().includes(term)) continue
      const g = map.get(r.material) ?? {
        material: r.material,
        total: { unrestricted: 0, quality: 0, restricted: 0, blocked: 0, returns: 0, transit: 0 },
        locations: [] as StockLine[],
      }
      const line: StockLine = {
        id: r._id,
        plant: r.plant ?? undefined,
        location: r.storageLocation ?? undefined,
        unrestricted: r.unrestricted ?? 0,
        quality: r.qualityInspection ?? 0,
        restricted: r.restricted ?? 0,
        blocked: r.blocked ?? 0,
        returns: r.returns ?? 0,
        transit: r.transit ?? 0,
      }
      g.locations.push(line)
      for (const k of Object.keys(g.total) as (keyof StockCols)[]) g.total[k] += line[k]
      map.set(r.material, g)
    }
    const list = Array.from(map.values()).sort((a, b) => a.material.localeCompare(b.material))
    for (const g of list) g.locations.sort((a, b) => (a.location ?? '').localeCompare(b.location ?? ''))
    return list
  }, [rows, term])

  const cells = (c: StockCols, strong = false) => (
    <>
      <td className={`px-3 py-2 ${strong ? 'font-semibold text-foreground' : 'text-foreground'}`}>{fmt(c.unrestricted)}</td>
      <td className="px-3 py-2 text-muted-foreground">{fmt(c.quality)}</td>
      <td className="px-3 py-2 text-muted-foreground">{fmt(c.restricted)}</td>
      <td className="px-3 py-2 text-muted-foreground">{fmt(c.blocked)}</td>
      <td className="px-3 py-2 text-muted-foreground">{fmt(c.returns)}</td>
      <td className="px-3 py-2 text-muted-foreground">{fmt(c.transit)}</td>
    </>
  )

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Stock"
        summary="Stock from the SAP MB52 report, per material and storage location."
        links={relatedPages('/stoklar')}
        info={
          <p>
            Each row is one storage location of a material; a material held in more than one
            location gets a total row below its locations. MB52 is uploaded on{' '}
            <Link to="/sapdata">SAP Data</Link>; which locations count for the plan is set on{' '}
            <Link to="/depolar">Storage Locations</Link>.
          </p>
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          placeholder="Search material…"
          aria-label="Search material"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Material</th>
              <th className="px-3 py-2 font-medium">Plant</th>
              <th className="px-3 py-2 font-medium">Storage Location</th>
              <th className="px-3 py-2 font-medium">Unrestricted</th>
              <th className="px-3 py-2 font-medium">Quality inspection</th>
              <th className="px-3 py-2 font-medium">Restricted</th>
              <th className="px-3 py-2 font-medium">Blocked</th>
              <th className="px-3 py-2 font-medium">Returns</th>
              <th className="px-3 py-2 font-medium">Transit</th>
            </tr>
          </thead>
          <tbody>
            {status === 'LoadingFirstPage' && (
              <tr><td className="px-3 py-3 text-muted-foreground" colSpan={9}>Loading…</td></tr>
            )}
            {status !== 'LoadingFirstPage' && groups.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={9}>
                  {rows.length > 0 ? 'No material matches the search.' : 'No stock data uploaded yet.'}
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <Fragment key={g.material}>
                {g.locations.map((l, i) => (
                  <tr key={l.id} className={i === 0 ? 'border-t border-border' : ''}>
                    <td className="px-3 py-2 font-medium text-foreground">{i === 0 ? g.material : ''}</td>
                    <td className="px-3 py-2 text-muted-foreground">{l.plant ?? '—'}</td>
                    <td className="px-3 py-2 text-foreground">{l.location ?? '—'}</td>
                    {cells(l)}
                  </tr>
                ))}
                {g.locations.length > 1 && (
                  <tr className="bg-muted/40">
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-xs text-muted-foreground" colSpan={2}>
                      Total · {g.locations.length} locations
                    </td>
                    {cells(g.total, true)}
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
