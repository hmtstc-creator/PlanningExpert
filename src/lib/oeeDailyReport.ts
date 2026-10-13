/**
 * OEE Daily Report (planlamacı, 2026-10-13): tek sayfada her iş yeri için
 * OEE, en büyük 3 kayıp (yanında malzemeleri) ve hız kaybı. Hesap Loss
 * Bridge'inkiyle aynı (buildBridge, level3); burada iş yeri başına çalışır.
 */
import type { OeeConfig } from './oee'
import { buildBridge, level3, type Level3Set, type LossItem } from './oeeBridge'

export interface ReportPart {
  label: string
  /** İş yeri (yalnızca toplam satırında). */
  sub?: string
  minutes: number
}

export interface ReportLoss {
  key: string
  label: string
  family: LossItem['family']
  minutes: number
  /** Loading time'a oranı (0–1). */
  share: number
  count: number
  /** En çok kayıp veren malzemeler (MATERIAL / Material - Key). */
  parts: ReportPart[]
}

export interface ReportRow {
  workCenter: string
  costCenter: string
  loadingMin: number
  oee: number | null
  availability: number | null
  performance: number | null
  quality: number | null
  /** En büyük kayıplar (hız kaybı hariç, o ayrı sütunda). */
  losses: ReportLoss[]
  speed: ReportLoss | null
}

const SPEED = 'pf:speed'
const EMPTY: Level3Set = { days: [], lossDays: [], orders: [] }

function lossOf(item: LossItem, set: Level3Set, c: OeeConfig, topParts: number, workCenter: string): ReportLoss {
  // Tek iş yerinde makine alt başlığı gereksiz; toplam satırında kalır.
  const parts = level3(item, 'part', c, set, EMPTY)
    .filter((r) => r.minutes > 0.05)
    .slice(0, topParts)
    .map((r) => ({ label: r.label, minutes: r.minutes, ...(r.sub && r.sub !== workCenter && { sub: r.sub }) }))
  return { key: item.key, label: item.label, family: item.family, minutes: item.minutes, share: item.share, count: item.count, parts }
}

/** Bir veri kümesinin raporu: kayıp kalemleri köprüdeki gibi, malzemeleri parça kırılımından. */
export function reportRow(workCenter: string, costCenter: string, set: Level3Set, c: OeeConfig, topLosses = 3, topParts = 3): ReportRow {
  const b = buildBridge(set.days, set.lossDays, c)
  // Öncelik olabilecek kayıplar (açıklanmayan fark, planlı duruş ve kazanç değil).
  const ranked = b.items.filter((i) => i.rankable && i.key !== SPEED && i.minutes > 0.05).sort((x, y) => y.minutes - x.minutes)
  const speed = b.items.find((i) => i.key === SPEED)
  return {
    workCenter,
    costCenter,
    loadingMin: b.baseMinutes,
    oee: b.oee,
    availability: b.availability,
    performance: b.performance,
    quality: b.quality,
    losses: ranked.slice(0, topLosses).map((i) => lossOf(i, set, c, topParts, workCenter)),
    speed: speed && speed.minutes > 0.05 ? lossOf(speed, set, c, topParts, workCenter) : null,
  }
}

/**
 * İş yeri başına satırlar (adına göre) ve seçimin toplamı. `set` kapsama
 * süzülmüş, vardiyası olan gün × makineyle eşleşmiş veridir (köprüdeki gibi).
 */
export function dailyReport(set: Level3Set, c: OeeConfig, topLosses = 3, topParts = 3): { rows: ReportRow[]; total: ReportRow } {
  const centers = [...new Set(set.days.filter((d) => d.loadingMin > 0).map((d) => d.workCenter))].sort()
  const rows = centers.map((wc) => {
    const only = <T extends { workCenter: string }>(xs: T[]) => xs.filter((x) => x.workCenter === wc)
    const days = only(set.days)
    return reportRow(
      wc,
      days[0]?.costCenter ?? '',
      { days, lossDays: only(set.lossDays), orders: only(set.orders), events: set.events && only(set.events) },
      c,
      topLosses,
      topParts,
    )
  })
  return { rows, total: reportRow('Total', '', set, c, topLosses, topParts) }
}
