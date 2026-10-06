// KPI girişinin metin ↔ değer dönüşümü (src/components/KpiSeriesEntry.tsx).
// Ekranda yüzdeler 3.5 diye yazılır, kayıtta kesirdir (0,035). Boş alan
// "girilmedi"dir, 0 değil.

import { KPI_INPUTS, type KpiValues } from './kpi'

export type Side = Partial<Record<keyof KpiValues, string>>

export const pctKeys = new Set(KPI_INPUTS.filter((i) => i.pct).map((i) => i.key))

export const toText = (v: KpiValues, key: keyof KpiValues) => {
  const x = v[key]
  if (x === undefined || x === null) return ''
  return pctKeys.has(key) ? String(Math.round(x * 1000) / 10) : String(x)
}

export function toValues(side: Side): KpiValues {
  const out: KpiValues = {}
  for (const [k, text] of Object.entries(side)) {
    const t = (text ?? '').trim().replace(',', '.')
    if (!t) continue
    const n = Number(t)
    if (!Number.isFinite(n)) continue
    out[k as keyof KpiValues] = pctKeys.has(k as keyof KpiValues) ? n / 100 : n
  }
  return out
}

export const sideOf = (v: KpiValues) => Object.fromEntries(KPI_INPUTS.map((i) => [i.key, toText(v ?? {}, i.key)])) as Side
