import type { CSSProperties, ReactNode } from 'react'

import { SPEED } from '../lib/oee'
import type { LossRow } from '../lib/oeeAsakai'

/**
 * Asakai sayfalarının ortak parçaları (planlamacı, 2026-10-26): Excel
 * "Metal Stamping Daily Follow Up" görünümü — kâğıt gibi beyaz, koyu temada
 * da (PDF ile ekran aynı). Renkler Excel'in renkleri.
 */
export const X = {
  navy: '#333f4f',
  slate: '#44546a',
  bar: '#44546a',
  totalRow: '#acb9ca',
  lineCell: '#adb9ca',
  headBlue: '#bdd7ee',
  lightBlue: '#ddebf7',
  salmon: '#f4b183',
  salmonLight: '#f8cbad',
  yellow: '#ffe699',
  bad: '#ffc7ce',
  badText: '#c00000',
  border: '#000000',
  grid: '#bfbfbf',
}

/** Grafikteki kayıp renkleri (Excel lejantı); bilinmeyen ad sıradaki renk. */
const LOSS_COLORS: [RegExp, string][] = [
  [/^oee$/i, '#375623'],
  [/die|klp/i, '#c55a11'],
  [/setup|stp/i, '#a5a5a5'],
  [/mach|arz/i, '#ffc000'],
  [/short|ksd/i, '#4472c4'],
  [/other/i, '#70ad47'],
  [/speed/i, '#9dc3e6'],
  [/undef|unassigned|#/i, '#7f7f7f'],
]
const SPARE = ['#264478', '#9e480e', '#636363', '#997300', '#43682b', '#698ed0']

export function lossColor(col: string, i: number): string {
  return LOSS_COLORS.find(([re]) => re.test(col))?.[1] ?? SPARE[i % SPARE.length]
}

/** Sütun başlığı: Excel'deki gibi büyük harf; hız kaybı "SPEED_LOSS" (tanımsızlar Unassigned → "UNASSIGNED"). */
export const colTitle = (col: string) => (col === SPEED ? 'SPEED_LOSS' : col.toUpperCase())

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '' : `${Math.round(v * 100)}%`)
/** Kayıp payı: hiç kayıp yoksa boş (Excel'deki gibi). */
export const share = (r: LossRow, col: string) => (r.loadingMin > 0 && r.shares[col] > 0 ? pct(r.shares[col]) : '')

/** Sayfa sabit genişlikte çizilir; PDF bu genişlikten kâğıda küçülür. */
export const SHEET_WIDTH = 1400

export const SHEET_FONT: CSSProperties = {
  fontFamily: 'Calibri, Carlito, Arial, sans-serif',
  color: '#000',
  background: '#fff',
}

export function Cell({
  children,
  bg,
  color,
  bold,
  align = 'center',
  style,
  ...rest
}: {
  children?: ReactNode
  bg?: string
  color?: string
  bold?: boolean
  align?: 'center' | 'left' | 'right'
  style?: CSSProperties
  colSpan?: number
  rowSpan?: number
}) {
  return (
    <td
      {...rest}
      style={{
        background: bg,
        color,
        fontWeight: bold ? 700 : undefined,
        textAlign: align,
        border: `1px solid ${X.grid}`,
        padding: '1px 4px',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </td>
  )
}

/** Sütun grafiği: 0–100 % ekseni, koyu çubuk, üstünde değer (Excel'deki aylık / haftalık). */
export function AsakaiBars({ title, points }: { title: string; points: { label: string; oee: number | null }[] }) {
  const W = 470
  const H = 150
  const left = 34
  const top = 22
  const bottom = 128
  const step = (W - left - 6) / points.length
  const y = (v: number) => bottom - (bottom - top) * Math.min(1, Math.max(0, v))
  return (
    <div>
      <div
        style={{
          textAlign: 'center',
          fontWeight: 700,
          fontSize: 14,
          color: '#595959',
        }}
      >
        {title}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title}>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={left} x2={W - 4} y1={y(v)} y2={y(v)} stroke="#d9d9d9" strokeWidth={0.6} />
            <text x={left - 4} y={y(v) + 3} fontSize={8} textAnchor="end" fill="#595959">
              {v * 100}%
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = left + step * i + step / 2
          const v = p.oee ?? 0
          return (
            <g key={p.label + i}>
              {p.oee !== null && <rect x={cx - step * 0.15} width={step * 0.3} y={y(v)} height={bottom - y(v)} fill={X.bar} />}
              {p.oee !== null && (
                <text x={cx} y={y(v) - 4} fontSize={10} fontWeight={700} textAnchor="middle" fill="#404040">
                  {pct(p.oee)}
                </text>
              )}
              <text x={cx} y={bottom + 13} fontSize={9} textAnchor="middle" fill="#404040">
                {p.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Yığılı sütun: günün OEE'si altta, kayıpları üstünde (% of Loading). */
export function AsakaiStacked({ title, rows, columns }: { title: string; rows: (LossRow & { tick: string })[]; columns: string[] }) {
  const W = 470
  const H = 230
  const left = 22
  const top = 20
  const bottom = 192
  const step = (W - left - 6) / rows.length
  const scale = (bottom - top) / 1
  const series = ['OEE', ...columns]
  return (
    <div>
      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14 }}>{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title}>
        <text
          x={8}
          y={(top + bottom) / 2}
          fontSize={8}
          fontWeight={700}
          transform={`rotate(-90 8 ${(top + bottom) / 2})`}
          textAnchor="middle"
        >
          % of Loading
        </text>
        <line x1={left} x2={W - 4} y1={bottom} y2={bottom} stroke="#bfbfbf" />
        {rows.map((r, i) => {
          const x = left + step * i + step * 0.2
          const w = step * 0.6
          let acc = 0
          const has = r.loadingMin > 0
          return (
            <g key={r.tick + i}>
              {has &&
                series.map((s, k) => {
                  const v = s === 'OEE' ? (r.oee ?? 0) : (r.shares[s] ?? 0)
                  if (v <= 0) return null
                  const h = Math.min(v, Math.max(0, 1.05 - acc)) * scale
                  const yy = bottom - acc * scale - h
                  acc += v
                  const big = h >= 9
                  return (
                    <g key={s}>
                      <rect x={x} y={yy} width={w} height={h} fill={lossColor(s, k)} stroke="#fff" strokeWidth={0.4} />
                      {big && (
                        <text
                          x={x + w / 2}
                          y={yy + h / 2 + 3}
                          fontSize={8}
                          fontWeight={700}
                          textAnchor="middle"
                          fill={s === 'OEE' ? '#fff' : '#000'}
                        >
                          {pct(v)}
                        </text>
                      )}
                    </g>
                  )
                })}
              {!has && (
                <text x={x + w / 2} y={bottom - 3} fontSize={8} fontWeight={700} textAnchor="middle">
                  0%
                </text>
              )}
              <text x={x + w / 2} y={bottom + 13} fontSize={9} textAnchor="middle">
                {r.tick}
              </text>
            </g>
          )
        })}
        <g transform={`translate(${left + 10} ${H - 10})`}>
          {series.map((s, k) => (
            <g key={s} transform={`translate(${(k * (W - left - 20)) / series.length} 0)`}>
              <rect width={6} height={6} y={-6} fill={lossColor(s, k)} />
              <text x={9} y={0} fontSize={7.5}>
                {s === SPEED ? 'SPEED' : s.toUpperCase().split(' ')[0].slice(0, 9)}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  )
}
