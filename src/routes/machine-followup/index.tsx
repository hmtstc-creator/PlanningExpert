import { createFileRoute, Link } from '@tanstack/react-router'

import { api } from '../../../convex/_generated/api'
import { ModuleStat } from '../../components/ModuleStat'
import { useQuery } from '../../lib/convexTransport'
import { addDays, isoDate } from '../../lib/dates'
import { usePlanAlarms } from '../../lib/usePlanAlarms'

export const Route = createFileRoute('/machine-followup/')({
  component: MachineOverview,
})

function MachineOverview() {
  const breakdowns = (useQuery(api.machineProblems.list) ?? []) as {
    _id: string
    press: string
    problemType: string
    occurredAt: string
    stopsPress: boolean
    expectedUpDate?: string
    status: string
  }[]
  const maintenance = (useQuery(api.pressMaintenance.list) ?? []) as {
    press: string
    date: string
    status: string
  }[]
  const plan = usePlanAlarms()

  const today = isoDate(new Date())
  const inTwoWeeks = isoDate(addDays(new Date(), 14))
  const open = breakdowns.filter((b) => b.status === 'open')
  const down = open.filter((b) => b.stopsPress)
  const upcoming = maintenance.filter((m) => m.status === 'planned' && m.date >= today && m.date <= inTwoWeeks)
  const critical = plan?.alarms.machines.filter((m) => m.critical) ?? []

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Machine Follow-up</h1>
      <p className="mt-1 text-muted-foreground">Press breakdowns and maintenance in one place.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ModuleStat
          label="Holding up the plan"
          value={critical.length}
          tone={critical.length > 0 ? 'critical' : 'neutral'}
          to="/alarms"
          hint="Customer would wait"
        />
        <ModuleStat
          label="Presses down"
          value={down.length}
          tone={down.length > 0 ? 'critical' : 'neutral'}
          to="/machine-followup/breakdowns"
        />
        <ModuleStat
          label="Open breakdowns"
          value={open.length}
          tone={open.length > 0 ? 'warn' : 'neutral'}
          to="/machine-followup/breakdowns"
        />
        <ModuleStat label="Maintenance, next 14 days" value={upcoming.length} to="/machine-followup/maintenance" />
      </div>

      {critical.length > 0 && (
        <div className="mt-6 rounded-lg border border-destructive bg-destructive/10 p-4">
          <h2 className="text-sm font-semibold text-destructive">Presses holding up the plan</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {critical.map((m) => (
              <li key={`${m.press}-${m.kind}-${m.from}`}>
                <strong className="text-foreground">{m.press}</strong>{' '}
                <span className="text-muted-foreground">
                  — {m.label}. {m.explanation}
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
          <h2 className="text-sm font-semibold text-foreground">Open breakdowns</h2>
          <Link to="/machine-followup/breakdowns" className="text-xs underline">
            Report or solve →
          </Link>
        </div>
        {open.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No open breakdowns.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border text-sm">
            {[...open]
              .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
              .map((b) => (
                <li key={b._id} className="flex flex-wrap justify-between gap-2 py-1.5">
                  <span className="text-foreground">
                    <strong>{b.press}</strong> · {b.problemType}
                    {b.stopsPress ? (
                      <span className="ml-2 text-xs text-destructive">
                        down {b.expectedUpDate ? `until ${b.expectedUpDate}` : 'until solved'}
                      </span>
                    ) : (
                      <span className="ml-2 text-xs text-amber-700">running</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{b.occurredAt}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  )
}
