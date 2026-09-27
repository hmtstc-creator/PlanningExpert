import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, type ReactNode } from 'react'

import { api } from '../../../convex/_generated/api'
import { OeeBarChart, PeriodTable, pct } from '../../components/OeeCharts'
import { OeeControls, useOeeSelection } from '../../components/OeePanel'
import { PageHeader } from '../../components/PageHeader'
import { useQuery } from '../../lib/convexTransport'
import {
  addDaysIso,
  areaOf,
  monthlyTrend,
  ratios,
  scopeLabel,
  totalsFor,
  weeklyTrend,
  weekShiftTrend,
  type MonthlyRow,
  type ShiftRow,
  type WeeklyRow,
} from '../../lib/oee'

export const Route = createFileRoute('/oee/')({
  component: OeeDashboard,
})

/** Kaç haftalık trend. */
const WEEKS = 10

function OeeDashboard() {
  const sel = useOeeSelection()
  const from = addDaysIso(sel.monday, -7 * (WEEKS - 1))
  const shifts = (useQuery(api.oee.shifts, { from, to: sel.sunday }) ?? []) as ShiftRow[]
  const periods = useQuery(api.oee.periods) as { weekly: WeeklyRow[]; monthly: MonthlyRow[] } | undefined
  const presses = (useQuery(api.presses.list) ?? []) as { name: string }[]
  const weekly = periods?.weekly ?? []
  const monthly = periods?.monthly ?? []

  const scopeRows = useMemo(() => [...shifts, ...weekly, ...monthly], [shifts, weekly, monthly])
  const month = useMemo(() => monthlyTrend(monthly, sel.scope), [monthly, sel.scope])
  const weeks = useMemo(() => weeklyTrend(shifts, weekly, sel.scope, sel.monday, WEEKS), [shifts, weekly, sel.scope, sel.monday])
  const week = useMemo(() => weekShiftTrend(shifts, sel.scope, sel.monday), [shifts, sel.scope, sel.monday])
  const day = ratios(totalsFor(shifts, sel.scope, sel.date, sel.date))
  const thisWeek = ratios(totalsFor(shifts, sel.scope, sel.monday, sel.sunday))
  const lastWeek = weeks.weeks.length > 1 ? weeks.weeks[weeks.weeks.length - 2] : null
  const known = new Set(presses.map((p) => p.name))
  // PRS için Press Definitions ile ad eşleşmesi; APR makineleri orada tanımlı değil.
  const unknown = new Set(
    [...new Set(shifts.map((s) => s.workCenter))].filter((wc) => areaOf(wc) === 'PRS' && presses.length > 0 && !known.has(wc)),
  )
  const label = scopeLabel(sel.scope)

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="OEE Dashboard"
        summary="Monthly, last 10 weeks and the selected week — OEE from summed times, never an average of percentages."
        links={[
          { to: '/oee/losses', label: 'Losses Trend' },
          { to: '/oee/data', label: 'Data' },
        ]}
        info={
          <>
            <p>
              <b>OEE = Availability × Performance × Quality</b>. Availability = Production time ÷ Loading
              time, Performance = Operation time ÷ Production time, Quality = Good ÷ (Good + Scrap +
              Reject).
            </p>
            <p>
              Every day, week, month and group adds up the times first and divides once. Days and
              weeks are calculated from Shiftly KPI; uploaded weekly rows (Weekly KPI, Weekly KPI_fix)
              are used for weeks they cover. Monthly comes from Monthly KPI as it is.
            </p>
            <p>
              Shifts: UB64 / UB61 = 1st, UB65 / UB62 = 2nd, UB66 / UB63 = 3rd. Cost centers: 51010171
              Transfer, 51010173 Progressive, 51010172 APR.
            </p>
          </>
        }
      />

      <OeeControls selection={sel} rows={scopeRows} />

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={`${label} · ${sel.date}`} value={pct(day.oee)} hint={`A ${pct(day.availability)} · P ${pct(day.performance)}`} />
        <Tile label={`${label} · W${sel.week.week}`} value={pct(thisWeek.oee)} hint={`A ${pct(thisWeek.availability)} · P ${pct(thisWeek.performance)}`} />
        <Tile
          label="Previous week"
          value={pct(lastWeek?.oee)}
          hint={
            lastWeek?.oee !== null && lastWeek?.oee !== undefined && thisWeek.oee !== null
              ? `${thisWeek.oee >= lastWeek.oee ? '▲' : '▼'} ${((thisWeek.oee - lastWeek.oee) * 100).toFixed(1)} pts this week`
              : ''
          }
        />
        <Tile label="Quality" value={pct(thisWeek.quality)} hint="Good ÷ (good + scrap + reject)" />
      </div>

      {shifts.length === 0 && monthly.length === 0 && (
        <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No OEE data for this period yet. Upload the file with <b>Upload data</b>.
        </p>
      )}

      <Section title={`Monthly OEE — ${label}`} note="Monthly KPI, as uploaded">
        <OeeBarChart points={month.months} ariaLabel={`Monthly OEE ${label}`} />
        <PeriodTable total={month.months} rows={[...month.byWorkCenter]} unknown={unknown} />
      </Section>

      <Section title={`Last ${WEEKS} weeks — ${label}`} note={`up to W${sel.week.week}`}>
        <OeeBarChart points={weeks.weeks} ariaLabel={`Weekly OEE ${label}`} />
        <PeriodTable total={weeks.weeks} rows={[...weeks.byWorkCenter]} unknown={unknown} />
      </Section>

      <Section title={`Week W${sel.week.week} by shift — ${label}`} note={`${sel.monday} – ${sel.sunday}`}>
        <OeeBarChart points={week.slots} ariaLabel={`Shift OEE week ${sel.week.week} ${label}`} />
        <PeriodTable total={week.slots} rows={[...week.byWorkCenter]} unknown={unknown} />
      </Section>

      <p className="mt-6 text-xs text-muted-foreground">
        Losses behind these numbers: <Link to="/oee/losses" className="underline">Losses Trend</Link>.
      </p>
    </div>
  )
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mt-6 rounded-lg border border-border p-4">
      <h2 className="flex flex-wrap items-baseline gap-x-3 text-sm font-semibold text-foreground">
        {title}
        {note && <span className="text-xs font-normal text-muted-foreground">{note}</span>}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  )
}
