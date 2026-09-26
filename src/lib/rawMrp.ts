// Hammadde ihtiyaç planlaması (MRP) — plandan BAĞIMSIZ.
//
// Yöntem (FMEA ile seçildi; bkz. Planning Logic):
//  1. Mamul talebi: ZPP'nin son haftasına kadar, haftalık kovalar. Bakiye
//     (overdue) bu haftaya yazılır.
//  2. Mamul stoğu düşülür: 2009 + 1009, en erken haftadan başlayarak (FIFO).
//     Kalan net adet üretilmesi gerekendir.
//  3. Hammaddeye çevrim: net adet × parça başı brüt ağırlık. Eş ürün aynı
//     vuruştan bedava çıkar: çiftin vuruşu iki tarafın ihtiyacının büyüğü,
//     sac yalnızca asıl ürünün gramajıyla sayılır.
//  4. Plan EKLENMEZ: planın öne çekmesi ve rulo/Min. lot fazlası aynı talebin
//     zamanlaması ve yuvarlamasıdır; ikisini toplamak mükerrer sipariş olur.
//     Bu sapmaları 10 günlük emniyet stoğu karşılar.
//  5. Haftalık stok yürütme: hafta başı stok + gelen sipariş, o haftanın
//     tüketimini VE haftanın sonundan itibaren N günlük tüketimi (emniyet)
//     karşılamalı. Yalnızca hafta başında N gün bakmak, hafta sonuna doğru
//     emniyetin altına düşmek demek olurdu (kova hatası).
//  6. Yetmiyorsa o hafta teslim edilecek sipariş: eksik + standart ek (500 kg).
//  7. ZPP'nin bittiği yerde talep bilinmez; son haftalarda emniyet penceresi
//     son 4 haftanın ortalamasıyla uzatılır (yoksa ufkun sonunda emniyet
//     çöker ve sipariş eksik çıkar).

import type { ProductSpec } from './planning'

export interface MrpWeek {
  /** Pazartesi (ISO). */
  start: string
  label: string
}

export interface RawRequirement {
  rawMaterial: string
  /** Bu hammaddeyi tüketen mamuller (eş ürünün asıl ürünü). */
  materials: string[]
  /** MB52 rulo stoğu (kg), kullanılabilir. */
  stockKg: number
  /** Haftalık brüt hammadde ihtiyacı (kg), `weeks` ile aynı sırada. */
  needKg: number[]
}

export interface RawRequirementPlan {
  weeks: MrpWeek[]
  items: RawRequirement[]
  /** Talebi olup hammadde kodu ya da brüt ağırlığı olmayan mamuller: ihtiyacı hesaplanamadı. */
  missingSpec: { material: string; pieces: number; reason: string }[]
  /** Brüt ağırlığı olağan dışı (birim hatası şüphesi) mamuller. */
  suspectWeights: { material: string; grossWeight: number }[]
}

export interface MrpSettings {
  coverageDays: number
  extraKg: number
}

export interface MrpWeekRow {
  needKg: number
  /** Hafta başı stok (sipariş gelmeden). */
  stockStartKg: number
  /** Hafta sonu için tutulması gereken emniyet: sonraki N günün tüketimi. */
  safetyKg: number
  /** Bu hafta teslim edilmesi gereken sipariş. */
  orderKg: number
  /** Hafta sonu stok (sipariş dahil, tüketim sonrası). */
  stockEndKg: number
}

export interface RawMrpResult {
  rawMaterial: string
  materials: string[]
  stockKg: number
  totalNeedKg: number
  totalOrderKg: number
  /** Siparişsiz, bugünkü stok kaç hafta yetiyor (ufukta bitmezse null). */
  coversWeeks: number | null
  rows: MrpWeekRow[]
}

const round = (kg: number) => Math.round(kg)
const cavities = (p?: ProductSpec) => (p?.moldCavities && p.moldCavities > 0 ? p.moldCavities : 1)

/**
 * Talep → net mamul → hammadde kg (haftalık). Plan kullanılmaz.
 */
export function buildRawRequirements(input: {
  products: ProductSpec[]
  /** ZPP: bakiye + haftalık kovalar (ilk kova bu hafta). */
  weeklyDemand: { material: string; overdue?: number; periods: { label: string; qty: number }[] }[]
  /** Mamul stoğu (yalnızca sayılan depolar). */
  finishedStock: Map<string, number>
  /** Hammadde stoğu (kg). */
  rawStock: Map<string, number>
  weeks: MrpWeek[]
}): RawRequirementPlan {
  const { weeks } = input
  const n = weeks.length
  const productByCode = new Map(input.products.map((p) => [p.code.trim(), p]))

  // 1–2. Net mamul ihtiyacı (adet / hafta), stok FIFO düşülmüş.
  const netByMaterial = new Map<string, number[]>()
  for (const row of input.weeklyDemand) {
    const material = row.material.trim()
    const need = Array.from({ length: n }, (_, w) => Math.abs(row.periods[w]?.qty ?? 0))
    if (n > 0) need[0] += Math.abs(row.overdue ?? 0)
    let stock = input.finishedStock.get(material) ?? 0
    for (let w = 0; w < n && stock > 0; w++) {
      const used = Math.min(stock, need[w])
      need[w] -= used
      stock -= used
    }
    const prev = netByMaterial.get(material)
    netByMaterial.set(material, prev ? prev.map((q, w) => q + need[w]) : need)
  }

  // 3. Eş ürün çiftleri: çifti taşıyan (asıl) ürün, eşini tanımlayandır.
  const carrierOf = new Map<string, ProductSpec>()
  for (const p of input.products) {
    const co = p.coProduct?.trim()
    if (!co || co === p.code.trim()) continue
    // İki taraf da birbirini eş gösteriyorsa kodu küçük olan asıldır.
    const back = productByCode.get(co)?.coProduct?.trim()
    if (back === p.code.trim() && p.code.trim() > co) continue
    carrierOf.set(co, p)
  }

  const byRaw = new Map<string, { materials: Set<string>; kg: number[] }>()
  const rawEntry = (raw: string) => {
    let e = byRaw.get(raw)
    if (!e) {
      e = { materials: new Set(), kg: Array.from({ length: n }, () => 0) }
      byRaw.set(raw, e)
    }
    return e
  }
  for (const p of input.products) {
    const raw = p.rawMaterialCode?.trim()
    if (raw && !carrierOf.has(p.code.trim())) rawEntry(raw).materials.add(p.code.trim())
  }

  const missing = new Map<string, { pieces: number; reason: string }>()
  const done = new Set<string>()
  for (const [material, net] of netByMaterial) {
    if (done.has(material)) continue
    let carrier = productByCode.get(material)
    let partnerCode: string | undefined
    const owner = carrierOf.get(material)
    if (owner) {
      carrier = owner
      partnerCode = material
    } else {
      partnerCode = carrier?.coProduct?.trim() || undefined
    }
    const carrierCode = carrier?.code.trim() ?? material
    done.add(carrierCode)
    if (partnerCode) done.add(partnerCode)
    const own = netByMaterial.get(carrierCode) ?? Array.from({ length: n }, () => 0)
    const partnerNet = partnerCode ? netByMaterial.get(partnerCode) : undefined
    const partner = partnerCode ? productByCode.get(partnerCode) : undefined
    // Asıl ürünün adedi: çiftin vuruşu × asıl ürünün göz sayısı.
    const primaryPieces = own.map((q, w) => {
      const strokes = Math.max(Math.ceil(q / cavities(carrier)), Math.ceil((partnerNet?.[w] ?? 0) / cavities(partner)))
      return strokes * cavities(carrier)
    })
    const total = primaryPieces.reduce((a, b) => a + b, 0)
    if (total <= 0) continue
    const raw = carrier?.rawMaterialCode?.trim()
    const gross = carrier?.grossWeight ?? 0
    if (!carrier || !raw || gross <= 0) {
      missing.set(carrierCode, {
        pieces: total,
        reason: !carrier ? 'not in master data' : !raw ? 'no raw material code' : 'no gross weight',
      })
      continue
    }
    const e = rawEntry(raw)
    e.materials.add(carrierCode)
    primaryPieces.forEach((pieces, w) => {
      e.kg[w] += pieces * gross
    })
  }

  // Birim hatası şüphesi: parça başı brüt ağırlık 50 kg'dan fazla ya da 1 g'dan az.
  const suspectWeights = input.products
    .filter((p) => (p.grossWeight ?? 0) > 50 || ((p.grossWeight ?? 0) > 0 && (p.grossWeight ?? 0) < 0.001))
    .map((p) => ({ material: p.code, grossWeight: p.grossWeight ?? 0 }))

  return {
    weeks,
    items: Array.from(byRaw.entries())
      .map(([rawMaterial, e]) => ({
        rawMaterial,
        materials: Array.from(e.materials).sort(),
        stockKg: round(input.rawStock.get(rawMaterial) ?? 0),
        needKg: e.kg.map(round),
      }))
      .sort((a, b) => a.rawMaterial.localeCompare(b.rawMaterial)),
    missingSpec: Array.from(missing.entries())
      .map(([material, m]) => ({ material, pieces: m.pieces, reason: m.reason }))
      .sort((a, b) => b.pieces - a.pieces),
    suspectWeights,
  }
}

/**
 * Bir hammaddenin haftalık stok yürütmesi ve teslim haftalarına sipariş.
 */
export function rawMrp(item: RawRequirement, settings: MrpSettings): RawMrpResult {
  const need = item.needKg
  const n = need.length
  const coverDays = Math.max(1, settings.coverageDays)
  const extra = Math.max(0, settings.extraKg)
  // Ufuk sonrası: son 4 haftanın ortalaması (talep orada bitmiyor, bilinmiyor).
  const tail = need.slice(Math.max(0, n - 4))
  const tailAvg = tail.length > 0 ? tail.reduce((a, b) => a + b, 0) / tail.length : 0
  const weekNeed = (w: number) => (w < n ? need[w] : tailAvg)
  /** `w` haftasının sonundan itibaren `coverDays` günlük tüketim (günlük eşit dağılım). */
  const safetyAfter = (w: number) => {
    let left = coverDays
    let kg = 0
    for (let k = w + 1; left > 0; k++) {
      const days = Math.min(7, left)
      kg += (weekNeed(k) * days) / 7
      left -= days
    }
    return kg
  }

  // Siparişsiz kapsama.
  let left = item.stockKg
  let coversWeeks: number | null = null
  for (let w = 0; w < n; w++) {
    if (need[w] > left + 1e-9) {
      coversWeeks = Math.round((w + (need[w] > 0 ? left / need[w] : 0)) * 10) / 10
      break
    }
    left -= need[w]
  }

  let stock = item.stockKg
  const rows: MrpWeekRow[] = []
  for (let w = 0; w < n; w++) {
    const safety = safetyAfter(w)
    const required = need[w] + safety
    let order = 0
    if (required > 0 && stock < required - 1e-9) order = round(required - stock + extra)
    const end = stock + order - need[w]
    rows.push({ needKg: need[w], stockStartKg: round(stock), safetyKg: round(safety), orderKg: order, stockEndKg: round(end) })
    stock = end
  }
  return {
    rawMaterial: item.rawMaterial,
    materials: item.materials,
    stockKg: item.stockKg,
    totalNeedKg: round(need.reduce((a, b) => a + b, 0)),
    totalOrderKg: rows.reduce((a, r) => a + r.orderKg, 0),
    coversWeeks,
    rows,
  }
}
