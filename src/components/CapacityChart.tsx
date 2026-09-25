import { useEffect, useRef, useState } from 'react'

import type { CapacityRow, CapacityWeek } from '../lib/capacityForecast'

/**
 * Haftalık kapasite grafiği — "Stamping Capacity Calculation" raporundaki
 * gibi, tek eksen (saat):
 *   gri sütun   = kapasitenin kullanılan kısmı (talep, kapasiteye kadar)
 *   kırmızı     = kapasiteyi aşan talep (fazla sipariş)
 *   beyaz kutu  = boş kapasite (siyah çerçeve)
 *   mavi çizgi  = kapasite
 *   koyu kırmızı çizgi = kümülatif (boş − fazla)
 * Her haftanın üstüne gelince bütün değerler ipucunda yazar; renk tek
 * başına bilgi taşımaz, tablo da her grafiğin üstünde.
 */

/** Hafta sütununun en dar ve en geniş hâli; arası kutunun genişliğine göre. */
const MIN_COL = 32
const MAX_COL = 90
const PAD_L = 44
const PAD_R = 12
const PAD_T = 16
const PAD_B = 34
const H = 360

const fmt = (n: number) => Math.round(n).toLocaleString('en-GB')

function niceStep(range: number): number {
  const raw = range / 5
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)))
  const n = raw / pow
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow
}

export function CapacityChart({
  weeks,
  rows,
  title,
  compact = false,
}: {
  weeks: CapacityWeek[]
  rows: CapacityRow[]
  title: string
  compact?: boolean
}) {
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
  const height = compact ? 160 : H
  const n = Math.max(1, weeks.length)
  // Sütun genişliği kutuya uyar; çok hafta varsa yatay kaydırma.
  const COL = Math.max(MIN_COL, Math.min(MAX_COL, ((boxWidth || 960) - PAD_L - PAD_R) / n))
  const BAR = Math.min(24, Math.round(COL * 0.6))
  const width = PAD_L + PAD_R + n * COL
  const plotH = height - PAD_T - PAD_B

  const maxV = Math.max(1, ...rows.map((r) => Math.max(r.capacity, r.demand, r.cumulative)))
  const minV = Math.min(0, ...rows.map((r) => r.cumulative))
  const step = niceStep(maxV - minV)
  const top = Math.ceil(maxV / step) * step
  // Negatif taraf yalnızca gerektiği kadar: çeyrek adıma yuvarlanır.
  const bottom = minV < 0 ? -Math.ceil(-minV / (step / 4)) * (step / 4) : 0
  const y = (v: number) => PAD_T + ((top - v) / (top - bottom || 1)) * plotH
  const x = (i: number) => PAD_L + i * COL + COL / 2
  const ticks: number[] = []
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v)
  for (let v = -step; v >= bottom - 1e-9; v -= step) ticks.push(v)

  const linePath = (values: number[]) =>
    values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  const h = hover !== null ? rows[hover] : null
  const hw = hover !== null ? weeks[hover] : null

  return (
    <div className="relative" ref={box}>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-label={`${title}: weekly capacity, demand and cumulative hours`}
          className="block"
          onMouseLeave={() => setHover(null)}
        >
          {/* Izgara ve eksen */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD_L}
                x2={width - PAD_R}
                y1={y(t)}
                y2={y(t)}
                className={t === 0 ? 'stroke-foreground/40' : 'stroke-border'}
                strokeWidth={1}
              />
              <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
                {fmt(t)}
              </text>
            </g>
          ))}

          {rows.map((r, i) => {
            const cx = x(i)
            const x0 = cx - BAR / 2
            const loadTop = y(r.load)
            return (
              <g key={weeks[i].start}>
                {hover === i && (
                  <rect x={cx - COL / 2} y={PAD_T} width={COL} height={plotH} className="fill-muted/60" />
                )}
                {/* Boş kapasite: siyah çerçeveli beyaz kutu */}
                {r.idle > 0 && (
                  <rect
                    x={x0 + 0.5}
                    y={y(r.capacity) + 0.5}
                    width={BAR - 1}
                    height={Math.max(0, loadTop - y(r.capacity) - 1)}
                    className="fill-background stroke-foreground"
                    strokeWidth={1}
                  />
                )}
                {/* Kullanılan kapasite */}
                {r.load > 0 && (
                  <rect x={x0} y={loadTop} width={BAR} height={Math.max(0, y(0) - loadTop)} className="fill-neutral-400 dark:fill-neutral-500" />
                )}
                {/* Fazla sipariş, kullanılanın üstünde (2px boşlukla) */}
                {r.over > 0 && (
                  <rect
                    x={x0}
                    y={y(r.load + r.over)}
                    width={BAR}
                    height={Math.max(1, y(r.load) - y(r.load + r.over) - 2)}
                    rx={3}
                    className="fill-red-600 dark:fill-red-500"
                  />
                )}
                {r.over >= 1 && !compact && (
                  <text x={cx} y={y(r.load + r.over) - 3} textAnchor="middle" className="fill-foreground text-[10px] font-semibold">
                    {fmt(r.over)}
                  </text>
                )}
                {/* Hafta etiketi ve tatil işareti */}
                <text x={cx} y={height - PAD_B + 14} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                  {weeks[i].label}
                </text>
                {weeks[i].holidays.length > 0 && (
                  <text x={cx} y={height - PAD_B + 26} textAnchor="middle" className="fill-amber-700 text-[9px] dark:fill-amber-400">
                    holiday
                  </text>
                )}
              </g>
            )
          })}

          {/* Kapasite ve kümülatif çizgileri */}
          <path d={linePath(rows.map((r) => r.capacity))} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-blue-600 dark:stroke-blue-400" />
          <path d={linePath(rows.map((r) => r.cumulative))} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-rose-900 dark:stroke-rose-300" />
          {rows.map((r, i) => (
            <circle key={i} cx={x(i)} cy={y(r.cumulative)} r={3.5} strokeWidth={2} className="fill-rose-900 stroke-background dark:fill-rose-300" />
          ))}

          {/* Hover hedefleri: bütün sütun */}
          {rows.map((_, i) => (
            <rect
              key={`hit-${i}`}
              x={x(i) - COL / 2}
              y={0}
              width={COL}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
            />
          ))}
        </svg>
      </div>

      {h && hw && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-52 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md"
          style={{ left: Math.max(0, Math.min(x(hover!) + 12, Math.min(width, boxWidth || width) - 216)) }}
        >
          <p className="font-semibold">
            {hw.label} <span className="font-normal text-muted-foreground">from {hw.start}</span>
          </p>
          {hw.holidays.length > 0 && <p className="text-amber-700 dark:text-amber-400">{hw.holidays.join(', ')}</p>}
          <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 tabular-nums">
            <dt className="text-muted-foreground">Capacity</dt>
            <dd className="text-right">{fmt(h.capacity)} h</dd>
            <dt className="text-muted-foreground">Demand</dt>
            <dd className="text-right">{fmt(h.demand)} h</dd>
            <dt className="text-muted-foreground">Over capacity</dt>
            <dd className="text-right">{fmt(h.over)} h</dd>
            <dt className="text-muted-foreground">Idle</dt>
            <dd className="text-right">{fmt(h.idle)} h</dd>
            <dt className="text-muted-foreground">Cumulative</dt>
            <dd className="text-right font-medium">{fmt(h.cumulative)} h</dd>
          </dl>
        </div>
      )}
    </div>
  )
}

/** Grafiklerin ortak açıklaması — sayfada bir kez. */
export function CapacityLegend() {
  const item = (swatch: React.ReactNode, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      {swatch}
      {label}
    </span>
  )
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {item(<span className="inline-block h-3 w-3 bg-neutral-400 dark:bg-neutral-500" />, 'Production time (demand within capacity)')}
      {item(<span className="inline-block h-3 w-3 border border-foreground bg-background" />, 'Idle capacity')}
      {item(<span className="inline-block h-3 w-3 rounded-sm bg-red-600 dark:bg-red-500" />, 'Over capacity')}
      {item(<span className="inline-block h-0.5 w-4 bg-blue-600 dark:bg-blue-400" />, 'Available hours')}
      {item(<span className="inline-block h-0.5 w-4 bg-rose-900 dark:bg-rose-300" />, 'Cumulative (idle − over)')}
    </div>
  )
}
