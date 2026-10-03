/**
 * Board Dashboard (docs/board.md): holding → şirket → plant → masraf yeri
 * kapsamında özet sonuçlar ve trendler. Hesap KPI ile aynı (src/lib/kpi.ts):
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
  costCenters: { code: string; name: string }[]
  entries: KpiEntry[]
  oee: (OeeSum & { slot: string })[]
}

/** Seçili kapsam: boş = bütün grup; şirket; plant. */
export interface BoardScope {
  companyId?: string
  plantId?: string
}

export interface BoardNode {
  key: string
  label: string
  /** Tıklanınca inilecek kapsam (masraf yerinde yok). */
  drill: BoardScope | null
  /** Dilim başına sonuç (trend). */
  bySlot: KpiResult[]
}

/** Seçilebilir ölçüler (yönü belli olanlar). */
export const BOARD_MEASURES = KPI_ROWS.filter((r) => r.higher !== null)

export const measureOf = (key: keyof KpiMetrics) => KPI_ROWS.find((r) => r.key === key)!

/** Başlık kartlarındaki sabit ölçüler (ölçü her dönem aynı). */
export const BOARD_CARDS: (keyof KpiMetrics)[] = ['oee', 'efficiency', 'volume', 'productivity', 'overtimePct', 'absenteeismPct']

const tagged = (p: BoardPlant, ccFilter?: string) => ({
  entries: p.entries.filter((e) => !ccFilter || e.costCenter === ccFilter).map((e) => ({ ...e, costCenter: `${p.plantId}|${e.costCenter}` })),
  oee: p.oee.filter((o) => !ccFilter || o.costCenter === ccFilter).map((o) => ({ ...o, costCenter: `${p.plantId}|${o.costCenter}` })),
})

/** Plantler (isteğe bağlı tek masraf yeri) için dilim başına sonuç. */
export function seriesFor(plants: BoardPlant[], slots: KpiSlot[], ccFilter?: string): KpiResult[] {
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

/**
 * Kapsamın bir alt kırılımı: bütün grup → şirketler, şirket → plantler,
 * plant → masraf yerleri.
 */
export function childrenOf(plants: BoardPlant[], scope: BoardScope, slots: KpiSlot[]): BoardNode[] {
  const inScope = plantsInScope(plants, scope)
  if (scope.plantId) {
    const p = inScope[0]
    if (!p) return []
    return p.costCenters.map((cc) => ({ key: `${p.plantId}|${cc.code}`, label: cc.name, drill: null, bySlot: seriesFor([p], slots, cc.code) }))
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
 * Dikkat listesi: kapsamın en alt seviyesinde (plant ya da masraf yeri) plana
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
    ? inScope.flatMap((p) => p.costCenters.map((cc) => ({ label: cc.name, series: seriesFor([p], slots, cc.code) })))
    : inScope.map((p) => ({ label: multiCompany ? `${p.companyName} · ${p.plantName}` : p.plantName, series: seriesFor([p], slots) }))
  return units
    .map((u) => ({ label: u.label, rel: relativeGap(u.series[current], key), declining: declining(u.series, current, key), result: u.series[current] }))
    .filter((u) => (u.rel !== null && u.rel < 0) || u.declining)
    .sort((a, b) => (a.rel ?? 0) - (b.rel ?? 0))
    .slice(0, n)
}
