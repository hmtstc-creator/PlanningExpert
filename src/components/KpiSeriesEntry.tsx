import { Link } from '@tanstack/react-router'
import { ArrowRightToLine, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { ErrorBanner } from './ErrorBanner'
import { PageHeader } from './PageHeader'
import { useQuery } from '../lib/convexTransport'
import {
  KPI_INPUTS,
  formatKpi,
  isoWeeksInYear,
  kpiFor,
  slotKey,
  type KpiEntry,
  type KpiMetrics,
  type KpiPeriod,
  type KpiSlot,
  type KpiValues,
  type OeeSum,
  type OperatorType,
} from '../lib/kpi'
import { sideOf, toValues, type Side } from '../lib/kpiForm'
import { cleanPasted, lineEntry, parseGrid, seriesLines, seriesSlots, seriesTotal, slotRows, type SeriesLine } from '../lib/kpiSeries'
import { isoWeek } from '../lib/oee'
import { relatedPages } from '../lib/navigation'
import { usePlant } from '../lib/plantContext'
import { useSafeMutation } from '../lib/useSafeMutation'

/**
 * KPI girişi — dizi görünümü: sütunlarda dönemler (aylıkta Ocak–Aralık,
 * haftalıkta seçilen haftayla biten 13 ISO hafta) ve toplam; satırlarda her
 * göstergenin planı ve gerçekleşeni. Bir masraf yerinin bütün aralığı tek
 * ekranda; birden çok operatör satırı (Direct, Indirect …) üstteki
 * sekmeler. Kural: src/lib/kpiSeries.ts; kayıt convex/kpi.ts → saveRange
 * (yalnızca seçili masraf yeri).
 *
 * Excel gibi: Enter / ↑ ↓ satır değiştirir, Tab dönem değiştirir; Excel'den
 * kopyalanan bir satır ya da blok, tıklanan hücreden başlayarak yayılır.
 */

/** Ekrandaki satır: dönem başına metin (girilen hâliyle). */
interface DraftLine {
  id: string
  operatorType: OperatorType
  cells: Record<string, { plan: Side; actual: Side }>
}

type Unit = 'n' | 'h' | 'pcs' | '%'
const UNIT: Record<keyof KpiValues, Unit> = {
  operators: 'n',
  volume: 'pcs',
  productionHours: 'h',
  presenceHours: 'h',
  overtimeHours: 'h',
  absenteeism: '%',
  productivity: 'n',
  oee: '%',
}
/** Girilen alanın toplam sütunundaki karşılığı. */
const METRIC: Record<keyof KpiValues, keyof KpiMetrics> = {
  operators: 'operators',
  volume: 'volume',
  productionHours: 'productionHours',
  presenceHours: 'presenceHours',
  overtimeHours: 'overtimeHours',
  absenteeism: 'absenteeismPct',
  productivity: 'productivity',
  oee: 'oee',
}
const COMPUTED: { key: keyof KpiMetrics; label: string; unit: Unit; note: string }[] = [
  { key: 'overtimePct', label: 'Overtime %', unit: '%', note: 'overtime ÷ normal presence' },
  { key: 'totalPresenceHours', label: 'Total presence hour', unit: 'h', note: 'normal presence + overtime' },
  { key: 'efficiency', label: 'Efficiency', unit: '%', note: 'production hour ÷ total presence' },
]

let seq = 0
const newId = () => `s${Date.now()}-${seq++}`
const EMPTY_CELL = { plan: sideOf({}), actual: sideOf({}) }

const toDraft = (lines: SeriesLine[], slots: KpiSlot[]): DraftLine[] =>
  lines.map((l) => ({
    id: newId(),
    operatorType: l.operatorType,
    cells: Object.fromEntries(
      slots.map((s) => {
        const c = l.cells[slotKey(s)]
        return [slotKey(s), { plan: sideOf(c?.plan ?? {}), actual: sideOf(c?.actual ?? {}) }]
      }),
    ),
  }))

const toLine = (d: DraftLine): SeriesLine => ({
  operatorType: d.operatorType,
  k: 0,
  cells: Object.fromEntries(Object.entries(d.cells).map(([k, c]) => [k, { plan: toValues(c.plan), actual: toValues(c.actual) }])),
})

/** Karşılaştırma için: yalnızca değerler (kimlik değil). */
const sig = (ls: DraftLine[]) => JSON.stringify(ls.map((l) => [l.operatorType, l.cells]))

const cell =
  'h-8 w-full min-w-[4.25rem] rounded-md border border-border/70 bg-background px-1.5 text-right text-sm tabular-nums outline-none transition-colors placeholder:text-muted-foreground/45 hover:border-input focus:border-violet-400 focus:bg-background focus:ring-2 focus:ring-violet-200 disabled:border-transparent disabled:bg-transparent'

/** Bugünün dönemi. */
function today(period: KpiPeriod): { year: number; num: number } {
  const d = new Date()
  if (period === 'month') return { year: d.getFullYear(), num: d.getMonth() + 1 }
  const w = isoWeek(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  return { year: w.year, num: w.week }
}

/** Haftalık aralığı n hafta kaydırır (yıl geçişi dahil). */
function shiftWeek(year: number, week: number, n: number): { year: number; num: number } {
  let y = year
  let w = week + n
  while (w < 1) {
    y--
    w += isoWeeksInYear(y)
  }
  while (w > isoWeeksInYear(y)) {
    w -= isoWeeksInYear(y)
    y++
  }
  return { year: y, num: w }
}

export function KpiSeriesEntry({ period }: { period: KpiPeriod }) {
  const { ctx, canArea } = usePlant()
  const editable = canArea('kpi.entry', 'edit')
  const costCenters = useMemo(() => ctx?.active?.costCenters ?? [], [ctx?.active?.costCenters])
  const now = today(period)
  // Aylıkta yıl; haftalıkta aralığın son haftası.
  const [end, setEnd] = useState(now)
  const slots = useMemo(() => seriesSlots(period, end.year, end.num), [period, end.year, end.num])
  const [cc, setCc] = useState<string | null>(null)
  const code = cc && costCenters.some((c) => c.code === cc) ? cc : (costCenters[0]?.code ?? null)
  const data = useQuery(api.kpi.range, { period, year: end.year, num: end.num }) as
    { entries: KpiEntry[]; oee: (OeeSum & { year: number; num: number })[] } | undefined
  const { run: save, error, clearError } = useSafeMutation(api.kpi.saveRange)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [saved, setSaved] = useState('')
  const [active, setActive] = useState(0)
  const [justSaved, setJustSaved] = useState(false)

  // Sunucudaki aralık → seçili masraf yerinin satırları.
  const serverSig = JSON.stringify(data?.entries.filter((e) => e.costCenter === code) ?? null)
  useEffect(() => {
    if (!data || !code) return
    const next = toDraft(seriesLines(data.entries, period, slots, code), slots)
    setLines(next)
    setSaved(sig(next))
    setActive((a) => Math.min(a, next.length - 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSig, code, slotKey(end)])

  const dirty = lines.length > 0 && sig(lines) !== saved
  const guard = (fn: () => void) => () => (dirty && !window.confirm('Discard the unsaved changes?') ? undefined : fn())
  const line = lines[Math.min(active, lines.length - 1)]
  const cellOf = (l: DraftLine, key: string) => l.cells[key] ?? EMPTY_CELL

  const setValue = (key: string, side: 'plan' | 'actual', field: keyof KpiValues, text: string) => {
    setJustSaved(false)
    setLines((ls) =>
      ls.map((l) =>
        l.id === line?.id
          ? { ...l, cells: { ...l.cells, [key]: { ...cellOf(l, key), [side]: { ...cellOf(l, key)[side], [field]: text } } } }
          : l,
      ),
    )
  }
  const setType = (t: OperatorType) => setLines((ls) => ls.map((l) => (l.id === line?.id ? { ...l, operatorType: t } : l)))
  const addLine = () => {
    const other: OperatorType = lines.some((l) => l.operatorType === 'indirect') ? 'direct' : 'indirect'
    setLines((ls) => [...ls, ...toDraft([{ operatorType: other, k: 0, cells: {} }], slots)])
    setActive(lines.length)
  }
  const ccName = (c: string | null) => costCenters.find((x) => x.code === c)?.name ?? c ?? ''
  const rangeLabel =
    period === 'month' ? String(end.year) : `${slots[0].label} ${slots[0].year} – ${slots[slots.length - 1].label} ${end.year}`
  const removeLine = () => {
    if (!line || lines.length < 2) return
    if (!window.confirm(`Remove the ${line.operatorType} line of ${ccName(code)} for ${rangeLabel}? Its values are deleted when you save.`))
      return
    setLines((ls) => ls.filter((l) => l.id !== line.id))
    setActive(0)
  }

  const onSave = async () => {
    if (!code) return
    const sl = lines.map(toLine)
    const body = slots.map((s) => ({ year: s.year, num: s.num, rows: slotRows(sl, slotKey(s)) }))
    if (await save({ period, costCenter: code, slots: body })) {
      setSaved(sig(lines))
      setJustSaved(true)
    }
  }

  // Hesaplar: dönem başına ve toplam. OEE kök verisi masraf yerinindir — ilk satırda gösterilir.
  const first = active === 0
  const oeeOf = (s: KpiSlot) =>
    first ? (data?.oee ?? []).filter((o) => o.costCenter === code && o.year === s.year && o.num === s.num) : []
  const sl = line ? toLine(line) : null
  const perSlot = useMemo(
    () => (sl && code ? Object.fromEntries(slots.map((s) => [slotKey(s), kpiFor([lineEntry(sl, period, s, code)], oeeOf(s))])) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [line, data, code, slots, first],
  )
  const total = useMemo(
    () =>
      sl && code
        ? seriesTotal(
            slots.map((s) => lineEntry(sl, period, s, code)),
            first ? (data?.oee ?? []).filter((o) => o.costCenter === code) : [],
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [line, data, code, slots, first],
  )

  const isNow = (s: KpiSlot) => s.year === now.year && s.num === now.num

  // ---- Excel gibi gezinme ve yapıştırma ----
  const tableRef = useRef<HTMLTableElement>(null)
  // Girilebilir satırlar sırayla (OEE gerçekleşeni girilmez).
  const rows = KPI_INPUTS.flatMap((i) =>
    (['plan', 'actual'] as const).filter((s) => !(s === 'actual' && i.planOnly)).map((side) => ({ key: i.key, side })),
  )
  const focusCell = (r: number, c: number) =>
    tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`)?.focus()
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault()
      focusCell(e.shiftKey && e.key === 'Enter' ? r - 1 : r + 1, c)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusCell(r - 1, c)
    }
  }
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const grid = parseGrid(e.clipboardData.getData('text/plain'))
    if (grid.length === 1 && grid[0].length === 1) return // tek değer: normal yapıştırma
    e.preventDefault()
    setJustSaved(false)
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== line?.id) return l
        const cells = { ...l.cells }
        grid.forEach((cols, i) => {
          const row = rows[r + i]
          if (!row) return
          cols.forEach((v, j) => {
            const s = slots[c + j]
            if (!s) return
            const key = slotKey(s)
            const cur = cells[key] ?? EMPTY_CELL
            cells[key] = { ...cur, [row.side]: { ...cur[row.side], [row.key]: cleanPasted(v) } }
          })
        })
        return { ...l, cells }
      }),
    )
  }
  /** Bir satırın ilk değerini boş dönemlere yayar. */
  const fillRight = (field: keyof KpiValues, side: 'plan' | 'actual') => {
    if (!line) return
    const firstVal = slots.map((s) => cellOf(line, slotKey(s))[side][field] ?? '').find((v) => v.trim())
    if (!firstVal) return
    setJustSaved(false)
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== line.id) return l
        const cells = { ...l.cells }
        for (const s of slots) {
          const key = slotKey(s)
          const cur = cells[key] ?? EMPTY_CELL
          if (!(cur[side][field] ?? '').trim()) cells[key] = { ...cur, [side]: { ...cur[side], [field]: firstVal } }
        }
        return { ...l, cells }
      }),
    )
  }

  const typeCount = (t: OperatorType) => lines.filter((l) => l.operatorType === t).length
  const lineLabel = (l: DraftLine, i: number) => {
    const t = l.operatorType === 'direct' ? 'Direct' : 'Indirect'
    return typeCount(l.operatorType) > 1 ? `${t} ${lines.slice(0, i + 1).filter((x) => x.operatorType === l.operatorType).length}` : t
  }
  const hasData = (c: string) => (data?.entries ?? []).some((e) => e.costCenter === c)
  const move = (dir: -1 | 1) =>
    guard(() => setEnd((e) => (period === 'month' ? { year: e.year + dir, num: 12 } : shiftWeek(e.year, e.num, dir * slots.length))))
  const totalLabel = period === 'month' ? String(end.year) : `${slots.length} weeks`
  const weeks = isoWeeksInYear(end.year)
  const yearOptions = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - 5 + i)
  const sel = 'rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm font-semibold text-foreground'

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title={period === 'month' ? 'Monthly KPI — data entry' : 'Weekly KPI — data entry'}
        summary={`${ctx?.active?.plantName ?? ''} — one cost center at a time: ${period === 'month' ? 'months' : 'weeks'} across, plan and actual down.`}
        links={relatedPages(period === 'month' ? '/kpi/monthly/entry' : '/kpi/weekly/entry')}
        info={
          <>
            <p>
              {period === 'month'
                ? 'Choose the year and the cost center; the columns are the twelve months.'
                : 'Choose the last week and the cost center; the columns are the 13 ISO weeks up to it (the same weeks as the dashboard). The arrows move 13 weeks back or forward — plan the coming weeks by choosing a later week.'}{' '}
              Each cost center can have several lines (e.g. Direct and Indirect) — the tabs above the table. Saving writes only this cost
              center's {period === 'month' ? 'year' : 'weeks'}.
            </p>
            <p>
              Like Excel: Enter or ↓ goes to the next row, Tab to the next {period === 'month' ? 'month' : 'week'}. Copy a row or a block in
              Excel and paste it into a cell — it fills the columns to the right and the rows below. Turkish and English number formats both
              work (1.234,5 or 1,234.5). The ⇥ button copies a row's first value into its empty {period === 'month' ? 'months' : 'weeks'}.
            </p>
            <p>
              Calculated: Overtime % = overtime ÷ normal presence; Total presence = normal presence + overtime; Efficiency = production hour
              ÷ total presence. Actual OEE comes from the OEE data; actual production volume and hour are taken from the OEE data when left
              empty (shown in grey). Total column: hours and pieces are added, operators averaged, ratios from the totals.
            </p>
          </>
        }
      />
      <ErrorBanner message={error} onDismiss={clearError} />

      {costCenters.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {ctx?.active?.plantName} has no cost center yet — a creator adds them on{' '}
          <Link to="/settings" className="underline">
            Company settings
          </Link>
          .
        </p>
      ) : (
        <>
          {/* Dönem, masraf yeri, kayıt */}
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="text-xs text-muted-foreground">
              {period === 'month' ? 'Year' : 'Weeks up to'}
              <div className="mt-1 flex items-center gap-1">
                <button
                  onClick={move(-1)}
                  className="rounded-lg border border-input p-1.5 hover:bg-muted"
                  title={period === 'month' ? 'Previous year' : '13 weeks earlier'}
                  aria-label="Earlier"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </button>
                <select
                  className={sel}
                  value={end.year}
                  aria-label="Year"
                  onChange={(e) => {
                    const y = Number(e.target.value)
                    guard(() => setEnd((x) => ({ year: y, num: period === 'month' ? 12 : Math.min(x.num, isoWeeksInYear(y)) })))()
                  }}
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                {period === 'week' && (
                  <select
                    className={sel}
                    value={end.num}
                    aria-label="Last week"
                    onChange={(e) => {
                      const w = Number(e.target.value)
                      guard(() => setEnd((x) => ({ ...x, num: w })))()
                    }}
                  >
                    {Array.from({ length: weeks }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        W{i + 1}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  onClick={move(1)}
                  className="rounded-lg border border-input p-1.5 hover:bg-muted"
                  title={period === 'month' ? 'Next year' : '13 weeks later'}
                  aria-label="Later"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
                {(end.year !== now.year || (period === 'week' && end.num !== now.num)) && (
                  <button onClick={guard(() => setEnd(now))} className="ml-1 text-xs underline">
                    {period === 'month' ? 'This year' : 'This week'}
                  </button>
                )}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Cost center</p>
              <div className="mt-1 flex gap-1.5 overflow-x-auto pb-1">
                {costCenters.map((c) => {
                  const isSel = c.code === code
                  return (
                    <button
                      key={c.code}
                      onClick={guard(() => {
                        setCc(c.code)
                        setActive(0)
                      })}
                      className={`shrink-0 rounded-xl border px-3 py-1.5 text-left transition ${
                        isSel
                          ? 'border-violet-300 bg-violet-50 shadow-sm ring-1 ring-violet-200'
                          : 'border-border bg-background hover:bg-muted'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                        {c.name}
                        {hasData(c.code) && (
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title={`Has data in ${rangeLabel}`} />
                        )}
                      </span>
                      <span className="block text-[11px] text-muted-foreground tabular-nums">{c.code}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex items-center gap-2 pb-1">
              {dirty && <span className="text-xs font-medium text-amber-700">● Unsaved changes</span>}
              {!dirty && justSaved && <span className="text-xs text-emerald-700">✓ Saved</span>}
              {dirty && (
                <button
                  className="text-xs underline"
                  onClick={() => {
                    if (data && code) setLines(toDraft(seriesLines(data.entries, period, slots, code), slots))
                  }}
                >
                  Discard
                </button>
              )}
              <button
                className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background shadow-sm disabled:opacity-40"
                disabled={!dirty || !editable}
                onClick={() => void onSave()}
              >
                Save {ccName(code)}
              </button>
            </div>
          </div>
          {!editable && (
            <p className="mt-2 text-xs text-muted-foreground">You can view the KPI data; changing it needs KPI edit permission.</p>
          )}

          {/* Satırlar (Direct / Indirect …) */}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-b border-border">
            {lines.map((l, i) => (
              <button
                key={l.id}
                onClick={() => setActive(i)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${i === active ? 'border-violet-500 font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              >
                {lineLabel(l, i)}
              </button>
            ))}
            {editable && (
              <button
                onClick={addLine}
                className="flex items-center gap-1 px-2 py-2 text-xs text-muted-foreground hover:text-foreground"
                title="Another operator line for this cost center"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden /> line
              </button>
            )}
            {line && (
              <span className="ml-auto flex items-center gap-2 pb-1 text-xs text-muted-foreground">
                Operator type
                <select
                  className="rounded-md border border-input bg-background px-1.5 py-1 text-sm text-foreground disabled:opacity-60"
                  disabled={!editable}
                  value={line.operatorType}
                  onChange={(e) => setType(e.target.value as OperatorType)}
                >
                  <option value="direct">Direct</option>
                  <option value="indirect">Indirect</option>
                </select>
                {editable && lines.length > 1 && (
                  <button
                    onClick={removeLine}
                    className="rounded-md p-1 text-destructive hover:bg-destructive/10"
                    title="Remove this line"
                    aria-label="Remove this line"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </span>
            )}
          </div>

          {!data || !line ? (
            <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-xl border border-border shadow-sm">
              <table ref={tableRef} className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/70 text-xs text-muted-foreground">
                    <th className="sticky left-0 z-20 w-32 min-w-32 bg-muted px-3 py-2 text-left font-medium sm:w-48 sm:min-w-48">
                      {ccName(code)} · {lineLabel(line, active)}
                    </th>
                    <th className="sticky left-32 z-20 w-16 min-w-16 bg-muted px-2 py-2 text-left font-medium sm:left-48" />
                    {slots.map((s, i) => (
                      <th key={slotKey(s)} className={`px-1 py-2 text-center font-semibold ${isNow(s) ? 'text-violet-700' : ''}`}>
                        {s.label}
                        {/* Haftalıkta yıl değişince ve ilk sütunda yıl. */}
                        {period === 'week' && (i === 0 || s.year !== slots[i - 1].year) && (
                          <span className="block text-[10px] font-normal text-muted-foreground">{s.year}</span>
                        )}
                        {isNow(s) && <span className="mx-auto mt-0.5 block h-0.5 w-5 rounded-full bg-violet-500" />}
                      </th>
                    ))}
                    <th className="border-l border-border bg-muted px-3 py-2 text-right font-semibold whitespace-nowrap text-foreground">
                      {totalLabel}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {KPI_INPUTS.map((inp, gi) => {
                    const sides = (['plan', 'actual'] as const).filter((s) => !(s === 'actual' && inp.planOnly))
                    // Yapışkan sütunlar kayarken altı görünmesin: zeminler opak.
                    const band = gi % 2 ? 'bg-slate-50' : 'bg-background'
                    const label = inp.key === 'oee' ? 'OEE' : inp.label
                    return (
                      <Fragment key={inp.key}>
                        {sides.map((side, si) => {
                          const r = rows.findIndex((x) => x.key === inp.key && x.side === side)
                          return (
                            <tr key={side} className={`group ${band} ${si === 0 ? 'border-t border-border' : ''}`}>
                              {si === 0 && (
                                <th
                                  rowSpan={inp.key === 'oee' ? 2 : sides.length}
                                  className={`sticky left-0 z-10 w-32 min-w-32 px-3 py-1 text-left align-top text-xs font-medium text-foreground sm:w-48 sm:min-w-48 sm:text-sm ${band}`}
                                >
                                  {label}
                                  <span className="block text-[11px] font-normal text-muted-foreground">
                                    {inp.key === 'oee' ? '%' : inp.unit}
                                  </span>
                                </th>
                              )}
                              <td className={`sticky left-32 z-10 px-2 py-1 text-xs whitespace-nowrap sm:left-48 ${band}`}>
                                <span className="flex items-center gap-1.5">
                                  <span className={`h-1.5 w-1.5 rounded-full ${side === 'plan' ? 'bg-violet-500' : 'bg-emerald-500'}`} />
                                  <span className="text-muted-foreground">
                                    {inp.key === 'oee' ? 'Target' : side === 'plan' ? 'Plan' : 'Actual'}
                                  </span>
                                  {editable && (
                                    <button
                                      tabIndex={-1}
                                      onClick={() => fillRight(inp.key, side)}
                                      className="ml-auto rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground"
                                      title={`Copy the first value into the empty ${period === 'month' ? 'months' : 'weeks'}`}
                                      aria-label={`Fill ${label} ${side} into the empty ${period === 'month' ? 'months' : 'weeks'}`}
                                    >
                                      <ArrowRightToLine className="h-3.5 w-3.5" aria-hidden />
                                    </button>
                                  )}
                                </span>
                              </td>
                              {slots.map((s, c) => {
                                const o = oeeOf(s)[0]
                                const hint =
                                  side === 'actual' && o?.loadingMin
                                    ? inp.key === 'volume'
                                      ? Math.round(o.good).toLocaleString('en-GB')
                                      : inp.key === 'productionHours'
                                        ? String(Math.round(o.productionMin / 60))
                                        : ''
                                    : ''
                                const key = slotKey(s)
                                return (
                                  <td key={key} className={`px-0.5 py-0.5 ${isNow(s) ? 'bg-violet-50/50' : ''}`}>
                                    <input
                                      className={cell}
                                      inputMode="decimal"
                                      disabled={!editable}
                                      data-r={r}
                                      data-c={c}
                                      placeholder={hint}
                                      title={hint ? `Empty = ${hint} from the OEE data` : `${label} — ${side} — ${s.label} ${s.year}`}
                                      aria-label={`${label} ${side} ${s.label}`}
                                      value={cellOf(line, key)[side][inp.key] ?? ''}
                                      onChange={(e) => setValue(key, side, inp.key, e.target.value)}
                                      onKeyDown={(e) => onKey(e, r, c)}
                                      onPaste={(e) => onPaste(e, r, c)}
                                    />
                                  </td>
                                )
                              })}
                              <td className="border-l border-border bg-muted/40 px-3 py-1 text-right font-semibold tabular-nums">
                                {formatKpi(total?.[side][METRIC[inp.key]] ?? null, UNIT[inp.key])}
                              </td>
                            </tr>
                          )
                        })}
                        {inp.key === 'oee' && (
                          <tr className={band}>
                            <td className={`sticky left-32 z-10 px-2 py-1 text-xs whitespace-nowrap sm:left-48 ${band}`}>
                              <span className="flex items-center gap-1.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                <span className="text-muted-foreground">Actual</span>
                              </span>
                            </td>
                            {slots.map((s) => (
                              <td
                                key={slotKey(s)}
                                className={`px-2 py-1 text-right text-muted-foreground tabular-nums ${isNow(s) ? 'bg-violet-50/50' : ''}`}
                                title="From the OEE data"
                              >
                                {first ? formatKpi(perSlot[slotKey(s)]?.actual.oee ?? null, '%') : ''}
                              </td>
                            ))}
                            <td className="border-l border-border bg-muted/40 px-3 py-1 text-right font-semibold tabular-nums">
                              {first ? formatKpi(total?.actual.oee ?? null, '%') : ''}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                  <tr>
                    <td
                      colSpan={slots.length + 3}
                      className="border-t-2 border-border bg-muted/60 px-3 py-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase"
                    >
                      Calculated
                    </td>
                  </tr>
                  {COMPUTED.map((c) =>
                    (['plan', 'actual'] as const).map((side, si) => (
                      <tr key={`${c.key}${side}`} className={`bg-slate-50 ${si === 0 ? 'border-t border-border' : ''}`}>
                        {si === 0 && (
                          <th
                            rowSpan={2}
                            className="sticky left-0 z-10 w-32 min-w-32 bg-slate-50 px-3 py-1 text-left align-top text-xs font-medium text-foreground sm:w-48 sm:min-w-48 sm:text-sm"
                          >
                            {c.label}
                            <span className="block text-[11px] font-normal text-muted-foreground">{c.note}</span>
                          </th>
                        )}
                        <td className="sticky left-32 z-10 bg-slate-50 px-2 py-1 text-xs whitespace-nowrap text-muted-foreground sm:left-48">
                          <span className="flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 rounded-full ${side === 'plan' ? 'bg-violet-500' : 'bg-emerald-500'}`} />
                            {side === 'plan' ? 'Plan' : 'Actual'}
                          </span>
                        </td>
                        {slots.map((s) => (
                          <td
                            key={slotKey(s)}
                            className={`px-2 py-1 text-right text-muted-foreground tabular-nums ${isNow(s) ? 'bg-violet-50/50' : ''}`}
                          >
                            {formatKpi(perSlot[slotKey(s)]?.[side][c.key] ?? null, c.unit)}
                          </td>
                        ))}
                        <td className="border-l border-border bg-muted/40 px-3 py-1 text-right font-semibold tabular-nums">
                          {formatKpi(total?.[side][c.key] ?? null, c.unit)}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Empty fields stay empty (not 0). Percentages are entered as numbers, e.g. 3.5 for 3.5%. Productivity is a plain value. Grey
            numbers in Actual come from the OEE data and are used while the cell is empty.
          </p>
        </>
      )}
    </div>
  )
}
