import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { Legend, LineTrendChart, pct } from '../../components/OeeCharts'
import { OeeControls, OeeDataNotice, effectiveScope, useOeeConfig, useOeeSelection } from '../../components/OeePanel'
import { OeeParetoChart } from '../../components/OeeParetoChart'
import { PageHeader } from '../../components/PageHeader'
import { PrintFilterHeader } from '../../components/OeePrint'
import { dm } from '../../components/OeePeriodControl'
import { SavePdfButton } from '../../components/SavePdfButton'
import { pdfFileName } from '../../lib/pdfFile'
import { sheetToPdf } from '../../lib/pdfSheet'
import { useOeeFilters } from '../../lib/oeeFilters'
import { columnMinutes, machineMinutes, paretoView, subLossMachines, subLossMinutes, topMaterials } from '../../lib/oeePareto'
import { useQuery } from '../../lib/convexTransport'
import {
  SPEED,
  addDaysIso,
  areaNames,
  chartGroups,
  chartShare,
  inScope,
  isoWeek,
  lossBreakdown,
  lossCoverage,
  lossForPeriod,
  scopeLabel,
  subLosses,
  sumTimes,
  weekTimes,
  type DayRow,
  type LossDay,
  type WeeklyRow,
} from '../../lib/oee'
import { fromStoredLosses, type StoredLossDay } from '../../lib/oeeStore'
import { fromStoredStops, type StoredStopDay } from '../../lib/oeeReliability'
import { shortStopNote, splitShortStops } from '../../lib/oeeShortStops'
import { relatedPages } from '../../lib/navigation'

export const Route = createFileRoute('/oee/losses')({
  component: LossesPage,
})

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const minutes = (m: number) => (m >= 90 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m)} min`)
/** Fark (puan). Kayıpta artış kötüdür (kırmızı). */
const gapText = (cur: number, prev: number) => {
  const d = (cur - prev) * 100
  if (Math.abs(d) < 0.05) return { text: '0.0 pts', tone: 'text-muted-foreground' }
  return { text: `${d > 0 ? '▲ +' : '▼ '}${d.toFixed(1)} pts`, tone: d > 0 ? 'text-destructive' : 'text-emerald-700' }
}

/** Bir dönem: Loading ve o dönemin duruş özetleri. */
interface Period {
  key: string
  label: string
  loadingMin: number
  lossDays: LossDay[]
  /** Duruş verisi yoksa yalnızca Speed bilinir. */
  hasDowntime: boolean
  share: (column: string) => number
}

/**
 * Losses Trend (planlamacı, 2026-10-20): tek grafik. Bir kayıp seçilir (ör.
 * STP), istenirse altındaki bir alt kayıp (duruş metni, ör. DIE SETUP); grafik
 * ikisinin % of Loading trendini çizer. Altında o kaybın alt kayıpları bu hafta
 * ile geçen haftayı karşılaştırır; satıra tıklamak alt kaybı seçer.
 */
function LossesPage() {
  const sel = useOeeSelection()
  const { config } = useOeeConfig()
  const weeksN = Math.max(2, config.trendWeeks || 1)
  const trendFrom = addDaysIso(sel.monday, -7 * (weeksN - 1))
  const prevMonday = addDaysIso(sel.monday, -7)
  const dayRows = (useQuery(api.oee.days, { from: trendFrom, to: sel.sunday }) ?? []) as DayRow[]
  const periods = useQuery(api.oee.periods) as { weekly: WeeklyRow[] } | undefined
  const lossRaw = (useQuery(api.oee.lossDays, { from: trendFrom, to: sel.sunday }) ?? []) as StoredLossDay[]
  // Kısa duruşlar (< eşik) "Short stops" sütununa, hız kaybından ayrı (src/lib/oeeShortStops.ts).
  const stopRaw = (useQuery(api.oee.stopDays, { from: trendFrom, to: sel.sunday }) ?? []) as StoredStopDay[]
  const split = useMemo(() => splitShortStops(fromStoredLosses(lossRaw), fromStoredStops(stopRaw), config), [lossRaw, stopRaw, config])
  const allLoss = split.lossDays
  const scope = effectiveScope(sel.scope, areaNames(dayRows, config))
  const label = scopeLabel(scope, config)
  const columns = useMemo(() => chartGroups(config, allLoss), [config, allLoss])
  // İş merkezi (Work Center) filtresi: ortak OEE filtresinin machine alanı. Trend ve
  // paretolar seçili iş merkezine göre daralır; "" = kapsamdaki bütün iş merkezleri.
  const [shared, setFilters] = useOeeFilters()
  const machines = useMemo(() => {
    const names = new Set<string>()
    for (const r of dayRows) if (r.workCenter && inScope(r, scope, config)) names.add(r.workCenter)
    for (const d of allLoss) if (d.workCenter && inScope(d, scope, config)) names.add(d.workCenter)
    return [...names].sort()
  }, [dayRows, allLoss, scope, config])
  const machine = machines.includes(shared.machine) ? shared.machine : ''
  const setMachine = (m: string) => setFilters({ machine: m })
  const days = machine ? dayRows.filter((r) => r.workCenter === machine) : dayRows
  const lossDays = machine ? allLoss.filter((d) => d.workCenter === machine) : allLoss

  const [view, setView] = useState<'weeks' | 'days'>('weeks')
  const [picked, setPicked] = useState<string | null>(null)
  const [sub, setSub] = useState<string>('')
  const loss = picked && columns.includes(picked) ? picked : (columns[0] ?? SPEED)
  const pickLoss = (col: string) => {
    setPicked(col)
    setSub('')
  }

  const coverageNotes = useMemo(() => {
    const cov = lossCoverage(dayRows, allLoss, scope, config, sel.monday, sel.sunday)
    const d2 = (d: string) => `${d.slice(8)}.${d.slice(5, 7)}`
    const out: string[] = []
    if (cov.noDowntimes.length) out.push(`No downtimes uploaded for ${cov.noDowntimes.map(d2).join(', ')} — losses of these days are missing from the percentages.`)
    if (cov.noShifts.length) out.push(`Downtimes without shift data for ${cov.noShifts.map(d2).join(', ')} — no loading time, so no loss percentage for these days.`)
    const note = shortStopNote(split, config)
    if (note) out.push(note)
    return out
  }, [dayRows, allLoss, split, scope, config, sel.monday, sel.sunday])

  // Haftalar: süreler OEE Dashboard ile aynı kaynaktan (günler ya da yüklenen hafta).
  const perWeek = useMemo(() => weekTimes(days, periods?.weekly ?? []), [days, periods])
  const weekPeriods = useMemo<Period[]>(
    () =>
      Array.from({ length: weeksN }, (_, i) => {
        const monday = addDaysIso(sel.monday, -7 * (weeksN - 1 - i))
        const { year, week } = isoWeek(monday)
        const end = addDaysIso(monday, 6)
        const key = `${year}-W${String(week).padStart(2, '0')}|`
        const times = sumTimes([...perWeek].filter(([k, w]) => k.startsWith(key) && inScope(w, scope, config)).map(([, w]) => w.times))
        const lds = lossDays.filter((d) => d.date >= monday && d.date <= end && inScope(d, scope, config))
        const b = lossBreakdown(times, lds, config)
        return { key: monday, label: `W${week}`, loadingMin: b.loadingMin, lossDays: lds, hasDowntime: lds.length > 0, share: (col) => chartShare(b, col) }
      }),
    [perWeek, lossDays, scope, config, sel.monday, weeksN],
  )
  const dayPeriods = useMemo<Period[]>(
    () =>
      DAY_LABELS.map((d, i) => {
        const date = addDaysIso(sel.monday, i)
        const b = lossForPeriod(days, lossDays, scope, config, date, date)
        const lds = lossDays.filter((x) => x.date === date && inScope(x, scope, config))
        return { key: date, label: `${d} ${date.slice(8)}`, loadingMin: b.loadingMin, lossDays: lds, hasDowntime: lds.length > 0, share: (col) => chartShare(b, col) }
      }),
    [days, lossDays, scope, config, sel.monday],
  )
  const shown = view === 'weeks' ? weekPeriods : dayPeriods

  /** Alt kaybın dönemdeki payı (% of Loading). */
  const subShare = (p: Period, text: string) =>
    p.loadingMin > 0 ? (subLosses(p.lossDays, config, loss).get(text)?.minutes ?? 0) / p.loadingMin : 0
  const valueOf = (p: Period, text?: string) => {
    if (p.loadingMin <= 0 || (!p.hasDowntime && loss !== SPEED)) return null
    return text ? subShare(p, text) : p.share(loss)
  }

  // Bu hafta ve geçen hafta (haftalık dönemlerin son ikisi).
  const cur = weekPeriods[weekPeriods.length - 1]
  const prev = weekPeriods[weekPeriods.length - 2]
  const subRows = useMemo(() => {
    if (!cur || loss === SPEED) return []
    const now = subLosses(cur.lossDays, config, loss)
    return [...now]
      .map(([text, a]) => ({ text, count: a.count, minutes: a.minutes, share: cur.loadingMin > 0 ? a.minutes / cur.loadingMin : 0 }))
      .sort((x, y) => y.minutes - x.minutes)
  }, [cur, loss, config])
  const subLabel = sub && subRows.some((r) => r.text === sub) ? sub : ''

  const curValue = cur ? valueOf(cur, subLabel || undefined) : null
  const prevValue = prev ? valueOf(prev, subLabel || undefined) : null
  const gp = curValue !== null && prevValue !== null ? gapText(curValue, prevValue) : null
  const lossIndex = columns.indexOf(loss)

  // A4 PDF: adı seçili günle "GGAAYY LOSSES TREND".
  const sheetRef = useRef<HTMLDivElement>(null)
  const fileName = pdfFileName(sel.date, 'LOSSES TREND')
  const filters = [
    label,
    `Work center ${machine || 'all'}`,
    `Loss ${loss}${subLabel ? ` → ${subLabel}` : ''}`,
    `Week W${sel.week.week} (${dm(sel.monday)} – ${dm(sel.sunday)})`,
  ]
  const noData = dayRows.length === 0 && allLoss.length === 0

  // Paretolar (seçili hafta). Duruş ve alt duruş grafikleri seçili iş merkezine göre
  // daralır; makine dağılımları (duruş → makine, alt duruş → makine) kapsamdaki tüm
  // iş merkezlerini gösterir, böylece hangi makinenin payı büyük görülür.
  const weekAll = useMemo(
    () => allLoss.filter((d) => d.date >= sel.monday && d.date <= sel.sunday && inScope(d, scope, config)),
    [allLoss, sel.monday, sel.sunday, scope, config],
  )
  const weekLoss = useMemo(() => (machine ? weekAll.filter((d) => d.workCenter === machine) : weekAll), [weekAll, machine])
  const isSpeed = loss === SPEED
  const pColumns = useMemo(() => paretoView(columnMinutes(weekLoss, config)), [weekLoss, config])
  const pMachines = useMemo(() => paretoView(isSpeed ? [] : machineMinutes(weekAll, config, loss)), [weekAll, config, loss, isSpeed])
  const pSubs = useMemo(() => paretoView(isSpeed ? [] : subLossMinutes(weekLoss, config, loss)), [weekLoss, config, loss, isSpeed])
  const activeSub = subLabel || pSubs.bars[0]?.key || ''
  const pSubMachines = useMemo(
    () => paretoView(isSpeed || !activeSub ? [] : subLossMachines(weekAll, config, loss, activeSub)),
    [weekAll, config, loss, isSpeed, activeSub],
  )
  const mats = useMemo(() => topMaterials(weekLoss, config, 3), [weekLoss, config])
  const fmt = minutes

  return (
    <div className="mx-auto w-full max-w-[297mm] px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Losses Trend"
        summary="Pick a loss — and, if you like, one of its sub-losses — and follow its trend."
        links={relatedPages('/oee/losses')}
        info={
          <>
            <p>
              A loss is its downtime minutes (Downtimes; Reason Code 1 marked as a loss in Settings, grouped by
              Reason Code 2 into the chart columns; a stop with Reason Code 1 or 2 “#”, not defined by the operator, is under Unassigned — the last column) ÷ Loading time of the same machines and days — "% of
              Loading". <b>Speed</b> = (Production − Operation) ÷ Loading and has no sub-losses.
            </p>
            <p>
              A sub-loss is the downtime text under the loss (e.g. STP → DIE SETUP). Groups and columns are set on{' '}
              <Link to="/oee/settings">OEE Settings</Link>. Dies: Dies OEE Trend; breakdowns: MTTR &amp; MTBF.
            </p>
          </>
        }
      />

      <OeeControls
        selection={sel}
        rows={dayRows}
        config={config}
        actions={
          <SavePdfButton fileName={fileName} make={() => sheetToPdf(sheetRef.current!, { size: 'A4', orientation: 'portrait', pages: 'fit' })} />
        }
      />
      <OeeDataNotice items={coverageNotes} />

      {noData && (
        <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No data for this period yet. Upload the file with <b>Upload data</b>.
        </p>
      )}

      {/* Seçim: tek satır — kayıp düğmeleri, alt kayıp, iş merkezi. */}
      <div className="mt-4 flex flex-nowrap items-center gap-2 overflow-x-auto pb-1 print:hidden">
        {columns.map((col) => (
          <button
            key={col}
            type="button"
            onClick={() => pickLoss(col)}
            className={`h-8 shrink-0 rounded-md px-2.5 text-xs font-semibold transition-colors ${
              col === loss ? 'bg-foreground text-background' : 'border border-border bg-background text-foreground hover:bg-muted'
            }`}
          >
            {col}
          </button>
        ))}
        <span className="mx-1 h-5 w-px shrink-0 bg-border" />
        {loss !== SPEED && (
          <select
            aria-label="Sub-loss"
            value={subLabel}
            onChange={(e) => setSub(e.target.value)}
            className="h-8 w-56 shrink-0 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">All of {loss}</option>
            {subRows.map((r) => (
              <option key={r.text} value={r.text}>
                {r.text} — {pct(r.share)}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Work center"
          value={machine}
          onChange={(e) => setMachine(e.target.value)}
          className="h-8 w-44 shrink-0 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="">All work centers</option>
          {machines.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div ref={sheetRef} className="oee-viz bg-background">
        <PrintFilterHeader title="LOSSES TREND" filters={filters} />
        <section className="print-avoid-break mt-4 rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {loss}
                {subLabel && <span className="text-muted-foreground"> → {subLabel}</span>}
              </h2>
              <p className="text-xs text-muted-foreground">% of Loading · {label}</p>
            </div>
            <div className="flex items-end gap-5">
              <div className="text-right">
                <p className="text-[11px] tracking-wide text-muted-foreground uppercase">W{sel.week.week}</p>
                <p className="text-2xl font-bold tabular-nums text-foreground">{pct(curValue)}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] tracking-wide text-muted-foreground uppercase">W{isoWeek(prevMonday).week}</p>
                <p className="text-lg font-semibold tabular-nums text-muted-foreground">{pct(prevValue)}</p>
              </div>
              {gp && <p className={`whitespace-nowrap pb-1 text-sm font-semibold tabular-nums ${gp.tone}`}>{gp.text}</p>}
              <div className="flex rounded-lg border border-border p-0.5 print:hidden">
                {(['weeks', 'days'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium ${view === v ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'}`}
                  >
                    {v === 'weeks' ? `${weeksN} weeks` : `Days W${sel.week.week}`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-start gap-4">
            <div className="min-w-0 basis-[70%]">
              <Legend
              items={[
                { key: loss, label: loss, slot: lossIndex + 1 },
                ...(subLabel ? [{ key: 'sub', label: subLabel, slot: lossIndex + 2 }] : []),
              ]}
            />
            <LineTrendChart
              height={190}
              labels={shown.map((p) => p.label)}
              series={[
                { key: loss, label: loss, slot: lossIndex + 1, values: shown.map((p) => valueOf(p)) },
                ...(subLabel ? [{ key: 'sub', label: subLabel, slot: lossIndex + 2, values: shown.map((p) => valueOf(p, subLabel)) }] : []),
              ]}
              ariaLabel={`${loss} trend`}
            />
            {loss !== SPEED && shown.some((p) => p.loadingMin > 0 && !p.hasDowntime) && (
              <p className="mt-1 text-xs text-muted-foreground">Periods without uploaded downtimes are left empty.</p>
            )}
            </div>

            <div className="min-w-0 flex-1">
          {loss !== SPEED && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Sub-losses of {loss} — W{sel.week.week}
              </p>
              {subRows.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No {loss} downtimes this week.</p>
              ) : (
                <div className="mt-2 max-h-[20rem] overflow-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium">Sub-loss</th>
                        <th className="px-2 py-1.5 text-right font-medium">Count</th>
                        <th className="px-2 py-1.5 text-right font-medium">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subRows.map((r) => {
                        const active = r.text === subLabel
                        return (
                          <tr
                            key={r.text}
                            onClick={() => setSub(active ? '' : r.text)}
                            className={`cursor-pointer border-t border-border hover:bg-muted/50 ${active ? 'bg-muted font-semibold' : ''}`}
                          >
                            <td className="px-2 py-1 text-foreground">{r.text}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{r.count}</td>
                            <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-muted-foreground">{minutes(r.minutes)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
            </div>
          </div>
        </section>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <OeeParetoChart
            title="Downtime losses"
            subtitle={`W${sel.week.week} · ${label}${machine ? ` · ${machine}` : ''}`}
            view={pColumns}
            selected={loss}
            onSelect={pickLoss}
            format={fmt}
            unit="min"
            emptyText="No downtimes in this week."
          />
          <OeeParetoChart
            title={`${loss} — by work center`}
            subtitle={`W${sel.week.week} · all work centers in ${label}`}
            view={pMachines}
            selected={machine}
            onSelect={(m) => setMachine(m === machine ? '' : m)}
            format={fmt}
            unit="min"
            emptyText={isSpeed ? 'Speed has no downtimes or work-center breakdown.' : `No ${loss} downtimes this week.`}
          />
          <OeeParetoChart
            title={`${loss} — by sub-loss`}
            subtitle={`W${sel.week.week} · ${machine || label}`}
            view={pSubs}
            selected={subLabel}
            onSelect={(t) => setSub(t === subLabel ? '' : t)}
            format={fmt}
            unit="min"
            emptyText={isSpeed ? 'Speed has no sub-losses.' : `No ${loss} sub-losses this week.`}
          />
          <OeeParetoChart
            title={activeSub ? `${activeSub} — by work center` : 'Sub-loss — by work center'}
            subtitle={`W${sel.week.week} · ${loss}${subLabel ? '' : ' · top sub-loss'}`}
            view={pSubMachines}
            selected={machine}
            onSelect={(m) => setMachine(m === machine ? '' : m)}
            format={fmt}
            unit="min"
            emptyText="No sub-loss downtimes this week."
          />
        </div>
        <section className="print-avoid-break mt-3 rounded-lg border border-border p-3">
          <p className="text-xs font-semibold text-foreground">
            Top 3 materials — W{sel.week.week} · {label}
            {machine ? ` · ${machine}` : ''}
          </p>
          {mats.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">No material downtime data this week.</p>
          ) : (
            <ol className="mt-1.5 grid grid-cols-3 gap-3 text-xs">
              {mats.map((m, i) => (
                <li key={m.material} className="min-w-0">
                  <span className="block truncate font-semibold text-foreground">
                    {i + 1}. {m.material}
                  </span>
                  <span className="block tabular-nums text-muted-foreground">
                    {minutes(m.minutes)} · top loss {m.loss} ({pct(m.lossShare)})
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}
