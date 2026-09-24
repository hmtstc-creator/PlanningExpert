import { createFileRoute, Link } from '@tanstack/react-router'

import { api } from '../../../convex/_generated/api'
import { ModuleStat } from '../../components/ModuleStat'
import { useQuery } from '../../lib/convexTransport'
import { isoDate, addDays } from '../../lib/dates'
import { usePlanAlarms } from '../../lib/usePlanAlarms'

export const Route = createFileRoute('/die-followup/')({
  component: DieOverview,
})

function DieOverview() {
  const problems = (useQuery(api.moldProblems.list) ?? []) as {
    _id: string
    material: string
    operation: string
    problemType: string
    occurredAt: string
    status: string
  }[]
  const readiness = (useQuery(api.moldReadiness.list) ?? []) as { material: string; ready: boolean }[]
  const alarms = (useQuery(api.moldAlarms.list) ?? []) as { material: string; status: string }[]
  const maintenance = (useQuery(api.moldMaintenance.list) ?? []) as {
    material: string
    date: string
    dateTo?: string
  }[]
  const plan = usePlanAlarms()

  const today = isoDate(new Date())
  const inTwoWeeks = isoDate(addDays(new Date(), 14))
  const open = problems.filter((p) => p.status === 'open')
  const notReady = readiness.filter((r) => !r.ready)
  const shotAlarms = alarms.filter((a) => a.status === 'open')
  const upcoming = maintenance.filter((m) => (m.dateTo ?? m.date) >= today && m.date <= inTwoWeeks)
  const critical = plan?.alarms.dies.filter((d) => d.critical) ?? []

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Die Follow-up</h1>
      <p className="mt-1 text-muted-foreground">
        Die problems, readiness, maintenance and shot counters in one place.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <ModuleStat
          label="Holding up the plan"
          value={critical.length}
          tone={critical.length > 0 ? 'critical' : 'neutral'}
          to="/alarms"
          hint="Customer would wait"
        />
        <ModuleStat
          label="Open problems"
          value={open.length}
          tone={open.length > 0 ? 'warn' : 'neutral'}
          to="/die-followup/problems"
        />
        <ModuleStat
          label="Dies not ready"
          value={notReady.length}
          tone={notReady.length > 0 ? 'warn' : 'neutral'}
          to="/die-followup/maintenance"
        />
        <ModuleStat
          label="Shot-limit alarms"
          value={shotAlarms.length}
          tone={shotAlarms.length > 0 ? 'warn' : 'neutral'}
          to="/die-followup/maintenance"
        />
        <ModuleStat label="Maintenance, next 14 days" value={upcoming.length} to="/die-followup/maintenance" />
      </div>

      {critical.length > 0 && (
        <div className="mt-6 rounded-lg border border-destructive bg-destructive/10 p-4">
          <h2 className="text-sm font-semibold text-destructive">Dies holding up the plan</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {critical.map((d) => (
              <li key={`${d.material}-${d.kind}`}>
                <strong className="text-foreground">{d.material}</strong>{' '}
                <span className="text-muted-foreground">
                  — {d.label}. {d.explanation}
                </span>
              </li>
            ))}
          </ul>
          <Link to="/alarms" className="mt-2 inline-block text-xs underline">
            All alarms in PlanningExpert →
          </Link>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-border p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-foreground">Open problems</h2>
          <Link to="/die-followup/problems" className="text-xs underline">
            Report or solve →
          </Link>
        </div>
        {open.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No open die problems.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border text-sm">
            {[...open]
              .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
              .slice(0, 8)
              .map((p) => (
                <li key={p._id} className="flex flex-wrap justify-between gap-2 py-1.5">
                  <span className="text-foreground">
                    <strong>{p.material}</strong> · {p.operation} · {p.problemType}
                  </span>
                  <span className="text-xs text-muted-foreground">{p.occurredAt}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  )
}
