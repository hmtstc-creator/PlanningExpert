import { createFileRoute, Link } from '@tanstack/react-router'
import { Fragment, useMemo, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { dm } from '../../components/OeePeriodControl'
import { OeeControls, OeeDataNotice, effectiveScope, useOeeConfig, useOeeSelection } from '../../components/OeePanel'
import { InfoTip, PageHeader } from '../../components/PageHeader'
import { useQuery } from '../../lib/convexTransport'
import { relatedPages } from '../../lib/navigation'
import { MES_SHORT_STOP_MIN, addDaysIso, areaNames, inScope, isoWeek, scopeLabel, shortStopMinOf, type DayRow } from '../../lib/oee'
import {
  bucketsOf,
  bucketDetail,
  bucketRows,
  defaultSetupTexts,
  fromStoredStops,
  relCategories,
  relGrid,
  stopDates,
  type DurationRange,
  type RelCategory,
  type RelCell,
  type RelGrid,
  type RelPeriod,
  type StoredStopDay,
  type Tally,
} from '../../lib/oeeReliability'
import { fromStoredDay, type StoredDowntimeDay } from '../../lib/oeeStore'

export const Route = createFileRoute('/oee/mttr')({
  component: MttrPage,
})

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Süre: 90 dk'ya kadar dakika, üstü saat. */
const dur = (m: number | null) => (m === null ? '—' : m < 90 ? `${m < 10 ? m.toFixed(1) : Math.round(m)} min` : `${(m / 60).toFixed(1)} h`)

/**
 * Sayfanın kendi ayarı (tarayıcıda): en az dakika, kategori, STP metinleri.
 * En az dakika boşsa (null) OEE Settings'teki kısa duruş eşiği: MTTR / MTBF
 * kullanılabilirlik kaybıdır, < eşik duruşlar performanstır (2026-10-23).
 * Anahtar v2: eski kayıtlı 0 yeni varsayılanı gölgelemesin.
 */
const PREF_KEY = 'oee-mttr-v2'
interface Prefs {
  minMinutes: number | null
  category: string
  setupTexts: string[] | null
}
function readPrefs(): Prefs {
  try {
    const v = JSON.parse(window.localStorage.getItem(PREF_KEY) ?? 'null')
    if (v && typeof v === 'object')
      return {
        minMinutes: typeof v.minMinutes === 'number' && v.minMinutes >= 0 ? v.minMinutes : null,
        category: typeof v.category === 'string' ? v.category : '',
        setupTexts: Array.isArray(v.setupTexts) ? v.setupTexts.filter((t: unknown) => typeof t === 'string') : null,
      }
  } catch {
    // Saklanamıyorsa varsayılan.
  }
  return { minMinutes: null, category: '', setupTexts: null }
}

/**
 * MTTR & MTBF (Aksiyonlar sunumu, planlamacı 2026-10-14): ARZ, KLP (OEE
 * Settings'te "breakdown" işaretli gruplar) ve STP (seçilen setup metinleri:
 * kalıp setup'ı planlı / plansız, rulo setup'ı) için yıl (aylar), son haftalar
 * ve seçilen hafta (günler). Ekran ikiye bölünür: solda MTTR, sağda MTBF.
 * "En az N dakika" girdisi: altındaki duruşlar MTTR / MTBF'e girmez. Altta süre
 * kovaları (< 2, 2–10, ≥ 10 dk): toplam dakika, adet, MTTR, MTBF ve hangi pres,
 * hangi parça, hangi vardiya.
 */
function MttrPage() {
  const sel = useOeeSelection()
  const { config } = useOeeConfig()
  const [prefs, setPrefsState] = useState<Prefs>(() => (typeof window === 'undefined' ? { minMinutes: null, category: '', setupTexts: null } : readPrefs()))
  const minMinutes = prefs.minMinutes ?? shortStopMinOf(config)
  const setPrefs = (p: Partial<Prefs>) =>
    setPrefsState((cur) => {
      const next = { ...cur, ...p }
      try {
        window.localStorage.setItem(PREF_KEY, JSON.stringify(next))
      } catch {
        // Yalnızca bu oturumda.
      }
      return next
    })

  const weeksN = config.trendWeeks || 10
  const year = sel.date.slice(0, 4)
  const yearStart = `${year}-01-01`
  const trendFrom = addDaysIso(sel.monday, -7 * (weeksN - 1))
  const from = trendFrom < yearStart ? trendFrom : yearStart
  const to = sel.sunday
  const days = (useQuery(api.oee.days, { from, to }) ?? []) as DayRow[]
  const stopRaw = useQuery(api.oee.stopDays, { from, to }) as StoredStopDay[] | undefined
  const stops = useMemo(() => fromStoredStops(stopRaw ?? []), [stopRaw])
  // Pres / parça / vardiya ayrıntısı ham duruşlardan: seçilen hafta (7 gün).
  const weekRaw = useQuery(api.oee.downtimeDays, { from: sel.monday, to: sel.sunday }) as StoredDowntimeDay[] | undefined
  const weekEvents = useMemo(() => (weekRaw ?? []).map(fromStoredDay), [weekRaw])
  const coverage = useQuery(api.oee.coverage) as { downtimes: { from: string; to: string } | null } | undefined

  const scope = effectiveScope(sel.scope, areaNames(days, config))
  const label = scopeLabel(scope, config)
  const allSetupTexts = config.setupTexts.map((t) => t.text)
  const setupTexts = prefs.setupTexts ? prefs.setupTexts.filter((t) => allSetupTexts.includes(t)) : defaultSetupTexts(config)
  const categories = useMemo(() => relCategories(config, setupTexts), [config, setupTexts.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const cat = categories.find((c) => c.key === prefs.category) ?? categories[0]
  const range: DurationRange = { lo: minMinutes, hi: Infinity }

  const periods = useMemo(() => {
    const lastMonth = Number(sel.date.slice(5, 7))
    const months: RelPeriod[] = Array.from({ length: lastMonth }, (_, i) => {
      const m = String(i + 1).padStart(2, '0')
      const end = new Date(Date.UTC(Number(year), i + 1, 0)).toISOString().slice(0, 10)
      return { key: `${year}-${m}`, label: MONTHS[i], from: `${year}-${m}-01`, to: end }
    })
    const weeks: RelPeriod[] = Array.from({ length: weeksN }, (_, i) => {
      const monday = addDaysIso(sel.monday, -7 * (weeksN - 1 - i))
      return { key: monday, label: `W${isoWeek(monday).week}`, from: monday, to: addDaysIso(monday, 6) }
    })
    const week: RelPeriod[] = DAYS.map((d, i) => {
      const date = addDaysIso(sel.monday, i)
      return { key: date, label: `${d} ${date.slice(8)}`, from: date, to: date }
    })
    return { months, weeks, week }
  }, [sel.date, sel.monday, year, weeksN])

  const grids = useMemo(() => {
    if (!cat) return null
    return {
      months: relGrid(stops, days, periods.months, cat, range, scope, config),
      weeks: relGrid(stops, days, periods.weeks, cat, range, scope, config),
      week: relGrid(stops, days, periods.week, cat, range, scope, config),
    }
  }, [stops, days, periods, cat, range.lo, scope, config]) // eslint-disable-line react-hooks/exhaustive-deps

  // Hafta × makine: bütün kategoriler (Losses Trend'deki eski tablo, eşikle).
  const weekPeriod: RelPeriod = { key: 'week', label: `W${sel.week.week}`, from: sel.monday, to: sel.sunday }
  const weekByMachine = useMemo(
    () => categories.map((c) => ({ cat: c, grid: relGrid(stops, days, [weekPeriod], c, range, scope, config) })),
    [categories, stops, days, sel.monday, range.lo, scope, config], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const [bucketSpan, setBucketSpan] = useState<'week' | 'weeks' | 'year'>('week')
  const span =
    bucketSpan === 'week'
      ? { from: sel.monday, to: sel.sunday, text: `W${sel.week.week}` }
      : bucketSpan === 'weeks'
        ? { from: trendFrom, to: sel.sunday, text: `last ${weeksN} weeks` }
        : { from: yearStart, to: sel.sunday, text: `${year} up to W${sel.week.week}` }
  const buckets = useMemo(
    () =>
      categories.map((c) => ({
        cat: c,
        rows: bucketRows(stops, days, span.from, span.to, c, scope, config),
        detail: bucketsOf(config).map((b) => bucketDetail(weekEvents, c, b.range, scope, config)),
      })),
    [categories, stops, days, span.from, span.to, weekEvents, scope, config],
  )

  // Seçilen haftada üretimi olup duruş verisi olmayan günler: MTBF'e girmez.
  const uncovered = useMemo(() => {
    const covered = stopDates(stops)
    const out = new Set<string>()
    for (const d of days)
      if (d.date >= sel.monday && d.date <= sel.sunday && d.productionMin > 0 && !covered.has(d.date) && inScope(d, scope, config)) out.add(d.date)
    return [...out].sort()
  }, [stops, days, sel.monday, sel.sunday, scope, config])

  const notes = [
    ...(uncovered.length && stops.length
      ? [
          `No downtime data yet for ${uncovered.map(dm).join(', ')} — production on ${uncovered.length === 1 ? 'that day' : 'those days'} is left out of MTBF until the downtimes are uploaded.`,
        ]
      : []),
    ...(stopRaw !== undefined && stops.length === 0 && coverage?.downtimes
      ? ['Downtime durations are being prepared from the uploaded downtimes — the tables fill when it is done (open this page with OEE data rights once).']
      : []),
    ...(categories.length === 0 ? ['No loss group is marked as a breakdown and no setup text is defined on OEE Settings.'] : []),
  ]

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title="MTTR & MTBF"
        summary="Breakdowns (ARZ, KLP) and setups (STP): average repair time and average running time between two stops — this year by month, the last weeks and the selected week by day."
        links={relatedPages('/oee/mttr')}
        info={
          <>
            <p>
              <b>MTTR</b> = stop minutes ÷ number of stops (average duration of one stop). <b>MTBF</b> = production time ÷ number of stops
              (average running time between two stops). Production time: net production time of the Shiftly KPI, same machines and days —
              only days whose downtimes are uploaded.
            </p>
            <p>
              <b>Minimum duration</b>: stops shorter than this many minutes are left out of MTTR and MTBF (e.g. 10 → only stops of 10 minutes
              and more). 0 counts every stop. The duration buckets below always show all stops.
            </p>
            <p>
              ARZ, KLP …: the loss groups ticked as &apos;breakdown&apos; on <Link to="/oee/settings">OEE Settings</Link>. STP: the setup texts
              picked here (default: die setup planned / unplanned and coil setup).
            </p>
          </>
        }
      />

      <OeeControls
        selection={sel}
        rows={days}
        config={config}
        extra={
          <label
            className="flex flex-col gap-1"
            title={`Stops shorter than this are left out of MTTR and MTBF. Default: the short-stop limit of OEE Settings (${shortStopMinOf(config)} min) — shorter stops are performance, not availability.`}
          >
            Min. duration (min)
            <input
              type="number"
              min={0}
              max={240}
              step={1}
              value={minMinutes}
              onChange={(e) => setPrefs({ minMinutes: Math.max(0, Math.min(240, Math.floor(Number(e.target.value) || 0))) })}
              className="w-24 rounded-md border bg-amber-50 px-2 py-1.5 text-sm text-foreground dark:bg-amber-950/30"
            />
          </label>
        }
      />
      <FormulaNote data={weekByMachine} minMinutes={minMinutes} shortStopMin={shortStopMinOf(config)} />
      <OeeDataNotice items={notes} />

      {/* Haftanın makine tablosu (Losses Trend'den taşındı). */}
      <section className="mt-6 rounded-lg border border-border p-4">
        <h2 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-foreground">
          Week W{sel.week.week} by machine — all categories
          <span className="text-xs font-normal text-muted-foreground">
            {dm(sel.monday)} – {dm(sel.sunday)} · {label}
            {minMinutes > 0 && ` · stops ≥ ${prefs.minMinutes} min`}
          </span>
        </h2>
        <WeekMachineTable data={weekByMachine} />
      </section>

      {cat && grids && (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Category">
              {categories.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={c.key === cat.key}
                  onClick={() => setPrefs({ category: c.key })}
                  className={`rounded px-4 py-1.5 text-sm font-bold ${c.key === cat.key ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {cat.key === 'setup' && allSetupTexts.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="font-semibold text-foreground">STP texts:</span>
                {allSetupTexts.map((t) => (
                  <label key={t} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={setupTexts.includes(t)}
                      onChange={(e) => {
                        const next = e.target.checked ? [...setupTexts, t] : setupTexts.filter((x) => x !== t)
                        setPrefs({ setupTexts: next.length ? next : null })
                      }}
                    />
                    {t}
                  </label>
                ))}
              </div>
            )}
            <span className="text-xs text-muted-foreground">
              {label}
              {minMinutes > 0 ? ` · only stops ≥ ${prefs.minMinutes} min` : ' · every stop'}
            </span>
          </div>

          {/* Ekran ortadan ikiye: solda MTTR, sağda MTBF. */}
          <div className="mt-3 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <MetricColumn title="MTTR" hint="average duration of one stop" cat={cat} grids={grids} pick={(c) => c.mttr} year={year} week={sel.week.week} weeksN={weeksN} />
            <MetricColumn
              title="MTBF"
              hint="average running time between two stops"
              cat={cat}
              grids={grids}
              pick={(c) => c.mtbf}
              year={year}
              week={sel.week.week}
              weeksN={weeksN}
            />
          </div>
        </>
      )}

      <section className="mt-6 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            Stops by duration — {span.text}
            <InfoTip label="About the duration buckets">
              Every stop of the category, whatever the minimum duration above: shorter than 2 minutes, 2 to 10 minutes, 10 minutes and more.
              MTBF = production time of the period ÷ stops in the bucket. Parts and shifts come from the downtime rows of the selected week.
            </InfoTip>
          </h2>
          <div className="flex rounded-md border border-border p-0.5 text-xs" role="group" aria-label="Period of the buckets">
            {(
              [
                ['week', `Week W${sel.week.week}`],
                ['weeks', `Last ${weeksN} weeks`],
                ['year', `Year ${year}`],
              ] as const
            ).map(([k, t]) => (
              <button
                key={k}
                type="button"
                aria-pressed={bucketSpan === k}
                onClick={() => setBucketSpan(k)}
                className={`rounded px-2.5 py-1 font-medium ${bucketSpan === k ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <BucketTable data={buckets} withDetail={bucketSpan === 'week'} />
      </section>
    </div>
  )
}

function WeekMachineTable({ data }: { data: { cat: RelCategory; grid: RelGrid }[] }) {
  const wcs = data[0]?.grid.rows.map((r) => r.workCenter) ?? []
  if (!data.length || !wcs.length) return <p className="mt-2 text-xs text-muted-foreground">Nothing for this week.</p>
  // Production time aynı makine ve hafta için her kategoride aynı: ilk kategoriden.
  const prod = (c: RelCell | undefined) => (c && c.production > 0 ? dur(c.production) : '—')
  const th = 'px-2 py-1.5 pr-3 text-right font-medium whitespace-nowrap'
  const cells = (c: RelCell | undefined, strong = false) => (
    <>
      <td className={`border-l border-border px-2 py-1 pr-3 text-right tabular-nums ${strong ? 'font-semibold' : ''}`}>{c?.count ?? 0}</td>
      <td className="px-2 py-1 pr-3 text-right tabular-nums">{c?.count ? dur(c.minutes) : '—'}</td>
      <td className="px-2 py-1 pr-3 text-right font-semibold tabular-nums">{dur(c?.mttr ?? null)}</td>
      <td className="px-2 py-1 pr-3 text-right tabular-nums">{dur(c?.mtbf ?? null)}</td>
    </>
  )
  return (
    <div className="mt-2 w-fit max-w-full overflow-auto rounded-md border border-border">
      <table className="w-auto text-xs">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium" />
            <th className="px-2 py-1.5 text-left font-medium" />
            {data.map((d) => (
              <th key={d.cat.key} colSpan={4} className="border-l border-border px-2 py-1.5 text-center font-bold text-foreground">
                {d.cat.label}
              </th>
            ))}
          </tr>
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">Machine</th>
            <th className={th} title="Net production time (Shiftly KPI) — the numerator of MTBF">
              Prod. time
            </th>
            {data.map((d) => (
              <FourHeads key={d.cat.key} className={th} />
            ))}
          </tr>
        </thead>
        <tbody>
          {wcs.map((wc, i) => (
            <tr key={wc} className="border-t border-border">
              <td className="px-2 py-1 font-medium whitespace-nowrap text-foreground">{wc}</td>
              <td className="px-2 py-1 pr-3 text-right text-muted-foreground tabular-nums">{prod(data[0].grid.rows[i]?.cells[0])}</td>
              {data.map((d) => (
                <Fragment key={d.cat.key}>{cells(d.grid.rows[i]?.cells[0])}</Fragment>
              ))}
            </tr>
          ))}
          <tr className="border-t border-border bg-muted/40 font-semibold">
            <td className="px-2 py-1 text-foreground">Total</td>
            <td className="px-2 py-1 pr-3 text-right tabular-nums">{prod(data[0].grid.total[0])}</td>
            {data.map((d) => (
              <Fragment key={d.cat.key}>{cells(d.grid.total[0], true)}</Fragment>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/**
 * Filtrenin altında sabit bilgi bloğu: MTTR / MTBF formülleri ve haftanın
 * tablosundan canlı bir örnek (en çok duruşu olan makine × kategori).
 */
function FormulaNote({ data, minMinutes, shortStopMin }: { data: { cat: RelCategory; grid: RelGrid }[]; minMinutes: number; shortStopMin: number }) {
  let ex: { wc: string; cat: string; c: RelCell } | null = null
  for (const d of data)
    for (const r of d.grid.rows) {
      const c = r.cells[0]
      if (c && c.count > 0 && c.production > 0 && (!ex || c.count > ex.c.count)) ex = { wc: r.workCenter, cat: d.cat.label, c }
    }
  const code = 'rounded bg-background px-1 py-0.5 font-mono text-[11px] text-foreground'
  return (
    <aside className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
      <p className="font-semibold">How the numbers are calculated</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        <li>
          <b>MTTR</b> <span className={code}>= stop minutes ÷ number of stops</span> — average length of one stop.
        </li>
        <li>
          <b>MTBF</b> <span className={code}>= production time ÷ number of stops</span> — average running time between two stops of that
          category. Production time is the <i>net production time</i> of the Shiftly KPI (loading time minus the unplanned stops of{' '}
          {MES_SHORT_STOP_MIN} min and longer — the MES leaves shorter ones in), for the same machines and days, counted only on days whose
          downtimes are uploaded.
        </li>
        <li>
          Each category is counted on its own: ARZ MTBF counts only ARZ stops, even though the machine also stops for KLP and STP in between.
          <b> Total</b> = all machines summed (Σ time ÷ Σ stops), not the average of the machine values.
        </li>
        <li>
          {minMinutes > 0 ? (
            <>
              Only stops of <b>{minMinutes} min</b> and longer are counted (shorter ones are left out of the count, MTTR and MTBF).
              {minMinutes === shortStopMin
                ? ' This is the short-stop limit (OEE Settings): shorter stops are a performance loss, analysed in the buckets below and in the Loss Bridge.'
                : ` The short-stop limit (OEE Settings) is ${shortStopMin} min.`}
            </>
          ) : (
            <>Every stop is counted (min. duration 0).</>
          )}
        </li>
        {ex && (
          <li>
            Example, {ex.wc} · {ex.cat}: MTTR = {dur(ex.c.minutes)} ÷ {ex.c.count} = <b>{dur(ex.c.mttr)}</b>, MTBF = {dur(ex.c.production)} ÷{' '}
            {ex.c.count} = <b>{dur(ex.c.mtbf)}</b>.
          </li>
        )}
      </ul>
    </aside>
  )
}

function FourHeads({ className }: { className: string }) {
  return (
    <>
      <th className={`${className} border-l border-border`}>Count</th>
      <th className={className}>Time</th>
      <th className={className}>MTTR</th>
      <th className={className}>MTBF</th>
    </>
  )
}

/** Bir yarı: MTTR ya da MTBF — yıl (aylar), son haftalar, seçilen hafta (günler). */
function MetricColumn({
  title,
  hint,
  cat,
  grids,
  pick,
  year,
  week,
  weeksN,
}: {
  title: string
  hint: string
  cat: RelCategory
  grids: { months: RelGrid; weeks: RelGrid; week: RelGrid }
  pick: (c: RelCell) => number | null
  year: string
  week: number
  weeksN: number
}) {
  return (
    <section className="min-w-0 rounded-xl border-2 border-border p-3">
      <h2 className="text-base font-bold text-foreground">
        {title} · {cat.label} <span className="text-xs font-normal text-muted-foreground">— {hint}</span>
      </h2>
      {cat.note && <p className="text-[11px] text-muted-foreground">{cat.note}</p>}
      <GridTable title={`Year ${year} by month`} grid={grids.months} pick={pick} />
      <GridTable title={`Last ${weeksN} weeks`} grid={grids.weeks} pick={pick} />
      <GridTable title={`Week W${week} by day`} grid={grids.week} pick={pick} />
      <p className="mt-2 text-[10px] text-muted-foreground">none = production but no stop · — = no data</p>
    </section>
  )
}

function GridTable({ title, grid, pick }: { title: string; grid: RelGrid; pick: (c: RelCell) => number | null }) {
  // "none": üretim var, bu süre ve üstünde duruş yok; "—": veri yok.
  const show = (c: RelCell) => (c.count ? dur(pick(c)) : c.production > 0 ? <span className="text-emerald-700">none</span> : '—')
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-foreground">{title}</p>
      {grid.rows.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">No data.</p>
      ) : (
        <div className="mt-1 max-w-full overflow-x-auto rounded-md border border-border">
          <table className="w-full text-[11px]">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-1.5 py-1 text-left font-medium" />
                {grid.periods.map((p) => (
                  <th key={p.key} className="px-1.5 py-1 text-right font-medium whitespace-nowrap">
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border bg-muted/40 font-semibold">
                <td className="px-1.5 py-1 text-foreground">Total</td>
                {grid.total.map((c, i) => (
                  <td key={i} className="px-1.5 py-1 text-right whitespace-nowrap tabular-nums" title={`${c.count} stops · ${dur(c.minutes)}`}>
                    {show(c)}
                  </td>
                ))}
              </tr>
              {grid.rows.map((r) => (
                <tr key={r.workCenter} className="border-t border-border">
                  <td className="px-1.5 py-1 font-medium whitespace-nowrap text-foreground">{r.workCenter}</td>
                  {r.cells.map((c, i) => (
                    <td key={i} className="px-1.5 py-1 text-right whitespace-nowrap tabular-nums" title={`${c.count} stops · ${dur(c.minutes)}`}>
                      {show(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const top3 = (xs: Tally[]) =>
  xs.length
    ? xs
        .slice(0, 3)
        .map((t) => `${t.key} ${dur(t.minutes)}`)
        .join(' · ')
    : '—'

function BucketTable({
  data,
  withDetail,
}: {
  data: { cat: RelCategory; rows: ReturnType<typeof bucketRows>; detail: ReturnType<typeof bucketDetail>[] }[]
  withDetail: boolean
}) {
  if (!data.length) return <p className="mt-2 text-xs text-muted-foreground">No category.</p>
  const th = 'px-2 py-1.5 pr-3 font-medium whitespace-nowrap'
  return (
    <div className="mt-2 max-w-full overflow-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            <th className={`${th} text-left`}>Category</th>
            <th className={`${th} text-left`}>Duration</th>
            <th className={`${th} text-right`}>Count</th>
            <th className={`${th} text-right`}>Total time</th>
            <th className={`${th} text-right`}>MTTR</th>
            <th className={`${th} text-right`}>MTBF</th>
            <th className={`${th} text-left`}>Presses</th>
            <th className={`${th} text-left`}>Parts {withDetail ? '' : '(week only)'}</th>
            <th className={`${th} text-left`}>Shifts {withDetail ? '' : '(week only)'}</th>
          </tr>
        </thead>
        <tbody>
          {data.map(({ cat, rows, detail }) =>
            rows.map((r, i) => (
              <tr key={`${cat.key}|${r.key}`} className={`border-t border-border ${i === 0 ? 'border-t-2 border-t-foreground/20' : ''}`}>
                {i === 0 && (
                  <td rowSpan={rows.length} className="px-2 py-1 align-top text-sm font-bold text-foreground">
                    {cat.label}
                  </td>
                )}
                <td className="px-2 py-1 pr-3 font-semibold whitespace-nowrap">{r.label}</td>
                <td className="px-2 py-1 pr-3 text-right tabular-nums">{r.cell.count}</td>
                <td className="px-2 py-1 pr-3 text-right tabular-nums">{r.cell.count ? dur(r.cell.minutes) : '—'}</td>
                <td className="px-2 py-1 pr-3 text-right font-semibold tabular-nums">{dur(r.cell.mttr)}</td>
                <td className="px-2 py-1 pr-3 text-right tabular-nums">{dur(r.cell.mtbf)}</td>
                <td className="px-2 py-1 pr-3">
                  {r.byPress.length
                    ? r.byPress
                        .slice(0, 3)
                        .map((p) => `${p.workCenter} ${p.count}× ${dur(p.minutes)}`)
                        .join(' · ')
                    : '—'}
                </td>
                <td className="px-2 py-1 pr-3">{withDetail ? top3(detail[i]?.materials ?? []) : '—'}</td>
                <td className="px-2 py-1 pr-3 whitespace-nowrap">{withDetail ? top3(detail[i]?.shifts ?? []) : '—'}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  )
}
