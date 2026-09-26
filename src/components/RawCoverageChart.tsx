import { useEffect, useRef, useState } from 'react'

import type { CoverageDay } from '../lib/rawCoverage'

/**
 * Bir hammaddenin gün gün stoğu — tek eksen (kg):
 *   gri sütun        = o günün tüketimi
 *   mavi çizgi       = gün başındaki stok (gelen sipariş dahil)
 *   kesikli çizgi    = hedef: o günden itibaren N günün tüketimi
 *   koyu nokta       = sipariş günü (miktar ipucunda ve takvim tablosunda)
 * Üstüne gelince günün bütün değerleri ipucunda yazar.
 */

const PAD_L = 56
const PAD_R = 12
const PAD_T = 20
const PAD_B = 30
const H = 300
const fmt = (n: number) => Math.round(n).toLocaleString('en-GB')

function niceStep(range: number): number {
  const raw = range / 5
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)))
  const n = raw / pow
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow
}

export function RawCoverageChart({ days, coverageDays }: { days: CoverageDay[]; coverageDays: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [boxWidth, setBoxWidth] = useState(0)
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const n = Math.max(1, days.length)
  const col = Math.max(14, Math.min(48, ((boxWidth || 800) - PAD_L - PAD_R) / n))
  const width = PAD_L + PAD_R + n * col
  const plotH = H - PAD_T - PAD_B
  const maxV = Math.max(1, ...days.map((d) => Math.max(d.stockKg, d.targetKg, d.consumptionKg)))
  const step = niceStep(maxV)
  const top = Math.ceil(maxV / step) * step
  const y = (v: number) => PAD_T + ((top - v) / top) * plotH
  const x = (i: number) => PAD_L + i * col + col / 2
  const ticks: number[] = []
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v)
  const path = (values: number[]) => values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const bar = Math.max(4, Math.min(18, col * 0.5))
  const h = hover !== null ? days[hover] : null
  const label = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  const every = Math.max(1, Math.ceil(46 / col))

  return (
    <div className="relative" ref={box}>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${H}`}
          width={width}
          height={H}
          role="img"
          aria-label="Coil stock per day against the days-of-cover target, with order days"
          className="block"
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD_L} x2={width - PAD_R} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-foreground/40' : 'stroke-border'} />
              <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
                {fmt(t)}
              </text>
            </g>
          ))}
          {days.map((d, i) => (
            <g key={d.date}>
              {hover === i && <rect x={x(i) - col / 2} y={PAD_T} width={col} height={plotH} className="fill-muted/60" />}
              {d.consumptionKg > 0 && (
                <rect
                  x={x(i) - bar / 2}
                  y={y(d.consumptionKg)}
                  width={bar}
                  height={Math.max(1, y(0) - y(d.consumptionKg))}
                  rx={2}
                  className="fill-neutral-300 dark:fill-neutral-600"
                />
              )}
              {i % every === 0 && (
                <text x={x(i)} y={H - PAD_B + 14} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                  {label(d.date)}
                </text>
              )}
            </g>
          ))}
          <path d={path(days.map((d) => d.targetKg))} fill="none" strokeWidth={2} strokeDasharray="5 4" className="stroke-neutral-500" />
          <path d={path(days.map((d) => d.stockKg))} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-blue-600 dark:stroke-blue-400" />
          {days.map((d, i) =>
            d.orderKg > 0 ? (
              <g key={`o-${d.date}`}>
                <circle cx={x(i)} cy={y(d.stockKg)} r={5} strokeWidth={2} className="fill-foreground stroke-background" />
              </g>
            ) : null,
          )}
          {days.map((d, i) => (
            <rect
              key={`hit-${d.date}`}
              x={x(i) - col / 2}
              y={0}
              width={col}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>
      </div>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-56 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md"
          style={{ left: Math.max(0, Math.min(x(hover) + 12, Math.min(width, boxWidth || width) - 232)) }}
        >
          <p className="font-semibold">{label(h.date)}</p>
          <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 tabular-nums">
            <dt className="text-muted-foreground">Stock at start</dt>
            <dd className="text-right">{fmt(h.stockKg)} kg</dd>
            <dt className="text-muted-foreground">Used this day</dt>
            <dd className="text-right">{fmt(h.consumptionKg)} kg</dd>
            <dt className="text-muted-foreground">Need, next {coverageDays} days</dt>
            <dd className="text-right">{fmt(h.targetKg)} kg</dd>
            <dt className="text-muted-foreground">Order</dt>
            <dd className="text-right font-medium">{h.orderKg > 0 ? `${fmt(h.orderKg)} kg` : '—'}</dd>
          </dl>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-blue-600 dark:bg-blue-400" />
          Stock at start of day (with orders)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-2 border-dashed border-neutral-500" />
          Need for the next {coverageDays} days
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-neutral-300 dark:bg-neutral-600" />
          Used per day
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-foreground" />
          Order day
        </span>
      </div>
    </div>
  )
}
