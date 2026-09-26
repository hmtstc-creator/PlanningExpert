// Kapasite öngörüsü — "Stamping Capacity Calculation" raporunun mantığı.
//
// Her pres ve pres grubu için, haftalık:
//   kapasite  = Work Calendar'daki net çalışma saati (tatiller düşülmüş,
//               hafta istisnaları ve fazla mesai dahil; bu hafta için
//               bugünden sonra kalan saat)
//   talep     = o haftanın ZPP ihtiyacının saat karşılığı. Bu haftaya
//               geçmiş bakiye (overdue) eklenir. Belirli depolardaki stok
//               en erken ihtiyaçtan başlayarak düşülür.
//               saat = vuruş ÷ SPM ÷ 60 ÷ performans çarpanı
//               (10 saatlik saf süre, %60 çarpanla 16,67 saat sayılır;
//               setup ve onay bu pencerenin içindedir)
//   fazla     = talep − kapasite (pozitifse)
//   boş       = kapasite − talep (pozitifse)
//   kümülatif = Σ (boş − fazla): boş kapasiteyle öne üretilebilecek ya da
//               müşteriyi bekletecek toplam saat.
//
// Parça ana presine yazılır (esnek olsa da). Eş ürünler aynı vuruşta
// çıktığı için çiftin süresi bir kez, çok vuruş gerektiren tarafa göre
// sayılır.

import type { ProductSpec } from './planning'

/**
 * Stok sayılan depolar — plan ve kapasite öngörüsü aynı listeyi kullanır.
 * 2010 stok sayılmaz (planlamacının kararı).
 */
export const PLAN_STOCK_LOCATIONS = ['2009', '1009']
/** @deprecated PLAN_STOCK_LOCATIONS ile aynı. */
export const CAPACITY_STOCK_LOCATIONS = PLAN_STOCK_LOCATIONS

export interface CapacityWeek {
  /** Pazartesi, ISO. */
  start: string
  /** "W39" gibi. */
  label: string
  /** O haftadaki resmi/elle girilmiş tatillerin adları. */
  holidays: string[]
}

export interface CapacitySeries {
  /** Haftalık net kapasite, saat (planlı duruşlar düşülmüş, katsayısız). */
  capacity: number[]
  /** Haftalık talep, saat — master data parça performansıyla (B). */
  demand: number[]
  /** Kapasite × Performance sayfasındaki kabul katsayısı (A). */
  capacityAccepted?: number[]
  /** Talep, ideal hızda (parça performansı uygulanmamış) (A). */
  demandIdeal?: number[]
}

/**
 * Performansın hangi kaynaktan uygulanacağı: A) kabule göre — Performance
 * sayfasındaki katsayı kapasiteye; B) master data'daki parça performansı
 * talebe. İkisi birlikte uygulanmaz.
 */
export type PerformanceBasis = 'accepted' | 'masterData'

export function seriesForBasis(s: CapacitySeries, basis: PerformanceBasis): { capacity: number[]; demand: number[] } {
  return basis === 'accepted'
    ? { capacity: s.capacityAccepted ?? s.capacity, demand: s.demandIdeal ?? s.demand }
    : { capacity: s.capacity, demand: s.demand }
}

export interface CapacityForecast {
  weeks: CapacityWeek[]
  presses: ({ press: string } & CapacitySeries)[]
  groups: { name: string; presses: string[] }[]
  /** Hesaba katılamayan malzemeler ve nedeni. */
  unassigned: { material: string; reason: string; quantity: number }[]
  stockLocations: string[]
}

export interface ForecastInput {
  products: ProductSpec[]
  weeklyDemand: { material: string; overdue?: number; periods: { label: string; qty: number }[] }[]
  stock: { material: string; storageLocation?: string; unrestricted?: number }[]
  /** Presler ve Press Definitions'taki kategorileri (800T, Transfer…). */
  presses: { name: string; category?: string }[]
  weeks: CapacityWeek[]
  /** pres → hafta başına net kapasite dakikası (weeks ile aynı sırada), katsayısız. */
  capacityMinutes: Map<string, number[]>
  /** Performance sayfasındaki kabul katsayısı (varsayılan 1). */
  capacityFactor?: number
  stockLocations?: string[]
}

/** Pres adındaki numara: "PRS-106" → "106". */
export function pressNumber(name: string): string {
  return name.match(/(\d+)/)?.[1] ?? name.trim()
}

/**
 * Raporun grupları Press Definitions'taki kategoriden gelir (Gantt'taki
 * gruplamayla aynı): aynı kategorideki presler bir hat. Kategorisi boş pres
 * kendi grubudur. Elle tanımlı grup yoktur.
 */
export function groupPresses(presses: { name: string; category?: string }[]): { name: string; presses: string[] }[] {
  const groups: { name: string; presses: string[] }[] = []
  const byCategory = new Map<string, { name: string; presses: string[] }>()
  for (const p of presses) {
    const category = p.category?.trim()
    if (!category) {
      groups.push({ name: p.name, presses: [p.name] })
      continue
    }
    let g = byCategory.get(category)
    if (!g) {
      g = { name: category, presses: [] }
      byCategory.set(category, g)
      groups.push(g)
    }
    g.presses.push(p.name)
  }
  return groups
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function buildCapacityForecast(input: ForecastInput): CapacityForecast {
  const weekCount = input.weeks.length
  const locations = new Set(input.stockLocations ?? CAPACITY_STOCK_LOCATIONS)
  const productByCode = new Map(input.products.map((p) => [p.code.trim(), p]))
  const pressSet = new Set(input.presses.map((p) => p.name))

  // Stok: yalnızca seçili depolar, kısıtsız stok.
  const stock = new Map<string, number>()
  for (const row of input.stock) {
    if (!row.storageLocation || !locations.has(row.storageLocation.trim())) continue
    stock.set(row.material, (stock.get(row.material) ?? 0) + (row.unrestricted ?? 0))
  }

  // Malzeme → haftalık net ihtiyaç (adet), stok en erken haftadan düşülmüş.
  const netByMaterial = new Map<string, number[]>()
  for (const row of input.weeklyDemand) {
    const weeks = Array.from({ length: weekCount }, (_, w) => Math.abs(row.periods[w]?.qty ?? 0))
    if (weekCount > 0) weeks[0] += Math.abs(row.overdue ?? 0)
    let left = stock.get(row.material) ?? 0
    for (let w = 0; w < weekCount && left > 0; w++) {
      const used = Math.min(left, weeks[w])
      weeks[w] -= used
      left -= used
    }
    const prev = netByMaterial.get(row.material)
    netByMaterial.set(row.material, prev ? prev.map((q, w) => q + weeks[w]) : weeks)
  }

  const demandMinutes = new Map<string, number[]>(
    input.presses.map((p) => [p.name, Array.from({ length: weekCount }, () => 0)]),
  )
  const idealMinutes = new Map<string, number[]>(
    input.presses.map((p) => [p.name, Array.from({ length: weekCount }, () => 0)]),
  )
  const unassigned: CapacityForecast['unassigned'] = []
  const done = new Set<string>()
  const ownerOf = new Map<string, ProductSpec>()
  for (const p of input.products) {
    const co = p.coProduct?.trim()
    if (co) ownerOf.set(co, p)
  }

  for (const [material, net] of netByMaterial) {
    if (done.has(material)) continue
    const total = net.reduce((s, q) => s + q, 0)
    if (total <= 0) continue

    // Eş ürün çifti: süreyi taşıyan, eşini tanımlayan ürün.
    let carrier = productByCode.get(material)
    let partnerNet: number[] | undefined
    const partnerOf = (p?: ProductSpec) => p?.coProduct?.trim() || undefined
    const partner = partnerOf(carrier)
    if (partner) {
      partnerNet = netByMaterial.get(partner)
      done.add(partner)
    } else {
      // Bu malzeme başka bir ürünün eşi mi?
      const owner = ownerOf.get(material)
      if (owner) {
        carrier = owner
        partnerNet = netByMaterial.get(owner.code.trim())
        done.add(owner.code.trim())
      }
    }
    done.add(material)

    if (!carrier) {
      unassigned.push({ material, reason: 'not in master data', quantity: total })
      continue
    }
    const press = carrier.mainMachine?.trim() ?? ''
    const spm = carrier.spm ?? 0
    if (!press || !pressSet.has(press)) {
      unassigned.push({
        material,
        reason: press ? `main press ${press} is not defined` : 'no main press',
        quantity: total,
      })
      continue
    }
    if (spm <= 0) {
      unassigned.push({ material, reason: 'no SPM', quantity: total })
      continue
    }
    const cavities = carrier.moldCavities && carrier.moldCavities > 0 ? carrier.moldCavities : 1
    const factor =
      carrier.performanceFactor && carrier.performanceFactor > 0
        ? Math.min(1, carrier.performanceFactor)
        : 1
    const row = demandMinutes.get(press)!
    const ideal = idealMinutes.get(press)!
    for (let w = 0; w < weekCount; w++) {
      const qty = Math.max(net[w], partnerNet?.[w] ?? 0)
      if (qty <= 0) continue
      row[w] += qty / cavities / spm / factor
      ideal[w] += qty / cavities / spm
    }
  }

  return {
    weeks: input.weeks,
    presses: input.presses.map(({ name: press }) => ({
      press,
      capacity: (input.capacityMinutes.get(press) ?? []).map((m) => round2(m / 60)),
      demand: (demandMinutes.get(press) ?? []).map((m) => round2(m / 60)),
      capacityAccepted: (input.capacityMinutes.get(press) ?? []).map((m) => round2((m * (input.capacityFactor ?? 1)) / 60)),
      demandIdeal: (idealMinutes.get(press) ?? []).map((m) => round2(m / 60)),
    })),
    groups: groupPresses(input.presses),
    unassigned: unassigned.sort((a, b) => b.quantity - a.quantity),
    stockLocations: [...locations],
  }
}

/** Kapasite ve talepten raporun satırları. */
export interface CapacityRow {
  capacity: number
  demand: number
  /** Kapasitenin kullanılan kısmı: min(talep, kapasite). */
  load: number
  over: number
  idle: number
  cumulative: number
}

export function capacityRows(series: CapacitySeries): CapacityRow[] {
  let cumulative = 0
  return series.capacity.map((capacity, w) => {
    const demand = series.demand[w] ?? 0
    const over = Math.max(0, demand - capacity)
    const idle = Math.max(0, capacity - demand)
    cumulative += idle - over
    return { capacity, demand, load: Math.min(demand, capacity), over, idle, cumulative }
  })
}

/** Preslerin serilerini toplar (grup satırı). */
export function sumSeries(series: CapacitySeries[], weekCount: number): CapacitySeries {
  const capacity = Array.from({ length: weekCount }, () => 0)
  const demand = Array.from({ length: weekCount }, () => 0)
  for (const s of series) {
    for (let w = 0; w < weekCount; w++) {
      capacity[w] += s.capacity[w] ?? 0
      demand[w] += s.demand[w] ?? 0
    }
  }
  return { capacity, demand }
}
