import { createFileRoute, Link } from '@tanstack/react-router'

import type { DieAlarm, MachineAlarm } from '../lib/planAlarms'
import { usePlanAlarms } from '../lib/usePlanAlarms'

export const Route = createFileRoute('/alarms')({
  component: AlarmsPage,
})

/**
 * Planlamacının alarm sayfası. Kalıp ve makine takibi kendi modüllerinde;
 * burada yalnızca planı ilgilendiren taraf var:
 *  - üstte kritikler: kalıp/makine yüzünden müşteri bekleyecek,
 *  - altta bilgi: kullanılamıyor ama plan aksamıyor.
 */
function AlarmsPage() {
  const data = usePlanAlarms()
  const dies = data?.alarms.dies ?? []
  const machines = data?.alarms.machines ?? []
  const criticalDies = dies.filter((d) => d.critical)
  const infoDies = dies.filter((d) => !d.critical)
  const criticalMachines = machines.filter((m) => m.critical)
  const infoMachines = machines.filter((m) => !m.critical)

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Alarms</h1>
      <p className="mt-2 max-w-4xl text-muted-foreground">
        Dies and presses that cannot be used, checked against the plan. The top
        lists are the ones that make a delivery late — for example a die ready
        the day after tomorrow at 10:00 while 1 000 parts must ship tomorrow.
        The lists below are for information: the die or press is not available,
        but the plan is not held up. Updated with every plan calculation
        {data?.computedAt ? ` (last ${new Date(data.computedAt).toLocaleString('en-GB')})` : ''}.
      </p>

      {data === undefined && <p className="mt-6 text-sm text-muted-foreground">Loading…</p>}
      {data === null && (
        <p className="mt-6 text-sm text-muted-foreground">The plan has not been calculated yet.</p>
      )}

      {data && (
        <>
          <h2 className="mt-8 text-lg font-semibold text-foreground">Dies</h2>
          <DieTable
            title={`Holding up the plan (${criticalDies.length})`}
            empty="No die is holding up a delivery."
            tone="critical"
            rows={criticalDies}
          />
          <DieTable
            title={`For information — not ready, plan not affected (${infoDies.length})`}
            empty="Every die is available."
            tone="info"
            rows={infoDies}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Change readiness, dates and maintenance on{' '}
            <Link to="/die-followup/maintenance" className="underline">
              Die Follow-up → Maintenance &amp; readiness
            </Link>
            .
          </p>

          <h2 className="mt-10 text-lg font-semibold text-foreground">Machines</h2>
          <MachineTable
            title={`Holding up the plan (${criticalMachines.length})`}
            empty="No press breakdown or maintenance is holding up a delivery."
            tone="critical"
            rows={criticalMachines}
          />
          <MachineTable
            title={`For information — plan not affected (${infoMachines.length})`}
            empty="No press is down or booked for maintenance."
            tone="info"
            rows={infoMachines}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Report breakdowns and set the expected time a press is back on{' '}
            <Link to="/machine-followup/breakdowns" className="underline">
              Machine Follow-up → Breakdowns
            </Link>
            ; planned maintenance is on{' '}
            <Link to="/machine-followup/maintenance" className="underline">
              Machine Follow-up → Maintenance
            </Link>
            .
          </p>
        </>
      )}
    </div>
  )
}

function Frame({
  title,
  tone,
  children,
}: {
  title: string
  tone: 'critical' | 'info'
  children: React.ReactNode
}) {
  return (
    <div
      className={`mt-3 rounded-lg border ${
        tone === 'critical' ? 'border-destructive bg-destructive/5' : 'border-border'
      }`}
    >
      <h3
        className={`border-b px-4 py-2 text-sm font-semibold ${
          tone === 'critical' ? 'border-destructive/30 text-destructive' : 'border-border text-foreground'
        }`}
      >
        {tone === 'critical' ? '⚠ ' : 'ⓘ '}
        {title}
      </h3>
      {children}
    </div>
  )
}

function DieTable({
  title,
  empty,
  tone,
  rows,
}: {
  title: string
  empty: string
  tone: 'critical' | 'info'
  rows: DieAlarm[]
}) {
  return (
    <Frame title={title} tone={tone}>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Die</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Stock runs out</th>
                <th className="px-4 py-2 font-medium">Needed before it is ready</th>
                <th className="px-4 py-2 font-medium">Why</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={`${d.material}-${d.kind}-${d.label}`} className="border-t border-border align-top">
                  <td className="px-4 py-2 font-medium text-foreground">{d.material}</td>
                  <td className="px-4 py-2 text-foreground">{d.label}</td>
                  <td className="px-4 py-2 text-muted-foreground">{d.stockOut ?? '—'}</td>
                  <td className="px-4 py-2 tabular-nums text-muted-foreground">
                    {d.neededBefore > 0 ? `${Math.round(d.neededBefore).toLocaleString('en-GB')} pcs` : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{d.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Frame>
  )
}

function MachineTable({
  title,
  empty,
  tone,
  rows,
}: {
  title: string
  empty: string
  tone: 'critical' | 'info'
  rows: MachineAlarm[]
}) {
  return (
    <Frame title={title} tone={tone}>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Press</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Parts affected</th>
                <th className="px-4 py-2 font-medium">Why</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={`${m.press}-${m.kind}-${m.from}-${m.label}`} className="border-t border-border align-top">
                  <td className="px-4 py-2 font-medium text-foreground">{m.press}</td>
                  <td className="px-4 py-2 text-foreground">{m.label}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {m.affected.length === 0
                      ? '—'
                      : m.affected.slice(0, 8).map((a) => (
                          <span key={a.material} className="mr-2 inline-block">
                            <strong className="text-foreground">{a.material}</strong> stock out {a.stockOut} (
                            {a.issue === 'late' ? 'late' : 'cannot be planned'})
                          </span>
                        ))}
                    {m.affected.length > 8 && `+${m.affected.length - 8} more`}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{m.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Frame>
  )
}
