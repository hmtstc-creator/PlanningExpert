import { createFileRoute, Link } from '@tanstack/react-router'
import { Printer } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { FAMILY_SWATCH, hours, pctOf } from '../../components/OeeBridgeCharts'
import { OeeControls, OeeDataNotice, effectiveScope, useOeeConfig, useOeeSelection } from '../../components/OeePanel'
import { OeePeriodFields, dm, rangeText, useOeePeriod, useShiftOptions } from '../../components/OeePeriodControl'
import { PageHeader } from '../../components/PageHeader'
import { useQuery } from '../../lib/convexTransport'
import { relatedPages } from '../../lib/navigation'
import { areaNames, costCentersOf, inScope, scopeLabel, type DayRow, type OrderRow, type ShiftRow } from '../../lib/oee'
import { MAX_EVENT_DAYS, hasParts, matchedLossDays, parsePeriodLink, shiftSlice } from '../../lib/oeeBridge'
import { dailyReport, type ReportLoss, type ReportRow } from '../../lib/oeeDailyReport'
import { fromStoredDay, fromStoredLosses, type StoredDowntimeDay, type StoredLossDay } from '../../lib/oeeStore'
import { useCanOpen } from '../../lib/plantContext'
import { printSheet } from '../../lib/printSheet'

export const Route = createFileRoute('/oee/report')({
  validateSearch: parsePeriodLink,
  component: ReportPage,
})

const TOP_LOSSES = 3

/**
 * OEE Daily Report (planlamacı, 2026-10-13): tek sayfa — her iş yeri için
 * OEE, en büyük 3 kayıp ve yanında malzemeleri, hız kaybı ve malzemeleri.
 * Filtreler Loss Bridge'inkiler; hesap da onunki (src/lib/oeeDailyReport.ts).
 */
function ReportPage() {
  const sel = useOeeSelection()
  const { config } = useOeeConfig()
  const canOpen = useCanOpen()
  const link = Route.useSearch()
  const period = useOeePeriod(link)
  const { lastDay, wanted, cur, eventsOk } = period
  const [machineRaw, setMachine] = useState('')
  const [shift, setShift] = useState(link.shift ?? 0)
  useEffect(() => setShift(link.shift ?? 0), [link.shift, link.from, link.to])
  const sheetRef = useRef<HTMLDivElement>(null)

  const q = cur ? { from: cur.from, to: cur.to } : { from: wanted.from, to: wanted.to }
  const dayRows = (useQuery(api.oee.days, q) ?? []) as DayRow[]
  const lossRaw = (useQuery(api.oee.lossDays, q) ?? []) as StoredLossDay[]
  const orders = (useQuery(api.oee.orders, q) ?? []) as OrderRow[]
  const lossDays = useMemo(() => fromStoredLosses(lossRaw), [lossRaw])

  // Vardiya filtresi ham duruşlarla (en çok 8 gün); malzemeler kayıp özetinden,
  // eski özetlerde ham duruşlardan.
  const shiftOn = shift > 0 && eventsOk
  const storedParts = hasParts(lossDays)
  const needEvents = eventsOk && (shiftOn || !storedParts)
  const shiftRows = (useQuery(api.oee.shifts, shiftOn ? q : 'skip') ?? []) as ShiftRow[]
  const evRaw = useQuery(api.oee.downtimeDays, needEvents ? q : 'skip') as StoredDowntimeDay[] | undefined
  const events = useMemo(() => (evRaw ?? []).map(fromStoredDay), [evRaw])

  const scope = effectiveScope(sel.scope, areaNames(dayRows, config))
  const machineOptions = useMemo(
    () => [...new Set(dayRows.filter((r) => inScope(r, scope, config)).map((r) => r.workCenter))].sort(),
    [dayRows, scope, config],
  )
  const machine = machineOptions.includes(machineRaw) ? machineRaw : ''
  const shiftOptions = useShiftOptions(config)
  const wcCostCenter = useMemo(() => costCentersOf(dayRows), [dayRows])

  const report = useMemo(() => {
    const inSel = (r: { workCenter: string; costCenter: string }) => inScope(r, scope, config) && (!machine || r.workCenter === machine)
    const ords = orders.filter((o) => inSel({ workCenter: o.workCenter, costCenter: wcCostCenter.get(o.workCenter) ?? '' }))
    const slice = shiftOn ? shiftSlice(shift, config, { shifts: shiftRows, events, orders: ords }) : null
    const days = (slice ? slice.days : dayRows).filter(inSel)
    // Köprüdeki taban: yalnızca vardiyası olan gün × makinenin duruşları.
    const losses = matchedLossDays(days, (slice ? slice.lossDays : lossDays).filter(inSel))
    const keys = new Set(losses.map((l) => `${l.date}|${l.workCenter}`))
    const evs = (slice ? slice.events : events).filter((d) => keys.has(`${d.date}|${d.workCenter}`))
    return dailyReport({ days, lossDays: losses, orders: slice ? slice.orders : ords, events: evs }, config, TOP_LOSSES)
  }, [dayRows, lossDays, orders, events, shiftRows, shiftOn, shift, scope, machine, config, wcCostCenter])

  const label = `${scopeLabel(scope, config)}${machine ? ` · ${machine}` : ''}${shiftOn ? ` · ${shiftOptions.find((o) => o.number === shift)?.label ?? `Shift ${shift}`}` : ''}`
  const partsMissing = !storedParts && !eventsOk
  const notes = [
    ...(cur?.clipped ? [`The data ends on ${dm(cur.to)} — the period is shown up to that day.`] : []),
    ...(lastDay && wanted.from > lastDay ? [`No OEE data uploaded for ${rangeText(wanted)} yet (data ends on ${dm(lastDay)}).`] : []),
    ...(shift > 0 && !eventsOk ? [`The shift filter works for periods of up to ${MAX_EVENT_DAYS} days — all shifts are shown.`] : []),
    ...(partsMissing
      ? [
          `Materials of the downtimes are not ready for some days of this period yet — open any OEE page once, or pick up to ${MAX_EVENT_DAYS} days.`,
        ]
      : []),
  ]
  const hasData = report.rows.length > 0

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title="OEE Daily Report"
        summary="One page: OEE of each work center, its three biggest losses with the materials behind them, and the speed loss."
        links={relatedPages('/oee/report')}
        info={
          <>
            <p>
              Each row is one work center of the selection; the last row is the total. OEE, losses and percentages are exactly the Loss
              Bridge&apos;s: every loss is a share of the loading time.
            </p>
            <p>
              <b>Biggest losses</b>: the three largest recorded losses (downtime groups, scrap, reject) — not the unexplained difference and
              not the speed loss, which has its own column. Next to each loss: the materials (MATERIAL in the downtimes, Material - Key in
              the orders) with the most hours.
            </p>
          </>
        }
      />
      <OeeControls
        selection={sel}
        rows={dayRows}
        config={config}
        period={
          <OeePeriodFields
            period={period}
            shift={shift}
            setShift={setShift}
            shiftOptions={shiftOptions}
            machine={machine}
            setMachine={setMachine}
            machineOptions={machineOptions}
            showPrevious={false}
          />
        }
      />
      <OeeDataNotice items={notes} />

      {!hasData ? (
        <p className="mt-6 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {cur ? `No shift data for ${label} in ${rangeText(cur)}.` : 'No OEE data for this period.'}{' '}
          {canOpen('/oee/data') && (
            <Link to="/oee/data" className="underline">
              See the uploaded data
            </Link>
          )}
        </p>
      ) : (
        <div ref={sheetRef} className="bridge-sheet oee-viz mt-4 min-w-0 bg-background">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">
              OEE daily report · {label} <span className="font-normal text-muted-foreground">· {cur ? rangeText(cur) : ''}</span>
            </h2>
            <button
              type="button"
              onClick={() => sheetRef.current && printSheet(sheetRef.current, `OEE daily report ${label} ${cur?.from ?? ''}`)}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground print:hidden"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden /> Print
            </button>
          </div>
          <ReportTable rows={report.rows} total={report.rows.length > 1 ? report.total : null} />
        </div>
      )}
    </div>
  )
}

function ReportTable({ rows, total }: { rows: ReportRow[]; total: ReportRow | null }) {
  const th = 'border-b border-border px-2 py-2 text-left font-semibold text-foreground'
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[980px] text-xs">
        <thead className="bg-muted/70">
          <tr>
            <th className={th}>Work center</th>
            <th className={`${th} text-right`}>OEE</th>
            {Array.from({ length: TOP_LOSSES }, (_, i) => (
              <ColumnPair key={i} title={`Loss ${i + 1}`} className={th} />
            ))}
            <ColumnPair title="Speed loss" className={th} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.workCenter} row={r} />
          ))}
          {total && <Row row={total} total />}
        </tbody>
      </table>
    </div>
  )
}

function ColumnPair({ title, className }: { title: string; className: string }) {
  return (
    <>
      <th className={`${className} border-l`}>{title}</th>
      <th className={`${className} font-medium text-muted-foreground`}>Materials</th>
    </>
  )
}

function Row({ row, total }: { row: ReportRow; total?: boolean }) {
  const td = 'px-2 py-2 align-top'
  return (
    <tr className={`border-b border-border/60 last:border-0 ${total ? 'bg-muted/40 font-semibold' : ''}`}>
      <td className={`${td} whitespace-nowrap`}>
        <span className="font-semibold text-foreground">{row.workCenter}</span>
        <span className="block text-[11px] font-normal text-muted-foreground tabular-nums">{hours(row.loadingMin)} loading</span>
      </td>
      <td className={`${td} text-right whitespace-nowrap`}>
        <span className="text-sm font-bold text-foreground tabular-nums">{pctOf(row.oee)}</span>
        <span className="block text-[10px] font-normal text-muted-foreground tabular-nums">
          A {pctOf(row.availability, 0)} · P {pctOf(row.performance, 0)} · Q {pctOf(row.quality, 0)}
        </span>
      </td>
      {Array.from({ length: TOP_LOSSES }, (_, i) => (
        <LossCells key={i} loss={row.losses[i] ?? null} />
      ))}
      <LossCells loss={row.speed} bare />
    </tr>
  )
}

/** Kayıp ve yanında malzemeleri; `bare`: sütun başlığı zaten kaybın adı (hız kaybı). */
function LossCells({ loss, bare }: { loss: ReportLoss | null; bare?: boolean }) {
  const td = 'px-2 py-2 align-top'
  if (!loss)
    return (
      <>
        <td className={`${td} border-l border-border text-muted-foreground`}>—</td>
        <td className={td} />
      </>
    )
  return (
    <>
      <td className={`${td} border-l border-border`}>
        {!bare && (
          <span className="flex items-center gap-1.5 font-semibold text-foreground">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: FAMILY_SWATCH[loss.family] }} />
            {loss.label}
          </span>
        )}
        <span className={`block tabular-nums ${bare ? 'font-semibold text-foreground' : 'font-normal text-muted-foreground'}`}>
          {hours(loss.minutes)} · {pctOf(loss.share)}
        </span>
      </td>
      <td className={`${td} font-normal`}>
        {loss.parts.length ? (
          <ul className="space-y-0.5">
            {loss.parts.map((p) => (
              <li key={`${p.label}|${p.sub ?? ''}`} className="flex justify-between gap-2 whitespace-nowrap">
                <span className="text-foreground">
                  {p.label}
                  {p.sub && <span className="ml-1 text-muted-foreground">{p.sub}</span>}
                </span>
                <span className="text-muted-foreground tabular-nums">{hours(p.minutes)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </>
  )
}
