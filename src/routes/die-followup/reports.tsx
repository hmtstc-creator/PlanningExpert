import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { MaterialPicker } from '../../components/MaterialPicker'
import { ModuleStat } from '../../components/ModuleStat'
import { ParetoChart } from '../../components/ParetoChart'
import { ProblemMatrix } from '../../components/ProblemMatrix'
import { useQuery } from '../../lib/convexTransport'
import { groupBy, inRange } from '../../lib/problemReport'

export const Route = createFileRoute('/die-followup/reports')({
  component: DieReports,
})

type Problem = {
  material: string
  operation: string
  problemType: string
  occurredAt: string
  status: string
  downtimeMinutes?: number
}

function DieReports() {
  const problems = (useQuery(api.moldProblems.list) ?? []) as Problem[]
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [die, setDie] = useState('')

  const dieOptions = useMemo(
    () => Array.from(new Set(problems.map((p) => p.material))).sort().map((code) => ({ code })),
    [problems],
  )
  const rows = useMemo(() => {
    const ranged = inRange(problems, from, to)
    return die ? ranged.filter((p) => p.material === die) : ranged
  }, [problems, from, to, die])

  const count = (keyOf: (p: Problem) => string) =>
    groupBy(rows, keyOf).map((g) => ({ key: g.key, value: g.count }))
  const downtime = (keyOf: (p: Problem) => string) =>
    groupBy(rows, keyOf).map((g) => ({ key: g.key, value: g.downtimeMinutes }))

  const open = rows.filter((p) => p.status === 'open').length
  const lost = rows.reduce((s, p) => s + (p.downtimeMinutes ?? 0), 0)
  const dies = new Set(rows.map((p) => p.material)).size
  const inputClass = 'mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm'

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Die Reports</h1>
      <p className="mt-1 text-muted-foreground">
        Which dies fail, how often and why. Blue bars are the few that make up
        80% of the total — start there. Click a die to see only its problems.
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
          <span className="block text-xs text-muted-foreground">Die</span>
          <div className="mt-1 w-56">
            <MaterialPicker options={dieOptions} value={die} onChange={setDie} placeholder="All dies" />
          </div>
        </label>
        {(from || to || die) && (
          <button
            onClick={() => {
              setFrom('')
              setTo('')
              setDie('')
            }}
            className="mb-0.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ModuleStat label="Problems" value={rows.length} />
        <ModuleStat label="Still open" value={open} tone={open > 0 ? 'warn' : 'neutral'} />
        <ModuleStat label="Production lost" value={`${lost.toLocaleString('en-GB')} min`} />
        <ModuleStat label="Dies affected" value={dies} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ParetoChart
          title="Problems by die"
          unit="problems"
          groups={count((p) => p.material)}
          selected={die}
          onSelect={(key) => setDie(die === key ? '' : key)}
        />
        <ParetoChart title="Problems by type" unit="problems" groups={count((p) => p.problemType)} />
        <ParetoChart title="Problems by operation" unit="problems" groups={count((p) => p.operation)} />
        <ParetoChart
          title="Production lost by die"
          unit="min"
          groups={downtime((p) => p.material)}
          selected={die}
          onSelect={(key) => setDie(die === key ? '' : key)}
        />
      </div>

      <div className="mt-4">
        <ProblemMatrix
          title="Which die, how many times, for which problem"
          rows={rows}
          rowKey={(p) => p.material}
          colKey={(p) => p.problemType}
          rowLabel="Die"
        />
      </div>
    </div>
  )
}
