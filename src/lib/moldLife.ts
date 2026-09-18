// Kalıp ömrü takibi: her malzemenin kalıbının son bakımdan bu yana kaç
// vuruş yaptığını gerçekleşen üretimden (MB51) hesaplar ve referans
// kartındaki maksimum baskı limitiyle karşılaştırır.

import type { ProductSpec } from './planning'

export interface ActualShotRow {
  material: string
  postingDate: string
  quantity: number
}

export type MoldStatus = 'ok' | 'warning' | 'exceeded' | 'unknown'

export interface MoldLifeRow {
  material: string
  /** Son bakımdan bu yana yapılan vuruş. */
  cumulativeShots: number
  maxShots: number | null
  /** Limite kalan vuruş; limit tanımsızsa null. */
  remainingShots: number | null
  /** cumulativeShots / maxShots; limit tanımsızsa null. */
  usageRatio: number | null
  lastMaintenance: string | null
  status: MoldStatus
}

export interface MoldLifeOptions {
  /** Bu orandan sonrası uyarı sayılır (varsayılan 0.8). */
  warnRatio?: number
}

/**
 * Gerçekleşen üretimi vuruşa çevirip malzeme bazında toplar.
 *
 * - Vuruş = adet / göz sayısı. Göz sayısı tanımsızsa 1 kabul edilir.
 * - Son bakım tarihi verilmişse yalnızca o tarihten sonraki üretim sayılır;
 *   bakım kaydı yoksa eldeki tüm gerçekleşen üretim toplanır.
 * - Limit tanımsız mamuller `unknown` olarak işaretlenir — limit
 *   uydurulmaz.
 */
export function buildMoldLife(
  actual: ActualShotRow[],
  products: Map<string, ProductSpec>,
  lastMaintenanceByMaterial: Map<string, string> = new Map(),
  options: MoldLifeOptions = {},
): MoldLifeRow[] {
  const warnRatio = options.warnRatio ?? 0.8
  const shotsByMaterial = new Map<string, number>()

  for (const row of actual) {
    const since = lastMaintenanceByMaterial.get(row.material)
    if (since && row.postingDate <= since) continue

    const product = products.get(row.material)
    const cavities =
      product?.moldCavities && product.moldCavities > 0 ? product.moldCavities : 1
    shotsByMaterial.set(
      row.material,
      (shotsByMaterial.get(row.material) ?? 0) + row.quantity / cavities,
    )
  }

  // Bakım kaydı olup hiç üretim görmemiş kalıplar da listede görünsün.
  for (const material of lastMaintenanceByMaterial.keys()) {
    if (!shotsByMaterial.has(material)) shotsByMaterial.set(material, 0)
  }

  const rows: MoldLifeRow[] = []
  for (const [material, shots] of shotsByMaterial) {
    const product = products.get(material)
    const maxShots = product?.maxShots && product.maxShots > 0 ? product.maxShots : null
    const cumulativeShots = Math.round(shots)
    const usageRatio = maxShots ? cumulativeShots / maxShots : null

    let status: MoldStatus
    if (usageRatio === null) status = 'unknown'
    else if (usageRatio >= 1) status = 'exceeded'
    else if (usageRatio >= warnRatio) status = 'warning'
    else status = 'ok'

    rows.push({
      material,
      cumulativeShots,
      maxShots,
      remainingShots: maxShots ? Math.max(0, maxShots - cumulativeShots) : null,
      usageRatio,
      lastMaintenance: lastMaintenanceByMaterial.get(material) ?? null,
      status,
    })
  }

  const statusRank: Record<MoldStatus, number> = {
    exceeded: 0,
    warning: 1,
    ok: 2,
    unknown: 3,
  }
  return rows.sort(
    (a, b) =>
      statusRank[a.status] - statusRank[b.status] ||
      (b.usageRatio ?? 0) - (a.usageRatio ?? 0) ||
      a.material.localeCompare(b.material),
  )
}
