/**
 * Losses Trend paretoları (planlamacı, 2026-10-31): seçili haftada duruşların
 * dağılımı. Dört grafik: duruş → makine, (makine seçiliyse) duruş, duruş →
 * alt duruş, alt duruş → makineler. Hesap yeni değil: kayıp dakikası
 * `lossBreakdown` ve `subLosses` ile, pareto sıralaması `pareto` ile yapılır;
 * bu dosya yalnızca bunları makineye ve duruşa göre gruplar.
 *
 * Makine = Work Center (LossDay.workCenter). Speed bir duruş değildir (Production −
 * Operation), paretoda yer almaz.
 */
import { EMPTY_TIMES, SPEED, classifyLossKey, lossBreakdown, subLosses, type LossDay, type OeeConfig } from './oee'
import { pareto, type ParetoBar } from './problemReport'

export interface ParetoView {
  /** En çok `top` çubuk; fazlası tek "Other" çubuğunda toplanır. */
  bars: ParetoBar[]
  /** Toplam dakika (bütün kalemler, Other dahil). */
  total: number
  /** Other çubuğunun anahtarı; yoksa undefined. */
  otherKey?: string
}

/** Girdi: kalem → dakika. Sıralama ve kümülatif yüzde `pareto`dan gelir. */
export function paretoView(items: { key: string; value: number }[], top = 8): ParetoView {
  const all = pareto(items)
  const total = all.reduce((s, b) => s + b.value, 0)
  if (all.length <= top) return { bars: all, total }
  const head = all.slice(0, top)
  const rest = all.slice(top)
  const restValue = rest.reduce((s, b) => s + b.value, 0)
  const otherKey = `Other (${rest.length})`
  const other: ParetoBar = {
    key: otherKey,
    value: restValue,
    share: total > 0 ? (restValue / total) * 100 : 0,
    cumulative: 100,
    vital: false,
  }
  return { bars: [...head, other], total, otherKey }
}

/** Dönemin duruş sütunları (dakika), Speed hariç. */
export function columnMinutes(lossDays: LossDay[], c: OeeConfig): { key: string; value: number }[] {
  const { chart } = lossBreakdown(EMPTY_TIMES, lossDays, c)
  return Object.entries(chart)
    .filter(([key]) => key !== SPEED)
    .map(([key, value]) => ({ key, value }))
}

/** Bir duruş sütununun makinelere dağılımı (dakika). Makine başına gün kayıtlarından. */
export function machineMinutes(lossDays: LossDay[], c: OeeConfig, column: string): { key: string; value: number }[] {
  const byMachine = new Map<string, LossDay[]>()
  for (const d of lossDays) {
    if (!d.workCenter) continue
    const list = byMachine.get(d.workCenter)
    if (list) list.push(d)
    else byMachine.set(d.workCenter, [d])
  }
  return [...byMachine]
    .map(([key, lds]) => ({ key, value: lossBreakdown(EMPTY_TIMES, lds, c).chart[column] ?? 0 }))
    .filter((r) => r.value > 0)
}

/** Bir duruş sütununun alt kayıpları (dakika). */
export function subLossMinutes(lossDays: LossDay[], c: OeeConfig, column: string): { key: string; value: number }[] {
  return [...subLosses(lossDays, c, column)].map(([key, v]) => ({ key, value: v.minutes }))
}

/** Bir alt kaybın makinelere dağılımı (dakika). */
export function subLossMachines(lossDays: LossDay[], c: OeeConfig, column: string, sub: string): { key: string; value: number }[] {
  const byMachine = new Map<string, LossDay[]>()
  for (const d of lossDays) {
    if (!d.workCenter) continue
    const list = byMachine.get(d.workCenter)
    if (list) list.push(d)
    else byMachine.set(d.workCenter, [d])
  }
  return [...byMachine]
    .map(([key, lds]) => ({ key, value: subLosses(lds, c, column).get(sub)?.minutes ?? 0 }))
    .filter((r) => r.value > 0)
}

export interface MaterialRow {
  material: string
  minutes: number
  /** Malzemenin en çok duruş süren sütunu (kayıp grubu). */
  loss: string
  /** O sütunun malzemenin dakikalarındaki payı (0–1). */
  lossShare: number
}

/**
 * En çok duruş süren malzemeler (seçili iş merkezi kapsamında). Parça kırılımı
 * (`LossDay.parts`, anahtar `rc1|rc2|malzeme`) yalnız yeni özetlerde var; eski
 * özetlerde boş döner.
 */
export function topMaterials(lossDays: LossDay[], c: OeeConfig, top = 3): MaterialRow[] {
  const byMaterial = new Map<string, { minutes: number; columns: Map<string, number> }>()
  for (const d of lossDays) {
    for (const [key, [m]] of Object.entries(d.parts ?? {})) {
      const cls = classifyLossKey(key, c)
      if (!cls || !cls.rest) continue
      const row = byMaterial.get(cls.rest) ?? { minutes: 0, columns: new Map<string, number>() }
      row.minutes += m
      row.columns.set(cls.column, (row.columns.get(cls.column) ?? 0) + m)
      byMaterial.set(cls.rest, row)
    }
  }
  return [...byMaterial]
    .map(([material, r]) => {
      const [loss, lossMin] = [...r.columns].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
      return { material, minutes: r.minutes, loss, lossShare: r.minutes > 0 ? lossMin / r.minutes : 0 }
    })
    .sort((a, b) => b.minutes - a.minutes || a.material.localeCompare(b.material))
    .slice(0, top)
}
