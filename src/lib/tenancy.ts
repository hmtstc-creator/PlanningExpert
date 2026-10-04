/**
 * Çok şirket / çok fabrika — yetki kuralları (docs/plant-genisletme.md, v3).
 *
 * Veritabanından bağımsız: sunucu (convex/guarded.ts) ve ekran aynı kuralı
 * kullanır. Seviyeler:
 *
 *   Platform — site sahibi (owner) ve generaller: bütün şirketler, her şey.
 *   Şirket   — creator(lar): şirketin bütün fabrikaları, bütün modüllerde düzenler.
 *   Fabrika  — kullanıcı grupları: grubun fabrikaları × modül izinleri.
 *
 * Modül şirkette ya da fabrikada kapalıysa şirket kullanıcıları göremez;
 * platform (owner, general) her zaman görür ve düzenler.
 */

export const MODULES = ['planning', 'oee', 'die', 'machine', 'kpi'] as const
export type Module = (typeof MODULES)[number]

export const MODULE_LABELS: Record<Module, string> = {
  planning: 'PlanningExpert',
  oee: 'OEE',
  die: 'Die Follow-up',
  machine: 'Machine Follow-up',
  kpi: 'KPI',
}

export const LEVELS = ['none', 'view', 'edit'] as const
export type Level = (typeof LEVELS)[number]

export type Access = Record<Module, Level>

export type PlatformRole = 'owner' | 'general'
export type CompanyStatus = 'active' | 'suspended'

/**
 * Yetki alanları: modülün içindeki iş alanları. Grup her modüle bir
 * varsayılan seviye verir; bir alanı ayrıca daraltabilir ya da genişletebilir
 * (ör. PlanningExpert'i görür, yalnızca Work calendar'ı düzenler). Alanlar
 * program kuralıdır — her biri sunucudaki belli yazma işlevlerini kapsar
 * (convex/*.ts, `areas:`); ekranda yalnızca adları görünür.
 */
export const AREAS = [
  { key: 'planning.plan', module: 'planning', label: 'Plan & rules', hint: 'Pin, exclude or move jobs; approve the plan; work center start times; recalculate' },
  { key: 'planning.masterData', module: 'planning', label: 'Master data', hint: 'Parts, work centers, categories, storage locations, crane groups' },
  { key: 'planning.calendar', module: 'planning', label: 'Work calendar', hint: 'Shift patterns, exception weeks, overtime, planned stops, holidays, plan settings' },
  { key: 'planning.sapData', module: 'planning', label: 'SAP data', hint: 'Upload ZPP, ZPP_DAILY, MB52, MB51 and in-transit lists' },
  { key: 'oee.data', module: 'oee', label: 'OEE data', hint: 'Upload the OEE sheets' },
  { key: 'oee.settings', module: 'oee', label: 'OEE settings', hint: 'Departments, shifts, loss groups, setups' },
  { key: 'die.problems', module: 'die', label: 'Die problems', hint: 'Report, solve and reopen die problems' },
  { key: 'die.maintenance', module: 'die', label: 'Die maintenance', hint: 'Maintenance days, ready flag, shot-limit alarms' },
  { key: 'machine.breakdowns', module: 'machine', label: 'Breakdowns', hint: 'Report, solve and reopen machine breakdowns' },
  { key: 'machine.maintenance', module: 'machine', label: 'Machine maintenance', hint: 'Planned work center maintenance' },
  { key: 'kpi.entry', module: 'kpi', label: 'KPI entry', hint: 'Monthly and weekly plan and actual values' },
] as const satisfies readonly { key: string; module: Module; label: string; hint: string }[]

export type AreaKey = (typeof AREAS)[number]['key']
export type AreaAccess = Record<AreaKey, Level>
export const AREA_KEYS: readonly AreaKey[] = AREAS.map((a) => a.key)

export const areasOf = (m: Module) => AREAS.filter((a) => a.module === m)
export const areaInfo = (key: string) => AREAS.find((a) => a.key === key)

const allAreas = (level: Level): AreaAccess => Object.fromEntries(AREA_KEYS.map((k) => [k, level])) as AreaAccess
export const NO_AREAS: AreaAccess = allAreas('none')

export const NO_ACCESS: Access = { planning: 'none', oee: 'none', die: 'none', machine: 'none', kpi: 'none' }
export const FULL_ACCESS: Access = { planning: 'edit', oee: 'edit', die: 'edit', machine: 'edit', kpi: 'edit' }

const RANK: Record<Level, number> = { none: 0, view: 1, edit: 2 }

export function maxLevel(a: Level, b: Level): Level {
  return RANK[a] >= RANK[b] ? a : b
}

export function atLeast(have: Level, need: Level): boolean {
  return RANK[have] >= RANK[need]
}

export interface UserLike {
  _id: string
  companyId?: string
  /** Holding board üyesi: holding'e bağlı şirketlerin plantlerini özet olarak görür. */
  holdingId?: string
  /** 'owner' | 'general' (kayıtta metin). */
  platformRole?: PlatformRole | string
  isCreator?: boolean
  groupIds?: string[]
}

export interface PlantLike {
  _id: string
  companyId: string
  /** Fabrikada kapatılan modüller (şirkette açık olsa da). */
  disabledModules?: string[]
}

export interface CompanyLike {
  _id: string
  /** Şirketin bağlı olduğu holding (grup); General bağlar. */
  holdingId?: string
  status: CompanyStatus
  /** Şirket için açık modüller (kiralama paketi). */
  modules: string[]
}

export interface GroupLike {
  _id: string
  companyId: string
  allPlants: boolean
  plantIds: string[]
  permissions: Partial<Record<Module, Level>>
  /**
   * Alan bazında seviye (AREAS); yazılmayan alan modülün seviyesini alır.
   * Ör. { 'planning.calendar': 'edit' } — PlanningExpert'i görür, takvimi düzenler.
   */
  areas?: Partial<Record<string, Level | string>>
  /** Board grubu: üyeleri programı özet (board) görünümünde kullanır. */
  board?: boolean
}

const asLevel = (v: unknown): Level | undefined => (v === 'none' || v === 'view' || v === 'edit' ? v : undefined)

/** Grubun bir alandaki seviyesi: alana yazılan, yoksa modülünkü. */
export function groupAreaLevel(g: Pick<GroupLike, 'permissions' | 'areas'>, key: AreaKey): Level {
  const area = areaInfo(key)!
  return asLevel(g.areas?.[key]) ?? asLevel(g.permissions[area.module]) ?? 'none'
}

/** Board görünümünde açık modüller: yalnızca sonuçlar (KPI ve OEE), salt okunur. */
export const BOARD_MODULES: readonly Module[] = ['kpi', 'oee']

/**
 * Board görünümü: holding board üyesi ya da yalnızca board gruplarına üye
 * şirket kullanıcısı. Menüde Board Dashboard ve KPI / OEE dashboard'ları.
 */
export function isBoardUser(u: UserLike, groups: GroupLike[]): boolean {
  if (isPlatform(u) || u.isCreator) return false
  if (u.holdingId && !u.companyId) return true
  const mine = groups.filter((g) => (u.groupIds ?? []).includes(g._id))
  return mine.length > 0 && mine.every((g) => g.board === true)
}

export const isPlatform = (u: UserLike) => u.platformRole === 'owner' || u.platformRole === 'general'

/** Kullanıcı bu fabrikayı görebilir mi (herhangi bir modülde)? */
export function canSeePlant(u: UserLike, plant: PlantLike, company: CompanyLike, groups: GroupLike[]): boolean {
  return MODULES.some((m) => accessFor(u, plant, company, groups)[m] !== 'none')
}

/**
 * Kullanıcının bir fabrikadaki alan izinleri.
 * - Platform: her alan düzenler.
 * - Başka şirketin fabrikası: hiçbir şey.
 * - Creator: şirketin bütün fabrikalarında düzenler.
 * - Diğerleri: üyesi olduğu grupların bu fabrikayı kapsayanlarının en genişi
 *   (grubun alan seviyesi, yoksa modül seviyesi).
 * - Kapalı modül (şirket ya da fabrika): yok.
 * - Askıdaki şirket: en çok "görür" (salt okunur).
 */
export function areaAccessFor(u: UserLike, plant: PlantLike, company: CompanyLike, groups: GroupLike[]): AreaAccess {
  if (isPlatform(u)) return allAreas('edit')
  const out: AreaAccess = { ...NO_AREAS }
  // Holding board üyesi: holding'in şirketlerinde yalnızca KPI ve OEE, salt okunur.
  if (u.holdingId && !u.companyId) {
    if (!company.holdingId || company.holdingId !== u.holdingId || company._id !== plant.companyId) return out
    for (const a of AREAS) {
      if (BOARD_MODULES.includes(a.module) && company.modules.includes(a.module) && !(plant.disabledModules ?? []).includes(a.module)) out[a.key] = 'view'
    }
    return out
  }
  if (!u.companyId || u.companyId !== plant.companyId || company._id !== plant.companyId) return out
  if (u.isCreator) Object.assign(out, allAreas('edit'))
  else {
    const mine = new Set(u.groupIds ?? [])
    for (const g of groups) {
      if (!mine.has(g._id) || g.companyId !== plant.companyId) continue
      if (!g.allPlants && !g.plantIds.includes(plant._id)) continue
      for (const k of AREA_KEYS) out[k] = maxLevel(out[k], groupAreaLevel(g, k))
    }
  }
  for (const a of AREAS) {
    if (!company.modules.includes(a.module) || (plant.disabledModules ?? []).includes(a.module)) out[a.key] = 'none'
    else if (company.status !== 'active' && out[a.key] === 'edit') out[a.key] = 'view'
  }
  return out
}

/** Alan izinlerinden modül izni: modülün alanlarının en genişi (sayfaları açar). */
export function moduleAccessOf(areas: AreaAccess): Access {
  const out: Access = { ...NO_ACCESS }
  for (const a of AREAS) out[a.module] = maxLevel(out[a.module], areas[a.key])
  return out
}

/** Kullanıcının bir fabrikadaki modül izinleri (alan izinlerinin özeti). */
export function accessFor(u: UserLike, plant: PlantLike, company: CompanyLike, groups: GroupLike[]): Access {
  return moduleAccessOf(areaAccessFor(u, plant, company, groups))
}

/** İşlevin alanlarından biri yeterli. */
export function allowsAreas(areas: AreaAccess, keys: readonly AreaKey[], need: Level): boolean {
  return keys.some((k) => atLeast(areas[k] ?? 'none', need))
}

/** İşlevin modüllerinden biri yeterli: okumada "görür", yazmada "düzenler". */
export function allows(access: Access, modules: readonly Module[], need: Level): boolean {
  return modules.some((m) => atLeast(access[m], need))
}

/** Şirket kullanıcılarını ve gruplarını yönetebilir mi? */
export function canManageCompany(u: UserLike, companyId: string): boolean {
  return isPlatform(u) || (u.isCreator === true && u.companyId === companyId)
}

/**
 * Eski tek fabrikalı rollerin karşılığı (geçiş): admin → creator; diğer
 * roller aynı adlı gruba. Bugünkü davranış korunur: planner ve maintenance
 * her yere yazabiliyordu, viewer yalnızca okuyordu.
 */
export const LEGACY_ROLE_GROUPS: { role: string; name: string; level: Level }[] = [
  { role: 'planner', name: 'Planners', level: 'edit' },
  { role: 'maintenance', name: 'Maintenance', level: 'edit' },
  { role: 'viewer', name: 'Viewers', level: 'view' },
]

export function uniformPermissions(level: Level): Record<Module, Level> {
  return { planning: level, oee: level, die: level, machine: level, kpi: level }
}
