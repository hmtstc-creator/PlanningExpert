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
  platformRole?: PlatformRole
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
}

export const isPlatform = (u: UserLike) => u.platformRole === 'owner' || u.platformRole === 'general'

/** Kullanıcı bu fabrikayı görebilir mi (herhangi bir modülde)? */
export function canSeePlant(u: UserLike, plant: PlantLike, company: CompanyLike, groups: GroupLike[]): boolean {
  return MODULES.some((m) => accessFor(u, plant, company, groups)[m] !== 'none')
}

/**
 * Kullanıcının bir fabrikadaki modül izinleri.
 * - Platform: her modül düzenler.
 * - Başka şirketin fabrikası: hiçbir şey.
 * - Creator: şirketin bütün fabrikalarında düzenler.
 * - Diğerleri: üyesi olduğu grupların bu fabrikayı kapsayanlarının en genişi.
 * - Kapalı modül (şirket ya da fabrika): yok.
 * - Askıdaki şirket: en çok "görür" (salt okunur).
 */
export function accessFor(u: UserLike, plant: PlantLike, company: CompanyLike, groups: GroupLike[]): Access {
  if (isPlatform(u)) return { ...FULL_ACCESS }
  if (!u.companyId || u.companyId !== plant.companyId || company._id !== plant.companyId) return { ...NO_ACCESS }
  const out: Access = { ...NO_ACCESS }
  if (u.isCreator) Object.assign(out, FULL_ACCESS)
  else {
    const mine = new Set(u.groupIds ?? [])
    for (const g of groups) {
      if (!mine.has(g._id) || g.companyId !== plant.companyId) continue
      if (!g.allPlants && !g.plantIds.includes(plant._id)) continue
      for (const m of MODULES) out[m] = maxLevel(out[m], g.permissions[m] ?? 'none')
    }
  }
  for (const m of MODULES) {
    if (!company.modules.includes(m) || (plant.disabledModules ?? []).includes(m)) out[m] = 'none'
    else if (company.status !== 'active' && out[m] === 'edit') out[m] = 'view'
  }
  return out
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
