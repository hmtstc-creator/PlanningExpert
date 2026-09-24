import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { ModuleStat } from '../../components/ModuleStat'
import { ParetoChart } from '../../components/ParetoChart'
import { ProblemMatrix } from '../../components/ProblemMatrix'
import { useQuery } from '../../lib/convexTransport'
import { groupBy, inRange } from '../../lib/problemReport'

export const Route = createFileRoute('/machine-followup/reports')({
  component: MachineReports,
})

type Breakdown = {
  press: string
  problemType: string
  occurredAt: string
  status: string
  stopsPress: boolean
  reportedAt: number
  solvedAt?: number
  downtimeMinutes?: number
}

function MachineReports() {
  const rows = (useQuery(api.machineProblems.list) ?? []) as Breakdown[]
  const presses = (useQuery(api.presses.list) ?? []) as { name: string }[]
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [press, setPress] = useState('')

  const filtered = useMemo(() => {
    const ranged = inRange(rows, from, to)
    return press ? ranged.filter((r) => r.press === press) : ranged
  }, [rows, from, to, press])

  const count = (keyOf: (r: Breakdown) => string) =>
    groupBy(filtered, keyOf).map((g) => ({ key: g.key, value: g.count }))
  const downtime = (keyOf: (r: Breakdown) => string) =>
    groupBy(filtered, keyOf).map((g) => ({ key: g.key, value: g.downtimeMinutes }))

  const open = filtered.filter((r) => r.status === 'open').length
  const lost = filtered.reduce((s, r) => s + (r.downtimeMinutes ?? 0), 0)
  // Ortalama çözüm süresi: bildirimden çözüme, yalnız çözülmüşler.
  const solved = filtered.filter((r) => r.solvedAt !== undefined)
  const meanHours =
    solved.length > 0
      ? solved.reduce((s, r) => s + (r.solvedAt! - r.reportedAt), 0) / solved.length / 3_600_000
      : null
  const inputClass = 'mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm'

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Machine Reports</h1>
      <p className="mt-1 text-muted-foreground">
        Which presses break down, how often and why. Blue bars are the few that
        make up 80% of the total — start there. Click a press to see only its
        breakdowns.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">From</span>
          <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">To</span>
          <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Press</span>
          <select className={inputClass} value={press} onChange={(e) => setPress(e.target.value)}>
            <option value="">All presses</option>
            {presses.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {(from || to || press) && (
          <button
            onClick={() => {
              setFrom('')
              setTo('')
              setPress('')
            }}
            className="mb-0.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ModuleStat label="Breakdowns" value={filtered.length} />
        <ModuleStat label="Still open" value={open} tone={open > 0 ? 'warn' : 'neutral'} />
        <ModuleStat label="Production lost" value={`${lost.toLocaleString('en-GB')} min`} />
        <ModuleStat
          label="Average time to solve"
          value={meanHours === null ? '—' : `${meanHours.toFixed(1)} h`}
          hint="From report to solution"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ParetoChart
          title="Breakdowns by press"
          unit="breakdowns"
          groups={count((r) => r.press)}
          selected={press}
          onSelect={(key) => setPress(press === key ? '' : key)}
        />
        <ParetoChart title="Breakdowns by type" unit="breakdowns" groups={count((r) => r.problemType)} />
        <ParetoChart
          title="Production lost by press"
          unit="min"
          groups={downtime((r) => r.press)}
          selected={press}
          onSelect={(key) => setPress(press === key ? '' : key)}
        />
        <ParetoChart title="Production lost by type" unit="min" groups={downtime((r) => r.problemType)} />
      </div>

      <div className="mt-4">
        <ProblemMatrix
          title="Which press, how many times, for which problem"
          rows={filtered}
          rowKey={(r) => r.press}
          colKey={(r) => r.problemType}
          rowLabel="Press"
        />
      </div>
    </div>
  )
}
