// Production Plan sayfasının organizasyon süzgeci: bölüm → masraf yeri → iş
// yeri. Yalnızca **görünümü** daraltır; plan her zaman fabrikanın tamamı için
// hesaplanır (motor kapasiteyi, vinci, kalıbı birlikte görmek zorundadır), bu
// yüzden süzgeç motora girdi değildir.
//
// Eşleme Work Center Definitions'taki bağdır: iş yeri → masraf yeri (presses
// tablosu), masraf yeri → bölüm (plant kaydı). Tek kaynak orası; burada kopya
// tutulmaz.
//
// Pres planı yalnız `rateModel: 'stroke'` iş yerlerini kapsar
// (src/lib/rateModel.ts `pressPlanScope`). Cycle hatları (punta, robot,
// montaj, nut welding) henüz planlanmaz; süzgeç bunları "plan dışı" diye
// sayar ki seçilen bölüm boş görünürse nedeni belli olsun.

import { rateModelOf } from './rateModel'

/** Bölümü ya da masraf yeri olmayan iş yerlerinin seçenek değeri. */
export const UNASSIGNED = '(none)'

export interface OrgPress {
  name: string
  costCenter?: string
  rateModel?: string | null
}

export interface OrgCostCenter {
  code: string
  name: string
  department?: string
}

/** Süzgeç durumu: boş bölüm = hepsi, boş masraf yeri listesi = bölümün hepsi. */
export interface PlanOrgSelection {
  department: string
  costCenters: string[]
}

export const NO_ORG_FILTER: PlanOrgSelection = { department: '', costCenters: [] }

export interface PlanOrgOption {
  value: string
  label: string
  /** Pres planına giren iş yeri sayısı (stroke). */
  planned: number
  /** Tanımlı ama pres planına girmeyen iş yeri sayısı (cycle hatları). */
  other: number
}

export interface PlanOrgOptions {
  departments: PlanOrgOption[]
  costCenters: PlanOrgOption[]
}

export const orgFilterActive = (s: PlanOrgSelection) => s.department !== '' || s.costCenters.length > 0

/** İş yerinin masraf yeri kodu; kodu yoksa ya da plant'te tanımlı değilse UNASSIGNED. */
export function costCenterOf(press: OrgPress, costCenters: OrgCostCenter[]): string {
  const code = press.costCenter?.trim()
  if (!code) return UNASSIGNED
  return costCenters.some((c) => c.code === code) ? code : UNASSIGNED
}

/** Masraf yeri kodu → bölüm adı; bölümsüz masraf yeri UNASSIGNED sayılır. */
function departmentIndex(costCenters: OrgCostCenter[]): Map<string, string> {
  return new Map(costCenters.map((c) => [c.code, c.department?.trim() || UNASSIGNED]))
}

/** İş yerinin bölümü (masraf yeri yok ya da masraf yeri bölümsüz: UNASSIGNED). */
export function departmentOf(press: OrgPress, costCenters: OrgCostCenter[]): string {
  const code = costCenterOf(press, costCenters)
  if (code === UNASSIGNED) return UNASSIGNED
  return departmentIndex(costCenters).get(code) ?? UNASSIGNED
}

/**
 * Süzgeçten geçen iş yeri adları. Süzgeç kapalıysa bütün iş yerleri döner;
 * çağıran tarafın ayrıca `orgFilterActive` ile ilgilenmesi gerekmez.
 */
export function visibleWorkCenters(
  presses: OrgPress[],
  costCenters: OrgCostCenter[],
  selection: PlanOrgSelection,
): Set<string> {
  const index = departmentIndex(costCenters)
  const names = new Set<string>()
  for (const press of presses) {
    const code = costCenterOf(press, costCenters)
    const dept = code === UNASSIGNED ? UNASSIGNED : (index.get(code) ?? UNASSIGNED)
    if (selection.department !== '' && dept !== selection.department) continue
    if (selection.costCenters.length > 0 && !selection.costCenters.includes(code)) continue
    names.add(press.name)
  }
  return names
}

/**
 * Seçim kutularının içeriği. Masraf yeri listesi seçili bölüme göre daralır;
 * hiç iş yeri olmayan bölüm / masraf yeri listeye girmez (ölü seçenek olmaz).
 * `planned` pres planına giren, `other` plan dışı (cycle) iş yeri sayısıdır.
 * Bölüm sırası plant kaydındaki sıradır; listede olmayan bölümler sonra,
 * bölümsüzler en sonda.
 */
export function planOrgOptions(
  presses: OrgPress[],
  costCenters: OrgCostCenter[],
  departments: string[],
  selection: PlanOrgSelection,
): PlanOrgOptions {
  const index = departmentIndex(costCenters)
  const nameOf = new Map(costCenters.map((c) => [c.code, c.name]))
  const empty = () => ({ planned: 0, other: 0 })
  const add = (into: Map<string, { planned: number; other: number }>, key: string, press: OrgPress) => {
    const row = into.get(key) ?? empty()
    if (rateModelOf(press) === 'stroke') row.planned += 1
    else row.other += 1
    into.set(key, row)
  }

  const byDepartment = new Map<string, { planned: number; other: number }>()
  const byCostCenter = new Map<string, { planned: number; other: number }>()
  for (const press of presses) {
    const code = costCenterOf(press, costCenters)
    const dept = code === UNASSIGNED ? UNASSIGNED : (index.get(code) ?? UNASSIGNED)
    add(byDepartment, dept, press)
    // Masraf yeri sayıları yalnız seçili bölümün (bölüm seçilmediyse hepsinin).
    if (selection.department === '' || selection.department === dept) add(byCostCenter, code, press)
  }

  const option = (counts: Map<string, { planned: number; other: number }>, value: string, label: string): PlanOrgOption => ({
    value,
    label,
    ...(counts.get(value) ?? empty()),
  })

  const deptOrder = departments.filter((d) => byDepartment.has(d))
  for (const dept of byDepartment.keys()) if (dept !== UNASSIGNED && !deptOrder.includes(dept)) deptOrder.push(dept)
  const departmentOptions = deptOrder.map((name) => option(byDepartment, name, name))
  if (byDepartment.has(UNASSIGNED)) {
    departmentOptions.push(option(byDepartment, UNASSIGNED, 'Without a department'))
  }

  const codeOrder = costCenters.map((c) => c.code).filter((code) => byCostCenter.has(code))
  for (const code of byCostCenter.keys()) if (code !== UNASSIGNED && !codeOrder.includes(code)) codeOrder.push(code)
  const costCenterOptions = codeOrder.map((code) => {
    const name = nameOf.get(code)
    return option(byCostCenter, code, name ? `${code} — ${name}` : code)
  })
  if (byCostCenter.has(UNASSIGNED)) {
    costCenterOptions.push(option(byCostCenter, UNASSIGNED, 'Without a cost center'))
  }

  return { departments: departmentOptions, costCenters: costCenterOptions }
}

/**
 * Tanımlar değişince (bölüm silindi, masraf yeri başka bölüme taşındı) ya da
 * bölüm değişince geçersiz kalan seçimi temizler: bilinmeyen bölüm "hepsi"
 * olur, o bölümde olmayan masraf yerleri düşer. Yoksa süzgeç hiçbir iş yeri
 * göstermez. Seçim zaten geçerliyse aynı nesne döner.
 */
export function pruneOrgSelection(selection: PlanOrgSelection, options: PlanOrgOptions): PlanOrgSelection {
  if (selection.department !== '' && !options.departments.some((o) => o.value === selection.department)) {
    return NO_ORG_FILTER
  }
  const allowed = new Set(options.costCenters.map((o) => o.value))
  const kept = selection.costCenters.filter((code) => allowed.has(code))
  return kept.length === selection.costCenters.length ? selection : { ...selection, costCenters: kept }
}
