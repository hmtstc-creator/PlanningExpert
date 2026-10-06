import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { Bridge, BridgeFamily, BridgeStep, Level3Row, LossItem } from '../lib/oeeBridge'

/**
 * Loss Bridge grafikleri (docs/oee-bridge.md). Renkler .oee-viz paletinden,
 * aile başına sabit: süreler mavi, availability turuncu (planlı duruş aynı
 * ton taralı), performans mor, kalite pembe, efektif süre yeşil,
 * planlanmamış gri. Renk tek başına anlam taşımaz: her çubukta adı ve
 * değeri yazılı, aile başlıkları üstte.
 */

export const FAMILY_FILL: Record<BridgeFamily | 'total' | 'effective', string> = {
  total: 'var(--viz-1)',
  effective: 'var(--viz-3)',
  notScheduled: '#a8a7a2',
  planned: 'url(#bridge-hatch)',
  availability: 'var(--viz-2)',
  performance: 'var(--viz-7)',
  quality: 'var(--viz-5)',
}
export const FAMILY_LABEL: Record<BridgeFamily, string> = {
  notScheduled: 'Not scheduled',
  planned: 'Planned stops',
  availability: 'Availability',
  performance: 'Performance',
  quality: 'Quality',
}
/** HTML öğeleri için (desen yok): planlı duruş açık turuncu. */
export const FAMILY_SWATCH: Record<BridgeFamily, string> = {
  notScheduled: '#a8a7a2',
  planned: 'color-mix(in oklab, var(--viz-2) 45%, white)',
  availability: 'var(--viz-2)',
  performance: 'var(--viz-7)',
  quality: 'var(--viz-5)',
}

export const hours = (min: number) => {
  const h = min / 60
  const a = Math.abs(h)
  return `${h < 0 ? '−' : ''}${a >= 100 ? Math.round(a).toLocaleString('en-GB') : a.toFixed(1)} h`
}
export const pctOf = (v: number | null | undefined, digits = 1) =>
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
  // Ölçülene kadar 0: varsayılan bir genişlikle çizip sayfayı genişletmesin.
  return { ref, width }
}

/** Planlı duruş deseni: turuncu üstüne beyaz 45° çizgi. */
function Defs() {
  return (
    <defs>
      <pattern id="bridge-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="var(--viz-2)" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="white" strokeWidth="3" />
      </pattern>
    </defs>
  )
}

interface Bar {
  step: BridgeStep
  /** Çubuğun alt ve üst değeri (dakika). */
  lo: number
  hi: number
  fill: string
}

/** Adımlardan çubuklar: toplam 0'dan, kayıp önceki seviyeden aşağı (kazanç yukarı). */
export function bridgeBars(b: Bridge): Bar[] {
  const out: Bar[] = []
  let run = 0
  for (const s of b.steps) {
    if (s.kind === 'total') {
      run = s.minutes
      out.push({ step: s, lo: 0, hi: s.minutes, fill: s.key === 'E' ? FAMILY_FILL.effective : FAMILY_FILL.total })
    } else {
      const next = run - s.minutes
      out.push({ step: s, lo: Math.min(run, next), hi: Math.max(run, next), fill: FAMILY_FILL[s.family ?? 'availability'] })
      run = next
    }
  }
  return out
}

const PAD_L = 48
const PAD_R = 12
const PAD_T = 64
const PAD_B = 104

/** Tooltip içeriği (her iki yerleşimde aynı). */
function StepTip({ step, base, calendar }: { step: BridgeStep; base: number; calendar: number | null }) {
  return (
    <>
      <p className="font-semibold text-foreground">{step.label}</p>
      <p className="tabular-nums">
        {hours(step.minutes)} · {Math.round(step.minutes).toLocaleString('en-GB')} min
      </p>
      {base > 0 && <p className="text-muted-foreground tabular-nums">{pctOf(step.minutes / base)} of the OEE base</p>}
      {calendar ? <p className="text-muted-foreground tabular-nums">{pctOf(step.minutes / calendar)} of calendar time</p> : null}
      {step.note && <p className="mt-1 text-muted-foreground">{step.note}</p>}
    </>
  )
}

/**
 * Köprü (şelale). Geniş ekranda dikey sütunlar; dar ekranda yatay çubuklar.
 * Kayba tıklayınca `onSelect(key)` (Level 3). `selected` ve `priority`
 * çerçeveyle gösterilir.
 */
export function BridgeChart({
  bridge,
  selected,
  onSelect,
  selectable,
}: {
  bridge: Bridge
  selected: string | null
  onSelect: (key: string) => void
  selectable: Set<string>
}) {
  const { ref, width } = useWidth()
  const bars = bridgeBars(bridge)
  const priority = bridge.items.find((i) => i.priority)?.key
  // Ölçülen kapsayıcı hep yerinde kalır (içi değişir): kaldırılan öğe 0 genişlik bildirir.
  return (
    <div ref={ref} className="w-full min-w-0">
      {width === 0 ? (
        <div className="h-[420px]" />
      ) : width < 640 ? (
        <BridgeRows bars={bars} bridge={bridge} selected={selected} onSelect={onSelect} selectable={selectable} priority={priority} />
      ) : (
        <BridgeColumns
          width={width}
          bars={bars}
          bridge={bridge}
          selected={selected}
          onSelect={onSelect}
          selectable={selectable}
          priority={priority}
        />
      )}
    </div>
  )
}

interface LayoutProps {
  bars: Bar[]
  bridge: Bridge
  selected: string | null
  onSelect: (key: string) => void
  selectable: Set<string>
  priority?: string
}

function BridgeColumns({ width, bars, bridge, selected, onSelect, selectable, priority }: LayoutProps & { width: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const height = 420
  const max = Math.max(1, ...bars.map((b) => b.hi))
  const min = Math.min(0, ...bars.map((b) => b.lo))
  const plotH = height - PAD_T - PAD_B
  const y = (v: number) => PAD_T + plotH * (1 - (v - min) / (max - min))
  const n = bars.length
  const col = (width - PAD_L - PAD_R) / n
  const barW = Math.max(10, Math.min(46, col * 0.62))
  const x = (i: number) => PAD_L + col * i + col / 2
  // Izgara: saat, "güzel" adımla.
  const stepH = niceStep(max / 60)
  const ticks = Array.from({ length: Math.floor(max / 60 / stepH) + 1 }, (_, i) => i * stepH)
  // Aile başlıkları: art arda aynı ailedeki kayıplar tek başlık.
  const spans: { family: BridgeFamily; from: number; to: number }[] = []
  bars.forEach((b, i) => {
    const f = b.step.kind === 'loss' ? b.step.family : undefined
    if (!f) return
    const last = spans[spans.length - 1]
    if (last && last.family === f && last.to === i - 1) last.to = i
    else spans.push({ family: f, from: i, to: i })
  })
  return (
    <div className="oee-viz relative w-full min-w-0">
      <svg width={width} height={height} role="img" aria-label="OEE loss bridge" className="block select-none">
        <Defs />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={width - PAD_R} y1={y(t * 60)} y2={y(t * 60)} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={PAD_L - 6} y={y(t * 60) + 3} textAnchor="end" fontSize={10} fill="var(--viz-axis)">
              {t >= 1000 ? `${t / 1000}k` : t} h
            </text>
          </g>
        ))}
        {spans.map((s) => (
          <g key={`${s.family}${s.from}`}>
            <line
              x1={x(s.from) - barW / 2}
              x2={x(s.to) + barW / 2}
              y1={10}
              y2={10}
              stroke={s.family === 'planned' ? 'var(--viz-2)' : FAMILY_SWATCH[s.family]}
              strokeWidth={3}
              strokeLinecap="round"
            />
            <text x={(x(s.from) + x(s.to)) / 2} y={24} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="var(--viz-axis)">
              {FAMILY_LABEL[s.family]}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const top = y(b.hi)
          const h = Math.max(1, y(b.lo) - top)
          const isLoss = b.step.kind === 'loss'
          const isSel = selected === b.step.key
          const isPrio = priority === b.step.key
          const clickable = selectable.has(b.step.key)
          const gain = isLoss && b.step.minutes < 0
          return (
            <g
              key={b.step.key}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => clickable && onSelect(b.step.key)}
              style={{ cursor: clickable ? 'pointer' : 'default' }}
            >
              {/* Geniş tıklama alanı. */}
              <rect x={x(i) - col / 2} y={PAD_T} width={col} height={plotH} fill="transparent" />
              {/* Bağlantı çizgisi: bir sonraki adımın başladığı seviye. */}
              {i < n - 1 && (
                <line
                  x1={x(i) + barW / 2}
                  x2={x(i + 1) - barW / 2}
                  y1={y(isLoss ? (b.step.minutes >= 0 ? b.lo : b.hi) : b.hi)}
                  y2={y(isLoss ? (b.step.minutes >= 0 ? b.lo : b.hi) : b.hi)}
                  stroke="var(--viz-axis)"
                  strokeOpacity={0.35}
                  strokeDasharray="2 2"
                />
              )}
              <rect
                x={x(i) - barW / 2}
                y={top}
                width={barW}
                height={h}
                rx={3}
                fill={b.fill}
                fillOpacity={gain ? 0.45 : 1}
                stroke={isSel ? 'var(--foreground)' : isPrio ? 'var(--destructive)' : 'none'}
                strokeWidth={isSel || isPrio ? 2 : 0}
              />
              <text x={x(i)} y={top - 5} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="var(--viz-value)">
                {hours(b.step.minutes).replace(' h', '')}
              </text>
              {b.step.letter && (
                <text x={x(i)} y={y(b.lo) - 6} textAnchor="middle" fontSize={12} fontWeight={800} fill="white">
                  {b.step.letter}
                </text>
              )}
              {isPrio && (
                <text x={x(i)} y={top - 18} textAnchor="middle" fontSize={9} fontWeight={800} fill="var(--destructive)">
                  PRIORITY
                </text>
              )}
              <text
                x={x(i)}
                y={height - PAD_B + 12}
                textAnchor="end"
                fontSize={10.5}
                fontWeight={isLoss ? 400 : 700}
                fill="var(--viz-axis)"
                transform={`rotate(-40 ${x(i)} ${height - PAD_B + 12})`}
              >
                {b.step.label.length > 22 ? `${b.step.label.slice(0, 21)}…` : b.step.label}
              </text>
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 w-56 rounded-md border border-border bg-background px-2.5 py-2 text-xs shadow-lg"
          style={{
            left: Math.min(Math.max(8, x(hover) - 112), width - 232),
            top: Math.max(0, y(bars[hover].hi) - 8),
            transform: 'translateY(-100%)',
          }}
        >
          <StepTip step={bars[hover].step} base={bridge.baseMinutes} calendar={bridge.totals.calendar} />
        </div>
      )}
    </div>
  )
}

/** Telefon: her adım bir satır; çubuk, aynı ölçekte soldan konumlanır. */
function BridgeRows({ bars, bridge, selected, onSelect, selectable, priority }: LayoutProps) {
  const max = Math.max(1, ...bars.map((b) => b.hi))
  const min = Math.min(0, ...bars.map((b) => b.lo))
  const pos = (v: number) => ((v - min) / (max - min)) * 100
  return (
    <div className="oee-viz w-full min-w-0 space-y-1">
      {bars.map((b) => {
        const isLoss = b.step.kind === 'loss'
        const clickable = selectable.has(b.step.key)
        const fam = b.step.family
        return (
          <button
            key={b.step.key}
            type="button"
            disabled={!clickable}
            onClick={() => onSelect(b.step.key)}
            className={`grid w-full grid-cols-[7.5rem_1fr_3.5rem] items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs ${selected === b.step.key ? 'bg-muted ring-1 ring-foreground/30' : ''}`}
          >
            <span className={`truncate ${isLoss ? 'text-muted-foreground' : 'font-semibold text-foreground'}`}>
              {b.step.letter ? `${b.step.letter} · ` : ''}
              {b.step.label}
              {priority === b.step.key && <span className="ml-1 font-bold text-destructive">●</span>}
            </span>
            <span className="relative h-3.5 rounded-sm bg-muted/50">
              <span
                className="absolute inset-y-0 rounded-sm"
                style={{
                  left: `${pos(b.lo)}%`,
                  width: `${Math.max(0.8, pos(b.hi) - pos(b.lo))}%`,
                  background: !isLoss ? (b.step.key === 'E' ? 'var(--viz-3)' : 'var(--viz-1)') : FAMILY_SWATCH[fam ?? 'availability'],
                  opacity: isLoss && b.step.minutes < 0 ? 0.45 : 1,
                }}
              />
            </span>
            <span className="text-right font-semibold tabular-nums">{hours(b.step.minutes)}</span>
          </button>
        )
      })}
      <p className="pt-1 text-[11px] text-muted-foreground">OEE base {hours(bridge.baseMinutes)} · tap a loss for its details</p>
    </div>
  )
}

function niceStep(maxH: number) {
  const raw = maxH / 5
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)))
  const m = raw / pow
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow
}

/** %100 sütun: parçalar aşağıdan yukarı, yanında adı ve payı. */
export function StackColumn({
  title,
  parts,
}: {
  title: string
  parts: { label: string; share: number; color: string; strong?: boolean }[]
}) {
  const shown = parts.filter((p) => p.share > 0.0005)
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      <div className="mt-2 flex h-56 gap-3">
        <div className="flex w-14 flex-col-reverse overflow-hidden rounded-md">
          {shown.map((p) => (
            <div
              key={p.label}
              title={`${p.label}: ${pctOf(p.share)}`}
              style={{ height: `${p.share * 100}%`, background: p.color }}
              className="border-t-2 border-background first:border-t-0"
            />
          ))}
        </div>
        <div className="flex flex-col-reverse justify-start">
          {shown.map((p) => (
            <div key={p.label} style={{ height: `${p.share * 100}%` }} className="flex min-h-4 items-center">
              <span className={`text-xs tabular-nums ${p.strong ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>
                {p.label} <b className="text-foreground">{pctOf(p.share)}</b>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Level 2: kalemler aileye göre, çoktan aza; öncelik işaretli; tıklanır. */
export function Level2Bars({
  items,
  previous,
  selected,
  onSelect,
}: {
  items: LossItem[]
  previous: Map<string, LossItem>
  selected: string | null
  onSelect: (key: string) => void
}) {
  const max = Math.max(1e-9, ...items.map((i) => Math.abs(i.share)))
  const families = (['planned', 'availability', 'performance', 'quality'] as BridgeFamily[]).filter((f) =>
    items.some((i) => i.family === f),
  )
  return (
    <div className="space-y-3">
      {families.map((f) => (
        <div key={f}>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            <span className="h-2 w-2 rounded-sm" style={{ background: FAMILY_SWATCH[f] }} />
            {FAMILY_LABEL[f]}
          </p>
          <div className="mt-1 space-y-0.5">
            {items
              .filter((i) => i.family === f)
              .map((i) => {
                const prev = previous.get(i.key)
                const d = prev ? (i.share - prev.share) * 100 : null
                return (
                  <button
                    key={i.key}
                    type="button"
                    onClick={() => onSelect(i.key)}
                    className={`grid w-full grid-cols-[minmax(6rem,9rem)_1fr_3.6rem_3.4rem] items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-muted ${selected === i.key ? 'bg-muted ring-1 ring-foreground/25' : ''}`}
                  >
                    <span className={`truncate ${i.rankable ? 'text-foreground' : 'text-muted-foreground italic'}`}>
                      {i.label}
                      {i.priority && (
                        <span className="ml-1.5 rounded bg-destructive px-1 py-px text-[9px] font-bold text-white not-italic">
                          PRIORITY
                        </span>
                      )}
                    </span>
                    <span className="relative h-3 rounded-sm bg-muted/60">
                      <span
                        className="absolute inset-y-0 left-0 rounded-sm"
                        style={{
                          width: `${(Math.abs(i.share) / max) * 100}%`,
                          background: FAMILY_SWATCH[f],
                          opacity: i.minutes < 0 ? 0.45 : 1,
                        }}
                      />
                    </span>
                    <span className="text-right font-semibold tabular-nums">{pctOf(i.share)}</span>
                    <span
                      className={`text-right tabular-nums ${d === null || Math.abs(d) < 0.05 ? 'text-muted-foreground' : d > 0 ? 'text-destructive' : 'text-emerald-700'}`}
                      title="Change against the previous period (points)"
                    >
                      {d === null ? '—' : `${d > 0 ? '▲' : d < 0 ? '▼' : ''}${Math.abs(d).toFixed(1)}`}
                    </span>
                  </button>
                )
              })}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Level 3 Pareto: ilk 5 + diğerleri, kümülatif %, önceki dönem. */
export function Level3Table({
  rows,
  total,
  unit,
  showMttr,
  action,
}: {
  rows: Level3Row[]
  total: number
  unit: 'min' | 'pcs'
  showMttr: boolean
  action?: (r: Level3Row) => ReactNode
}) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.minutes)))
  let cum = 0
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-1.5 pr-2 text-left font-medium">#</th>
            <th className="py-1.5 pr-2 text-left font-medium">Item</th>
            <th className="w-[35%] py-1.5 pr-2 font-medium" />
            <th className="py-1.5 pr-2 text-right font-medium">Time</th>
            <th className="py-1.5 pr-2 text-right font-medium">Cum.</th>
            <th className="py-1.5 pr-2 text-right font-medium">{unit === 'pcs' ? 'Pieces' : 'Stops'}</th>
            {showMttr && (
              <th className="py-1.5 pr-2 text-right font-medium" title="Average duration of one stop">
                MTTR
              </th>
            )}
            <th className="py-1.5 pr-2 text-right font-medium" title="Same item in the previous period">
              Previous
            </th>
            {action && <th className="py-1.5 font-medium" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            cum += r.minutes
            const isOthers = r.key === '__others'
            return (
              <tr key={r.key} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 pr-2 tabular-nums text-muted-foreground">{isOthers ? '' : i + 1}</td>
                <td className="py-1.5 pr-2">
                  <span className={i === 0 && !isOthers ? 'font-semibold text-foreground' : 'text-foreground'}>{r.label}</span>
                  {r.sub && <span className="ml-1 text-muted-foreground">{r.sub}</span>}
                  {i === 0 && !isOthers && (
                    <span className="ml-1.5 rounded bg-destructive px-1 py-px text-[9px] font-bold text-white">PRIORITY</span>
                  )}
                </td>
                <td className="py-1.5 pr-2">
                  <span
                    className="block h-2.5 rounded-sm bg-[var(--viz-1)]"
                    style={{ width: `${(Math.abs(r.minutes) / max) * 100}%`, opacity: isOthers ? 0.35 : r.minutes < 0 ? 0.45 : 1 }}
                  />
                </td>
                <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">{hours(r.minutes)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">{total > 0 ? pctOf(cum / total, 0) : '—'}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{r.count ? r.count.toLocaleString('en-GB') : '—'}</td>
                {showMttr && <td className="py-1.5 pr-2 text-right tabular-nums">{r.mttr === null ? '—' : `${r.mttr.toFixed(1)} min`}</td>}
                <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">{r.previous ? hours(r.previous) : '—'}</td>
                {action && <td className="py-1.5 text-right whitespace-nowrap">{isOthers ? null : action(r)}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
