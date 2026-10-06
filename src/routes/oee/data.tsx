import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { OeeControls, effectiveScope, useOeeConfig, useOeeSelection } from '../../components/OeePanel'
import { PageHeader } from '../../components/PageHeader'
import { useQuery } from '../../lib/convexTransport'
import {
  addDaysIso,
  areaNames,
  inScope,
  isoWeek,
  monthTimes,
  ratios,
  weekTimes,
  type DayRow,
  type MonthlyRow,
  type OeeTimes,
  type OrderRow,
  type ShiftRow,
  type WeeklyRow,
} from '../../lib/oee'
import { fromStoredDay, type StoredDowntimeDay } from '../../lib/oeeStore'
import { relatedPages } from '../../lib/navigation'

export const Route = createFileRoute('/oee/data')({
  component: OeeDataPage,
})

/**
 * Yüklenen sayfalar, dosyadaki sütun sırasıyla (2026-10-06 biçimi: Report.xlsx →
 * Shiftly KPI, Shiftly Order Based KPI; Downtimes). Gün, hafta ve ay
 * dosyada yok: vardiyalardan hesaplanır (toplam ÷ toplam).
 */

type SheetId = 'shiftly' | 'orders' | 'downtimes' | 'daily' | 'weekly' | 'monthly'

const SHEETS: { id: SheetId; label: string; note: string }[] = [
  { id: 'shiftly', label: 'Shiftly KPI', note: 'as uploaded · selected week' },
  { id: 'orders', label: 'Shiftly Order Based KPI', note: 'as uploaded · selected week' },
  { id: 'downtimes', label: 'Downtimes', note: 'as uploaded · selected day' },
  { id: 'daily', label: 'Days', note: 'calculated: sum of the shifts · selected week' },
  { id: 'weekly', label: 'Weeks', note: 'calculated: sum of the days · selected week' },
  { id: 'monthly', label: 'Months', note: 'calculated: sum of the days · year of the selected week' },
]

const TIME_HEAD = [
  'GOODQUANTITY',
  'SCRAPQUANTITY',
  'REJECTQUANTITY',
  'Scheduled Downtime(Min)',
  'Unscheduled Downtime(Min)',
  'Net Operating Time(Min)',
  'Net Production Time(Min)',
  'Loading Time(Min)',
]
const PERIOD_HEAD = [...TIME_HEAD, 'Availability', 'Quality', 'Performance', 'Oee']

type Cell = string | number | null

const f2 = (v: number) => Math.round(v * 100) / 100

function periodCells(t: OeeTimes): Cell[] {
  const r = ratios(t)
  const p = (v: number | null) => (v === null ? null : f2(v * 100))
  return [t.good, t.scrap, t.reject, f2(t.scheduledMin), f2(t.unscheduledMin), f2(t.operatingMin), f2(t.productionMin), f2(t.loadingMin), p(r.availability), p(r.quality), p(r.performance), p(r.oee)]
}

function OeeDataPage() {
  const sel = useOeeSelection()
  const { config } = useOeeConfig()
  const [sheet, setSheet] = useState<SheetId>('shiftly')
  const year = sel.monday.slice(0, 4)
  const shifts = (useQuery(api.oee.shifts, { from: sel.monday, to: sel.sunday }) ?? []) as ShiftRow[]
  const dayRows = (useQuery(api.oee.days, { from: sel.monday, to: sel.sunday }) ?? []) as DayRow[]
  const yearDays = (useQuery(api.oee.days, sheet === 'monthly' ? { from: `${year}-01-01`, to: `${year}-12-31` } : 'skip') ?? []) as DayRow[]
  const periods = useQuery(api.oee.periods) as { weekly: WeeklyRow[]; monthly: MonthlyRow[] } | undefined
  const orders = (useQuery(api.oee.orders, sheet === 'orders' ? { from: sel.monday, to: sel.sunday } : 'skip') ?? []) as OrderRow[]
  const down = (useQuery(api.oee.downtimeDays, sheet === 'downtimes' ? { from: sel.date, to: sel.date } : 'skip') ?? []) as StoredDowntimeDay[]
  const scope = effectiveScope(sel.scope, areaNames(dayRows, config))
  const ccOf = new Map(dayRows.map((s) => [s.workCenter, s.costCenter]))
  const within = (r: { workCenter: string; costCenter: string }) => inScope(r, scope, config)

  const table = useMemo((): { head: string[]; rows: Cell[][] } => {
    if (sheet === 'shiftly') {
      return {
        head: ['Date', 'Plant - Key', 'Cost Center - Key', 'Work Center', 'Shift Defination', 'Shift Definition Txt', ...TIME_HEAD, 'Availability', 'Quality', 'Performance', 'Oee'],
        rows: shifts
          .filter(within)
          .map((s) => [s.date, s.plantKey, s.costCenter, s.workCenter, s.shiftGroup, s.shiftDefinition, s.good, s.scrap, s.reject, f2(s.scheduledMin), f2(s.unscheduledMin), f2(s.operatingMin), f2(s.productionMin), f2(s.loadingMin), f2(s.availability), f2(s.quality), f2(s.performance), f2(s.oee)]),
      }
    }
    if (sheet === 'orders') {
      return {
        head: ['Date', 'Plant - Key', 'Plant', 'Work Center', 'Shift Defination', 'Order', 'Material - Key', 'Var_Equipment', ...TIME_HEAD, 'Availability (Order)', 'Quality (Order)', 'Performance (Order)', 'Oee (Order)'],
        rows: orders
          .filter((o) => within({ workCenter: o.workCenter, costCenter: ccOf.get(o.workCenter) ?? '' }))
          .map((o) => [o.date, o.plant, o.plantName, o.workCenter, o.shift, o.order, o.material, o.equipment, o.good, o.scrap, o.reject, f2(o.scheduledMin), f2(o.unscheduledMin), f2(o.operatingMin), f2(o.productionMin), f2(o.loadingMin), f2(o.availability), f2(o.quality), f2(o.performance), f2(o.oee)]),
      }
    }
    if (sheet === 'daily') {
      return {
        head: ['Date', 'Cost Center - Key', 'Work Center', ...PERIOD_HEAD],
        rows: dayRows
          .filter(within)
          .sort((a, b) => a.date.localeCompare(b.date) || a.workCenter.localeCompare(b.workCenter))
          .map((d) => [d.date, d.costCenter, d.workCenter, ...periodCells(d)]),
      }
    }
    if (sheet === 'weekly') {
      const { year: y, week } = isoWeek(sel.monday)
      const key = `${y}-W${String(week).padStart(2, '0')}|`
      return {
        head: ['Week', 'Cost Center - Key', 'Work Center', ...PERIOD_HEAD],
        rows: [...weekTimes(dayRows, periods?.weekly ?? [])]
          .filter(([k, w]) => k.startsWith(key) && within(w))
          .sort(([, a], [, b]) => a.workCenter.localeCompare(b.workCenter))
          .map(([, w]) => [week, w.costCenter, w.workCenter, ...periodCells(w.times)]),
      }
    }
    if (sheet === 'monthly') {
      return {
        head: ['Month', 'Cost Center - Key', 'Work Center', ...PERIOD_HEAD],
        rows: [...monthTimes(yearDays, (periods?.monthly ?? []).filter((m) => String(m.year) === year))]
          .filter(([, m]) => within(m))
          .sort(([a, x], [b, y]) => a.split('|')[0].localeCompare(b.split('|')[0]) || x.workCenter.localeCompare(y.workCenter))
          .map(([k, m]) => [k.split('|')[0], m.costCenter, m.workCenter, ...periodCells(m.times)]),
      }
    }
    const days = down.map(fromStoredDay).filter(within)
    return {
      head: ['Date', 'Plant', 'Plant - Key', 'Cost Center - Key', 'Work Center - Key (Not Compounded)', 'Order Number', 'MATERIAL', 'Mold Number', 'Shift Group', 'Shift Defination', 'Reason Code 1', 'Reason Code 2', 'Reason Code 3', 'Reason Code 4', 'Reason Code 5', 'Reason Code Defination EN', 'Reason Code Defination TR', 'Stoppage Duration', 'Stoppage Duration(Min)', 'StartDate', 'StartTime', 'EndDate', 'EndTime'],
      rows: days.flatMap((d) =>
        d.events.map((e) => [d.date, d.plant, d.plantKey, d.costCenter, d.workCenter, e.order, e.material, e.mold, e.shiftGroup, e.shiftDefinition, e.rc1, e.rc2, e.rc3, e.rc4, e.rc5, e.textEn, e.textTr, e.seconds, f2(e.minutes), e.startDate, e.startTime, e.endDate, e.endTime]),
      ),
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, shifts, dayRows, yearDays, periods, orders, down, scope, config, sel.monday])

  const info = SHEETS.find((s) => s.id === sheet)!
  const MAX = 3000

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="OEE Data"
        summary="The uploaded sheets in the order of the file (Report: Shiftly KPI, Shiftly Order Based KPI; Downtimes). Days, weeks and months are calculated from the shifts."
        links={relatedPages('/oee/data')}
      />
      <OeeControls selection={sel} rows={dayRows} config={config} />
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
        {info.note} ({sheet === 'downtimes' ? sel.date : sheet === 'monthly' ? year : `${sel.monday} – ${addDaysIso(sel.monday, 6)}`}) ·{' '}
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
