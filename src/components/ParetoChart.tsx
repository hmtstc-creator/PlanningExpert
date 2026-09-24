import { useState } from 'react'

import { pareto } from '../lib/problemReport'

/**
 * Pareto grafiği — tek eksenli.
 *
 * Klasik pareto çubukları ve kümülatif çizgiyi iki ayrı ölçekle üst üste
 * koyar; iki eksenli grafik yanlış okunur. Burada çubuklar sıralıdır,
 * kümülatif yüzde her satırın yanında yazar ve toplamın ilk %80'ine ulaşan
 * "önemli azınlık" mavi, gerisi gri çizilir; %80 sınırı çizgiyle ayrılır.
 * Satırlar aynı zamanda tablodur: renk tek başına bilgi taşımaz.
 */

const SHOWN = 12

export function ParetoChart({
  title,
  unit,
  groups,
  selected,
  onSelect,
  format = (v) => v.toLocaleString('en-GB'),
}: {
  title: string
  /** Değerin birimi, çoğul: "problems", "min". */
  unit: string
  groups: { key: string; value: number }[]
  selected?: string
  /** Verilirse satıra tıklamak o anahtara süzer. */
  onSelect?: (key: string) => void
  format?: (value: number) => string
}) {
  const bars = pareto(groups)
  const [hover, setHover] = useState<string | null>(null)
  const total = bars.reduce((s, b) => s + b.value, 0)
  const max = bars[0]?.value ?? 0
  const shown = bars.slice(0, SHOWN)
  const rest = bars.slice(SHOWN)
  const restValue = rest.reduce((s, b) => s + b.value, 0)
  const lastVital = shown.reduce((i, b, index) => (b.vital ? index : i), -1)

  return (
    <section className="rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {total > 0 ? (
          <>
            {format(total)} {unit} in total ·{' '}
            <span className="inline-block h-2 w-2 rounded-sm bg-[#2a78d6] align-middle" /> the
            ones that make up 80%
          </>
        ) : (
          'Nothing in this range.'
        )}
      </p>
      {total > 0 && (
        <div className="mt-3 text-xs" role="table" aria-label={title}>
          <div role="row" className="grid grid-cols-[minmax(6rem,11rem)_1fr_3.5rem_3.5rem] gap-2 pb-1 text-muted-foreground">
            <span role="columnheader">Name</span>
            <span role="columnheader" />
            <span role="columnheader" className="text-right">
              {unit === 'min' ? 'Min' : 'Times'}
            </span>
            <span role="columnheader" className="text-right" title="Cumulative share of the total">
              Cum.
            </span>
          </div>
          {shown.map((bar, index) => {
            const active = hover === bar.key || selected === bar.key
            return (
              <div key={bar.key}>
                <div
                  role="row"
                  onMouseEnter={() => setHover(bar.key)}
                  onMouseLeave={() => setHover(null)}
                  onClick={onSelect ? () => onSelect(bar.key) : undefined}
                  title={`${bar.key}: ${format(bar.value)} ${unit} — ${bar.share.toFixed(1)}% of the total, ${bar.cumulative.toFixed(0)}% cumulative`}
                  className={`grid grid-cols-[minmax(6rem,11rem)_1fr_3.5rem_3.5rem] items-center gap-2 rounded py-1 ${
                    active ? 'bg-muted' : ''
                  } ${onSelect ? 'cursor-pointer' : ''}`}
                >
                  <span role="cell" className="truncate font-medium text-foreground">
                    {bar.key}
                  </span>
                  <span role="cell" className="h-3.5">
                    <span
                      className={`block h-full rounded-r-[4px] ${bar.vital ? 'bg-[#2a78d6]' : 'bg-muted-foreground/35'}`}
                      style={{ width: `${Math.max(1.5, (bar.value / max) * 100)}%` }}
                    />
                  </span>
                  <span role="cell" className="text-right tabular-nums text-foreground">
                    {format(bar.value)}
                  </span>
                  <span role="cell" className="text-right tabular-nums text-muted-foreground">
                    {bar.cumulative.toFixed(0)}%
                  </span>
                </div>
                {index === lastVital && index < shown.length - 1 && (
                  <div className="my-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="h-px flex-1 border-t border-dashed border-muted-foreground/60" />
                    80% of all {unit}
                    <span className="h-px flex-1 border-t border-dashed border-muted-foreground/60" />
                  </div>
                )}
              </div>
            )
          })}
          {rest.length > 0 && (
            <div className="grid grid-cols-[minmax(6rem,11rem)_1fr_3.5rem_3.5rem] items-center gap-2 py-1 text-muted-foreground">
              <span>+{rest.length} more</span>
              <span />
              <span className="text-right tabular-nums">{format(restValue)}</span>
              <span className="text-right">100%</span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
