// Work Center Definitions sayfasının ağacı: aynı work center listesi üç
// açıdan görülür — organizasyon (bölüm → masraf yeri), kategori (hat) ve hol
// (vinç). Seçilen düğüm sağdaki tabloyu süzer.

export interface WcPress {
  _id: string
  name: string
  hall: string
  category?: string
  feedsCoil?: boolean
  frozenDays?: number
  costCenter?: string
}

export interface WcCostCenter {
  code: string
  name: string
  department?: string
}

export type WcView = 'org' | 'category' | 'hall'

export type WcNode =
  | { kind: 'plant' }
  | { kind: 'department'; name: string }
  | { kind: 'costCenter'; code: string }
  | { kind: 'unlinked' }
  | { kind: 'category'; name: string }
  | { kind: 'noCategory' }
  | { kind: 'hall'; name: string }
  | { kind: 'noHall' }
  | { kind: 'workCenter'; name: string }

const byName = (a: WcPress, b: WcPress) => a.name.localeCompare(b.name, undefined, { numeric: true })

export const sameWcNode = (a: WcNode | null, b: WcNode | null) => JSON.stringify(a) === JSON.stringify(b)

/** Düğümün work center'ları (sağdaki tablo). */
export function pressesIn(node: WcNode, presses: WcPress[], costCenters: WcCostCenter[]): WcPress[] {
  const known = new Set(costCenters.map((c) => c.code))
  const deptOf = new Map(costCenters.map((c) => [c.code, c.department ?? '']))
  const keep = (p: WcPress): boolean => {
    switch (node.kind) {
      case 'plant':
        return true
      case 'department':
        return !!p.costCenter && known.has(p.costCenter) && (deptOf.get(p.costCenter) || '') === node.name
      case 'costCenter':
        return p.costCenter === node.code
      case 'unlinked':
        return !p.costCenter || !known.has(p.costCenter)
      case 'category':
        return p.category?.trim() === node.name
      case 'noCategory':
        return !p.category?.trim()
      case 'hall':
        return p.hall.trim() === node.name
      case 'noHall':
        return !p.hall.trim()
      case 'workCenter':
        return p.name === node.name
    }
  }
  return presses.filter(keep).sort(byName)
}

/** Organizasyon görünümü: bölüm → masraf yeri → work center. */
export function orgGroups(presses: WcPress[], costCenters: WcCostCenter[], departments: string[]) {
  const depts = [...departments]
  for (const c of costCenters) if (c.department && !depts.includes(c.department)) depts.push(c.department)
  const groups = depts.map((name) => ({
    name,
    costCenters: costCenters
      .filter((c) => c.department === name)
      .map((c) => ({ ...c, presses: presses.filter((p) => p.costCenter === c.code).sort(byName) })),
  }))
  // Bölümü olmayan masraf yerleri (Company settings'te düzeltilir).
  const loose = costCenters
    .filter((c) => !c.department || !depts.includes(c.department))
    .map((c) => ({ ...c, presses: presses.filter((p) => p.costCenter === c.code).sort(byName) }))
  if (loose.length) groups.push({ name: '', costCenters: loose })
  const known = new Set(costCenters.map((c) => c.code))
  const unlinked = presses.filter((p) => !p.costCenter || !known.has(p.costCenter)).sort(byName)
  return { departments: groups, unlinked }
}

/** Kategori görünümü: listedeki her kategori (boş olanlar da) + kategorisizler. */
export function categoryGroups(presses: WcPress[], categories: string[]) {
  const groups = categories.map((name) => ({ name, presses: presses.filter((p) => p.category?.trim() === name).sort(byName) }))
  return { categories: groups, none: presses.filter((p) => !p.category?.trim()).sort(byName) }
}

/** Hol görünümü: tanımlı holler + holsüzler (her biri kendi başına). */
export function hallGroups(presses: WcPress[]) {
  const names = [...new Set(presses.map((p) => p.hall.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  return { halls: names.map((name) => ({ name, presses: presses.filter((p) => p.hall.trim() === name).sort(byName) })), none: presses.filter((p) => !p.hall.trim()).sort(byName) }
}
