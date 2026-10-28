import type { JobRequirement } from './scheduler'

/** İş penceresindeki durum satırının bir parçası. */
export interface JobStatusPart {
  qty: number
  /** late / early: ihtiyaç anına göre; onTime: tam ihtiyaç anında; overstock: ihtiyaç dışı (rulo / min. lot fazlası). */
  kind: 'late' | 'early' | 'onTime' | 'overstock'
  hours?: number
}

/**
 * İş penceresi (planlamacı 2026-10-28): işin karşıladığı ihtiyaçlar ve her
 * birinin ihtiyaç anına (ihtiyaç günü 08:00) göre kaç saat erken / geç
 * hazır olduğu; lotun ihtiyacı aşan kısmı "overstock".
 *
 * Örnek: 6 000 adetlik iş (1 rulo), 3 000 adetlik acil bakiye 2 saat geç
 * hazır → [{ 3 000, late, 2 }, { 3 000, overstock }].
 */
export function jobStatus(quantity: number, requirements: readonly JobRequirement[] | undefined): JobStatusPart[] {
  const parts: JobStatusPart[] = []
  let covered = 0
  for (const r of requirements ?? []) {
    covered += r.qty
    const hours = r.hours ?? 0
    const kind = hours > 0.05 ? 'late' : hours < -0.05 ? 'early' : 'onTime'
    const last = parts[parts.length - 1]
    // Aynı yönde ve aynı saatte olan ardışık ihtiyaçlar birleşir.
    if (last && last.kind === kind && last.hours === Math.abs(hours)) last.qty += r.qty
    else parts.push({ qty: r.qty, kind, hours: Math.abs(hours) })
  }
  const rest = Math.round(quantity) - covered
  if (rest > 0) parts.push({ qty: rest, kind: 'overstock' })
  return parts
}

/** "28.10.2026" — sunumdaki gibi gün.ay.yıl. */
export const dottedDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
