/**
 * Organizasyon ağacı: Holding → Company → Plant → Department → Cost center →
 * Work center (docs/board.md → Organizasyon ağacı). Tepeden aşağı kurulur: şirket bir
 * holding'in, masraf yeri bir bölümün altında açılır.
 *
 * Saf fonksiyonlar: Companies and plants sayfası ağacı, uyarıları ve
 * "kim bu fabrikayı görüyor" tablosunu buradan alır.
 */

import { MODULES, accessFor, type Access, type CompanyStatus, type GroupLike, type Level, type Module } from './tenancy'

export interface OrgCostCenter {
  code: string
  name: string
  department?: string
}

export interface OrgWorkCenter {
  name: string
  /** Bağlı masraf yeri kodu (Work Center Definitions'ta seçilir). */
  costCenter?: string
}

export interface OrgPlant {
  _id: string
  companyId: string
  name: string
  country?: string
  timeZone?: string
  disabledModules?: string[]
  departments?: string[]
  costCenters?: OrgCostCenter[]
  workCenters?: OrgWorkCenter[]
}

export interface OrgCompany {
  _id: string
  name: string
  status: CompanyStatus
  modules: string[]
  holdingId?: string
  plants: OrgPlant[]
}

export interface OrgHolding {
  _id: string
  name: string
}

export interface OrgUser {
  _id: string
  name: string
  active: boolean
  isCreator: boolean
  groupIds: string[]
}

export interface OrgGroup extends GroupLike {
  name: string
}

/** Ağaçta seçili düğüm. `department: null` → bölümü olmayan (eski) masraf yerleri. */
export type OrgNode =
  | { kind: 'holding'; id: string }
  | { kind: 'company'; id: string }
  | { kind: 'plant'; id: string }
  | { kind: 'department'; plantId: string; department: string | null }

export const sameNode = (a: OrgNode | null, b: OrgNode | null) => JSON.stringify(a) === JSON.stringify(b)

/** Bölümler sırasıyla, her birinin masraf yerleriyle. */
export function departmentsOf(plant: OrgPlant): { name: string; costCenters: OrgCostCenter[] }[] {
  const ccs = plant.costCenters ?? []
  return (plant.departments ?? []).map((name) => ({ name, costCenters: ccs.filter((c) => c.department === name) }))
}

/** Bölüme bağlı olmayan masraf yerleri (bölümden önceki kayıtlar ya da silinmiş bölüm adı). */
export function unassignedOf(plant: OrgPlant): OrgCostCenter[] {
  const names = new Set(plant.departments ?? [])
  return (plant.costCenters ?? []).filter((c) => !c.department || !names.has(c.department))
}

/** Masraf yerine bağlı work center'lar. */
export function workCentersOf(plant: OrgPlant, costCenter: string): OrgWorkCenter[] {
  return (plant.workCenters ?? []).filter((w) => w.costCenter === costCenter)
}

/** Masraf yeri olmayan ya da fabrikada olmayan bir koda bağlı work center'lar. */
export function unlinkedWorkCenters(plant: OrgPlant): OrgWorkCenter[] {
  const codes = new Set((plant.costCenters ?? []).map((c) => c.code))
  return (plant.workCenters ?? []).filter((w) => !w.costCenter || !codes.has(w.costCenter))
}

/** Holding'in şirketleri (ad sırasıyla). */
export function companiesOf(holdingId: string, companies: OrgCompany[]): OrgCompany[] {
  return companies.filter((c) => c.holdingId === holdingId).sort((a, b) => a.name.localeCompare(b.name))
}

/** Holding'e bağlı olmayan şirketler (holding zorunlu olmadan önce açılanlar). */
export function orphanCompanies(holdings: OrgHolding[], companies: OrgCompany[]): OrgCompany[] {
  const ids = new Set(holdings.map((h) => h._id))
  return companies.filter((c) => !c.holdingId || !ids.has(c.holdingId))
}

export interface OrgCounts {
  companies: number
  plants: number
  departments: number
  costCenters: number
  workCenters: number
}

export function countsOf(companies: OrgCompany[]): OrgCounts {
  const plants = companies.flatMap((c) => c.plants)
  return {
    companies: companies.length,
    plants: plants.length,
    departments: plants.reduce((n, p) => n + (p.departments?.length ?? 0), 0),
    costCenters: plants.reduce((n, p) => n + (p.costCenters?.length ?? 0), 0),
    workCenters: plants.reduce((n, p) => n + (p.workCenters?.length ?? 0), 0),
  }
}

export interface OrgIssue {
  text: string
  node: OrgNode
}

/**
 * Ağaçtaki eksikler, tepeden aşağı: holding'siz şirket, şirketsiz holding,
 * aynı adlı iki plant, bölümsüz plant, masraf yeri olmayan bölüm, bölümsüz
 * masraf yeri, masraf yerine bağlı olmayan work center.
 */
export function structureIssues(holdings: OrgHolding[], companies: OrgCompany[]): OrgIssue[] {
  const out: OrgIssue[] = []
  for (const c of orphanCompanies(holdings, companies)) out.push({ text: `${c.name} has no holding — link it to one`, node: { kind: 'company', id: c._id } })
  for (const h of holdings) {
    if (!companiesOf(h._id, companies).length) out.push({ text: `${h.name} has no company yet`, node: { kind: 'holding', id: h._id } })
  }
  for (const c of companies) {
    const seen = new Map<string, number>()
    for (const p of c.plants) {
      const k = p.name.trim().toLowerCase()
      seen.set(k, (seen.get(k) ?? 0) + 1)
      if (seen.get(k) === 2) out.push({ text: `${c.name}: two plants are named ${p.name} — merge or rename one`, node: { kind: 'company', id: c._id } })
    }
    for (const p of c.plants) {
      if (!(p.departments ?? []).length) out.push({ text: `${c.name} › ${p.name}: no department yet`, node: { kind: 'plant', id: p._id } })
      for (const d of departmentsOf(p)) {
        if (!d.costCenters.length) out.push({ text: `${c.name} › ${p.name} › ${d.name}: no cost center yet`, node: { kind: 'department', plantId: p._id, department: d.name } })
      }
      const loose = unassignedOf(p)
      if (loose.length) {
        out.push({
          text: `${c.name} › ${p.name}: ${loose.length} cost center${loose.length === 1 ? '' : 's'} without a department`,
          node: { kind: 'department', plantId: p._id, department: null },
        })
      }
      const wc = unlinkedWorkCenters(p)
      if (wc.length) {
        out.push({
          text: `${c.name} › ${p.name}: ${wc.length} work center${wc.length === 1 ? '' : 's'} without a cost center (${wc.map((w) => w.name).join(', ')})`,
          node: { kind: 'plant', id: p._id },
        })
      }
    }
  }
  return out
}

/** Plant'in yeni bölüm / masraf yeri listesi (sunucuya tek parça gider). */
export interface PlantStructure {
  departments: string[]
  costCenters: OrgCostCenter[]
}

const structureOf = (p: OrgPlant): PlantStructure => ({ departments: [...(p.departments ?? [])], costCenters: [...(p.costCenters ?? [])] })

export function addDepartment(p: OrgPlant, name: string): PlantStructure {
  const s = structureOf(p)
  return { ...s, departments: [...s.departments, name.trim()] }
}

/** Bölümün adı değişir; masraf yerleri yeni adla gelir. */
export function renameDepartment(p: OrgPlant, from: string, to: string): PlantStructure {
  const s = structureOf(p)
  const n = to.trim()
  return {
    departments: s.departments.map((d) => (d === from ? n : d)),
    costCenters: s.costCenters.map((c) => (c.department === from ? { ...c, department: n } : c)),
  }
}

/** Yalnızca boş bölüm kaldırılır (sunucu da denetler). */
export function removeDepartment(p: OrgPlant, name: string): PlantStructure {
  const s = structureOf(p)
  return { ...s, departments: s.departments.filter((d) => d !== name) }
}

export function addCostCenter(p: OrgPlant, cc: OrgCostCenter): PlantStructure {
  const s = structureOf(p)
  return { ...s, costCenters: [...s.costCenters, { code: cc.code.trim(), name: cc.name.trim() || cc.code.trim(), department: cc.department }] }
}

/** Masraf yerinin adı ya da bölümü değişir (kod sabit: veriler kodla bağlı). */
export function editCostCenter(p: OrgPlant, code: string, patch: Partial<Omit<OrgCostCenter, 'code'>>): PlantStructure {
  const s = structureOf(p)
  return { ...s, costCenters: s.costCenters.map((c) => (c.code === code ? { ...c, ...patch } : c)) }
}

export function removeCostCenter(p: OrgPlant, code: string): PlantStructure {
  const s = structureOf(p)
  return { ...s, costCenters: s.costCenters.filter((c) => c.code !== code) }
}

export interface PlantAccessRow {
  user: OrgUser
  /** Yetkinin kaynağı: "Creator" ya da bu plant'i kapsayan grupların adları. */
  via: string[]
  access: Access
}

/**
 * Plant'i gören şirket kullanıcıları ve modül izinleri — yetkinin tek
 * kuralı `accessFor` (tenancy.ts). Önce creator'lar, sonra ada göre.
 */
export function plantAccessRows(plant: OrgPlant, company: OrgCompany, users: OrgUser[], groups: OrgGroup[]): PlantAccessRow[] {
  const rows: PlantAccessRow[] = []
  for (const u of users) {
    const access = accessFor({ _id: u._id, companyId: company._id, isCreator: u.isCreator, groupIds: u.groupIds }, plant, company, groups)
    if (!MODULES.some((m) => access[m] !== 'none')) continue
    const via = u.isCreator
      ? ['Creator']
      : groups.filter((g) => u.groupIds.includes(g._id) && (g.allPlants || g.plantIds.includes(plant._id))).map((g) => g.name)
    rows.push({ user: u, via, access })
  }
  return rows.sort((a, b) => Number(b.user.isCreator) - Number(a.user.isCreator) || a.user.name.localeCompare(b.user.name))
}

/** Matris hücresi: kullanıcının bu plant'te gördüğü modüller (kısa). */
export function accessSummary(access: Access): { module: Module; level: Level }[] {
  return MODULES.filter((m) => access[m] !== 'none').map((m) => ({ module: m, level: access[m] }))
}
