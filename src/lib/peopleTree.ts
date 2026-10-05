// Users & permissions sayfasının saf yardımcıları: ağaç (şirket → gruplar →
// kullanıcılar), grup izin taslağı ve etkin izin matrisi. Kural tek yerde:
// src/lib/tenancy.ts (sunucu da onu kullanır).

import {
  AREAS,
  MODULES,
  areaAccessFor,
  groupAreaLevel,
  type AreaAccess,
  type AreaKey,
  type CompanyLike,
  type GroupLike,
  type Level,
  type Module,
  type PlantLike,
} from './tenancy'

export interface PeopleUser {
  _id: string
  name: string
  email?: string
  active: boolean
  isCreator: boolean
  groupIds: string[]
  hasPassword?: boolean
  mustChangePassword?: boolean
  /** Son başarılı giriş (ms); hiç girmediyse null. */
  lastLoginAt?: number | null
  /** Hatalı parola kilidi sürüyor. */
  locked?: boolean
  platformRole?: string | null
}

export interface PeopleGroup {
  _id: string
  name: string
  allPlants: boolean
  plantIds: string[]
  permissions: Partial<Record<Module, Level>>
  areas?: Partial<Record<string, Level | string>>
  board?: boolean
}

export type PeopleNode =
  | { kind: 'company' }
  | { kind: 'creators' }
  | { kind: 'noGroup' }
  | { kind: 'group'; id: string }
  | { kind: 'newGroup' }
  | { kind: 'user'; id: string; via?: string }
  | { kind: 'newUser' }

export const samePeopleNode = (a: PeopleNode | null, b: PeopleNode | null) => JSON.stringify(a) === JSON.stringify(b)

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

/** Ağaç: creator'lar, gruplar (üyeleriyle), grubu olmayanlar. */
export function peopleTree(users: PeopleUser[], groups: PeopleGroup[]) {
  const company = users.filter((u) => !u.platformRole)
  const creators = company.filter((u) => u.isCreator).sort(byName)
  const ids = new Set(groups.map((g) => g._id))
  return {
    creators,
    groups: [...groups].sort(byName).map((g) => ({ group: g, members: company.filter((u) => !u.isCreator && u.groupIds.includes(g._id)).sort(byName) })),
    // Creator olmayan ve geçerli bir grubu olmayan: hiçbir şey göremez.
    noGroup: company.filter((u) => !u.isCreator && !u.groupIds.some((id) => ids.has(id))).sort(byName),
  }
}

/** Grup düzenleme taslağı: modül varsayılanı ve alan seviyeleri ('' = modülünki). */
export interface GroupDraft {
  name: string
  board: boolean
  allPlants: boolean
  plantIds: string[]
  modules: Record<Module, Level>
  areas: Record<AreaKey, Level | ''>
}

export function groupDraft(g?: PeopleGroup): GroupDraft {
  const modules = Object.fromEntries(MODULES.map((m) => [m, (g?.permissions[m] as Level) ?? 'none'])) as Record<Module, Level>
  const areas = Object.fromEntries(
    AREAS.map((a) => {
      const own = g?.areas?.[a.key]
      return [a.key, own === 'none' || own === 'view' || own === 'edit' ? (own === modules[a.module] ? '' : own) : '']
    }),
  ) as Record<AreaKey, Level | ''>
  return { name: g?.name ?? '', board: g?.board === true, allPlants: g?.allPlants ?? true, plantIds: g?.plantIds ?? [], modules, areas }
}

/** Taslağın sunucuya gidecek hâli (users.saveGroup). */
export function groupPayload(d: GroupDraft) {
  const areas: Record<string, Level> = {}
  for (const a of AREAS) {
    const v = d.areas[a.key]
    if (v && v !== d.modules[a.module]) areas[a.key] = v
  }
  return { name: d.name.trim(), board: d.board, allPlants: d.allPlants, plantIds: d.allPlants ? [] : d.plantIds, permissions: d.modules, areas }
}

/** Taslaktaki bir alanın etkin seviyesi. */
export const draftAreaLevel = (d: GroupDraft, key: AreaKey): Level => {
  const a = AREAS.find((x) => x.key === key)!
  return d.areas[key] || d.modules[a.module]
}

/** Grubun her alandaki seviyesi (matris satırı). */
export function groupRow(g: PeopleGroup): AreaAccess {
  return Object.fromEntries(AREAS.map((a) => [a.key, groupAreaLevel({ permissions: g.permissions, areas: g.areas }, a.key)])) as AreaAccess
}

/** Kullanıcının bir plant'teki etkin alan izinleri (gruplar + creator + şirket modülleri). */
export function userAreas(u: PeopleUser, companyId: string, plant: PlantLike, company: CompanyLike, groups: PeopleGroup[]): AreaAccess {
  const gl: GroupLike[] = groups.map((g) => ({ ...g, companyId }))
  return areaAccessFor({ _id: u._id, companyId, isCreator: u.isCreator, groupIds: u.groupIds }, plant, company, gl)
}
