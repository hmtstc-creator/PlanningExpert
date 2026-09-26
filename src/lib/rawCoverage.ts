// Hammadde yeterliliği ve sipariş takvimi.
//
// Plan her hammaddenin (sac rulo) gün gün tüketimini verir: planlanan iş ×
// parça başına brüt ağırlık, işin üretim dakikalarına göre günlere dağıtılır.
// Eş ürün aynı gramajdan çıktığı için ikinci kez sayılmaz.
//
// Sipariş kuralı (kullanıcı ayarlar):
//   - Elde her zaman önümüzdeki N günün (varsayılan 10) tüketimi olmalı.
//   - Bir günün başında stok, o günden itibaren N günün tüketiminden azsa o
//     gün sipariş verilir: eksik miktar + standart ek (varsayılan 500 kg).
//     Örnek: 10 günlük ihtiyaç 3 000 kg, eksik 3 000 kg → 3 500 kg sipariş.
// Ufkun sonundaki günlerde tüketim yalnızca plan ufku kadar bilinir; bu
// günlerde hedef kısalır (plan ufku dışı bilinmiyor).

import type { ProductSpec } from './planning'

export interface RawConsumption {
  rawMaterial: string
  /** Bu hammaddeyi kullanan mamuller. */
  materials: string[]
  /** MB52'deki rulo stoğu (kg). */
  stockKg: number
  /** `dates` ile aynı sırada günlük tüketim (kg). */
  kgByDay: number[]
}

export interface RawConsumptionPlan {
  /** Bugünden plan ufkunun sonuna kadar ardışık takvim günleri. */
  dates: string[]
  items: RawConsumption[]
}

export interface CoverageSettings {
  /** Elde tutulacak tüketim günü. */
  coverageDays: number
  /** Her siparişe eklenen standart miktar (kg). */
  extraKg: number
}

export const DEFAULT_COVERAGE: CoverageSettings = { coverageDays: 10, extraKg: 500 }

export interface CoverageDay {
  date: string
  /** Gün başındaki stok (o gün gelen sipariş dahil). */
  stockKg: number
  consumptionKg: number
  /** O günden itibaren N günün tüketimi. */
  targetKg: number
  orderKg: number
}

export interface RawOrder {
  date: string
  rawMaterial: string
  kg: number
  /** Siparişten önceki stok ve N günlük ihtiyaç. */
  stockBeforeKg: number
  targetKg: number
}

export interface RawCoverage {
  rawMaterial: string
  materials: string[]
  stockKg: number
  /** Bugünkü stoğun kaç gün yettiği; ufukta bitmiyorsa null. */
  coversDays: number | null
  /** Stoğun bittiği gün (sipariş olmadan); bitmiyorsa null. */
  runsOutOn: string | null
  totalConsumptionKg: number
  days: CoverageDay[]
  orders: RawOrder[]
}

const round = (kg: number) => Math.round(kg)

/**
 * Planlanan işlerden günlük hammadde tüketimi. İşin kilosu, üretim ("run")
 * parçalarının dakikalarına göre günlere bölünür.
 */
export function buildRawConsumption(input: {
  jobs: { material: string; quantity: number; segments: { kind: string; date: string; start: number; end: number }[] }[]
  products: Map<string, ProductSpec>
  rawStockKg: Map<string, number>
  dates: string[]
}): RawConsumptionPlan {
  const { jobs, products, rawStockKg, dates } = input
  const index = new Map(dates.map((d, i) => [d, i]))
  const secondary = new Set<string>()
  for (const p of products.values()) {
    const co = p.coProduct?.trim()
    if (co && co !== p.code) secondary.add(co)
  }
  const byRaw = new Map<string, { materials: Set<string>; kgByDay: number[] }>()
  const entry = (raw: string) => {
    let e = byRaw.get(raw)
    if (!e) {
      e = { materials: new Set(), kgByDay: dates.map(() => 0) }
      byRaw.set(raw, e)
    }
    return e
  }
  // Master data'daki her hammadde listelenir (tüketimi olmasa da stoğu görünür).
  for (const p of products.values()) {
    const raw = p.rawMaterialCode?.trim()
    if (raw) entry(raw).materials.add(p.code)
  }
  for (const job of jobs) {
    if (secondary.has(job.material)) continue
    const product = products.get(job.material)
    const raw = product?.rawMaterialCode?.trim()
    const gross = product?.grossWeight ?? 0
    if (!raw || gross <= 0 || job.quantity <= 0) continue
    const runs = job.segments.filter((s) => s.kind === 'run' && s.end > s.start)
    const total = runs.reduce((a, s) => a + (s.end - s.start), 0)
    const kg = job.quantity * gross
    const e = entry(raw)
    if (total <= 0) {
      const i = index.get(job.segments[0]?.date ?? '')
      if (i !== undefined) e.kgByDay[i] += kg
      continue
    }
    for (const s of runs) {
      const i = index.get(s.date)
      if (i !== undefined) e.kgByDay[i] += (kg * (s.end - s.start)) / total
    }
  }
  return {
    dates,
    items: Array.from(byRaw.entries())
      .map(([rawMaterial, e]) => ({
        rawMaterial,
        materials: Array.from(e.materials).sort(),
        stockKg: round(rawStockKg.get(rawMaterial) ?? 0),
        kgByDay: e.kgByDay.map(round),
      }))
      .sort((a, b) => a.rawMaterial.localeCompare(b.rawMaterial)),
  }
}

/** Bir hammaddenin gün gün stoğu ve sipariş takvimi. */
export function coverageOf(item: RawConsumption, dates: string[], settings: CoverageSettings): RawCoverage {
  const n = Math.max(1, Math.round(settings.coverageDays))
  const extra = Math.max(0, settings.extraKg)
  const c = item.kgByDay
  const windowSum = (i: number) => {
    let sum = 0
    for (let k = i; k < Math.min(c.length, i + n); k++) sum += c[k]
    return sum
  }
  // Siparişsiz: stok ne zaman biter?
  let left = item.stockKg
  let runsOutOn: string | null = null
  let coversDays: number | null = null
  for (let i = 0; i < c.length; i++) {
    if (c[i] > left + 1e-9) {
      runsOutOn = dates[i]
      coversDays = i + (c[i] > 0 ? left / c[i] : 0)
      break
    }
    left -= c[i]
  }
  // Siparişli: her gün başında N günlük hedefe tamamla (+ standart ek).
  let stock = item.stockKg
  const days: CoverageDay[] = []
  const orders: RawOrder[] = []
  for (let i = 0; i < c.length; i++) {
    const target = windowSum(i)
    let orderKg = 0
    if (target > 0 && stock < target - 1e-9) {
      orderKg = round(target - stock + extra)
      orders.push({ date: dates[i], rawMaterial: item.rawMaterial, kg: orderKg, stockBeforeKg: round(stock), targetKg: round(target) })
      stock += orderKg
    }
    days.push({ date: dates[i], stockKg: round(stock), consumptionKg: c[i], targetKg: round(target), orderKg })
    stock -= c[i]
  }
  return {
    rawMaterial: item.rawMaterial,
    materials: item.materials,
    stockKg: item.stockKg,
    coversDays: coversDays === null ? null : Math.round(coversDays * 10) / 10,
    runsOutOn,
    totalConsumptionKg: round(c.reduce((a, b) => a + b, 0)),
    days,
    orders,
  }
}
