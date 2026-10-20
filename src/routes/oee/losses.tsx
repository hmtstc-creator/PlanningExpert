import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { Legend, LineTrendChart, pct } from '../../components/OeeCharts'
import { OeeControls, OeeDataNotice, effectiveScope, useOeeConfig, useOeeSelection } from '../../components/OeePanel'
import { PageHeader } from '../../components/PageHeader'
import { PrintFilterHeader } from '../../components/OeePrint'
import { dm } from '../../components/OeePeriodControl'
import { SavePdfButton } from '../../components/SavePdfButton'
import { pdfFileName } from '../../lib/pdfFile'
import { sheetToPdf } from '../../lib/pdfSheet'
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
  const lossDays = useMemo(() => fromStoredLosses(lossRaw), [lossRaw])
  const scope = effectiveScope(sel.scope, areaNames(dayRows, config))
  const label = scopeLabel(scope, config)
  const columns = useMemo(() => chartGroups(config, lossDays), [config, lossDays])

  const [view, setView] = useState<'weeks' | 'days'>('weeks')
  const [picked, setPicked] = useState<string | null>(null)
  const [sub, setSub] = useState<string>('')
  const loss = picked && columns.includes(picked) ? picked : (columns[0] ?? SPEED)
  const pickLoss = (col: string) => {
    setPicked(col)
    setSub('')
  }

  const coverageNotes = useMemo(() => {
    const cov = lossCoverage(dayRows, lossDays, scope, config, sel.monday, sel.sunday)
    const d2 = (d: string) => `${d.slice(8)}.${d.slice(5, 7)}`
    const out: string[] = []
    if (cov.noDowntimes.length) out.push(`No downtimes uploaded for ${cov.noDowntimes.map(d2).join(', ')} — losses of these days are missing from the percentages.`)
    if (cov.noShifts.length) out.push(`Downtimes without shift data for ${cov.noShifts.map(d2).join(', ')} — no loading time, so no loss percentage for these days.`)
    return out
  }, [dayRows, lossDays, scope, config, sel.monday, sel.sunday])

  // Haftalar: süreler OEE Dashboard ile aynı kaynaktan (günler ya da yüklenen hafta).
  const perWeek = useMemo(() => weekTimes(dayRows, periods?.weekly ?? []), [dayRows, periods])
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
        const b = lossForPeriod(dayRows, lossDays, scope, config, date, date)
        const lds = lossDays.filter((x) => x.date === date && inScope(x, scope, config))
        return { key: date, label: `${d} ${date.slice(8)}`, loadingMin: b.loadingMin, lossDays: lds, hasDowntime: lds.length > 0, share: (col) => chartShare(b, col) }
      }),
    [dayRows, lossDays, scope, config, sel.monday],
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
    const before = prev ? subLosses(prev.lossDays, config, loss) : new Map()
    const texts = new Set([...now.keys(), ...before.keys()])
    return [...texts]
      .map((text) => {
        const a = now.get(text) ?? { minutes: 0, count: 0 }
        const b = before.get(text) ?? { minutes: 0, count: 0 }
        return {
          text,
          count: a.count,
          minutes: a.minutes,
          share: cur.loadingMin > 0 ? a.minutes / cur.loadingMin : 0,
          prevShare: prev && prev.loadingMin > 0 ? b.minutes / prev.loadingMin : 0,
        }
      })
      .sort((x, y) => y.minutes - x.minutes || y.prevShare - x.prevShare)
  }, [cur, prev, loss, config])
  const subLabel = sub && subRows.some((r) => r.text === sub) ? sub : ''

  const curValue = cur ? valueOf(cur, subLabel || undefined) : null
  const prevValue = prev ? valueOf(prev, subLabel || undefined) : null
  const gp = curValue !== null && prevValue !== null ? gapText(curValue, prevValue) : null
  const lossIndex = columns.indexOf(loss)

  // A4 PDF: adı seçili günle "GGAAYY LOSSES TREND".
  const sheetRef = useRef<HTMLDivElement>(null)
  const fileName = pdfFileName(sel.date, 'LOSSES TREND')
  const filters = [label, `Loss ${loss}${subLabel ? ` → ${subLabel}` : ''}`, `Week W${sel.week.week} (${dm(sel.monday)} – ${dm(sel.sunday)})`]
  const noData = dayRows.length === 0 && lossDays.length === 0

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
              Reason Code 2 into the chart columns) ÷ Loading time of the same machines and days — "% of
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
          <SavePdfButton fileName={fileName} make={() => sheetToPdf(sheetRef.current!, { size: 'A4', orientation: 'landscape', pages: 'flow' })} />
        }
      />
      <OeeDataNotice items={coverageNotes} />

      {noData && (
        <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No data for this period yet. Upload the file with <b>Upload data</b>.
        </p>
      )}

      {/* Seçim */}
      <div className="mt-6 space-y-3 print:hidden">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Loss</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {columns.map((col) => (
              <button
                key={col}
                type="button"
                onClick={() => pickLoss(col)}
                className={`h-10 rounded-lg px-3.5 text-sm font-semibold shadow-sm transition-colors ${
                  col === loss ? 'bg-foreground text-background' : 'border border-border bg-background text-foreground hover:bg-muted'
                }`}
              >
                {col}
              </button>
            ))}
          </div>
        </div>
        {loss !== SPEED && (
          <label className="block max-w-md">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Sub-loss</span>
            <select
              value={subLabel}
              onChange={(e) => setSub(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              <option value="">All of {loss}</option>
              {subRows.map((r) => (
                <option key={r.text} value={r.text}>
                  {r.text} — {pct(r.share)} this week
                </option>
              ))}
            </select>
          </label>
        )}
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

          <div className="mt-3">
            <Legend
              items={[
                { key: loss, label: loss, slot: lossIndex + 1 },
                ...(subLabel ? [{ key: 'sub', label: subLabel, slot: lossIndex + 2 }] : []),
              ]}
            />
            <LineTrendChart
              height={280}
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

          {/* Alt kayıplar: bu hafta ve geçen hafta; satıra tıklamak seçer. */}
          {loss !== SPEED && (
            <div className="mt-4">
              <p className="text-xs font-medium text-muted-foreground">
                Sub-losses of {loss} — W{sel.week.week} vs W{isoWeek(prevMonday).week}
              </p>
              {subRows.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No {loss} downtimes in these two weeks.</p>
              ) : (
                <div className="mt-2 max-h-[22rem] overflow-auto rounded-lg border border-border">
                  <table className="w-full min-w-[32rem] text-sm">
                    <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Sub-loss</th>
                        <th className="px-3 py-2 text-right font-medium">Count</th>
                        <th className="px-3 py-2 text-right font-medium">Time</th>
                        <th className="px-3 py-2 text-right font-medium">W{sel.week.week}</th>
                        <th className="px-3 py-2 text-right font-medium">W{isoWeek(prevMonday).week}</th>
                        <th className="px-3 py-2 text-right font-medium">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subRows.map((r) => {
                        const g = gapText(r.share, r.prevShare)
                        const active = r.text === subLabel
                        return (
                          <tr
                            key={r.text}
                            onClick={() => setSub(active ? '' : r.text)}
                            className={`cursor-pointer border-t border-border hover:bg-muted/50 ${active ? 'bg-muted font-semibold' : ''}`}
                          >
                            <td className="px-3 py-1.5 text-foreground">{r.text}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{r.count}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted-foreground">{minutes(r.minutes)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{pct(r.share)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{pct(r.prevShare)}</td>
                            <td className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${g.tone}`}>{g.text}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
