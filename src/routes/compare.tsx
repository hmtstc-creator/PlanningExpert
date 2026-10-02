import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { api } from '../../convex/_generated/api'
import { pct } from '../components/OeeCharts'
import { PageHeader } from '../components/PageHeader'
import { useQuery } from '../lib/convexTransport'

export const Route = createFileRoute('/compare')({
  component: ComparePage,
})

interface Cell {
  key: string
  label: string
  loadingMin: number
  availability: number | null
  performance: number | null
  oee: number | null
}

interface Row {
  plantId: string
  plantName: string
  companyName: string
  total: Omit<Cell, 'key' | 'label'>
  weeks: Cell[]
}

/**
 * Fabrika karşılaştırma (aşama 7, ilk sürüm): görebildiğiniz fabrikaların
 * haftalık OEE'si yan yana. İçerik planlamacıyla genişletilecek.
 */
function ComparePage() {
  const [date, setDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  })
  const [weeks, setWeeks] = useState(10)
  const data = useQuery(api.compare.oeeWeeks, { endDate: date, weeks }) as { weeks: { key: string; label: string }[]; plants: Row[] } | undefined
  const companies = new Set((data?.plants ?? []).map((p) => p.companyName))
  const best = (i: number) => Math.max(...(data?.plants ?? []).map((p) => p.weeks[i]?.oee ?? -1))

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title="Compare plants"
        summary="Weekly OEE of every plant you can see, side by side — summed times, then divided, the same in every plant."
        info={
          <>
            <p>Only plants where you have OEE permission are listed. The best plant of each week is in bold.</p>
            <p>A = Availability, P = Performance. Empty: no OEE data uploaded for that week.</p>
          </>
        }
      />
      <div className="mt-4 flex flex-wrap items-end gap-3 text-xs text-muted-foreground">
        <label>
          Up to
          <input type="date" className="mt-1 block rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <label>
          Weeks
          <input type="number" min={1} max={26} className="mt-1 block w-20 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground" value={weeks} onChange={(e) => setWeeks(Math.max(1, Math.min(26, Number(e.target.value) || 1)))} />
        </label>
      </div>
      {data && data.plants.length === 0 && <p className="mt-6 text-sm text-muted-foreground">No plant with OEE permission.</p>}
      {data && data.plants.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Plant</th>
                {data.weeks.map((w) => (
                  <th key={w.key} className="px-2 py-2 text-right font-medium">
                    {w.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">Period</th>
              </tr>
            </thead>
            <tbody>
              {data.plants.map((p) => (
                <tr key={p.plantId} className="border-t border-border">
                  <td className="px-3 py-2 whitespace-nowrap">{companies.size > 1 ? `${p.companyName} · ${p.plantName}` : p.plantName}</td>
                  {p.weeks.map((w, i) => (
                    <td key={w.key} className={`px-2 py-2 text-right tabular-nums ${w.oee !== null && w.oee === best(i) && data.plants.length > 1 ? 'font-bold' : ''}`} title={w.oee === null ? '' : `A ${pct(w.availability)} · P ${pct(w.performance)}`}>
                      {w.oee === null ? '' : pct(w.oee)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums" title={`A ${pct(p.total.availability)} · P ${pct(p.total.performance)}`}>
                    {pct(p.total.oee)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
