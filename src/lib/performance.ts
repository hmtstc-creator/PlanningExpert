// Plan / gerçekleşen karşılaştırması ve performans göstergeleri.
// MB51'den yüklenen gerçekleşen üretim ile onaylı planı karşılaştırır;
// çıkan performans faktörü ileriye dönük kapasiteyi gerçekçileştirmek
// için kullanılır.

import type { ProductSpec } from './planning'

export interface PlanRow {
  material: string
  date: string
  quantity: number
}

export interface ActualRow {
  material: string
  postingDate: string
  quantity: number
}

export interface AdherenceRow {
  material: string
  plannedQty: number
  actualQty: number
  /** gerçekleşen − planlanan (eksi ise geride kalınmış). */
  diff: number
  /** gerçekleşen / planlanan. Plan 0 ise null. */
  ratio: number | null
}

function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to
}

/**
 * Verilen tarih aralığında malzeme bazında plan ve gerçekleşen miktarları
 * yan yana koyar. Planda olmayıp üretilen ya da planlanıp üretilmeyen
 * kalemler de listede yer alır.
 */
export function buildAdherence(
  plan: PlanRow[],
  actual: ActualRow[],
  from: string,
  to: string,
): AdherenceRow[] {
  const planned = new Map<string, number>()
  for (const row of plan) {
    if (!inRange(row.date, from, to)) continue
    planned.set(row.material, (planned.get(row.material) ?? 0) + row.quantity)
  }

  const produced = new Map<string, number>()
  for (const row of actual) {
    if (!inRange(row.postingDate, from, to)) continue
    produced.set(row.material, (produced.get(row.material) ?? 0) + row.quantity)
  }

  const materials = Array.from(new Set([...planned.keys(), ...produced.keys()])).sort()
  return materials.map((material) => {
    const plannedQty = planned.get(material) ?? 0
    const actualQty = produced.get(material) ?? 0
    return {
      material,
      plannedQty,
      actualQty,
      diff: actualQty - plannedQty,
      ratio: plannedQty > 0 ? actualQty / plannedQty : null,
    }
  })
}

/**
 * Toplam gerçekleşen / toplam planlanan. Kapasiteyi gerçekçileştirmek için
 * kullanılır: 0.85 çıkıyorsa plan yaparken kapasitenin %85'i baz alınır.
 * Plan yoksa null döner (faktör uydurulmaz).
 */
export function performanceFactor(rows: AdherenceRow[]): number | null {
  const totalPlanned = rows.reduce((s, r) => s + r.plannedQty, 0)
  if (totalPlanned <= 0) return null
  const totalActual = rows.reduce((s, r) => s + r.actualQty, 0)
  return totalActual / totalPlanned
}

/**
 * Gerçekleşen üretimin teorik (ideal hızda) kaç dakika sürmesi gerektiğini
 * hesaplar. Referans kartında SPM veya göz sayısı tanımsız olan mamuller
 * atlanır.
 */
export function theoreticalMinutes(
  actual: ActualRow[],
  products: Map<string, ProductSpec>,
): number {
  let minutes = 0
  for (const row of actual) {
    const product = products.get(row.material)
    const cavities = product?.moldCavities && product.moldCavities > 0 ? product.moldCavities : 0
    const spm = product?.spm && product.spm > 0 ? product.spm : 0
    if (cavities === 0 || spm === 0) continue
    minutes += row.quantity / cavities / spm
  }
  return minutes
}

/**
 * Kapasite kullanımı: teorik üretim süresi / açık kapasite.
 *
 * NOT: Bu tam bir OEE değildir — duruş ve fire verisi sistemde yok.
 * Kullanılabilirlik × performans bileşenlerinin birleşik bir yaklaşığıdır;
 * kalite bileşeni (fire) hesaba girmez.
 */
export function capacityUtilisation(
  theoreticalMin: number,
  availableMinutes: number,
): number | null {
  if (availableMinutes <= 0) return null
  return theoreticalMin / availableMinutes
}
