// Organizasyon süzgeci: bölüm → masraf yeri → iş yeri. Production Plan,
// Master Data ve Capacity Dashboard aynı hesabı kullanır (tek kaynak).
// Yalnızca **görünümü** daraltır; plan her zaman fabrikanın tamamı için
// hesaplanır (motor kapasiteyi, vinci, kalıbı birlikte görmek zorundadır), bu
// yüzden süzgeç motora girdi değildir.
//
// Eşleme Work Center Definitions'taki bağdır: iş yeri → masraf yeri (presses
// tablosu), masraf yeri → bölüm (plant kaydı). Tek kaynak orası; burada kopya
// tutulmaz.
//
// Bütün iş yerleri planlanır (2026-10-29: süre her parçada çevrim süresinden
// gelir; pres / cycle ayrımı yoktur), bu yüzden "plan dışı" sayaç yoktur.

/** Bölümü ya da masraf yeri olmayan iş yerlerinin seçenek değeri. */
export const UNASSIGNED = '(none)'

export interface OrgPress {
  name: string
  costCenter?: string
  /** Operatör planı: hattın vardiyada gereken adamı (yok = 1). */
  crewSize?: number
}

export interface OrgCostCenter {
  code: string
  name: string
  department?: string
  /** 'operator' = operatör planı (src/lib/operatorAllocation.ts); yok = vardiya planı. */
  planningModel?: 'shift' | 'operator'
}

/**
 * Süzgeç durumu. Her kademe boşken üstündekinin hepsi demektir: boş bölüm =
 * bütün bölümler, boş masraf yeri listesi = bölümün hepsi, boş iş yeri
 * listesi = masraf yerlerinin hepsi.
 */
export interface PlanOrgSelection {
  department: string
  costCenters: string[]
  workCenters: string[]
}

export const NO_ORG_FILTER: PlanOrgSelection = { department: '', costCenters: [], workCenters: [] }

export interface PlanOrgOption {
  value: string
  label: string
  /** Bu seçenekteki iş yeri sayısı (hepsi planlanır). */
  count: number
}

export interface PlanOrgOptions {
  departments: PlanOrgOption[]
  costCenters: PlanOrgOption[]
  /** Seçili bölüm / masraf yerindeki iş yerlerinin adları (sayı taşımaz). */
  workCenters: string[]
}

export const orgFilterActive = (s: PlanOrgSelection) =>
  s.department !== '' || s.costCenters.length > 0 || s.workCenters.length > 0

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
    if (selection.workCenters.length > 0 && !selection.workCenters.includes(press.name)) continue
    names.add(press.name)
  }
  return names
}

/**
 * Seçim kutularının içeriği. Masraf yeri listesi seçili bölüme göre daralır;
 * hiç iş yeri olmayan bölüm / masraf yeri listeye girmez (ölü seçenek olmaz).
 * `count` seçenekteki iş yeri sayısıdır.
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
  const add = (into: Map<string, number>, key: string) => into.set(key, (into.get(key) ?? 0) + 1)

  const byDepartment = new Map<string, number>()
  const byCostCenter = new Map<string, number>()
  const workCenterNames: string[] = []
  for (const press of presses) {
    const code = costCenterOf(press, costCenters)
    const dept = code === UNASSIGNED ? UNASSIGNED : (index.get(code) ?? UNASSIGNED)
    add(byDepartment, dept)
    // Masraf yeri sayıları yalnız seçili bölümün (bölüm seçilmediyse hepsinin).
    const inDepartment = selection.department === '' || selection.department === dept
    if (inDepartment) add(byCostCenter, code)
    // İş yeri listesi seçili bölüm + masraf yerine göre daralır; iş yeri
    // seçiminin kendisi listeyi daraltmaz (yoksa seçtikten sonra ötekiler
    // kaybolur ve seçim geri alınamaz).
    if (inDepartment && (selection.costCenters.length === 0 || selection.costCenters.includes(code))) {
      workCenterNames.push(press.name)
    }
  }

  const option = (counts: Map<string, number>, value: string, label: string): PlanOrgOption => ({
    value,
    label,
    count: counts.get(value) ?? 0,
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

  return {
    departments: departmentOptions,
    costCenters: costCenterOptions,
    workCenters: [...new Set(workCenterNames)].sort((a, b) => a.localeCompare(b)),
  }
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
  const names = new Set(options.workCenters)
  const keptNames = selection.workCenters.filter((name) => names.has(name))
  if (kept.length === selection.costCenters.length && keptNames.length === selection.workCenters.length) {
    return selection
  }
  return { ...selection, costCenters: kept, workCenters: keptNames }
}
