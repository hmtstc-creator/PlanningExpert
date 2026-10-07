import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, type ReactNode } from 'react'

import { api } from '../../../convex/_generated/api'
import { OeeBarChart, PeriodTable } from '../../components/OeeCharts'
import { OeeControls, OeeDataNotice, effectiveScope, useOeeConfig, useOeeSelection } from '../../components/OeePanel'
import { PageHeader } from '../../components/PageHeader'
import { useQuery } from '../../lib/convexTransport'
import {
  addDaysIso,
  areaNames,
  inScope,
  monthlyTrend,
  scopeLabel,
  trendGaps,
  weeklyTrend,
  weekShiftTrend,
  type DayRow,
  type MonthlyRow,
  type ShiftRow,
  type WeeklyRow,
} from '../../lib/oee'
import { relatedPages } from '../../lib/navigation'
import { usePlant } from '../../lib/plantContext'
import { netShiftMinutes } from '../../lib/shifts'

export const Route = createFileRoute('/oee/')({
  component: OeeDashboard,
})

function OeeDashboard() {
  const sel = useOeeSelection()
  const { config } = useOeeConfig()
  // Kaç vardiya çalışıldı = Loading ÷ net vardiya süresi (vardiya − planlı duruşlar:
  // çay, yemek, toplantı; Company settings → Shifts ve Planning → Planned stops).
  const stops = useQuery(api.oee.plannedStopMinutes) as { shiftIndex: number; durationMinutes: number }[] | undefined
  const net = netShiftMinutes(usePlant().ctx?.active?.shifts, stops)
  const weeksN = config.trendWeeks || 1
  const yearStart = `${sel.date.slice(0, 4)}-01-01`
  const trendFrom = addDaysIso(sel.monday, -7 * (weeksN - 1))
  const from = trendFrom < yearStart ? trendFrom : yearStart
  const days = (useQuery(api.oee.days, { from, to: sel.sunday }) ?? []) as DayRow[]
  const shifts = (useQuery(api.oee.shifts, { from: sel.monday, to: sel.sunday }) ?? []) as ShiftRow[]
  const periods = useQuery(api.oee.periods) as { weekly: WeeklyRow[]; monthly: MonthlyRow[] } | undefined
  const presses = (useQuery(api.presses.list) ?? []) as { name: string }[]
  const weekly = periods?.weekly ?? []
  const monthly = periods?.monthly ?? []

  const scopeRows = useMemo(() => [...days, ...weekly, ...monthly], [days, weekly, monthly])
  const scope = effectiveScope(sel.scope, areaNames(scopeRows, config))
  const month = useMemo(() => monthlyTrend(days, monthly, scope, config, sel.date), [days, monthly, scope, config, sel.date])
  const weeks = useMemo(() => weeklyTrend(days, weekly, scope, config, sel.monday, weeksN), [days, weekly, scope, config, sel.monday, weeksN])
  const week = useMemo(() => weekShiftTrend(shifts, scope, config, sel.monday), [shifts, scope, config, sel.monday])
  // Press Definitions ile ad eşleşmesi: alanında en az bir iş merkezi tanımlı pres
  // ise (pres alanı), tanımsız olanlar işaretlenir.
  const known = new Set(presses.map((p) => p.name))
  const wcs = [...new Set(scopeRows.filter((r) => inScope(r, scope, config)).map((r) => r.workCenter))]
  const unknown = new Set(wcs.some((wc) => known.has(wc)) ? wcs.filter((wc) => !known.has(wc)) : [])
  const label = scopeLabel(scope, config)
  const h = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`
  const shiftNote = `Shifts worked = loading time ÷ net shift (${h(net.average)} h = shift ${net.timesDefined ? '' : '8:00 h assumed '}− planned stops ${h(net.plannedAverage)} h: breaks, meals, meetings). Shift times: Company settings → Shifts; planned stops: Planning → Calendar.`

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="OEE Trend Analysis"
        summary="Monthly, recent weeks and the selected week — OEE bars with the performance line; OEE from summed times, never an average of percentages."
        links={relatedPages('/oee')}
        info={
          <>
            <p>
              <b>OEE = Availability × Performance × Quality</b>. Availability = Production time ÷ Loading
              time, Performance = Operation time ÷ Production time, Quality = Good ÷ (Good + Scrap +
              Reject).
            </p>
            <p>
              Every day, week, month and group adds up the times first and divides once. A day is the
              sum of its shifts (Report → Shiftly KPI); a week or month is the sum of its days (Weekly /
              Monthly KPI rows uploaded earlier are kept where they cover more loading time).
            </p>
            <p>
              Areas, cost center names and shift numbers come from{' '}
              <Link to="/oee/settings">OEE Settings</Link>.
            </p>
          </>
        }
      />

      <OeeControls selection={sel} rows={scopeRows} config={config} />
      <OeeDataNotice items={[...trendGaps(month).map((t) => `Monthly — ${t}`), ...trendGaps(weeks).map((t) => `Weekly — ${t}`)]} />

      {days.length === 0 && monthly.length === 0 && weekly.length === 0 && (
        <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No OEE data for this period yet. Upload the file with <b>Upload data</b> —{' '}
          <Link to="/oee/guide" className="underline">
            how to use
          </Link>
          .
        </p>
      )}

      <Section title={`Monthly OEE — ${label}`} note={`${sel.date.slice(0, 4)}, up to ${sel.date.slice(0, 7)}`}>
        <OeeBarChart points={month.total} ariaLabel={`Monthly OEE ${label}`} />
        <PeriodTable total={month.total} rows={[...month.byWorkCenter]} unknown={unknown} />
      </Section>

      <Section title={`Last ${weeksN} weeks — ${label}`} note={`up to W${sel.week.week}`}>
        <OeeBarChart points={weeks.total} ariaLabel={`Weekly OEE ${label}`} />
        <PeriodTable
          total={weeks.total}
          rows={[...weeks.byWorkCenter]}
          unknown={unknown}
          shiftsWorked={{ of: (p) => (p.times.loadingMin > 0 ? p.times.loadingMin / net.average : null), note: shiftNote }}
        />
      </Section>

      <Section
        title={`Week W${sel.week.week} by shift — ${label}`}
        note={`${sel.monday} – ${sel.sunday}${week.unknown.length ? ` · shift codes not numbered in Settings: ${week.unknown.join(', ')}` : ''}`}
      >
        <OeeBarChart points={week.slots} ariaLabel={`Shift OEE week ${sel.week.week} ${label}`} />
        <PeriodTable
          total={week.slots}
          rows={[...week.byWorkCenter]}
          unknown={unknown}
          shiftsWorked={{
            of: (p) => (p.times.loadingMin > 0 ? p.times.loadingMin / (net.byShift[Number(p.key.split('|')[1])] ?? net.average) : null),
            note: shiftNote,
          }}
        />
      </Section>

      <p className="mt-6 text-xs text-muted-foreground">
        Losses behind these numbers: <Link to="/oee/losses" className="underline">Losses Trend</Link>.
      </p>
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
