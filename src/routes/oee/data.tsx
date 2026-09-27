import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { OeeControls, useOeeSelection } from '../../components/OeePanel'
import { PageHeader } from '../../components/PageHeader'
import { useQuery } from '../../lib/convexTransport'
import {
  addDaysIso,
  downtimeFormulas,
  inScope,
  isoWeek,
  orderFormulas,
  ratios,
  sumTimes,
  weekTimesByWorkCenter,
  type MonthlyRow,
  type OeeTimes,
  type OrderRow,
  type ShiftRow,
  type WeeklyRow,
} from '../../lib/oee'
import { fromStoredDay, type StoredDowntimeDay } from '../../lib/oeeStore'

export const Route = createFileRoute('/oee/data')({
  component: OeeDataPage,
})

/**
 * Yüklenen sayfalar, dosyadaki sütun sırasıyla. Formül sütunları dosyadaki
 * formülle hesaplanır (Order Based: WEEK, TOTAL1; Downtimes: Shift, Week,
 * material, min). Daily ve Weekly vardiyadan hesaplanır (toplam ÷ toplam).
 */

type SheetId = 'shiftly' | 'daily' | 'weekly' | 'monthly' | 'orders' | 'downtimes'

const SHEETS: { id: SheetId; label: string; note: string }[] = [
  { id: 'shiftly', label: 'Shiftly KPI', note: 'as uploaded · selected week' },
  { id: 'daily', label: 'Daily KPI', note: 'calculated from Shiftly KPI · selected week' },
  { id: 'weekly', label: 'Weekly KPI', note: 'archive (Weekly KPI_fix) or uploaded weeks, otherwise calculated from Shiftly KPI · selected week' },
  { id: 'monthly', label: 'Monthly KPI', note: 'as uploaded' },
  { id: 'orders', label: 'Shiftly Order Based KPI', note: 'as uploaded · selected week · WEEK and TOTAL1 by the file formulas' },
  { id: 'downtimes', label: 'Downtimes', note: 'as uploaded · selected day · Shift, Week, material, min by the file formulas' },
]

const PERIOD_HEAD = [
  'GOODQUANTITY',
  'SCRAPQUANTITY',
  'REJECTQUANTITY',
  'Scheduled Downtime',
  'Scheduled Downtime(Min)',
  'Unscheduled Downtime(Min)',
  'Net Operating Time(Min)',
  'Net Production Time(Min)',
  'Loading Time(Min)',
  'Availability',
  'Quality',
  'Performance',
  'Oee',
]

type Cell = string | number | null

const f2 = (v: number) => Math.round(v * 100) / 100

function periodCells(t: OeeTimes): Cell[] {
  const r = ratios(t)
  const p = (v: number | null) => (v === null ? null : f2(v * 100))
  return [t.good, t.scrap, t.reject, f2(t.scheduledMin * 60), f2(t.scheduledMin), f2(t.unscheduledMin), f2(t.operatingMin), f2(t.productionMin), f2(t.loadingMin), p(r.availability), p(r.quality), p(r.performance), p(r.oee)]
}

function OeeDataPage() {
  const sel = useOeeSelection()
  const [sheet, setSheet] = useState<SheetId>('shiftly')
  const shifts = (useQuery(api.oee.shifts, { from: sel.monday, to: sel.sunday }) ?? []) as ShiftRow[]
  const periods = useQuery(api.oee.periods) as { weekly: WeeklyRow[]; monthly: MonthlyRow[] } | undefined
  const orders = (useQuery(api.oee.orders, sheet === 'orders' ? { from: sel.monday, to: sel.sunday } : 'skip') ?? []) as OrderRow[]
  const down = (useQuery(api.oee.downtimeDays, sheet === 'downtimes' ? { from: sel.date, to: sel.date } : 'skip') ?? []) as StoredDowntimeDay[]
  const scope = sel.scope
  const ccOf = new Map(shifts.map((s) => [s.workCenter, s.costCenter]))

  const table = useMemo((): { head: string[]; rows: Cell[][] } => {
    if (sheet === 'shiftly') {
      return {
        head: ['Date', 'Plant - Key', 'Production Responsible', 'Cost Center', 'Work Center', 'Shift Group', 'Shift Definition', 'Good Quantity', 'Scrap Quantity', 'Reject Quantity', 'Scheduled Downtime(Min)', 'Unscheduled Downtime(Min)', 'Net Operating Time(Min)', 'Net Production Time(Min)', 'Loading Time(Min)', 'Availability', 'Quality', 'Performance', 'Oee'],
        rows: shifts
          .filter((s) => inScope(s, scope))
          .map((s) => [s.date, s.plantKey, s.responsible, s.costCenter, s.workCenter, s.shiftGroup, s.shiftDefinition, s.good, s.scrap, s.reject, f2(s.scheduledMin), f2(s.unscheduledMin), f2(s.operatingMin), f2(s.productionMin), f2(s.loadingMin), f2(s.availability), f2(s.quality), f2(s.performance), f2(s.oee)]),
      }
    }
    if (sheet === 'daily') {
      const groups = new Map<string, ShiftRow[]>()
      for (const s of shifts.filter((x) => inScope(x, scope))) groups.set(`${s.date}|${s.workCenter}`, [...(groups.get(`${s.date}|${s.workCenter}`) ?? []), s])
      return {
        head: ['Date', 'Plant - Key', 'Production Responsible', 'Cost Center - Key', 'Work Center', ...PERIOD_HEAD],
        rows: [...groups.values()].map((g) => [g[0].date, g[0].plantKey, g[0].responsible, g[0].costCenter, g[0].workCenter, ...periodCells(sumTimes(g))]),
      }
    }
    if (sheet === 'weekly') {
      const { year, week } = isoWeek(sel.monday)
      const all = weekTimesByWorkCenter(shifts, periods?.weekly ?? [])
      const source = new Map((periods?.weekly ?? []).filter((w) => w.year === year && w.week === week).map((w) => [w.workCenter, w.source === 'archive' ? 'archive (Weekly KPI_fix)' : 'uploaded (Weekly KPI)']))
      return {
        head: ['Week', 'Cost Center - Key', 'Work Center', 'Source', ...PERIOD_HEAD],
        rows: [...all.values()]
          .filter((w) => w.year === year && w.week === week && inScope(w, scope))
          .sort((a, b) => a.workCenter.localeCompare(b.workCenter))
          .map((w) => [w.week, w.costCenter, w.workCenter, source.get(w.workCenter) ?? 'calculated (Shiftly KPI)', ...periodCells(w.times)]),
      }
    }
    if (sheet === 'monthly') {
      return {
        head: ['Month', 'Month Key', 'Plant - Key', 'Production Responsible', 'Cost Center - Key', 'Work Center', ...PERIOD_HEAD],
        rows: (periods?.monthly ?? [])
          .filter((m) => inScope(m, scope))
          .sort((a, b) => a.monthKey.localeCompare(b.monthKey) || a.workCenter.localeCompare(b.workCenter))
          .map((m) => [m.month, m.monthKey, m.plantKey, m.responsible, m.costCenter, m.workCenter, m.good, m.scrap, m.reject, m.scheduledSec, f2(m.scheduledMin), f2(m.unscheduledMin), f2(m.operatingMin), f2(m.productionMin), f2(m.loadingMin), f2(m.availability), f2(m.quality), f2(m.performance), f2(m.oee)]),
      }
    }
    if (sheet === 'orders') {
      return {
        head: ['Date', 'Plant', 'Plant Name', 'workcenter', 'Shift', 'Order', 'Equipment', 'Material', 'Good Quantity', 'Scrap Quantity', 'Reject Quantity', 'Scheduled Downtime (min)', 'Unscheduled Downtime (min)', 'Net Operating Time (min)', 'Net Production Time (min)', 'Loading Time (min)', 'Availability', 'Quality', 'Performance', 'OEE', 'WEEK', 'TOTAL1'],
        rows: orders
          .filter((o) => inScope({ workCenter: o.workCenter, costCenter: ccOf.get(o.workCenter) ?? '' }, scope))
          .map((o) => {
            const fx = orderFormulas(o)
            return [o.date, o.plant, o.plantName, o.workCenter, o.shift, o.order, o.equipment, o.material, o.good, o.scrap, o.reject, f2(o.scheduledMin), f2(o.unscheduledMin), f2(o.operatingMin), f2(o.productionMin), f2(o.loadingMin), f2(o.availability), f2(o.quality), f2(o.performance), f2(o.oee), fx.week, f2(fx.total1)]
          }),
      }
    }
    const days = down.map(fromStoredDay).filter((d) => inScope(d, scope))
    return {
      head: ['Date', 'Plant', 'Plant - Key', 'Cost Center - Key', 'Work Center - Key (Not Compounded)', 'Order Number', 'Material', 'Mold Number', 'Shift Group', 'Shift Defination', 'Reason Code 1', 'Reason Code 2', 'Reason Code 3', 'Reason Code 4', 'Reason Code 5', 'Reason Code Defination EN', 'Reason Code Defination TR', 'Stoppage Duration', 'Stoppage Duration(Min)', 'StartDate', 'StartTime', 'EndDate', 'EndTime', 'Shift', 'Week', 'material', 'min'],
      rows: days.flatMap((d) =>
        d.events.map((e) => {
          const fx = downtimeFormulas(d.date, e)
          return [d.date, d.plant, d.plantKey, d.costCenter, d.workCenter, e.order, e.material, e.mold, e.shiftGroup, e.shiftDefinition, e.rc1, e.rc2, e.rc3, e.rc4, e.rc5, e.textEn, e.textTr, e.seconds, f2(e.minutes), e.startDate, e.startTime, e.endDate, e.endTime, fx.shift, fx.week, fx.material, f2(fx.min)]
        }),
      ),
    }
  }, [sheet, shifts, periods, orders, down, scope, sel.monday, ccOf])

  const info = SHEETS.find((s) => s.id === sheet)!
  const MAX = 3000

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="OEE Data"
        summary="The uploaded sheets in the order of the file; the file formulas are calculated the same way."
        links={[
          { to: '/oee', label: 'OEE Dashboard' },
          { to: '/oee/losses', label: 'Losses Trend' },
        ]}
      />
      <OeeControls selection={sel} rows={shifts} />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {SHEETS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSheet(s.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${sheet === s.id ? 'bg-foreground text-background' : 'border border-border text-muted-foreground hover:bg-muted'}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {info.note} ({sheet === 'downtimes' ? sel.date : sheet === 'monthly' ? 'all months' : `${sel.monday} – ${addDaysIso(sel.monday, 6)}`}) ·{' '}
        {table.rows.length.toLocaleString('en-GB')} rows
        {table.rows.length > MAX && ` — first ${MAX.toLocaleString('en-GB')} shown`}
      </p>
      <div className="mt-2 max-h-[70vh] overflow-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted text-muted-foreground">
            <tr>
              {table.head.map((h, i) => (
                <th key={`${h}-${i}`} className="whitespace-nowrap px-2 py-1.5 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.slice(0, MAX).map((r, i) => (
              <tr key={i} className="border-t border-border">
                {r.map((c, j) => (
                  <td key={j} className={`whitespace-nowrap px-2 py-1 ${typeof c === 'number' ? 'text-right tabular-nums' : ''}`}>
                    {c === null ? '' : typeof c === 'number' ? c.toLocaleString('en-GB') : c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
