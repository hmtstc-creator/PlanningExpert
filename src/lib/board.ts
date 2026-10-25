/**
 * Board Dashboard (docs/board.md): holding → şirket → plant → bölüm → masraf
 * yeri kapsamında özet sonuçlar ve trendler. Hesap KPI ile aynı (src/lib/kpi.ts):
 * saat ve adetler toplanır, oranlar toplamdan; grup toplamında her şirketin
 * kendi planlarının toplamı kullanılır.
 */
import { KPI_ROWS, kpiFor, slotKey, type KpiEntry, type KpiMetrics, type KpiResult, type KpiSlot, type OeeSum } from './kpi'

export interface BoardPlant {
  plantId: string
  plantName: string
  companyId: string
  companyName: string
  holdingId: string | null
  holdingName: string | null
  /** Plant'in bölümleri, sıralı (plants.departments). */
  departments?: string[]
  /** Bölüm sorumluları (K7), adıyla. */
  departmentOwners?: { department: string; name: string }[]
  costCenters: { code: string; name: string; department?: string }[]
  entries: KpiEntry[]
  oee: (OeeSum & { slot: string })[]
}

/** Seçili kapsam: boş = bütün grup; şirket; plant; bölüm ('' = bölümsüz masraf yerleri). */
export interface BoardScope {
  companyId?: string
  plantId?: string
  department?: string
}

/** Bölümü olmayan masraf yerlerinin düğümü (Organization map'teki gibi). */
export const NO_DEPARTMENT_LABEL = 'Without a department'

export interface BoardNode {
  key: string
  label: string
  /** Tıklanınca inilecek kapsam (masraf yerinde yok). */
  drill: BoardScope | null
  /** Dilim başına sonuç (trend). */
  bySlot: KpiResult[]
  /** Bölüm satırında bölüm sorumlusu (K7). */
  owner?: string
}

/** Bölümün sorumlusunun adı (yoksa undefined). */
export function departmentOwner(p: Pick<BoardPlant, 'departmentOwners'>, department: string | undefined): string | undefined {
  return department ? p.departmentOwners?.find((o) => o.department === department)?.name : undefined
}

/** Seçilebilir ölçüler (yönü belli olanlar). */
export const BOARD_MEASURES = KPI_ROWS.filter((r) => r.higher !== null)

export const measureOf = (key: keyof KpiMetrics) => KPI_ROWS.find((r) => r.key === key)!

/** Başlık kartlarındaki sabit ölçüler (ölçü her dönem aynı). */
export const BOARD_CARDS: (keyof KpiMetrics)[] = ['oee', 'efficiency', 'volume', 'productivity', 'overtimePct', 'absenteeismPct']

type CcFilter = string | ReadonlySet<string>
const keep = (f: CcFilter | undefined, cc: string) => f === undefined || (typeof f === 'string' ? cc === f : f.has(cc))

const tagged = (p: BoardPlant, ccFilter?: CcFilter) => ({
  entries: p.entries.filter((e) => keep(ccFilter, e.costCenter)).map((e) => ({ ...e, costCenter: `${p.plantId}|${e.costCenter}` })),
  oee: p.oee.filter((o) => keep(ccFilter, o.costCenter)).map((o) => ({ ...o, costCenter: `${p.plantId}|${o.costCenter}` })),
})

/** Plantler (isteğe bağlı tek masraf yeri ya da masraf yeri kümesi) için dilim başına sonuç. */
export function seriesFor(plants: BoardPlant[], slots: KpiSlot[], ccFilter?: CcFilter): KpiResult[] {
  const parts = plants.map((p) => tagged(p, ccFilter))
  const entries = parts.flatMap((x) => x.entries)
  const oee = parts.flatMap((x) => x.oee)
  return slots.map((s) => {
    const k = slotKey(s)
    return kpiFor(
      entries.filter((e) => slotKey(e) === k),
      oee.filter((o) => o.slot === k),
    )
  })
}

export function plantsInScope(plants: BoardPlant[], scope: BoardScope): BoardPlant[] {
  return plants.filter((p) => (!scope.companyId || p.companyId === scope.companyId) && (!scope.plantId || p.plantId === scope.plantId))
}

/** Plant bölümlere ayrılmış mı (en az bir masraf yerinin bölümü var). Yoksa plant doğrudan masraf yerlerine iner. */
export const hasDepartments = (p: BoardPlant) => p.costCenters.some((cc) => !!cc.department)

/**
 * Plant'in bölümleri: sıralı liste, sonra listede olmayıp masraf yerinde geçenler,
 * en sonda bölümsüz masraf yeri varsa '' (Without a department). Masraf yeri
 * olmayan bölüm gösterilmez (verisi olamaz).
 */
export function departmentsOf(p: Pick<BoardPlant, 'departments' | 'costCenters'>): string[] {
  const used = new Set(p.costCenters.map((cc) => cc.department ?? ''))
  const order = [...(p.departments ?? []), ...[...used].filter((d) => d && !(p.departments ?? []).includes(d)).sort()]
  return [...order.filter((d) => used.has(d)), ...(used.has('') ? [''] : [])]
}

/** Kapsamdaki bölümün masraf yerleri (bölüm seçili değilse undefined = hepsi). */
function departmentCcs(p: BoardPlant, department: string | undefined): Set<string> | undefined {
  if (department === undefined) return undefined
  return new Set(p.costCenters.filter((cc) => (cc.department ?? '') === department).map((cc) => cc.code))
}

/**
 * Holding'in kendi hedefi girilebilen ölçüler (K7): dönemden bağımsız oranlar.
 * Adet ve saat toplamları dönem uzunluğuna bağlı olduğundan şirket planlarının
 * toplamı kalır.
 */
export const HOLDING_TARGET_KEYS = ['oee', 'efficiency', 'productivity', 'overtimePct', 'absenteeismPct'] as const
export type HoldingTargetKey = (typeof HOLDING_TARGET_KEYS)[number]
/** Holding hedefleri; yüzdeler oran (0.85 = %85). Girilmeyen ölçü yok sayılır. */
export type HoldingTargets = Partial<Record<HoldingTargetKey, number>>

/**
 * Grup kapsamında (şirket seçili değil, bütün plantler tek holding'in) holding
 * hedefi; yoksa null — plan şirket planlarının toplamı kalır.
 */
export function groupTargets(plants: BoardPlant[], scope: BoardScope, targets: Record<string, HoldingTargets> | undefined): HoldingTargets | null {
  if (scope.companyId || !plants.length || !targets) return null
  const holdings = new Set(plants.map((p) => p.holdingId))
  const id = holdings.size === 1 ? [...holdings][0] : null
  const t = id ? targets[id] : undefined
  return t && HOLDING_TARGET_KEYS.some((k) => t[k] !== undefined) ? t : null
}

/** Girilen holding hedefi planın yerine geçer; girilmeyen ölçü şirket planlarının toplamı. */
export function withTargets(series: KpiResult[], targets: HoldingTargets | null): KpiResult[] {
  if (!targets) return series
  return series.map((r) => {
    const plan = { ...r.plan }
    for (const k of HOLDING_TARGET_KEYS) if (targets[k] !== undefined) plan[k] = targets[k]!
    return { ...r, plan }
  })
}

/**
 * Seçili kapsamın toplamı (kartlar): bölüm seçiliyse yalnız onun masraf yerleri.
 * Grup kapsamında holding hedefi girilmişse o ölçünün planı hedeftir.
 */
export function scopeSeries(plants: BoardPlant[], scope: BoardScope, slots: KpiSlot[], targets: HoldingTargets | null = null): KpiResult[] {
  const inScope = plantsInScope(plants, scope)
  if (scope.plantId && scope.department !== undefined && inScope[0]) return seriesFor(inScope, slots, departmentCcs(inScope[0], scope.department))
  return withTargets(seriesFor(inScope, slots), scope.companyId ? null : targets)
}

/**
 * Kapsamın bir alt kırılımı: bütün grup → şirketler, şirket → plantler,
 * plant → bölümler (bölümü yoksa masraf yerleri), bölüm → masraf yerleri.
 */
export function childrenOf(plants: BoardPlant[], scope: BoardScope, slots: KpiSlot[]): BoardNode[] {
  const inScope = plantsInScope(plants, scope)
  if (scope.plantId) {
    const p = inScope[0]
    if (!p) return []
    if (scope.department === undefined && hasDepartments(p)) {
      return departmentsOf(p).map((d) => ({
        key: `${p.plantId}|dept|${d}`,
        label: d || NO_DEPARTMENT_LABEL,
        drill: { companyId: p.companyId, plantId: p.plantId, department: d },
        bySlot: seriesFor([p], slots, departmentCcs(p, d)),
        ...(departmentOwner(p, d) ? { owner: departmentOwner(p, d) } : {}),
      }))
    }
    const ccs = departmentCcs(p, scope.department)
    return p.costCenters
      .filter((cc) => !ccs || ccs.has(cc.code))
      .map((cc) => ({ key: `${p.plantId}|${cc.code}`, label: cc.name, drill: null, bySlot: seriesFor([p], slots, cc.code) }))
  }
  if (scope.companyId) {
    return inScope.map((p) => ({ key: p.plantId, label: p.plantName, drill: { companyId: p.companyId, plantId: p.plantId }, bySlot: seriesFor([p], slots) }))
  }
  const companies = [...new Map(inScope.map((p) => [p.companyId, p.companyName])).entries()]
  return companies.map(([id, name]) => ({ key: id, label: name, drill: { companyId: id }, bySlot: seriesFor(inScope.filter((p) => p.companyId === id), slots) }))
}

/** Gerçekleşen − plan, ölçünün yönüne göre iyi mi (null: karşılaştırılamaz). */
export function verdict(r: KpiResult, key: keyof KpiMetrics): { gap: number | null; good: boolean | null } {
  const a = r.actual[key]
  const p = r.plan[key]
  if (a === null || p === null) return { gap: null, good: null }
  const row = measureOf(key)
  // Gösterimde 0,0'a yuvarlanan fark eşit sayılır (yüzdede 0,05 puan altı).
  const gap = row.unit === '%' && Math.abs(a - p) < 0.0005 ? 0 : a - p
  const higher = row.higher
  if (higher === null || gap === 0) return { gap, good: null }
  return { gap, good: gap > 0 === higher }
}

/** Planın yüzde kaçı kadar sapma (sıralama için; plan 0 ise mutlak fark). */
export function relativeGap(r: KpiResult, key: keyof KpiMetrics): number | null {
  const { gap } = verdict(r, key)
  const p = r.plan[key]
  if (gap === null || p === null) return null
  const higher = measureOf(key).higher
  const signed = higher === false ? -gap : gap
  return p !== 0 ? signed / Math.abs(p) : signed
}

/** Son üç dilimde sürekli kötüleşiyor mu (ölçünün yönüne göre). */
export function declining(series: KpiResult[], current: number, key: keyof KpiMetrics): boolean {
  if (current < 2) return false
  const v = [series[current - 2], series[current - 1], series[current]].map((r) => r.actual[key])
  if (v.some((x) => x === null)) return false
  const [a, b, c] = v as number[]
  const higher = measureOf(key).higher
  return higher ? b < a && c < b : b > a && c > b
}

/**
 * Dikkat listesi: kapsamın en alt seviyesinde (plant ya da masraf yeri; bölüm
 * seçiliyse yalnız onun masraf yerleri) plana
 * en uzak kalanlar ve son üç dilimde kötüleşenler.
 */
export function attention(
  plants: BoardPlant[],
  scope: BoardScope,
  slots: KpiSlot[],
  current: number,
  key: keyof KpiMetrics,
  n = 5,
): { label: string; rel: number | null; declining: boolean; result: KpiResult }[] {
  const inScope = plantsInScope(plants, scope)
  const multiCompany = new Set(inScope.map((p) => p.companyId)).size > 1
  const units = scope.plantId
    ? inScope.flatMap((p) => {
        const ccs = departmentCcs(p, scope.department)
        return p.costCenters.filter((cc) => !ccs || ccs.has(cc.code)).map((cc) => ({ label: cc.name, series: seriesFor([p], slots, cc.code) }))
      })
    : inScope.map((p) => ({ label: multiCompany ? `${p.companyName} · ${p.plantName}` : p.plantName, series: seriesFor([p], slots) }))
  return units
    .map((u) => ({ label: u.label, rel: relativeGap(u.series[current], key), declining: declining(u.series, current, key), result: u.series[current] }))
    .filter((u) => (u.rel !== null && u.rel < 0) || u.declining)
    .sort((a, b) => (a.rel ?? 0) - (b.rel ?? 0))
    .slice(0, n)
}
