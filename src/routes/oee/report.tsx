import { createFileRoute, Link } from '@tanstack/react-router'
import { Printer } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { FAMILY_SWATCH, hours, pctOf } from '../../components/OeeBridgeCharts'
import { OeeControls, OeeDataNotice, effectiveScope, useOeeConfig, useOeeSelection } from '../../components/OeePanel'
import { OeePeriodFields, dm, rangeText, useOeePeriod, useShiftOptions } from '../../components/OeePeriodControl'
import { PageHeader } from '../../components/PageHeader'
import { useQuery } from '../../lib/convexTransport'
import { relatedPages } from '../../lib/navigation'
import { areaNames, costCentersOf, groupLabel, inScope, scopeLabel, type DayRow, type DowntimeDay, type OeeConfig, type OrderRow, type ShiftRow } from '../../lib/oee'
import { MAX_EVENT_DAYS, NOT_IN_ORDERS, NO_PART, hasParts, matchedLossDays, parsePeriodLink, shiftSlice } from '../../lib/oeeBridge'
import { dailyReport, type ReportLoss, type ReportRow } from '../../lib/oeeDailyReport'
import { partOrders, partStops, type DetailRow } from '../../lib/oeeReliability'
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
  // Vardiya ve makine bütün OEE sayfalarında ortak (src/lib/oeeFilters.ts).
  const { shift, setShift, machine: machineRaw, setMachine } = period
  const sheetRef = useRef<HTMLDivElement>(null)
  // Sağ panel: tıklanan referans (Aksiyonlar sunumu, 2026-10-14).
  const [focus, setFocus] = useState<Focus | null>(null)

  const q = cur ? { from: cur.from, to: cur.to } : { from: wanted.from, to: wanted.to }
  const dayRows = (useQuery(api.oee.days, q) ?? []) as DayRow[]
  const lossRaw = (useQuery(api.oee.lossDays, q) ?? []) as StoredLossDay[]
  const orders = (useQuery(api.oee.orders, q) ?? []) as OrderRow[]
  const lossDays = useMemo(() => fromStoredLosses(lossRaw), [lossRaw])

  // Vardiya filtresi ham duruşlarla (en çok 8 gün); malzemeler kayıp özetinden,
  // eski özetlerde ham duruşlardan.
  const shiftOn = shift > 0 && eventsOk
  const storedParts = hasParts(lossDays)
  const needEvents = eventsOk && (shiftOn || !storedParts || !!focus)
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

  const { report, detailSet } = useMemo(() => {
    const inSel = (r: { workCenter: string; costCenter: string }) => inScope(r, scope, config) && (!machine || r.workCenter === machine)
    const ords = orders.filter((o) => inSel({ workCenter: o.workCenter, costCenter: wcCostCenter.get(o.workCenter) ?? '' }))
    const slice = shiftOn ? shiftSlice(shift, config, { shifts: shiftRows, events, orders: ords }) : null
    const days = (slice ? slice.days : dayRows).filter(inSel)
    // Köprüdeki taban: yalnızca vardiyası olan gün × makinenin duruşları.
    const losses = matchedLossDays(days, (slice ? slice.lossDays : lossDays).filter(inSel))
    const keys = new Set(losses.map((l) => `${l.date}|${l.workCenter}`))
    const evs = (slice ? slice.events : events).filter((d) => keys.has(`${d.date}|${d.workCenter}`))
    const set = { days, lossDays: losses, orders: slice ? slice.orders : ords, events: evs }
    return { report: dailyReport(set, config, TOP_LOSSES), detailSet: set }
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
        <div className="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
          <div ref={sheetRef} className="bridge-sheet oee-viz min-w-0 bg-background">
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
            <p className="mt-1 text-[11px] text-muted-foreground print:hidden">Click a part (reference): its days, shifts and loss details open on the right.</p>
            <ReportTable rows={report.rows} total={report.rows.length > 1 ? report.total : null} focus={focus} onPick={setFocus} />
          </div>
          <FocusPanel
            focus={focus}
            onClose={() => setFocus(null)}
            eventsOk={eventsOk}
            loading={!!focus && eventsOk && evRaw === undefined}
            set={detailSet}
            config={config}
            period={cur ? rangeText(cur) : ''}
          />
        </div>
      )}
    </div>
  )
}

/** Sağ panelde açılan referans: hangi iş yeri, hangi kayıp. */
interface Focus {
  material: string
  /** Toplam satırında malzemenin iş yeri; yoksa satırın iş yeri. */
  workCenter: string | null
  loss: ReportLoss
}

function ReportTable({
  rows,
  total,
  focus,
  onPick,
}: {
  rows: ReportRow[]
  total: ReportRow | null
  focus: Focus | null
  onPick: (f: Focus) => void
}) {
  const th = 'border-b border-border px-2 py-2 text-left font-semibold text-foreground'
  return (
    <div className="mt-2 overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted/70">
          <tr>
            <th className={th}>Work center</th>
            <th className={`${th} text-right`}>OEE</th>
            {Array.from({ length: TOP_LOSSES }, (_, i) => (
              <th key={i} className={`${th} border-l`}>
                Loss {i + 1} <span className="font-normal text-muted-foreground">· parts</span>
              </th>
            ))}
            <th className={`${th} border-l`}>
              Speed loss <span className="font-normal text-muted-foreground">· parts</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.workCenter} row={r} focus={focus} onPick={onPick} />
          ))}
          {total && <Row row={total} total focus={focus} onPick={onPick} />}
        </tbody>
      </table>
    </div>
  )
}

function Row({ row, total, focus, onPick }: { row: ReportRow; total?: boolean; focus: Focus | null; onPick: (f: Focus) => void }) {
  const td = 'px-2 py-2 align-top'
  const wc = total ? null : row.workCenter
  return (
    <tr className={`border-b border-border/60 last:border-0 ${total ? 'bg-muted/40 font-semibold' : ''}`}>
      <td className={`${td} whitespace-nowrap`}>
        <span className="font-semibold text-foreground">{row.workCenter}</span>
        <span className="block text-[11px] font-normal text-muted-foreground tabular-nums">{hours(row.loadingMin)} loading</span>
      </td>
      <td className={`${td} text-right whitespace-nowrap`}>
        <span className="text-sm font-bold text-foreground tabular-nums">{pctOf(row.oee)}</span>
        <span className="block text-[10px] font-normal text-muted-foreground tabular-nums">
          A {pctOf(row.availability, 0)} · P {pctOf(row.performance, 0)}
        </span>
        <span className="block text-[10px] font-normal text-muted-foreground tabular-nums">Q {pctOf(row.quality, 0)}</span>
      </td>
      {Array.from({ length: TOP_LOSSES }, (_, i) => (
        <LossCell key={i} loss={row.losses[i] ?? null} workCenter={wc} focus={focus} onPick={onPick} />
      ))}
      <LossCell loss={row.speed} workCenter={wc} focus={focus} onPick={onPick} />
    </tr>
  )
}

/** Kayıp ve altında parçaları (tıklanır: sağ panel). */
function LossCell({
  loss,
  workCenter,
  focus,
  onPick,
}: {
  loss: ReportLoss | null
  workCenter: string | null
  focus: Focus | null
  onPick: (f: Focus) => void
}) {
  const td = 'border-l border-border px-2 py-2 align-top'
  if (!loss) return <td className={`${td} text-muted-foreground`}>—</td>
  return (
    <td className={td}>
      <span className="flex items-center gap-1.5 font-semibold whitespace-nowrap text-foreground">
        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: FAMILY_SWATCH[loss.family] }} />
        {loss.key === 'pf:speed' ? 'Speed' : loss.label}
        <span className="font-normal text-muted-foreground tabular-nums">
          {hours(loss.minutes)} · {pctOf(loss.share)}
        </span>
      </span>
      {loss.parts.length > 0 && (
        <ul className="mt-1 space-y-0.5 font-normal">
          {loss.parts.map((p) => {
            const wc = p.sub ?? workCenter
            const real = p.label !== NO_PART && p.label !== NOT_IN_ORDERS
            const active = focus && focus.material === p.label && focus.workCenter === wc && focus.loss.key === loss.key
            return (
              <li key={`${p.label}|${p.sub ?? ''}`}>
                <button
                  type="button"
                  disabled={!real}
                  onClick={() => onPick({ material: p.label, workCenter: wc, loss })}
                  className={`flex w-full justify-between gap-2 rounded px-1 text-left whitespace-nowrap ${real ? 'hover:bg-sky-100 dark:hover:bg-sky-900/40' : 'cursor-default'} ${active ? 'bg-sky-200/80 ring-1 ring-sky-500 dark:bg-sky-900/60' : ''}`}
                >
                  <span className={real ? 'text-foreground underline decoration-dotted underline-offset-2' : 'text-muted-foreground'}>
                    {p.label}
                    {p.sub && <span className="ml-1 text-muted-foreground no-underline">{p.sub}</span>}
                  </span>
                  <span className="text-muted-foreground tabular-nums">{hours(p.minutes)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </td>
  )
}

/**
 * Sağ panel (Aksiyonlar sunumu, 2026-10-14): tıklanan referansın hangi gün,
 * hangi vardiyada, hangi kayıp ve nedenle ne kadar kaybettirdiği — nereye
 * odaklanılacağı. Ham duruşlardan (en çok 8 günlük dönem).
 */
function FocusPanel({
  focus,
  onClose,
  eventsOk,
  loading,
  set,
  config,
  period,
}: {
  focus: Focus | null
  onClose: () => void
  eventsOk: boolean
  loading: boolean
  set: { events?: DowntimeDay[]; orders: OrderRow[] }
  config: OeeConfig
  period: string
}) {
  const detail = useMemo(() => {
    if (!focus) return null
    const { loss, material, workCenter } = focus
    const kind = loss.key === 'pf:speed' ? 'speed' : loss.key === 'q:scrap' ? 'scrap' : loss.key === 'q:reject' ? 'reject' : null
    const stops = partStops(set.events ?? [], workCenter, material, config)
    const focusRows = kind ? partOrders(set.orders, workCenter, material, kind, config) : stops.filter((r) => loss.groups.includes(r.group))
    const others = kind ? stops : stops.filter((r) => !loss.groups.includes(r.group))
    const byGroup = new Map<string, { minutes: number; count: number }>()
    for (const r of stops) {
      const g = byGroup.get(r.group) ?? { minutes: 0, count: 0 }
      g.minutes += r.minutes
      g.count += r.count
      byGroup.set(r.group, g)
    }
    return { kind, focusRows, others, byGroup: [...byGroup].sort((a, b) => b[1].minutes - a[1].minutes) }
  }, [focus, set, config])

  if (!focus || !detail)
    return (
      <aside className="flex min-h-[16rem] items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground xl:sticky xl:top-28">
        Click a part (reference) in the table — which day, which shift, which loss and why will show here.
      </aside>
    )
  const { loss, material, workCenter } = focus
  const focusTotal = detail.focusRows.reduce((a, r) => a + r.minutes, 0)
  const unit = detail.kind === 'scrap' || detail.kind === 'reject' ? 'pcs' : 'min'
  return (
    <aside className="min-w-0 rounded-xl border-2 border-sky-400/60 bg-sky-50/40 p-3 xl:sticky xl:top-28 dark:bg-sky-950/20">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-wide text-sky-900 uppercase dark:text-sky-200">Part (reference)</p>
          <p className="truncate text-lg font-bold text-foreground">{material}</p>
          <p className="text-xs text-muted-foreground">
            {workCenter ?? 'All work centers'} · {period}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground">
          Close
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 rounded-lg bg-background px-3 py-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: FAMILY_SWATCH[loss.family] }} />
        <span className="text-sm font-bold text-foreground">{loss.key === 'pf:speed' ? 'Speed loss' : loss.label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {unit === 'pcs' ? `${Math.round(focusTotal)} pcs` : hours(focusTotal)} of this part
        </span>
      </div>

      {!eventsOk && !detail.kind ? (
        <p className="mt-3 text-xs text-muted-foreground">Day and shift details are shown for periods of up to {MAX_EVENT_DAYS} days.</p>
      ) : loading ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading the downtimes…</p>
      ) : (
        <>
          <DetailTable title="Where and when" rows={detail.focusRows} unit={unit} countLabel={detail.kind === 'speed' ? 'Orders' : undefined} highlight />
          {detail.byGroup.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-foreground">All downtime losses of this part</p>
              <ul className="mt-1 flex flex-wrap gap-1.5 text-xs">
                {detail.byGroup.map(([g, v]) => (
                  <li
                    key={g}
                    className={`rounded-md border px-2 py-0.5 tabular-nums ${loss.groups.includes(g) ? 'border-sky-500 bg-sky-100 font-semibold dark:bg-sky-900/50' : 'border-border bg-background'}`}
                  >
                    {groupLabel(g, config)} · {hours(v.minutes)} · {v.count}×
                  </li>
                ))}
              </ul>
            </div>
          )}
          {detail.others.length > 0 && <DetailTable title="Other downtimes of this part" rows={detail.others} unit="min" />}
        </>
      )}
    </aside>
  )
}

function DetailTable({
  title,
  rows,
  unit,
  countLabel,
  highlight,
}: {
  title: string
  rows: DetailRow[]
  unit: 'min' | 'pcs'
  countLabel?: string
  highlight?: boolean
}) {
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">Nothing recorded.</p>
      ) : (
        <div className="mt-1 max-h-[22rem] overflow-auto rounded-md border border-border bg-background">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left font-medium">Day</th>
                <th className="px-2 py-1 text-left font-medium">Shift</th>
                <th className="px-2 py-1 text-left font-medium">Loss · detail</th>
                <th className="px-2 py-1 text-right font-medium">{countLabel ?? (unit === 'pcs' ? 'Pieces' : 'Stops')}</th>
                {unit === 'min' && <th className="px-2 py-1 text-right font-medium">Time</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={`border-t border-border ${highlight ? '' : 'text-muted-foreground'}`}>
                  <td className="px-2 py-1 whitespace-nowrap tabular-nums">
                    {dm(r.date).slice(0, 5)}
                    {r.start && <span className="ml-1 text-muted-foreground">{r.start}</span>}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">{r.shift ? `Shift ${r.shift}` : '—'}</td>
                  <td className="px-2 py-1">
                    <span className="font-semibold text-foreground">{r.group}</span> · {r.text}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{Math.round(r.count)}</td>
                  {unit === 'min' && <td className="px-2 py-1 text-right font-semibold tabular-nums text-foreground">{hours(r.minutes)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
