import { createFileRoute, Link } from '@tanstack/react-router'
import { Printer } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import {
  BridgeChart,
  FAMILY_LABEL,
  FAMILY_SWATCH,
  Level2Bars,
  Level3Table,
  StackColumn,
  hours,
  pctOf,
} from '../../components/OeeBridgeCharts'
import { OeeControls, OeeDataNotice, effectiveScope, useOeeConfig, useOeeSelection } from '../../components/OeePanel'
import { PageHeader } from '../../components/PageHeader'
import { useQuery } from '../../lib/convexTransport'
import { relatedPages } from '../../lib/navigation'
import { areaNames, costCentersOf, inScope, scopeLabel, type DayRow, type DowntimeDay, type OrderRow, type ShiftRow } from '../../lib/oee'
import {
  MAX_CUSTOM_DAYS,
  MAX_EVENT_DAYS,
  PERIOD_PRESETS,
  buildBridge,
  clipToData,
  daysBetween,
  level3,
  level3Views,
  matchedLossDays,
  periodRange,
  previousRange,
  shiftSlice,
  topN,
  type Level3By,
  type LossItem,
  type PeriodPreset,
} from '../../lib/oeeBridge'
import { fromStoredDay, fromStoredLosses, type StoredDowntimeDay, type StoredLossDay } from '../../lib/oeeStore'
import { useCanOpen, usePlant } from '../../lib/plantContext'
import { printSheet } from '../../lib/printSheet'

export const Route = createFileRoute('/oee/bridge')({
  component: BridgePage,
})

function localIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dm = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
const rangeText = (r: { from: string; to: string }) => (r.from === r.to ? dm(r.from) : `${dm(r.from)} – ${dm(r.to)}`)

const VIEW_LABEL: Record<Level3By, string> = { reason: 'By reason', machine: 'By machine', die: 'By die' }

/**
 * OEE Loss Bridge (docs/oee-bridge.md): seçilen makine ya da hattın
 * zamanı takvimden efektif süreye adım adım; Level 1 / 2 / 3 kayıp dağılımı
 * ve öncelik. Hesap src/lib/oeeBridge.ts (test edilir); OEE, OEE Dashboard
 * ile aynı tanım ve toplama (Loading tabanında birebir).
 */
function BridgePage() {
  const sel = useOeeSelection()
  const { config } = useOeeConfig()
  const { ctx } = usePlant()
  const canOpen = useCanOpen()
  const coverage = useQuery(api.oee.coverage) as { days: { from: string; to: string } | null } | undefined
  const today = localIso(new Date())
  const [preset, setPreset] = useState<PeriodPreset>('yesterday')
  const [custom, setCustom] = useState(() => periodRange('lastWeek', today))
  const [machineRaw, setMachine] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [view, setView] = useState<Level3By | null>(null)
  const [shift, setShift] = useState(0)
  const sheetRef = useRef<HTMLDivElement>(null)

  const wanted = periodRange(preset, today, custom)
  const lastDay = coverage?.days?.to ?? null
  const cur = clipToData(wanted, lastDay)
  // Ay dönemleri önceki takvim ayıyla karşılaştırılır.
  const prev = cur ? previousRange(cur, preset === 'thisMonth' || preset === 'lastMonth') : null
  const firstDay = coverage?.days?.from ?? null
  // Önceki dönem ilk yüklenen günden önce başlıyorsa karşılaştırma yapılmaz (yarım dönem).
  const prevFull = !!prev && !!firstDay && prev.from >= firstDay
  // Sorgu aralığı: önceki dönemin başından bu dönemin sonuna (veri yoksa dünkü gün, boş döner).
  const q = cur && prev ? { from: prev.from, to: cur.to } : { from: wanted.from, to: wanted.to }
  const dayRows = (useQuery(api.oee.days, q) ?? []) as DayRow[]
  const lossRaw = (useQuery(api.oee.lossDays, q) ?? []) as StoredLossDay[]
  const orders = (useQuery(api.oee.orders, q) ?? []) as OrderRow[]
  const lossDays = useMemo(() => fromStoredLosses(lossRaw), [lossRaw])

  // Vardiya filtresi ve duruşların kalıp kırılımı ham duruşlarla: en çok 8 günlük dönem.
  const eventsOk = !!cur && !!prev && daysBetween(cur.from, cur.to) <= MAX_EVENT_DAYS
  const shiftOn = shift > 0 && eventsOk
  const needEvents = eventsOk && (shiftOn || view === 'die')
  const shiftRows = (useQuery(api.oee.shifts, shiftOn ? q : 'skip') ?? []) as ShiftRow[]
  const curEvRaw = useQuery(api.oee.downtimeDays, needEvents && cur ? { from: cur.from, to: cur.to } : 'skip') as
    StoredDowntimeDay[] | undefined
  const prevEvRaw = useQuery(api.oee.downtimeDays, needEvents && prev ? { from: prev.from, to: prev.to } : 'skip') as
    StoredDowntimeDay[] | undefined
  const curEvents = useMemo(() => (curEvRaw ?? []).map(fromStoredDay), [curEvRaw])
  const prevEvents = useMemo(() => (prevEvRaw ?? []).map(fromStoredDay), [prevEvRaw])
  const eventsLoading = needEvents && (curEvRaw === undefined || prevEvRaw === undefined)

  const scope = effectiveScope(sel.scope, areaNames(dayRows, config))
  const machineOptions = useMemo(
    () => [...new Set(dayRows.filter((r) => inScope(r, scope, config)).map((r) => r.workCenter))].sort(),
    [dayRows, scope, config],
  )
  // Hat ya da alan değişince seçimin dışında kalan makine yok sayılır.
  const machine = machineOptions.includes(machineRaw) ? machineRaw : ''
  const inSel = (r: { workCenter: string; costCenter: string }) => inScope(r, scope, config) && (!machine || r.workCenter === machine)
  const wcCostCenter = useMemo(() => costCentersOf(dayRows), [dayRows])
  // Vardiyalar: Company settings → Shifts (adlarıyla), yoksa OEE ayarındaki kodların numaraları.
  const shiftOptions = useMemo(() => {
    const named = ctx?.active?.shifts ?? []
    const numbers = [...new Set(config.shifts.map((x) => x.number))].sort((a, b) => a - b)
    return numbers.map((n) => {
      const d = named.find((x) => x.number === n)
      return { number: n, label: d ? `${n} · ${d.name}` : `Shift ${n}` }
    })
  }, [config.shifts, ctx?.active?.shifts])

  const part = (r: { from: string; to: string } | null, events: DowntimeDay[]) => {
    if (!r) return null
    const inRange = (x: { date: string }) => x.date >= r.from && x.date <= r.to
    const ordsIn = orders.filter((o) => inRange(o) && inSel({ workCenter: o.workCenter, costCenter: wcCostCenter.get(o.workCenter) ?? '' }))
    // Tek vardiya: vardiya satırları, o vardiyanın duruşları ve siparişleri; yoksa gün özetleri.
    const slice = shiftOn
      ? shiftSlice(shift, config, { shifts: shiftRows.filter(inRange), events: events.filter(inRange), orders: ordsIn })
      : null
    const days = (slice ? slice.days : dayRows).filter((d) => inRange(d) && inSel(d))
    const scoped = (slice ? slice.lossDays : lossDays).filter((l) => inRange(l) && inSel(l))
    // Level 3 köprüyle aynı tabanı kullanır: yalnızca vardiyası olan gün × makine.
    const losses = matchedLossDays(days, scoped)
    const keys = new Set(losses.map((l) => `${l.date}|${l.workCenter}`))
    const evs = (slice ? slice.events : events).filter((d) => keys.has(`${d.date}|${d.workCenter}`))
    return { days, lossDays: losses, orders: slice ? slice.orders : ordsIn, events: evs, bridge: buildBridge(days, scoped, config) }
  }
  const deps = [dayRows, lossDays, orders, config, scope.area, scope.key, machine, shiftOn, shift, shiftRows]
  const now = useMemo(() => part(cur, curEvents), [...deps, curEvents, cur?.from, cur?.to]) // eslint-disable-line react-hooks/exhaustive-deps
  const before = useMemo(() => part(prev, prevEvents), [...deps, prevEvents, prev?.from, prev?.to]) // eslint-disable-line react-hooks/exhaustive-deps
  const b = now?.bridge
  const pb = before?.bridge
  const hasData = !!b && b.totals.loading > 0
  const prevOk = prevFull && !!pb && pb.totals.loading > 0

  // Level 3: seçilen kalem, yoksa öncelik, yoksa en büyük.
  const items = b?.items ?? []
  const selectedItem: LossItem | undefined = items.find((i) => i.key === picked) ?? items.find((i) => i.priority) ?? items[0]
  const views = selectedItem ? level3Views(selectedItem, eventsOk) : []
  const activeView = view && views.includes(view) ? view : views[0]
  const l3 = useMemo(() => {
    if (!selectedItem || !activeView || !now || !before) return []
    return topN(level3(selectedItem, activeView, config, now, prevOk ? before : { days: [], lossDays: [], orders: [] }), 5)
  }, [selectedItem, activeView, now, before, config, prevOk])
  const prevItems = useMemo(() => new Map((prevOk ? (pb?.items ?? []) : []).map((i) => [i.key, i])), [pb, prevOk])
  const selectable = useMemo(() => new Set(items.map((i) => i.key)), [items])

  const notes = [
    ...(cur?.clipped ? [`The data ends on ${dm(cur.to)} — the period is shown up to that day.`] : []),
    ...(wanted && lastDay && wanted.from > lastDay
      ? [`No OEE data uploaded for ${rangeText(wanted)} yet (data ends on ${dm(lastDay)}).`]
      : []),
    ...(prev && !prevFull && b
      ? [`No comparison: the previous period (${rangeText(prev)}) starts before the first uploaded day (${firstDay ? dm(firstDay) : '—'}).`]
      : []),
    ...(shift > 0 && !eventsOk ? [`The shift filter works for periods of up to ${MAX_EVENT_DAYS} days — all shifts are shown.`] : []),
    ...(shiftOn && b ? [`Shift ${shift}: times from the shift rows, losses from the downtimes of that shift.`] : []),
    ...(b?.warnings ?? []),
  ]
  const priority = items.find((i) => i.priority)
  const prevPriority = priority ? prevItems.get(priority.key) : undefined
  const label = `${scopeLabel(scope, config)}${machine ? ` · ${machine}` : ''}${shiftOn ? ` · ${shiftOptions.find((o) => o.number === shift)?.label ?? `Shift ${shift}`}` : ''}`
  // Önceki dönem tam yüklü değilse ya da verisi yoksa fark gösterilmez.
  const delta = (a: number | null | undefined, p: number | null | undefined) =>
    !prevOk || a === null || a === undefined || p === null || p === undefined ? null : (a - p) * 100

  const periodControl = (
    <>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Period
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value as PeriodPreset)}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
        >
          {PERIOD_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {preset === 'custom' && (
        <>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            From
            <input
              type="date"
              value={custom.from}
              onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            To (max {MAX_CUSTOM_DAYS} days)
            <input
              type="date"
              value={custom.to}
              onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
        </>
      )}
      {shiftOptions.length > 0 && (
        <label
          className="flex flex-col gap-1 text-xs text-muted-foreground"
          title={eventsOk ? undefined : `The shift filter works for periods of up to ${MAX_EVENT_DAYS} days`}
        >
          Shift
          <select
            value={eventsOk ? shift : 0}
            disabled={!eventsOk}
            onChange={(e) => setShift(Number(e.target.value))}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
          >
            <option value={0}>All shifts</option>
            {shiftOptions.map((o) => (
              <option key={o.number} value={o.number}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {machineOptions.length > 1 && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Machine
          <select
            value={machine}
            onChange={(e) => setMachine(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
          >
            <option value="">All in the selection</option>
            {machineOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      )}
      <span className="pb-2 text-xs text-muted-foreground">
        {cur ? (
          <>
            <strong className="text-foreground">{rangeText(cur)}</strong> · {daysBetween(cur.from, cur.to)} day(s) · vs{' '}
            {prev ? rangeText(prev) : '—'}
          </>
        ) : (
          'No data for this period'
        )}
      </span>
    </>
  )

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title="OEE Loss Bridge"
        summary="Loading time is 100% — each loss as a share of it, down to the OEE. Which loss to attack first."
        links={relatedPages('/oee/bridge')}
        info={
          <>
            <p>
              <b>Loading time = 100%</b> → unplanned downtimes (by chart column) → <b>Availability</b> → performance losses → <b>A × P</b> →
              quality losses → <b>OEE</b>. Every loss is a percentage of the loading time, so OEE + all losses = 100%.
            </p>
            <p>
              The loading time already leaves out the planned stops (breaks, planned meetings …), as in the MES and the OEE Dashboard — they
              are not taken off again; they are listed under the bridge for information. OEE, A, P and Q here are exactly the
              Dashboard&apos;s (A = production ÷ loading, P = operation ÷ production). Example: A 80% and P 80% give OEE 64% — 20%
              availability loss and 16% performance loss (20% of the 80% production time).
            </p>
            <p>
              The downtime groups are shown as recorded. If the records add up to a little more or less than Loading − Production, the
              difference is its own small grey step — normal, never spread over the groups.
            </p>
            <p>
              Priority: the biggest loss. Not explained, undefined, a speed gain and planned stops are never the priority. Level 3 shows the
              top 5 of the selected loss with count and MTTR (many short stops → small fixes; few long ones → maintenance).
            </p>
          </>
        }
      />
      <OeeControls selection={sel} rows={dayRows} config={config} period={periodControl} />
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
        <div ref={sheetRef} className="bridge-sheet oee-viz min-w-0 bg-background">
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">
              {label} <span className="font-normal text-muted-foreground">· {cur ? rangeText(cur) : ''}</span>
            </h2>
            <button
              type="button"
              onClick={() => sheetRef.current && printSheet(sheetRef.current, `OEE loss bridge ${label} ${cur?.from ?? ''}`)}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground print:hidden"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden /> Print A3
            </button>
          </div>

          {/* Kutular */}
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
            <Tile
              label="OEE"
              value={pctOf(b!.oee)}
              delta={delta(b!.oee, pb?.oee)}
              sub={`${hours(b!.baseMinutes)} loading · ${b!.coverage.dayRows} machine-day(s)`}
              strong
            />
            <Tile
              label={`Availability${config.lossGroups.some((g) => g.family === 'performance') ? ' (bridge split)' : ''}`}
              value={pctOf(b!.availability)}
              delta={delta(b!.availability, pb?.availability)}
              sub={`loss ${pctOf(b!.level1?.availability)} of loading`}
            />
            <Tile
              label="Performance"
              value={pctOf(b!.performance)}
              delta={delta(b!.performance, pb?.performance)}
              sub={`loss ${pctOf(b!.level1?.performance)} of loading`}
            />
            <Tile
              label="Quality"
              value={pctOf(b!.quality)}
              delta={delta(b!.quality, pb?.quality)}
              sub={`loss ${pctOf(b!.level1?.quality)} of loading`}
            />
            {priority ? (
              <button
                type="button"
                onClick={() => setPicked(priority.key)}
                className="col-span-2 rounded-xl border-2 border-destructive/60 bg-destructive/5 p-3 text-left lg:col-span-1"
              >
                <p className="text-[11px] font-bold tracking-wide text-destructive uppercase">Priority · {FAMILY_LABEL[priority.family]}</p>
                <p className="mt-0.5 truncate text-lg font-bold text-foreground">{priority.label}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {pctOf(priority.share)} of loading · {hours(priority.minutes)}
                  {prevPriority && ` · before ${pctOf(prevPriority.share)}`}
                </p>
              </button>
            ) : (
              <Tile label="Priority" value="—" sub="no attackable loss" />
            )}
          </div>

          {/* Köprü */}
          <section className="mt-4 rounded-xl border border-border p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                Bridge — % of loading time{' '}
                <span className="font-normal text-muted-foreground">
                  · {pctOf(1)} − losses = OEE {pctOf(b!.oee)}
                </span>
              </h3>
              <Legend />
            </div>
            <div className="mt-2">
              <BridgeChart bridge={b!} selected={selectedItem?.key ?? null} onSelect={(k) => setPicked(k)} selectable={selectable} />
            </div>
            {b!.outside.length > 0 && (
              <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
                <b className="font-semibold text-foreground">Outside OEE</b> — planned stops, already left out of the loading time (not
                taken off again): {b!.outside.map((o) => `${o.label} ${hours(o.minutes)}`).join(' · ')}
              </p>
            )}
          </section>

          {/* Dağılım */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[auto_auto_1fr]">
            <section className="rounded-xl border border-border p-4">
              <StackColumn
                title="OEE deployment"
                parts={[
                  { label: 'OEE', share: b!.level1?.oee ?? 0, color: 'var(--viz-3)', strong: true },
                  { label: 'Loss', share: 1 - (b!.level1?.oee ?? 0), color: '#c0362c' },
                ]}
              />
            </section>
            <section className="rounded-xl border border-border p-4">
              <StackColumn
                title="Level 1 — OEE + losses = 100%"
                parts={[
                  { label: 'OEE', share: b!.level1?.oee ?? 0, color: 'var(--viz-3)', strong: true },
                  { label: 'Availability', share: b!.level1?.availability ?? 0, color: FAMILY_SWATCH.availability },
                  { label: 'Performance', share: b!.level1?.performance ?? 0, color: FAMILY_SWATCH.performance },
                  { label: 'Quality', share: b!.level1?.quality ?? 0, color: FAMILY_SWATCH.quality },
                ]}
              />
            </section>
            <section className="min-w-0 rounded-xl border border-border p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Level 2 — losses, % of loading</p>
                <span className="text-[11px] text-muted-foreground">Δ points vs the previous period · click for Level 3</span>
              </div>
              <div className="mt-2">
                <Level2Bars items={items} previous={prevItems} selected={selectedItem?.key ?? null} onSelect={setPicked} />
              </div>
            </section>
          </div>

          {/* Level 3 */}
          {selectedItem && (
            <section className="mt-4 rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">
                  Level 3 — {selectedItem.label}{' '}
                  <span className="font-normal text-muted-foreground">
                    · {pctOf(selectedItem.share)} of loading · {hours(selectedItem.minutes)} · top 5
                  </span>
                </p>
                {views.length > 1 && (
                  <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Level 3 view">
                    {views.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setView(v)}
                        aria-pressed={activeView === v}
                        className={`rounded px-2.5 py-1 text-xs font-medium ${activeView === v ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'}`}
                      >
                        {VIEW_LABEL[v]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-2">
                {activeView === 'die' && eventsLoading ? (
                  <p className="text-xs text-muted-foreground">Loading the downtimes…</p>
                ) : l3.length ? (
                  <Level3Table
                    rows={l3}
                    total={selectedItem.minutes}
                    base={b!.baseMinutes}
                    unit={selectedItem.family === 'quality' ? 'pcs' : 'min'}
                    showMttr={selectedItem.groups.length > 0}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {selectedItem.key === 'pf:speed' && activeView === 'die'
                      ? 'No order-based data for this period.'
                      : 'Nothing recorded for this loss.'}
                  </p>
                )}
              </div>
              <ActionLinks item={selectedItem} canOpen={canOpen} />
            </section>
          )}

          {/* Tablo */}
          <details className="mt-4 rounded-xl border border-border p-4">
            <summary className="cursor-pointer text-sm font-semibold text-foreground">Bridge table</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-1.5 pr-2 text-left font-medium">Step</th>
                    <th className="py-1.5 pr-2 text-right font-medium">% of loading</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Previous</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Hours</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Minutes</th>
                    <th className="py-1.5 text-left font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {b!.steps.map((s) => {
                    const p = pb?.steps.find((x) => x.key === s.key)
                    return (
                      <tr key={s.key} className={`border-b border-border/60 ${s.kind === 'total' ? 'font-semibold' : ''}`}>
                        <td className="py-1 pr-2">
                          {s.kind === 'loss' ? (
                            <span
                              className="mr-1.5 inline-block h-2 w-2 rounded-sm"
                              style={{ background: FAMILY_SWATCH[s.family ?? 'availability'] }}
                            />
                          ) : null}
                          {s.kind === 'loss' ? '− ' : ''}
                          {s.label}
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">
                          {b!.baseMinutes > 0 ? pctOf(s.minutes / b!.baseMinutes) : '—'}
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">
                          {p && prevOk && pb!.baseMinutes > 0 ? pctOf(p.minutes / pb!.baseMinutes) : '—'}
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">{hours(s.minutes)}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{Math.round(s.minutes).toLocaleString('en-GB')}</td>
                        <td className="py-1 text-muted-foreground">{s.note ?? ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </div>
  )
}

function Tile({
  label,
  value,
  sub,
  delta,
  strong,
}: {
  label: string
  value: string
  sub?: string
  delta?: number | null
  strong?: boolean
}) {
  return (
    <div className={`rounded-xl border p-3 ${strong ? 'border-[var(--viz-3)]/50 bg-emerald-50/50' : 'border-border'}`}>
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-0.5 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-foreground tabular-nums">{value}</span>
        {delta !== undefined && delta !== null && Math.abs(delta) >= 0.05 && (
          <span
            className={`text-xs font-semibold tabular-nums ${delta > 0 ? 'text-emerald-700' : 'text-destructive'}`}
            title="Change against the previous period (points)"
          >
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}
          </span>
        )}
      </p>
      {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Legend() {
  const items: { label: string; color: string }[] = [
    { label: 'Total', color: 'var(--viz-1)' },
    { label: FAMILY_LABEL.availability, color: FAMILY_SWATCH.availability },
    { label: 'Records vs MES difference', color: FAMILY_SWATCH.notScheduled },
    { label: FAMILY_LABEL.performance, color: FAMILY_SWATCH.performance },
    { label: FAMILY_LABEL.quality, color: FAMILY_SWATCH.quality },
    { label: 'OEE', color: 'var(--viz-3)' },
  ]
  return (
    <div className="oee-viz flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}

/** Önceliği aksiyona çeviren sayfalar (izinli olanlar). */
function ActionLinks({ item, canOpen }: { item: LossItem; canOpen: (p: string) => boolean }) {
  const links: { to: string; label: string }[] = []
  if (item.family === 'availability' || item.family === 'planned') {
    links.push(
      { to: '/die-followup/problems', label: 'Die problems' },
      { to: '/machine-followup/breakdowns', label: 'Machine breakdowns' },
      { to: '/oee/losses', label: 'Losses Trend (setups, MTTR / MTBF)' },
    )
  } else if (item.family === 'performance') {
    links.push({ to: '/oee/losses', label: 'Losses Trend (worst dies, speed loss)' })
  } else if (item.family === 'quality') {
    links.push({ to: '/die-followup/problems', label: 'Die problems' })
  }
  if (item.key === 'av:unexplained')
    links.splice(0, links.length, { to: '/oee/data', label: 'Uploaded downtimes (which machine records no reason)' })
  const shown = links.filter((l) => canOpen(l.to))
  if (!shown.length) return null
  return (
    <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground print:hidden">
      Act on it:
      {shown.map((l) => (
        <Link key={l.to} to={l.to} className="font-medium text-foreground underline underline-offset-2">
          {l.label}
        </Link>
      ))}
    </p>
  )
}
