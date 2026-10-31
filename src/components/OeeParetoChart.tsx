import { pct } from './OeeCharts'
import type { ParetoView } from '../lib/oeePareto'

/**
 * Dikey pareto (Losses Trend): çubuklar toplamın yüzdesi, çizgi kümülatif yüzde.
 * İki seri de aynı 0–100 % ölçeğindedir (tek eksen). %80 kesikli çizgiyle
 * işaretlenir; ilk %80'i oluşturan çubuklar koyu, gerisi soluk çizilir. Çubuğa
 * tıklamak seçer; her çubuğun tüm dilimi tıklanabilir. Renkler .oee-viz
 * (--viz-*) değişkenleriyle; yazdırmada da aynı.
 */

const W = 560
const H = 250
const PAD_L = 34
const PAD_R = 34
const PAD_T = 14
const PAD_B = 64
const LABEL_CHARS = 12

const short = (s: string) => (s.length > LABEL_CHARS ? `${s.slice(0, LABEL_CHARS - 1)}…` : s)

export function OeeParetoChart({
  title,
  subtitle,
  view,
  selected,
  onSelect,
  format,
  unit,
  emptyText,
}: {
  title: string
  subtitle: string
  view: ParetoView
  /** Seçili çubuğun anahtarı (vurgulanır). */
  selected?: string
  onSelect?: (key: string) => void
  format: (minutes: number) => string
  /** Birim (ipucunda): "min". */
  unit: string
  /** Veri yoksa gösterilen yazı. */
  emptyText: string
}) {
  const { bars, total } = view
  const n = bars.length
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const slot = n > 0 ? plotW / n : plotW
  const barW = slot * 0.62
  const x = (i: number) => PAD_L + slot * i + slot / 2
  const y = (v: number) => PAD_T + plotH * (1 - v / 100)
  const base = PAD_T + plotH
  const linePts = bars.map((b, i) => `${x(i)},${y(b.cumulative)}`).join(' ')

  return (
    <section className="print-avoid-break flex min-w-0 flex-col rounded-lg border border-border p-3">
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {n === 0 || total <= 0 ? (
        <p className="flex flex-1 items-center justify-center py-10 text-center text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="oee-viz mt-2 flex flex-1 flex-col">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={title}>
            {[0, 20, 40, 60, 80, 100].map((t) => (
              <g key={t}>
                <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
                <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" fontSize={10} style={{ fill: 'var(--viz-axis)' }}>
                  {t}%
                </text>
                <text x={W - PAD_R + 6} y={y(t) + 3} textAnchor="start" fontSize={10} style={{ fill: 'var(--viz-axis)' }}>
                  {t}%
                </text>
              </g>
            ))}
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y(80)}
              y2={y(80)}
              stroke="var(--viz-axis)"
              strokeWidth={1}
              strokeDasharray="4 3"
              opacity={0.6}
            />

            {bars.map((b, i) => {
              const cx = x(i)
              const top = y(b.share)
              const h = Math.max(0, base - top)
              const r = Math.min(4, barW / 2, h)
              const left = cx - barW / 2
              const right = cx + barW / 2
              const d =
                h <= 0
                  ? ''
                  : `M${left},${base} L${left},${top + r} Q${left},${top} ${left + r},${top} L${right - r},${top} Q${right},${top} ${right},${top + r} L${right},${base} Z`
              const isSel = selected !== undefined && b.key === selected
              const isOther = b.key === view.otherKey
              return (
                <g key={b.key}>
                  <path
                    d={d}
                    style={{ fill: b.vital && !isOther ? 'var(--viz-1)' : 'var(--viz-axis)' }}
                    opacity={isSel || (b.vital && !isOther) ? 1 : 0.35}
                    stroke={isSel ? 'var(--viz-value)' : 'none'}
                    strokeWidth={isSel ? 2 : 0}
                  />
                  <text x={cx} y={top - 4} textAnchor="middle" fontSize={10} style={{ fill: 'var(--viz-value)' }}>
                    {format(b.value)}
                  </text>
                  <text x={cx} y={base + 14} textAnchor="middle" fontSize={10} style={{ fill: 'var(--viz-axis)' }}>
                    {short(b.key)}
                  </text>
                  {/* Hedef: çubuğun tamamı; ipucu tam ad, dakika, pay ve kümülatif. */}
                  <rect
                    x={cx - slot / 2}
                    y={PAD_T}
                    width={slot}
                    height={plotH + PAD_B - 18}
                    fill="transparent"
                    style={{ cursor: onSelect ? 'pointer' : 'default' }}
                    onClick={onSelect ? () => onSelect(b.key) : undefined}
                  >
                    <title>{`${b.key}: ${format(b.value)} ${unit} · ${pct(b.share / 100)} · kümülatif ${b.cumulative.toFixed(0)}%`}</title>
                  </rect>
                </g>
              )
            })}

            <polyline points={linePts} fill="none" stroke="var(--viz-2)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {bars.map((b, i) => (
              <circle key={`p-${b.key}`} cx={x(i)} cy={y(b.cumulative)} r={4} style={{ fill: 'var(--viz-2)' }} />
            ))}
          </svg>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--viz-1)' }} />
              Share of total ({unit}) · first 80% in color
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--viz-2)' }} />
              Cumulative %
            </span>
          </div>
        </div>
      )}
    </section>
  )
}
