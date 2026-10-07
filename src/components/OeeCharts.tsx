import { useEffect, useRef, useState, type ReactNode } from 'react'

import { ratios, type SeriesPoint } from '../lib/oee'

/**
 * OEE grafikleri. Tek eksen (yüzde), ince çubuklar, yatay ızgara; her
 * sütunun üstüne gelince değerler ipucunda. Renkler .oee-viz'de (styles.css),
 * kategorik sıra sabit. Sayılar ayrıca altındaki tablolarda.
 */

const PAD_L = 40
const PAD_R = 12
const PAD_T = 12
const PAD_B = 28

export const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width: width || 720 }
}

/** Izgara adımı: küçük değerlerde 5 / 10 puan, yoksa 25 puan. */
function tickStep(max: number): number {
  return max <= 0.3 ? 0.05 : max <= 0.6 ? 0.1 : 0.25
}

/** Eksenin üst sınırı: adımın katı; OEE grafiklerinde en az %100. */
function niceMax(v: number, atLeast = 1): number {
  const top = Math.max(v, atLeast)
  const step = tickStep(top)
  return Math.max(step, Math.ceil(top / step - 1e-9) * step)
}

function Grid({ width, height, max, top = PAD_T }: { width: number; height: number; max: number; top?: number }) {
  const step = tickStep(max)
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step)
  const y = (v: number) => top + (height - top - PAD_B) * (1 - v / max)
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD_L} x2={width - PAD_R} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
          <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--viz-axis)">
            {Math.round(t * 100)}%
          </text>
        </g>
      ))}
    </g>
  )
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(8, x - 90), width - 188)
  return (
    <div
      className="pointer-events-none absolute z-10 w-44 rounded-md border border-border bg-background px-2.5 py-2 text-xs shadow-lg"
      style={{ left, top: Math.max(0, y - 8), transform: 'translateY(-100%)' }}
    >
      {children}
    </div>
  )
}

/**
 * OEE çubukları (aylık, haftalık, vardiya) ve üstünde Performans % çizgisi
 * (koyu turuncu; planlamacı 2026-10-07: "OEE 64, P 80 → availability ~80"
 * yorumu için). İkisi de yüzde: tek eksen. Etiket: çubuk değeri çubuğun,
 * performans değeri noktanın üstünde (14 noktaya kadar; fazlası ipucunda).
 */
export function OeeBarChart({ points, height = 240, ariaLabel }: { points: SeriesPoint[]; height?: number; ariaLabel: string }) {
  const { ref, width } = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const perf = points.map((p) => (p.oee === null ? null : ratios(p.times).performance))
  const max = niceMax(Math.max(0, ...points.map((p) => p.oee ?? 0), ...perf.map((v) => v ?? 0)))
  const n = Math.max(1, points.length)
  const col = (width - PAD_L - PAD_R) / n
  const bar = Math.max(4, Math.min(28, col * 0.62))
  const top0 = PAD_T + 12
  const y = (v: number) => top0 + (height - top0 - PAD_B) * (1 - v / max)
  const base = height - PAD_B
  // Eksen etiketi en az ~40 px yer bulsun (telefonda üst üste binmesin).
  const labelEvery = Math.max(n > 14 ? Math.ceil(n / 14) : 1, Math.ceil(40 / col))
  const perfLabels = n <= 14 && col >= 22
  const cx = (i: number) => PAD_L + col * i + col / 2
  // Çizgi veri olmayan noktada kesilir.
  const segments: string[] = []
  let cur = ''
  perf.forEach((v, i) => {
    if (v === null || v === undefined) {
      if (cur) segments.push(cur)
      cur = ''
      return
    }
    cur += `${cur ? 'L' : 'M'}${cx(i)},${y(v)}`
  })
  if (cur) segments.push(cur)
  const h = hover !== null ? points[hover] : null
  const hr = h ? ratios(h.times) : null
  return (
    <div ref={ref} className="oee-viz relative w-full">
      <div className="mb-1 flex justify-end gap-4 text-[11px] text-muted-foreground" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--viz-1)' }} /> OEE
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="18" height="10" aria-hidden>
            <line x1="1" x2="17" y1="5" y2="5" stroke="var(--viz-perf)" strokeWidth="2" />
            <circle cx="9" cy="5" r="3.5" fill="var(--viz-perf)" stroke="var(--background)" strokeWidth="1.5" />
          </svg>
          Performance
        </span>
      </div>
      <svg width={width} height={height} role="img" aria-label={`${ariaLabel} — OEE bars, performance line`} onMouseLeave={() => setHover(null)}>
        <Grid width={width} height={height} max={max} top={top0} />
        {points.map((p, i) => {
          const v = p.oee ?? 0
          const top = y(v)
          const hgt = Math.max(0, base - top)
          return (
            <g key={p.key} onMouseEnter={() => setHover(i)}>
              <rect x={PAD_L + col * i} y={PAD_T} width={col} height={base - PAD_T} fill="transparent" />
              {p.oee !== null && hgt > 0 && (
                <path
                  d={`M${cx(i) - bar / 2},${base} V${top + 4} q0,-4 4,-4 H${cx(i) + bar / 2 - 4} q4,0 4,4 V${base} Z`}
                  fill="var(--viz-1)"
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              {i % labelEvery === 0 && (
                <text x={cx(i)} y={base + 16} textAnchor="middle" fontSize={10} fill="var(--viz-axis)">
                  {p.label}
                </text>
              )}
            </g>
          )
        })}
        {segments.map((d) => (
          <path key={d} d={d} fill="none" stroke="var(--viz-perf)" strokeWidth={2} strokeLinejoin="round" pointerEvents="none" />
        ))}
        {perf.map((v, i) => {
          if (v === null || v === undefined) return null
          const py = y(v)
          // Çubuk etiketiyle çakışmasın: nokta çubuğa yakınsa etiket biraz yukarıda.
          const barLabel = y(points[i].oee ?? 0) - 4
          const ly = Math.abs(py - 8 - barLabel) < 12 ? barLabel - 12 : py - 8
          return (
            <g key={`p${points[i].key}`} pointerEvents="none">
              <circle cx={cx(i)} cy={py} r={hover === i ? 5 : 4} fill="var(--viz-perf)" stroke="var(--background)" strokeWidth={2} />
              {perfLabels && (
                <text x={cx(i)} y={Math.max(9, ly)} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--viz-axis)">
                  {Math.round(v * 100)}
                </text>
              )}
            </g>
          )
        })}
        {/* Çubuk değerleri en üstte (çizgi üstünden geçmesin): kalın, siyah, % işaretsiz (60), zemin renginde ince hale. */}
        {points.map((p, i) =>
          p.oee !== null && base - y(p.oee) > 0 ? (
            <text
              key={`v${p.key}`}
              x={cx(i)}
              y={Math.max(10, y(p.oee) - 4)}
              textAnchor="middle"
              fontSize={bar < 14 ? 9 : 11}
              fontWeight={700}
              fill="var(--viz-value)"
              stroke="var(--background)"
              strokeWidth={3}
              paintOrder="stroke"
              pointerEvents="none"
            >
              {Math.round(p.oee * 100)}
            </text>
          ) : null,
        )}
      </svg>
      {h && hr && (
        <Tooltip x={cx(hover!)} y={y(Math.max(h.oee ?? 0, perf[hover!] ?? 0))} width={width}>
          <p className="font-semibold text-foreground">{h.label}</p>
          <p className="text-foreground">OEE {pct(hr.oee)}</p>
          <p className="text-foreground">Performance {pct(hr.performance)}</p>
          <p className="text-muted-foreground">
            A {pct(hr.availability)} · Q {pct(hr.quality)}
          </p>
        </Tooltip>
      )}
      {h && !hr && (
        <Tooltip x={cx(hover!)} y={base} width={width}>
          <p className="font-semibold text-foreground">{h.label}</p>
          <p className="text-muted-foreground">No data</p>
        </Tooltip>
      )}
    </div>
  )
}

export interface StackPart {
  key: string
  label: string
  value: number
}

const SLOT = (i: number) => `var(--viz-${(i % 7) + 1})`

/** `slot`: kategorik renk sırası; aynı kayıp her grafikte aynı renkte kalsın. */
export function Legend({ items }: { items: { key: string; label: string; slot?: number }[] }) {
  return (
    <div className="oee-viz flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((it, i) => (
        <span key={it.key} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SLOT(it.slot ?? i) }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

/** Yığılmış yüzde çubukları (günlük kayıp dağılımı, % of Loading). */
export function StackedShareChart({
  columns,
  height = 240,
  ariaLabel,
}: {
  columns: { key: string; label: string; parts: StackPart[] }[]
  height?: number
  ariaLabel: string
}) {
  const { ref, width } = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const totals = columns.map((c) => c.parts.reduce((a, p) => a + p.value, 0))
  const max = niceMax(Math.max(0, ...totals))
  const n = Math.max(1, columns.length)
  const col = (width - PAD_L - PAD_R) / n
  const bar = Math.max(6, Math.min(36, col * 0.6))
  const scale = (v: number) => (height - PAD_T - PAD_B) * (v / max)
  const base = height - PAD_B
  const h = hover !== null ? columns[hover] : null
  return (
    <div ref={ref} className="oee-viz relative w-full">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        <Grid width={width} height={height} max={max} />
        {columns.map((c, i) => {
          const cx = PAD_L + col * i + col / 2
          let acc = 0
          return (
            <g key={c.key} onMouseEnter={() => setHover(i)}>
              <rect x={PAD_L + col * i} y={PAD_T} width={col} height={base - PAD_T} fill="transparent" />
              {c.parts.map((p, j) => {
                const hgt = scale(p.value)
                const top = base - scale(acc) - hgt
                acc += p.value
                // 2 px yüzey boşluğu: dilimler ayrı okunur.
                return hgt > 2 ? (
                  <rect
                    key={p.key}
                    x={cx - bar / 2}
                    y={top + 1}
                    width={bar}
                    height={hgt - 2}
                    rx={2}
                    fill={SLOT(j)}
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                ) : null
              })}
              <text x={cx} y={base + 16} textAnchor="middle" fontSize={10} fill="var(--viz-axis)">
                {c.label}
              </text>
            </g>
          )
        })}
      </svg>
      {h && (
        <Tooltip x={PAD_L + col * hover! + col / 2} y={base - scale(totals[hover!])} width={width}>
          <p className="font-semibold text-foreground">{h.label}</p>
          {h.parts.map((p) => (
            <p key={p.key} className="flex justify-between text-muted-foreground">
              <span>{p.label}</span>
              <span className="tabular-nums text-foreground">{pct(p.value)}</span>
            </p>
          ))}
        </Tooltip>
      )}
    </div>
  )
}

/** Çizgi trendi (10 haftalık kayıp oranları). */
export function LineTrendChart({
  labels,
  series,
  height = 240,
  ariaLabel,
}: {
  labels: string[]
  series: { key: string; label: string; values: (number | null)[]; slot?: number }[]
  height?: number
  ariaLabel: string
}) {
  const { ref, width } = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const max = niceMax(Math.max(0.05, ...series.flatMap((s) => s.values.map((v) => v ?? 0))), 0)
  const n = Math.max(1, labels.length)
  const col = (width - PAD_L - PAD_R) / n
  const x = (i: number) => PAD_L + col * i + col / 2
  const y = (v: number) => PAD_T + (height - PAD_T - PAD_B) * (1 - v / max)
  const base = height - PAD_B
  return (
    <div ref={ref} className="oee-viz relative w-full">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        <Grid width={width} height={height} max={max} />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={base} stroke="var(--viz-axis)" strokeWidth={1} opacity={0.4} />}
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`))
          const d = pts.reduce<string>((acc, p, i) => (p ? `${acc}${acc && pts[i - 1] ? 'L' : 'M'}${p}` : acc), '')
          return (
            <g key={s.key}>
              <path d={d} fill="none" stroke={SLOT(s.slot ?? si)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {hover !== null && s.values[hover] !== null && (
                <circle cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={SLOT(s.slot ?? si)} stroke="var(--background)" strokeWidth={2} />
              )}
            </g>
          )
        })}
        {labels.map((l, i) => (
          <g key={l} onMouseEnter={() => setHover(i)}>
            <rect x={x(i) - col / 2} y={PAD_T} width={col} height={base - PAD_T} fill="transparent" />
            <text x={x(i)} y={base + 16} textAnchor="middle" fontSize={10} fill="var(--viz-axis)">
              {l}
            </text>
          </g>
        ))}
      </svg>
      {hover !== null && (
        <Tooltip x={x(hover)} y={PAD_T + 40} width={width}>
          <p className="font-semibold text-foreground">{labels[hover]}</p>
          {series.map((s) => (
            <p key={s.key} className="flex justify-between text-muted-foreground">
              <span>{s.label}</span>
              <span className="tabular-nums text-foreground">{pct(s.values[hover])}</span>
            </p>
          ))}
        </Tooltip>
      )}
    </div>
  )
}

/**
 * Pres bazında tablo: satır = iş merkezi (ve en üstte kapsam toplamı),
 * sütun = dönem. Hücre OEE; üstüne gelince A / P ve Loading.
 */
export function PeriodTable({
  total,
  rows,
  unknown,
  shiftsWorked,
}: {
  total: SeriesPoint[]
  rows: [string, SeriesPoint[]][]
  /** Press Definitions'ta olmayan iş merkezleri (işaretlenir). */
  unknown?: Set<string>
  /** Verilirse başlığın altında "Shifts worked" satırı: Loading ÷ net vardiya süresi. */
  shiftsWorked?: { of: (p: SeriesPoint) => number | null; note: string }
}) {
  if (!total.length) return null
  const cell = (p: SeriesPoint) => {
    const r = ratios(p.times)
    return (
      <td
        key={p.key}
        className="px-2 py-1 text-right tabular-nums"
        title={r.oee === null ? 'No data' : `A ${pct(r.availability)} · P ${pct(r.performance)} · Q ${pct(r.quality)}`}
      >
        {pct(r.oee)}
      </td>
    )
  }
  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">OEE</th>
            {total.map((p) => (
              <th key={p.key} className="px-2 py-1.5 text-right font-medium">
                {p.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shiftsWorked && (
            <tr className="border-t border-border bg-sky-100 font-semibold text-sky-950 dark:bg-sky-950 dark:text-sky-100">
              <td className="whitespace-nowrap px-2 py-1">Shifts worked</td>
              {total.map((p) => {
                const v = shiftsWorked.of(p)
                return (
                  <td key={p.key} className="px-2 py-1 text-right tabular-nums">
                    {v === null ? '—' : v.toFixed(1)}
                  </td>
                )
              })}
            </tr>
          )}
          <tr className="border-t border-border bg-muted/40 font-semibold text-foreground">
            <td className="px-2 py-1">Total</td>
            {total.map(cell)}
          </tr>
          {rows.map(([wc, pts]) => (
            <tr key={wc} className="border-t border-border">
              <td className="whitespace-nowrap px-2 py-1 font-medium text-foreground">
                {wc}
                {unknown?.has(wc) && (
                  <span className="ml-1 text-[10px] font-normal text-amber-700" title="Not defined on Work Center Definitions">
                    (not in Work Center Definitions)
                  </span>
                )}
              </td>
              {pts.map(cell)}
            </tr>
          ))}
        </tbody>
      </table>
      {shiftsWorked && <p className="border-t border-border px-2 py-1.5 text-[11px] text-muted-foreground">{shiftsWorked.note}</p>}
    </div>
  )
}
