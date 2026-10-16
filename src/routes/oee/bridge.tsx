import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { BridgeChart, FAMILY_LABEL, FAMILY_SWATCH, Level2Bars, Level3Table, Gauge, hours, pctOf } from '../../components/OeeBridgeCharts'
import { DieFollowUpDialog, FollowUpTime, type FollowUpDraft } from '../../components/DieFollowUpDialog'
import { OeePeriodFields, dm, rangeText, useOeePeriod, useShiftOptions } from '../../components/OeePeriodControl'
import { OeeControls, OeeDataNotice, effectiveScope, useOeeConfig, useOeeSelection } from '../../components/OeePanel'
import { PageHeader } from '../../components/PageHeader'
import { SavePdfButton } from '../../components/SavePdfButton'
import { useQuery } from '../../lib/convexTransport'
import { relatedPages } from '../../lib/navigation'
import { areaNames, costCentersOf, inScope, scopeLabel, type DayRow, type DowntimeDay, type OrderRow, type ShiftRow } from '../../lib/oee'
import {
  MAX_EVENT_DAYS,
  NO_PART,
  buildBridge,
  hasParts,
  isPartRow,
  level3,
  level3Views,
  matchedLossDays,
  parsePeriodLink,
  partDays,
  shiftSlice,
  topN,
  type Level3By,
  type Level3Row,
  type LossItem,
} from '../../lib/oeeBridge'
import { fromStoredDay, fromStoredLosses, type StoredDowntimeDay, type StoredLossDay } from '../../lib/oeeStore'
import { reasonShiftParts, type ReasonPartRow } from '../../lib/oeeReliability'
import { useCanOpen, usePlant } from '../../lib/plantContext'
import { pdfFileName } from '../../lib/pdfFile'
import { sheetToPdf } from '../../lib/pdfSheet'

export const Route = createFileRoute('/oee/bridge')({
  validateSearch: parsePeriodLink,
  component: BridgePage,
})

const VIEW_LABEL: Record<Level3By, string> = {
  reason: 'By reason',
  machine: 'By machine',
  part: 'By part',
}

/**
 * OEE Loss Bridge (docs/oee-bridge.md): seçilen makine ya da hattın
 * zamanı takvimden efektif süreye adım adım; Level 1 / 2 / 3 kayıp dağılımı
 * ve öncelik. Hesap src/lib/oeeBridge.ts (test edilir); OEE, OEE Dashboard
 * ile aynı tanım ve toplama (Loading tabanında birebir).
 */
function BridgePage() {
  const sel = useOeeSelection()
  const { config } = useOeeConfig()
  const canOpen = useCanOpen()
  // Dönem: tek gün ya da tarih aralığı; boşsa son yüklenen gün (OeePeriodControl).
  const link = Route.useSearch()
  const period = useOeePeriod(link)
  const { lastDay, firstDay, wanted, cur, prev, prevFull } = period
  // Vardiya ve makine bütün OEE sayfalarında ortak (src/lib/oeeFilters.ts).
  const { shift, setShift, machine: machineRaw, setMachine } = period
  const [picked, setPicked] = useState<string | null>(null)
  const [view, setView] = useState<Level3By | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  // Sorgu aralığı: önceki dönemin başından bu dönemin sonuna (veri yoksa dünkü gün, boş döner).
  const q = cur && prev ? { from: prev.from, to: cur.to } : { from: wanted.from, to: wanted.to }
  const dayRows = (useQuery(api.oee.days, q) ?? []) as DayRow[]
  const lossRaw = (useQuery(api.oee.lossDays, q) ?? []) as StoredLossDay[]
  const orders = (useQuery(api.oee.orders, q) ?? []) as OrderRow[]
  const lossDays = useMemo(() => fromStoredLosses(lossRaw), [lossRaw])

  // Vardiya filtresi ham duruşlarla: en çok 8 günlük dönem. Duruşların parça
  // kırılımı kayıp özetinden (her dönem); eski özetlerde ham duruşlardan.
  const eventsOk = period.eventsOk
  const shiftOn = shift > 0 && eventsOk
  const storedParts = hasParts(lossDays)
  const partsReady = shiftOn || storedParts
  const needEvents = eventsOk && (shiftOn || (view === 'part' && !storedParts))
  const shiftRows = (useQuery(api.oee.shifts, shiftOn ? q : 'skip') ?? []) as ShiftRow[]
  // Bu dönemin ham duruşları kısa dönemde her zaman: kalemlerin vardiyası ve
  // kaleme tıklayınca hangi referans / vardiya (Aksiyonlar sunumu, 2026-10-14).
  const curEvRaw = useQuery(api.oee.downtimeDays, eventsOk && cur ? { from: cur.from, to: cur.to } : 'skip') as
    StoredDowntimeDay[] | undefined
  const prevEvRaw = useQuery(api.oee.downtimeDays, needEvents && prev ? { from: prev.from, to: prev.to } : 'skip') as
    StoredDowntimeDay[] | undefined
  const curEvents = useMemo(() => (curEvRaw ?? []).map(fromStoredDay), [curEvRaw])
  const prevEvents = useMemo(() => (prevEvRaw ?? []).map(fromStoredDay), [prevEvRaw])
  const eventsLoading = needEvents && (curEvRaw === undefined || prevEvRaw === undefined)
  const [reason, setReason] = useState<string | null>(null)
  // Başka adım seçilince neden süzgeci kalkar.
  useEffect(() => setReason(null), [picked, view])

  const scope = effectiveScope(sel.scope, areaNames(dayRows, config))
  const machineOptions = useMemo(
    () => [...new Set(dayRows.filter((r) => inScope(r, scope, config)).map((r) => r.workCenter))].sort(),
    [dayRows, scope, config],
  )
  // Hat ya da alan değişince seçimin dışında kalan makine yok sayılır.
  const machine = machineOptions.includes(machineRaw) ? machineRaw : ''
  const inSel = (r: { workCenter: string; costCenter: string }) => inScope(r, scope, config) && (!machine || r.workCenter === machine)
  const wcCostCenter = useMemo(() => costCentersOf(dayRows), [dayRows])
  const shiftOptions = useShiftOptions(config)

  const part = (r: { from: string; to: string } | null, events: DowntimeDay[]) => {
    if (!r) return null
    const inRange = (x: { date: string }) => x.date >= r.from && x.date <= r.to
    const ordsIn = orders.filter(
      (o) =>
        inRange(o) &&
        inSel({
          workCenter: o.workCenter,
          costCenter: wcCostCenter.get(o.workCenter) ?? '',
        }),
    )
    // Tek vardiya: vardiya satırları, o vardiyanın duruşları ve siparişleri; yoksa gün özetleri.
    const slice = shiftOn
      ? shiftSlice(shift, config, {
          shifts: shiftRows.filter(inRange),
          events: events.filter(inRange),
          orders: ordsIn,
        })
      : null
    const days = (slice ? slice.days : dayRows).filter((d) => inRange(d) && inSel(d))
    const scoped = (slice ? slice.lossDays : lossDays).filter((l) => inRange(l) && inSel(l))
    // Level 3 köprüyle aynı tabanı kullanır: yalnızca vardiyası olan gün × makine.
    const losses = matchedLossDays(days, scoped)
    const keys = new Set(losses.map((l) => `${l.date}|${l.workCenter}`))
    const evs = (slice ? slice.events : events).filter((d) => keys.has(`${d.date}|${d.workCenter}`))
    return {
      days,
      lossDays: losses,
      orders: slice ? slice.orders : ordsIn,
      events: evs,
      bridge: buildBridge(days, scoped, config),
    }
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
  const views = selectedItem ? level3Views(selectedItem, partsReady || eventsOk) : []
  const activeView = view && views.includes(view) ? view : views[0]
  const l3All = useMemo(() => {
    if (!selectedItem || !activeView || !now || !before) return []
    return level3(selectedItem, activeView, config, now, prevOk ? before : { days: [], lossDays: [], orders: [] })
  }, [selectedItem, activeView, now, before, config, prevOk])
  const l3 = topN(l3All, 8)
  // Parça saatine tıklayınca Die Follow-up'a takip konusu (planlamacı, 2026-10-13).
  const { canArea } = usePlant()
  const [draft, setDraft] = useState<FollowUpDraft | null>(null)
  const canFollow = canArea('die.problems', 'edit') || canArea('planning.plan', 'edit')
  const followUp = canFollow
    ? (r: Level3Row) => {
        if (!selectedItem || !now || !cur) return
        setDraft({
          material: r.label,
          press: r.sub ?? machine,
          loss: selectedItem.label,
          minutes: r.minutes,
          days: partDays(selectedItem, r.key, config, now),
          period: rangeText(cur),
        })
      }
    : undefined
  // Yan panelde her zaman "hangi parçadan kaç saat" (planlamacı, 2026-10-13):
  // seçili görünüm parça değilse ayrıca kısa liste.
  const partRows = useMemo(() => {
    if (!selectedItem || !now || !before || activeView === 'part' || !views.includes('part')) return []
    const fromOrders = selectedItem.key === 'pf:speed' || selectedItem.family === 'quality'
    if (!fromOrders && !partsReady) return []
    return topN(level3(selectedItem, 'part', config, now, prevOk ? before : { days: [], lossDays: [], orders: [] }), 6)
  }, [selectedItem, activeView, views.join(), now, before, config, prevOk, partsReady]) // eslint-disable-line react-hooks/exhaustive-deps
  // Nedenlerin vardiyası ve neden × parça × vardiya (ham duruşlar, en çok 8 gün).
  const stopDetail = useMemo(() => {
    if (!selectedItem || !now || !eventsOk || curEvRaw === undefined || !selectedItem.groups.length || selectedItem.family === 'planned') return null
    return reasonShiftParts(now.events ?? [], selectedItem.groups, config)
  }, [selectedItem, now, eventsOk, curEvRaw, config])
  const pickedReason = activeView === 'reason' && reason && stopDetail?.parts.has(reason) ? reason : null
  const reasonParts = pickedReason ? (stopDetail?.parts.get(pickedReason) ?? []) : []
  // Neden × parça × vardiya saatine tıklayınca da Die Follow-up (planlamacı, 2026-10-16).
  const followReason =
    canFollow && pickedReason
      ? (r: ReasonPartRow) => {
          if (!selectedItem || !cur) return
          setDraft({
            material: r.material,
            press: r.workCenter,
            loss: selectedItem.label,
            detail: [pickedReason, r.shift ? `Shift ${r.shift}` : ''].filter(Boolean).join(' · '),
            minutes: r.minutes,
            days: r.days,
            period: rangeText(cur),
          })
        }
      : undefined
  const shiftCell =
    activeView === 'reason' && stopDetail
      ? (r: Level3Row) => {
          const by = stopDetail.shifts.get(r.label)
          if (!by) return '—'
          return [...by]
            .filter(([, m]) => m > 0.05)
            .sort((a, b) => (a[0] ?? 99) - (b[0] ?? 99))
            .map(([sh, m]) => `S${sh ?? '?'} ${Math.round(m)}′`)
            .join(' · ')
        }
      : undefined
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
    <OeePeriodFields
      period={period}
      shift={shift}
      setShift={setShift}
      shiftOptions={shiftOptions}
      machine={machine}
      setMachine={setMachine}
      machineOptions={machineOptions}
    />
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
              The loading time already leaves out the planned stops (breaks, planned meetings …), as in the MES and OEE Trend Analysis —
              they are not taken off again; they are listed under the bridge for information. OEE, A, P and Q here are exactly the
              Dashboard&apos;s (A = production ÷ loading, P = operation ÷ production). Example: A 80% and P 80% give OEE 64% — 20%
              availability loss and 16% performance loss (20% of the 80% production time).
            </p>
            <p>
              The downtime groups are shown as recorded. If the records add up to a little more or less than Loading − Production, the
              difference is its own small grey step — normal, never spread over the groups.
            </p>
            <p>
              Priority: the biggest loss. Not explained, undefined, a speed gain and planned stops are never the priority. Click a step of
              the bridge (or a Level 2 bar): its details open next to the chart — the top 8 by reason, machine or part (MATERIAL) with
              hours, count and MTTR (many short stops → small fixes; few long ones → maintenance), and the hours per part.
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
            <SavePdfButton
              variant="plain"
              label="Save PDF (A3)"
              fileName={pdfFileName(cur?.to ?? '', 'OEE LOSS BRIDGE')}
              disabled={!cur}
              make={() => sheetToPdf(sheetRef.current!, { size: 'A3', orientation: 'landscape', pages: 'fit' })}
            />
          </div>

          {/* Göstergeler yarı boyda solda tek blok; sağda "Pay Attention" (Aksiyonlar sunumu, 2026-10-14). */}
          <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="min-w-0 rounded-xl border border-border p-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <GaugeTile
                  label="OEE"
                  value={b!.oee}
                  delta={delta(b!.oee, pb?.oee)}
                  color="var(--viz-3)"
                  lines={[
                    ['Loading', hours(b!.totals.loading)],
                    ['Effective', hours(b!.totals.effective)],
                  ]}
                  strong
                />
                <GaugeTile
                  label={`Availability${config.lossGroups.some((g) => g.family === 'performance') ? ' (bridge)' : ''}`}
                  value={b!.availability}
                  delta={delta(b!.availability, pb?.availability)}
                  color={FAMILY_SWATCH.availability}
                  lines={[
                    ['Production', hours(b!.totals.production)],
                    ['÷ Loading', hours(b!.totals.loading)],
                  ]}
                />
                <GaugeTile
                  label="Performance"
                  value={b!.performance}
                  delta={delta(b!.performance, pb?.performance)}
                  color={FAMILY_SWATCH.performance}
                  lines={[
                    ['Operation', hours(b!.totals.operating)],
                    ['÷ Production', hours(b!.totals.production)],
                  ]}
                />
                <GaugeTile
                  label="Quality"
                  value={b!.quality}
                  delta={delta(b!.quality, pb?.quality)}
                  color={FAMILY_SWATCH.quality}
                  lines={[
                    ['Effective', hours(b!.totals.effective)],
                    ['÷ Operation', hours(b!.totals.operating)],
                  ]}
                />
              </div>
              {priority ? (
                <button
                  type="button"
                  onClick={() => setPicked(priority.key)}
                  className="mt-2 flex w-full flex-wrap items-baseline gap-x-2 rounded-lg border-2 border-destructive/60 bg-destructive/5 px-3 py-1.5 text-left"
                >
                  <span className="text-[11px] font-bold tracking-wide text-destructive uppercase">Priority · {FAMILY_LABEL[priority.family]}</span>
                  <span className="text-sm font-bold text-foreground">{priority.label}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {pctOf(priority.share)} of loading · {hours(priority.minutes)}
                    {prevPriority && ` · before ${pctOf(prevPriority.share)}`}
                  </span>
                </button>
              ) : (
                <p className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground">Priority: — no attackable loss</p>
              )}
            </section>
            <PayAttention />
          </div>

          {/* Köprü yarım genişlikte; yanında tıklanan adımın ayrıntısı (planlamacı, 2026-10-13). */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="min-w-0 rounded-xl border border-border p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  Bridge — % of loading time{' '}
                  <span className="font-normal text-muted-foreground">
                    · {pctOf(1)} − losses = OEE {pctOf(b!.oee)}
                  </span>
                </h3>
                <Legend />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground print:hidden">
                Click a step — its details open <span className="hidden lg:inline">on the right</span>
                <span className="lg:hidden">below</span>.
              </p>
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

            {selectedItem ? (
              <section className="min-w-0 rounded-xl border-2 border-foreground/15 p-3 sm:p-4">
                <StepHeader item={selectedItem} previous={prevItems.get(selectedItem.key)} rows={l3All} />
                {views.length > 1 && (
                  <div className="mt-3 flex w-fit rounded-md border border-border p-0.5" role="group" aria-label="Breakdown">
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
                <div className="mt-2">
                  {activeView === 'part' && !partsReady && eventsLoading ? (
                    <p className="text-xs text-muted-foreground">Loading the downtimes…</p>
                  ) : l3.length ? (
                    <Level3Table
                      rows={l3}
                      total={selectedItem.minutes}
                      base={b!.baseMinutes}
                      unit={selectedItem.family === 'quality' ? 'pcs' : 'min'}
                      showMttr={selectedItem.groups.length > 0}
                      compact
                      shift={shiftCell}
                      onRow={activeView === 'reason' && stopDetail ? (r) => setReason(reason === r.label ? null : r.label) : undefined}
                      activeKey={pickedReason}
                      action={
                        activeView === 'part' && followUp
                          ? (r) =>
                              isPartRow(r) ? (
                                <button
                                  type="button"
                                  onClick={() => followUp(r)}
                                  className="rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted print:hidden"
                                  title="Add to Die Follow-up with an action"
                                >
                                  + Follow up
                                </button>
                              ) : null
                          : undefined
                      }
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {selectedItem.key === 'pf:speed' && activeView === 'part'
                        ? 'No order-based data for this period.'
                        : 'Nothing recorded for this loss.'}
                    </p>
                  )}
                </div>
                {activeView === 'reason' && stopDetail && (
                  <p className="mt-1 text-[11px] text-muted-foreground print:hidden">
                    Click an item: below, which part (reference) and which shift it was lost in.
                  </p>
                )}
                {pickedReason ? (
                  <ReasonParts reason={pickedReason} rows={reasonParts} onClear={() => setReason(null)} onPick={followReason} />
                ) : (
                  partRows.length > 0 && <PartHours rows={partRows} total={selectedItem.minutes} onMore={() => setView('part')} onPick={followUp} />
                )}
                <ActionLinks item={selectedItem} canOpen={canOpen} />
              </section>
            ) : (
              <section className="flex items-center justify-center rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                Click a step in the bridge to see what it is made of.
              </section>
            )}
          </div>

          {/* Level 2 ve köprü tablosu hesapta duruyor, ekranda gösterilmez: üstteki
              grafik aynısını veriyor (Aksiyonlar sunumu, 2026-10-14). */}
          <div className="mt-4" hidden>
            <section className="min-w-0 rounded-xl border border-border p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Level 2 — losses, % of loading</p>
                <span className="text-[11px] text-muted-foreground">Δ points vs the previous period · click for details</span>
              </div>
              <div className="mt-2">
                <Level2Bars items={items} previous={prevItems} selected={selectedItem?.key ?? null} onSelect={setPicked} />
              </div>
            </section>
          </div>

          {/* Tablo */}
          <details className="mt-4 rounded-xl border border-border p-4" hidden>
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
                              style={{
                                background: FAMILY_SWATCH[s.family ?? 'availability'],
                              }}
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
      {draft && <DieFollowUpDialog draft={draft} onClose={() => setDraft(null)} />}
    </div>
  )
}

/** Yarı boy gösterge (Aksiyonlar sunumu, 2026-10-14): dört gösterge sol blokta yan yana. */
function GaugeTile({
  label,
  value,
  delta,
  color,
  lines,
  strong,
}: {
  label: string
  value: number | null
  delta: number | null
  color: string
  lines: [string, string][]
  strong?: boolean
}) {
  return (
    <div className={`min-w-0 rounded-lg border px-2 py-1.5 ${strong ? 'border-[var(--viz-3)]/50 bg-emerald-50/50 dark:bg-emerald-950/20' : 'border-border'}`}>
      <p className="flex items-baseline justify-between gap-1 text-[10px] font-bold tracking-wide text-foreground uppercase">
        <span className="truncate">{label}</span>
        {delta !== null && Math.abs(delta) >= 0.05 && (
          <span
            className={`text-[10px] font-semibold normal-case tabular-nums ${delta > 0 ? 'text-emerald-700' : 'text-destructive'}`}
            title="Change against the previous period (points)"
          >
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}
          </span>
        )}
      </p>
      <div className="mx-auto max-w-[120px]">
        <Gauge value={value} color={color} label={label} />
      </div>
      <p className="-mt-1 text-center text-lg font-bold text-foreground tabular-nums">{pctOf(value)}</p>
      <dl className="mt-0.5 space-y-0 text-[10px] leading-tight">
        {lines.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-1">
            <dt className="truncate text-muted-foreground">{k}</dt>
            <dd className="font-semibold text-foreground tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** "Pay Attention": ileride dikkat edilecek bilgilerle dolacak (şimdilik boş — planlamacı, 2026-10-14). */
function PayAttention() {
  return (
    <section className="flex min-h-[9rem] min-w-0 flex-col rounded-xl border-2 border-amber-400/70 bg-amber-50/60 p-3 dark:bg-amber-950/20">
      <h3 className="text-sm font-bold tracking-wide text-amber-900 uppercase dark:text-amber-200">Pay Attention</h3>
      <p className="mt-auto text-xs text-amber-900/60 dark:text-amber-200/60">Nothing here yet.</p>
    </section>
  )
}

/** Seçilen nedenin hangi parçada (referans), hangi makinede, hangi vardiyada kaybettirdiği. */
function ReasonParts({
  reason,
  rows,
  onClear,
  onPick,
}: {
  reason: string
  rows: ReasonPartRow[]
  onClear: () => void
  /** Saate tıklayınca Die Follow-up'a takip konusu (yetkisi olana). */
  onPick?: (r: ReasonPartRow) => void
}) {
  const total = rows.reduce((a, r) => a + r.minutes, 0)
  return (
    <div className="mt-3 border-t border-border pt-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">
          Hours by part (MATERIAL) · <span className="text-sky-800 dark:text-sky-300">{reason}</span>
        </p>
        <button type="button" onClick={onClear} className="text-[11px] text-muted-foreground underline underline-offset-2 print:hidden">
          All items
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">No downtime rows for this item.</p>
      ) : (
        <table className="mt-1.5 w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-1 pr-2 text-left font-medium">Part (reference)</th>
              <th className="py-1 pr-2 text-left font-medium">Work center</th>
              <th className="py-1 pr-2 text-left font-medium">Shift</th>
              <th className="py-1 pr-2 text-right font-medium">Stops</th>
              <th className="py-1 pr-2 text-right font-medium">Time</th>
              <th className="py-1 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((r) => (
              <tr key={`${r.workCenter}|${r.material}|${r.shift ?? ''}`} className="border-b border-border/60 last:border-0">
                <td className="py-1 pr-2 font-semibold text-foreground">{r.material}</td>
                <td className="py-1 pr-2 text-muted-foreground">{r.workCenter}</td>
                <td className="py-1 pr-2 tabular-nums">{r.shift ? `Shift ${r.shift}` : '—'}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{r.count}</td>
                <td className="py-1 pr-2 text-right font-semibold tabular-nums">
                  {onPick && r.material !== NO_PART ? <FollowUpTime minutes={r.minutes} onClick={() => onPick(r)} /> : hours(r.minutes)}
                </td>
                <td className="py-1 text-right tabular-nums text-muted-foreground">{total > 0 ? pctOf(r.minutes / total, 0) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/**
 * Yan panelin başı: solda aile ve adım, hemen yanında payı, süresi, duruş
 * sayısı ve MTTR — kalın başlıklarla (Aksiyonlar sunumu, 2026-10-14).
 */
function StepHeader({ item, previous, rows }: { item: LossItem; previous?: LossItem; rows: Level3Row[] }) {
  const count = rows.reduce((a, r) => a + r.count, 0)
  const delta = previous ? (item.share - previous.share) * 100 : null
  const isStops = item.groups.length > 0
  const stat = 'min-w-[4.5rem] rounded-md bg-muted/60 px-2 py-1'
  const dt = 'text-[10px] font-bold tracking-wide text-foreground uppercase'
  const dd = 'text-sm font-bold text-foreground tabular-nums'
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-foreground uppercase">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: FAMILY_SWATCH[item.family] }} />
          {FAMILY_LABEL[item.family]}
          {item.priority && <span className="rounded bg-destructive px-1 py-px text-[9px] font-bold text-white">PRIORITY</span>}
        </p>
        <p className="mt-0.5 text-xl font-bold text-foreground">{item.label}</p>
      </div>
      <dl className="flex flex-wrap gap-1.5">
        <div className={stat}>
          <dt className={dt}>% of loading</dt>
          <dd className={dd}>
            {pctOf(item.share)}
            {delta !== null && Math.abs(delta) >= 0.05 && (
              // Kayıp arttıysa kötü.
              <span className={`ml-1 text-[11px] ${delta > 0 ? 'text-destructive' : 'text-emerald-700'}`}>
                {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}
              </span>
            )}
          </dd>
        </div>
        <div className={stat}>
          <dt className={dt}>Time</dt>
          <dd className={dd}>{hours(item.minutes)}</dd>
        </div>
        <div className={stat}>
          <dt className={dt}>{item.family === 'quality' ? 'Pieces' : 'Stops'}</dt>
          <dd className={dd}>{count ? count.toLocaleString('en-GB') : '—'}</dd>
        </div>
        <div className={stat}>
          <dt className={dt}>{isStops ? 'MTTR' : 'Previous'}</dt>
          <dd className={dd}>{isStops ? (count ? `${(item.minutes / count).toFixed(1)} min` : '—') : previous ? pctOf(previous.share) : '—'}</dd>
        </div>
      </dl>
    </div>
  )
}

/** Adımın parçalara (MATERIAL) göre saatleri: kısa liste. */
function PartHours({
  rows,
  total,
  onMore,
  onPick,
}: {
  rows: Level3Row[]
  total: number
  onMore: () => void
  /** Saate tıklayınca Die Follow-up'a takip konusu (yetkisi olana). */
  onPick?: (r: Level3Row) => void
}) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.minutes)))
  return (
    <div className="mt-3 border-t border-border pt-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">Hours by part (MATERIAL)</p>
        <button type="button" onClick={onMore} className="text-[11px] text-muted-foreground underline underline-offset-2 print:hidden">
          Full list
        </button>
      </div>
      <ul className="mt-1.5 space-y-1 text-xs">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_5rem_3.5rem_3rem] items-center gap-2">
            <span className="truncate text-foreground" title={r.sub ? `${r.label} · ${r.sub}` : r.label}>
              {r.label}
              {r.sub && <span className="ml-1 text-muted-foreground">{r.sub}</span>}
            </span>
            <span
              className="h-2 rounded-sm bg-[var(--viz-1)]"
              style={{
                width: `${(Math.abs(r.minutes) / max) * 100}%`,
                opacity: r.key === '__others' ? 0.35 : 1,
              }}
            />
            {onPick && isPartRow(r) ? (
              <FollowUpTime minutes={r.minutes} onClick={() => onPick(r)} className="justify-self-end" />
            ) : (
              <span className="text-right font-semibold tabular-nums">{hours(r.minutes)}</span>
            )}
            <span className="text-right tabular-nums text-muted-foreground">{total > 0 ? pctOf(r.minutes / total, 0) : '—'}</span>
          </li>
        ))}
      </ul>
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
      { to: '/oee/mttr', label: 'MTTR & MTBF' },
      { to: '/oee/losses', label: 'Losses Trend (setups)' },
    )
  } else if (item.family === 'performance') {
    links.push({
      to: '/oee/dies',
      label: 'Dies OEE Trend (worst dies, speed loss)',
    })
  } else if (item.family === 'quality') {
    links.push({ to: '/die-followup/problems', label: 'Die problems' })
  }
  if (item.key === 'av:unexplained')
    links.splice(0, links.length, {
      to: '/oee/data',
      label: 'Uploaded downtimes (which machine records no reason)',
    })
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
