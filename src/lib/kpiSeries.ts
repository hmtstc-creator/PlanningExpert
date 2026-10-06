// KPI girişi — dizi görünümü (src/components/KpiSeriesEntry.tsx): sütunlarda
// dönemler (aylıkta yılın 12 ayı, haftalıkta seçilen haftayla biten 13 ISO
// hafta — dashboard ile aynı aralık), satırlarda plan ve gerçekleşen. Bir
// masraf yerinin bütün aralığı tek ekranda; kayıt yine dönem başına
// (kpiEntries: period + year + num).
//
// Satır ("seri"): masraf yerinin bir operatör satırı (ör. Direct, Indirect).
// Dönemler arasında satır, operatör tipi ve o dönem içindeki o tipten
// kaçıncı satır olduğuyla eşleşir — satır numarası (line) dönemden döneme
// farklı olabilir.

import {
  kpiFor,
  slotKey,
  trendSlots,
  type KpiEntry,
  type KpiMetrics,
  type KpiPeriod,
  type KpiSlot,
  type KpiValues,
  type OeeSum,
  type OperatorType,
} from './kpi'

export interface CellValues {
  plan: KpiValues
  actual: KpiValues
}

export interface SeriesLine {
  operatorType: OperatorType
  /** Aynı tipten kaçıncı satır (0, 1 …). */
  k: number
  /** Dönem anahtarı (slotKey: "2026-03") → değerler. */
  cells: Record<string, CellValues>
}

/** Ekrandaki dönemler: aylıkta yılın 12 ayı, haftalıkta `num` haftasıyla biten 13 hafta. */
export function seriesSlots(period: KpiPeriod, year: number, num: number): KpiSlot[] {
  return trendSlots(period, year, period === 'month' ? 12 : num)
}

const isEmpty = (v: KpiValues | undefined) => !v || Object.values(v).every((x) => x === undefined || x === null)

/** Bir masraf yerinin kayıtları → satırlar (Direct önce). Kayıt yoksa boş bir Direct satır. */
export function seriesLines(entries: KpiEntry[], period: KpiPeriod, slots: KpiSlot[], costCenter: string): SeriesLine[] {
  const own = entries.filter((e) => e.period === period && e.costCenter === costCenter)
  const lines = new Map<string, SeriesLine>()
  for (const slot of slots) {
    const here = own.filter((e) => e.year === slot.year && e.num === slot.num).sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
    const seen: Record<string, number> = {}
    for (const e of here) {
      const k = seen[e.operatorType] ?? 0
      seen[e.operatorType] = k + 1
      const key = `${e.operatorType}|${k}`
      const line = lines.get(key) ?? { operatorType: e.operatorType, k, cells: {} }
      line.cells[slotKey(slot)] = { plan: e.plan ?? {}, actual: e.actual ?? {} }
      lines.set(key, line)
    }
  }
  const out = [...lines.values()].sort((a, b) => (a.operatorType === b.operatorType ? a.k - b.k : a.operatorType === 'direct' ? -1 : 1))
  return out.length ? out : [{ operatorType: 'direct', k: 0, cells: {} }]
}

/**
 * Kayıt: bir dönemin satırları (sırayla). Değeri olmayan satır o dönem için
 * yazılmaz — boş alan 0 değildir; dönem tamamen boşsa o dönemin kaydı yok.
 */
export function slotRows(lines: SeriesLine[], key: string): { operatorType: OperatorType; plan: KpiValues; actual: KpiValues }[] {
  return lines
    .map((l) => ({ operatorType: l.operatorType, plan: l.cells[key]?.plan ?? {}, actual: l.cells[key]?.actual ?? {} }))
    .filter((r) => !isEmpty(r.plan) || !isEmpty(r.actual))
}

/** Bir satırın bir dönemi, kpiFor'un beklediği kayıt olarak. */
export function lineEntry(l: SeriesLine, period: KpiPeriod, slot: KpiSlot, costCenter: string): KpiEntry {
  const c = l.cells[slotKey(slot)]
  return { period, year: slot.year, num: slot.num, costCenter, operatorType: l.operatorType, plan: c?.plan ?? {}, actual: c?.actual ?? {} }
}

/**
 * Toplam sütunu (yıl ya da 13 hafta): saat ve adetler toplanır, oranlar
 * toplamdan (kpiFor); operatör sayısı ise toplanmaz — değeri olan
 * dönemlerin ortalaması.
 */
export function seriesTotal(entries: KpiEntry[], oee: OeeSum[]): { plan: KpiMetrics; actual: KpiMetrics } {
  const r = kpiFor(entries, oee)
  const avg = (pick: (e: KpiEntry) => number | undefined) => {
    const bySlot = new Map<string, number>()
    for (const e of entries) {
      const v = pick(e)
      if (v === undefined || v === null || !Number.isFinite(v)) continue
      const key = slotKey(e)
      bySlot.set(key, (bySlot.get(key) ?? 0) + v)
    }
    return bySlot.size ? [...bySlot.values()].reduce((a, b) => a + b, 0) / bySlot.size : null
  }
  return {
    plan: { ...r.plan, operators: avg((e) => e.plan.operators) },
    actual: { ...r.actual, operators: avg((e) => e.actual.operators) },
  }
}

/** Bir günün (YYYY-MM-DD) dönemi; aralıkta değilse null. */
export function slotOfDate(slots: KpiSlot[], date: string): KpiSlot | null {
  return slots.find((s) => s.from <= date && date <= s.to) ?? null
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
