// Onaylanan plan ile o an hesaplanan otomatik planın karşılaştırılması.
// Plan her zaman canlı veriden yeniden hesaplandığı için, "onayladığım
// plana göre ne değişti" sorusunun cevabı bu katmandan gelir.

export interface PlanJobLike {
  material: string
  press: string
  date: string
  quantity: number
}

export type PlanChangeKind = 'added' | 'removed' | 'moved' | 'quantity' | 'same'

export interface PlanChange {
  material: string
  kind: PlanChangeKind
  approvedQty: number
  currentQty: number
  /** "PRS-1 · 2026-09-14" biçiminde, sıralı slot listesi. */
  approvedSlots: string[]
  currentSlots: string[]
}

export interface PlanDiff {
  changes: PlanChange[]
  addedCount: number
  removedCount: number
  movedCount: number
  quantityCount: number
  sameCount: number
}

function group(jobs: PlanJobLike[]): Map<string, { qty: number; slots: string[] }> {
  const map = new Map<string, { qty: number; slots: string[] }>()
  for (const job of jobs) {
    const entry = map.get(job.material) ?? { qty: 0, slots: [] }
    entry.qty += job.quantity
    entry.slots.push(`${job.press} · ${job.date}`)
    map.set(job.material, entry)
  }
  for (const entry of map.values()) entry.slots.sort()
  return map
}

function sameSlots(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Malzeme bazında karşılaştırır: yeni eklenen, düşen, presi/günü değişen
 * ve miktarı değişen kalemler. Aynı kalanlar yalnızca sayılır.
 */
export function diffPlans(approved: PlanJobLike[], current: PlanJobLike[]): PlanDiff {
  const a = group(approved)
  const c = group(current)
  const materials = Array.from(new Set([...a.keys(), ...c.keys()])).sort()

  const changes: PlanChange[] = []
  let addedCount = 0
  let removedCount = 0
  let movedCount = 0
  let quantityCount = 0
  let sameCount = 0

  for (const material of materials) {
    const before = a.get(material)
    const after = c.get(material)

    let kind: PlanChangeKind
    if (!before) {
      kind = 'added'
      addedCount++
    } else if (!after) {
      kind = 'removed'
      removedCount++
    } else if (!sameSlots(before.slots, after.slots)) {
      kind = 'moved'
      movedCount++
    } else if (Math.round(before.qty) !== Math.round(after.qty)) {
      kind = 'quantity'
      quantityCount++
    } else {
      kind = 'same'
      sameCount++
    }

    if (kind !== 'same') {
      changes.push({
        material,
        kind,
        approvedQty: before?.qty ?? 0,
        currentQty: after?.qty ?? 0,
        approvedSlots: before?.slots ?? [],
        currentSlots: after?.slots ?? [],
      })
    }
  }

  return { changes, addedCount, removedCount, movedCount, quantityCount, sameCount }
}
