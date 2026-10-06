import { Link } from '@tanstack/react-router'
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { PageHeader } from './PageHeader'
import { useQuery } from '../lib/convexTransport'
import {
  KPI_ROWS,
  formatKpi,
  kpiFor,
  kpiGap,
  periodTitle,
  slotKey,
  type KpiEntry,
  type KpiMetrics,
  type KpiPeriod,
  type KpiResult,
  type KpiSlot,
  type OeeSum,
} from '../lib/kpi'
import { usePlant } from '../lib/plantContext'
import { KpiPeriodPicker, defaultSlot } from './KpiPeriodPicker'
import { relatedPages } from '../lib/navigation'
import { printSheet } from '../lib/printSheet'

/**
 * KPI dashboard'u — tek A3 (yatay) sayfa. Ölçü sabit: aylıkta her zaman 12
 * ay (Ocak–Aralık), haftalıkta seçilen haftayla biten 13 hafta; Ocak'ta da
 * Aralık'ta da kartlar, grafikler ve tablo aynı yerde, aynı boyutta.
 * Birden çok fabrika ve masraf yeri seçilebilir; toplamlar saat ve adetlerden.
 */

interface PlantData {
  plantId: string
  plantName: string
  companyName: string
  costCenters: { code: string; name: string }[]
  entries: KpiEntry[]
  oee: (OeeSum & { slot: string })[]
}

interface PlantOption {
  plantId: string
  plantName: string
  companyName: string
  costCenters: { code: string; name: string }[]
}

/** A3 yatay, 96 dpi'da piksel. */
const SHEET_W = 1587
const SHEET_H = 1123
/** Tabloda en çok bu kadar masraf yeri satırı (ölçü sabit kalsın). */
const TABLE_ROWS = 10

const ccKey = (plantId: string, code: string) => `${plantId}|${code}`

export function KpiDashboardPage({ period }: { period: KpiPeriod }) {
  const { ctx, can } = usePlant()
  const [slot, setSlot] = useState(() => defaultSlot(period))
  const options = (useQuery(api.kpi.plants) ?? []) as PlantOption[]
  const [plantIds, setPlantIds] = useState<string[] | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  // Varsayılan: seçili fabrika, bütün masraf yerleri.
  const chosen = plantIds ?? (ctx?.active ? [ctx.active.plantId] : [])
  const validIds = chosen.filter((id) => options.some((o) => o.plantId === id))
  const data = useQuery(api.kpi.dashboard, validIds.length ? { period, year: slot.year, num: slot.num, plantIds: validIds } : 'skip') as
    | { slots: KpiSlot[]; plants: PlantData[] }
    | undefined

  const allCcs = options.filter((o) => validIds.includes(o.plantId)).flatMap((o) => o.costCenters.map((c) => ({ plant: o, cc: c, key: ccKey(o.plantId, c.code) })))
  const selectedCcs = allCcs.filter((x) => !excluded.has(x.key))
  const selectedKeys = new Set(selectedCcs.map((x) => x.key))
  const multiPlant = validIds.length > 1

  const view = useMemo(() => {
    if (!data) return null
    const entries = data.plants.flatMap((p) => p.entries.filter((e) => selectedKeys.has(ccKey(p.plantId, e.costCenter))).map((e) => ({ ...e, plantId: p.plantId })))
    const oee = data.plants.flatMap((p) => p.oee.filter((o) => selectedKeys.has(ccKey(p.plantId, o.costCenter))).map((o) => ({ ...o, plantId: p.plantId })))
    // Masraf yeri kodu iki fabrikada aynı olabilir: hesapta fabrika+kod ayrı tutulur.
    const tag = <T extends { costCenter: string; plantId: string }>(r: T) => ({ ...r, costCenter: ccKey(r.plantId, r.costCenter) })
    const bySlot = data.slots.map((s) => {
      const k = slotKey(s)
      return kpiFor(
        entries.filter((e) => slotKey(e) === k).map(tag),
        oee.filter((o) => o.slot === k).map(tag),
      )
    })
    const current = data.slots.findIndex((s) => s.year === slot.year && s.num === slot.num)
    const curKey = slotKey(slot)
    const perCc = selectedCcs.map((x) => ({
      label: multiPlant ? `${x.plant.plantName} · ${x.cc.name}` : x.cc.name,
      result: kpiFor(
        entries.filter((e) => e.plantId === x.plant.plantId && e.costCenter === x.cc.code && slotKey(e) === curKey),
        oee.filter((o) => o.plantId === x.plant.plantId && o.costCenter === x.cc.code && o.slot === curKey),
      ),
    }))
    return { bySlot, current: current < 0 ? data.slots.length - 1 : current, perCc }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, [...selectedKeys].join(','), slot.year, slot.num])

  const sheetRef = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, e.contentRect.width / SHEET_W)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const title = `${period === 'month' ? 'Monthly' : 'Weekly'} KPI — ${periodTitle(period, slot.year, slot.num)}`
  const plantsLabel = options
    .filter((o) => validIds.includes(o.plantId))
    .map((o) => (new Set(options.map((x) => x.companyName)).size > 1 ? `${o.companyName} · ${o.plantName}` : o.plantName))
    .join(', ')
  const ccLabel = selectedCcs.length === allCcs.length ? 'All cost centers' : selectedCcs.map((x) => (multiPlant ? `${x.plant.plantName} · ${x.cc.name}` : x.cc.name)).join(', ')

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title={period === 'month' ? 'Monthly KPI — dashboard' : 'Weekly KPI — dashboard'}
        summary="One A3 page: every KPI, plan against actual, the trend and each cost center."
        links={relatedPages(period === 'month' ? '/kpi/monthly/dashboard' : '/kpi/weekly/dashboard')}
        info={
          <>
            <p>
              The page always has the same layout: {period === 'month' ? 'the 12 months of the selected year' : 'the 13 weeks ending with the selected week'} in every trend, the
              selected {period === 'month' ? 'month' : 'week'} in the cards and the table.
            </p>
            <p>Several plants and cost centers can be combined: hours and pieces are added up and every percentage is calculated once from the sums.</p>
            <p>Print / PDF opens the print dialog with an A3 landscape page — choose “Save as PDF”.</p>
          </>
        }
      />

      <div className="mt-4 flex flex-wrap items-end gap-4 rounded-lg border border-border p-3 text-sm">
        <KpiPeriodPicker period={period} value={slot} onChange={setSlot} />
        {options.length > 1 && (
          <fieldset className="text-xs text-muted-foreground">
            <legend>Plants</legend>
            <div className="mt-1 flex max-w-xl flex-wrap gap-x-3 gap-y-1">
              {options.map((o) => (
                <label key={o.plantId} className="flex items-center gap-1 text-foreground">
                  <input
                    type="checkbox"
                    checked={chosen.includes(o.plantId)}
                    onChange={(e) => setPlantIds(e.target.checked ? [...chosen, o.plantId] : chosen.filter((x) => x !== o.plantId))}
                  />
                  {new Set(options.map((x) => x.companyName)).size > 1 ? `${o.companyName} · ${o.plantName}` : o.plantName}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <fieldset className="text-xs text-muted-foreground">
          <legend>
            Cost centers{' '}
            <button type="button" className="underline" onClick={() => setExcluded(new Set())}>
              all
            </button>
          </legend>
          <div className="mt-1 flex max-w-2xl flex-wrap gap-x-3 gap-y-1">
            {allCcs.map((x) => (
              <label key={x.key} className="flex items-center gap-1 text-foreground">
                <input
                  type="checkbox"
                  checked={!excluded.has(x.key)}
                  onChange={(e) => {
                    const next = new Set(excluded)
                    if (e.target.checked) next.delete(x.key)
                    else next.add(x.key)
                    setExcluded(next)
                  }}
                />
                {multiPlant ? `${x.plant.plantName} · ${x.cc.name}` : x.cc.name}
              </label>
            ))}
            {!allCcs.length && <span>No cost center defined for the selected plants.</span>}
          </div>
        </fieldset>
        <button
          type="button"
          className="ml-auto rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
          disabled={!view}
          onClick={() => sheetRef.current && printSheet(sheetRef.current, `KPI_${period === 'month' ? 'Monthly' : 'Weekly'}_${slotKey(slot)}`)}
        >
          Print / PDF (A3)
        </button>
      </div>

      <div ref={box} className="mt-4 w-full overflow-hidden" style={{ height: SHEET_H * scale }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: SHEET_W, height: SHEET_H }}>
          <KpiSheet
            ref={sheetRef}
            title={title}
            sub={`${plantsLabel || '—'} · ${ccLabel || 'no cost center'}`}
            slots={data?.slots ?? []}
            view={view}
            period={period}
            emptyText={validIds.length ? 'Loading…' : 'Choose a plant.'}
          />
        </div>
      </div>
      {!ctx?.active?.costCenters?.length && (
        <p className="mt-3 text-xs text-muted-foreground">
          The cost centers of a plant are defined on <Link to="/settings" className="underline">Company settings</Link>.
        </p>
      )}
    </div>
  )
}

export interface SheetView {
  bySlot: KpiResult[]
  current: number
  perCc: { label: string; result: KpiResult }[]
}

/** A3 sayfasının kendisi (ekranda ölçekli, yazdırmada 1:1). */
export const KpiSheet = forwardRef<
  HTMLDivElement,
  { title: string; sub: string; slots: KpiSlot[]; view: SheetView | null; period: KpiPeriod; emptyText: string; printedOn?: string }
>(function KpiSheet({ title, sub, slots, view, period, emptyText, printedOn }, ref) {
  return (
    <div ref={ref} className="kpi-sheet">
      <header className="kpi-head">
        <div>
          <div className="kpi-title">{title}</div>
          <div className="kpi-sub">{sub}</div>
        </div>
        <div className="kpi-legend">
          <span>
            <i className="kpi-sw kpi-sw-actual" /> Actual
          </span>
          <span>
            <i className="kpi-sw kpi-sw-plan" /> Plan
          </span>
          <span className="kpi-printed">Printed {printedOn ?? new Date().toISOString().slice(0, 10)}</span>
        </div>
      </header>
      {!view ? (
        <div className="kpi-empty">{emptyText}</div>
      ) : (
        <>
          <section className="kpi-cards">
            {KPI_ROWS.map((row) => (
              <KpiCard key={row.key} row={row} slots={slots} results={view.bySlot} current={view.current} />
            ))}
            {/* 12. kutu: tanımlar (ölçü sabit — 6 × 2). */}
            <div className="kpi-card kpi-notes">
              <div className="kpi-card-label">How it is calculated</div>
              <ul>
                <li>Overtime % = overtime ÷ normal presence</li>
                <li>Total presence = normal presence + overtime</li>
                <li>Efficiency = production hour ÷ total presence</li>
                <li>OEE actual = Σ operating ÷ Σ loading (OEE data)</li>
                <li>Absenteeism % and Productivity (value): entered; several lines weighted by hours</li>
                <li>Hours and pieces are added first, ratios once — never averaged</li>
              </ul>
            </div>
          </section>
          <CcTable rows={view.perCc} total={view.bySlot[view.current]} period={period} />
        </>
      )}
      <footer className="kpi-foot">
        Plan against actual per cost center · ▲▼ difference, “better / worse” by the direction of each KPI · empty = not entered
      </footer>
    </div>
  )
})

function KpiCard({ row, slots, results, current }: { row: (typeof KPI_ROWS)[number]; slots: KpiSlot[]; results: KpiResult[]; current: number }) {
  const r = results[current]
  const actual = r.actual[row.key]
  const plan = r.plan[row.key]
  const gap = kpiGap(plan, actual)
  const good = gap === null || gap === 0 || row.higher === null ? null : (gap > 0) === row.higher
  const fmt = (v: number | null) => formatKpi(v, row.unit)
  const gapText = gap === null ? '—' : `${gap > 0 ? '▲ +' : gap < 0 ? '▼ ' : ''}${row.unit === '%' ? `${(gap * 100).toFixed(1)} pts` : formatKpi(gap, row.unit)}`
  return (
    <div className="kpi-card">
      <div className="kpi-card-label" title={row.label}>
        {row.card ?? row.label}
      </div>
      <div className="kpi-card-main">
        <span className="kpi-card-value">{fmt(actual)}</span>
        <span className="kpi-card-plan">plan {fmt(plan)}</span>
      </div>
      <div className={`kpi-card-gap ${good === null ? '' : good ? 'kpi-good' : 'kpi-bad'}`}>
        {gapText}
        {good !== null && <span className="kpi-gap-word">{good ? ' better' : ' worse'}</span>}
        {row.key === 'operators' && (
          <span className="kpi-split">
            {' '}
            · direct {fmt(r.actual.operatorsDirect)} / {fmt(r.plan.operatorsDirect)} · indirect {fmt(r.actual.operatorsIndirect)} / {fmt(r.plan.operatorsIndirect)}
          </span>
        )}
      </div>
      <MiniTrend slots={slots} actual={results.map((x) => x.actual[row.key])} plan={results.map((x) => x.plan[row.key])} current={current} unit={row.unit} label={row.label} />
    </div>
  )
}

/** Sabit dilimli küçük trend: gerçekleşen çubuk, plan kısa çizgi; seçili dilim koyu ve değerli. */
export function MiniTrend({ slots, actual, plan, current, unit, label }: { slots: KpiSlot[]; actual: (number | null)[]; plan: (number | null)[]; current: number; unit: 'n' | 'h' | 'pcs' | '%'; label: string }) {
  const W = 290
  const H = 150
  const padB = 16
  const padT = 14
  const vals = [...actual, ...plan].filter((v): v is number => v !== null && Number.isFinite(v))
  const max = Math.max(...vals, 0) * 1.12 || 1
  const step = W / slots.length
  const bw = Math.min(14, step * 0.55)
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="kpi-trend" role="img" aria-label={`${label} trend`}>
      <line x1={0} x2={W} y1={H - padB} y2={H - padB} className="kpi-base" />
      {slots.map((s, i) => {
        const cx = step * i + step / 2
        const a = actual[i]
        const p = plan[i]
        const sel = i === current
        return (
          <g key={slotKey(s)}>
            <title>{`${s.label} ${s.year}: actual ${formatKpi(a, unit)} · plan ${formatKpi(p, unit)}`}</title>
            <rect x={step * i} y={0} width={step} height={H} fill="transparent" />
            {a !== null && a > 0 && (
              <path
                d={`M${cx - bw / 2},${H - padB} V${y(a) + 2} q0,-2 2,-2 h${bw - 4} q2,0 2,2 V${H - padB} Z`}
                className={sel ? 'kpi-bar kpi-bar-sel' : 'kpi-bar'}
              />
            )}
            {p !== null && <line x1={cx - step * 0.38} x2={cx + step * 0.38} y1={y(p)} y2={y(p)} className="kpi-plan" />}
            {sel && a !== null && (
              <text
                x={i === slots.length - 1 ? cx + bw / 2 : i === 0 ? cx - bw / 2 : cx}
                y={Math.max(9, y(Math.max(a, p ?? 0)) - 4)}
                textAnchor={i === slots.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}
                className="kpi-val"
              >
                {formatKpi(a, unit)}
              </text>
            )}
            <text x={cx} y={H - 4} textAnchor="middle" className={sel ? 'kpi-tick kpi-tick-sel' : 'kpi-tick'}>
              {s.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function CcTable({ rows, total, period }: { rows: { label: string; result: KpiResult }[]; total: KpiResult; period: KpiPeriod }) {
  const shown = rows.slice(0, TABLE_ROWS)
  const cell = (m: KpiMetrics, key: keyof KpiMetrics, unit: 'n' | 'h' | 'pcs' | '%') => formatKpi(m[key], unit)
  return (
    <section className="kpi-table-wrap">
      <table className="kpi-table">
        <thead>
          <tr>
            <th rowSpan={2} className="kpi-th-name">
              {period === 'month' ? 'Cost center — month' : 'Cost center — week'}
            </th>
            {KPI_ROWS.map((r) => (
              <th key={r.key} colSpan={2} title={r.label}>
                {r.short ?? r.label}
              </th>
            ))}
          </tr>
          <tr>
            {KPI_ROWS.map((r) => [
              <th key={`${r.key}p`} className="kpi-th-sub">
                Plan
              </th>,
              <th key={`${r.key}a`} className="kpi-th-sub">
                Act.
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: TABLE_ROWS }, (_, i) => shown[i]).map((row, i) => (
            <tr key={i}>
              <td className="kpi-td-name">{row?.label ?? ''}</td>
              {KPI_ROWS.map((r) => [
                <td key={`${r.key}p`}>{row ? cell(row.result.plan, r.key, r.unit) : ''}</td>,
                <td key={`${r.key}a`}>{row ? cell(row.result.actual, r.key, r.unit) : ''}</td>,
              ])}
            </tr>
          ))}
          <tr className="kpi-total">
            <td className="kpi-td-name">Total{rows.length > TABLE_ROWS ? ` (${rows.length} cost centers; first ${TABLE_ROWS} listed)` : ''}</td>
            {KPI_ROWS.map((r) => [<td key={`${r.key}p`}>{cell(total.plan, r.key, r.unit)}</td>, <td key={`${r.key}a`}>{cell(total.actual, r.key, r.unit)}</td>])}
          </tr>
        </tbody>
      </table>
    </section>
  )
}

