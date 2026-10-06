// KPI aylık girişi — yıl görünümü (src/components/KpiYearEntry.tsx):
// sütunlarda aylar, satırlarda plan ve gerçekleşen. Bir masraf yerinin bir
// yılı tek ekranda; kayıt yine ay başına (kpiEntries: period 'month', num 1–12).
//
// Satır ("seri"): masraf yerinin bir operatör satırı (ör. Direct, Indirect).
// Aylar arasında satır, operatör tipi ve o ay içindeki o tipten kaçıncı
// satır olduğuyla eşleşir — satır numarası (line) aydan aya farklı olabilir.

import { kpiFor, type KpiEntry, type KpiMetrics, type KpiValues, type OeeSum, type OperatorType } from './kpi'

export const MONTH_NUMS = Array.from({ length: 12 }, (_, i) => i + 1)

export interface MonthValues {
  plan: KpiValues
  actual: KpiValues
}

export interface YearLine {
  operatorType: OperatorType
  /** Aynı tipten kaçıncı satır (0, 1 …). */
  k: number
  months: Record<number, MonthValues>
}

const isEmpty = (v: KpiValues | undefined) => !v || Object.values(v).every((x) => x === undefined || x === null)

/** Bir masraf yerinin yıl kayıtları → satırlar (Direct önce). Kayıt yoksa boş bir Direct satır. */
export function yearLines(entries: KpiEntry[], costCenter: string): YearLine[] {
  const own = entries.filter((e) => e.period === 'month' && e.costCenter === costCenter)
  const lines = new Map<string, YearLine>()
  for (const num of MONTH_NUMS) {
    const month = own.filter((e) => e.num === num).sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
    const seen: Record<string, number> = {}
    for (const e of month) {
      const k = seen[e.operatorType] ?? 0
      seen[e.operatorType] = k + 1
      const key = `${e.operatorType}|${k}`
      const line = lines.get(key) ?? { operatorType: e.operatorType, k, months: {} }
      line.months[num] = { plan: e.plan ?? {}, actual: e.actual ?? {} }
      lines.set(key, line)
    }
  }
  const out = [...lines.values()].sort((a, b) => (a.operatorType === b.operatorType ? a.k - b.k : a.operatorType === 'direct' ? -1 : 1))
  return out.length ? out : [{ operatorType: 'direct', k: 0, months: {} }]
}

/**
 * Kayıt: bir ayın satırları (sırayla). Değeri olmayan satır o ay için yazılmaz
 * — boş alan 0 değildir; ay tamamen boşsa o ayın kaydı yok.
 */
export function monthRows(lines: YearLine[], num: number): { operatorType: OperatorType; plan: KpiValues; actual: KpiValues }[] {
  return lines
    .map((l) => ({ operatorType: l.operatorType, plan: l.months[num]?.plan ?? {}, actual: l.months[num]?.actual ?? {} }))
    .filter((r) => !isEmpty(r.plan) || !isEmpty(r.actual))
}

/** Bir satırın bir ayı, kpiFor'un beklediği kayıt olarak. */
export function lineEntry(l: YearLine, year: number, num: number, costCenter: string): KpiEntry {
  return {
    period: 'month',
    year,
    num,
    costCenter,
    operatorType: l.operatorType,
    plan: l.months[num]?.plan ?? {},
    actual: l.months[num]?.actual ?? {},
  }
}

/**
 * Yıl sütunu: saat ve adetler toplanır, oranlar toplamdan (kpiFor); operatör
 * sayısı ise toplanmaz — değeri olan ayların ortalaması.
 */
export function yearTotal(entries: KpiEntry[], oee: OeeSum[]): { plan: KpiMetrics; actual: KpiMetrics } {
  const r = kpiFor(entries, oee)
  const avg = (pick: (e: KpiEntry) => number | undefined) => {
    const byMonth = new Map<number, number>()
    for (const e of entries) {
      const v = pick(e)
      if (v === undefined || v === null || !Number.isFinite(v)) continue
      byMonth.set(e.num, (byMonth.get(e.num) ?? 0) + v)
    }
    return byMonth.size ? [...byMonth.values()].reduce((a, b) => a + b, 0) / byMonth.size : null
  }
  return {
    plan: { ...r.plan, operators: avg((e) => e.plan.operators) },
    actual: { ...r.actual, operators: avg((e) => e.actual.operators) },
  }
}

// ---- Excel'den yapıştırma -----------------------------------------------------------

/** Panodaki metin → hücre ızgarası (satırlar \n, sütunlar sekme). */
export function parseGrid(text: string): string[][] {
  const rows = text.replace(/\r/g, '').split('\n')
  if (rows.length > 1 && rows[rows.length - 1] === '') rows.pop()
  return rows.map((r) => r.split('\t'))
}

/**
 * Excel'in yazdığı sayı → girişin anladığı biçim. Türkçe ("1.234,5") ve
 * İngilizce ("1,234.5") binlik ayraçları, boşluk ve % atılır. Tek ayraçta
 * ardından tam üç rakam geliyorsa binliktir ("2.000" = 2000).
 */
export function cleanPasted(s: string): string {
  let t = s.trim().replace(/[\s% ]/g, '')
  if (!t) return ''
  const comma = t.lastIndexOf(',')
  const dot = t.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) {
    // Sonra gelen ondalık ayraçtır.
    t = comma > dot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  } else {
    const sep = comma >= 0 ? ',' : dot >= 0 ? '.' : ''
    if (!sep) return t
    const parts = t.split(sep)
    // Birden çok ayraç ya da tek ayraçtan sonra tam üç rakam (ve 0 olmayan
    // tam kısım): binlik ayraç — "2.000", "12,500". Değilse ondalık: "3,5", "0,035".
    const thousands = parts.length > 2 || (parts[1].length === 3 && /^[1-9]\d*$/.test(parts[0].replace(/^-/, '')))
    t = thousands ? parts.join('') : `${parts[0]}.${parts[1]}`
  }
  return t
}
