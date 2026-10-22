// Hammadde tedarik süresi: siparişin en geç verilmesi gereken gün.
//
// Teslim haftası rawMrp'den gelir (stok o haftanın tüketimine + emniyete
// yetmiyor). Sipariş, teslim haftasının başında (Pazartesi) elde olmalı:
//   en geç sipariş günü = teslim haftasının başı − tedarik süresi (TAKVİM günü).
// Bugünden önceyse sipariş gecikmiştir; bu hafta içindeyse bu hafta verilmeli.
// Takvim günü seçildi çünkü tedarikçi süreyi takvimle verir ve tatiller
// tedarikçinin değil fabrikanın takvimidir.

import type { MrpWeek, RawMrpResult } from './rawMrp'
import { SETTINGS_DEFAULTS } from './settingsDefaults'

/** rawLeadTimes'ta varsayılan satırın kodu (convex/rawLeadTimes.ts ile aynı). */
export const DEFAULT_RAW = '*'

export interface LeadTimeRow {
  rawMaterialCode: string
  leadTimeDays: number
  supplier?: string
  note?: string
}

export interface LeadTime {
  days: number
  /** Sacın kendi satırı mı, yoksa varsayılan mı (girilmemiş). */
  entered: boolean
  supplier?: string
}

export type DeadlineStatus = 'late' | 'thisWeek' | 'later'

export interface OrderDeadline {
  rawMaterial: string
  /** rawMrp hafta indeksi. */
  week: number
  deliveryWeekStart: string
  orderKg: number
  leadTimeDays: number
  leadTimeEntered: boolean
  /** En geç sipariş günü (ISO). */
  orderBy: string
  status: DeadlineStatus
}

/** Kayıtlı satırlardan sac → tedarik süresi okuyucusu. */
export function leadTimeLookup(rows: readonly LeadTimeRow[]): {
  defaultDays: number
  defaultEntered: boolean
  of: (rawMaterial: string) => LeadTime
} {
  const byCode = new Map(rows.map((r) => [r.rawMaterialCode.trim(), r]))
  const def = byCode.get(DEFAULT_RAW)
  const defaultDays = def?.leadTimeDays ?? SETTINGS_DEFAULTS.rawLeadTimeDays
  return {
    defaultDays,
    defaultEntered: !!def,
    of: (rawMaterial) => {
      const row = byCode.get(rawMaterial.trim())
      return row
        ? { days: row.leadTimeDays, entered: true, ...(row.supplier ? { supplier: row.supplier } : {}) }
        : { days: defaultDays, entered: false }
    },
  }
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** ISO tarihinin haftasının Pazar günü. */
export function weekEndIso(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay() // 0 = Pazar
  return addDaysIso(iso, day === 0 ? 0 : 7 - day)
}

export function deadlineStatus(orderBy: string, todayIso: string): DeadlineStatus {
  if (orderBy < todayIso) return 'late'
  return orderBy <= weekEndIso(todayIso) ? 'thisWeek' : 'later'
}

/** Bir hammaddenin her siparişi için en geç sipariş günü. */
export function orderDeadlines(
  result: RawMrpResult,
  weeks: readonly MrpWeek[],
  lead: LeadTime,
  todayIso: string,
): OrderDeadline[] {
  const out: OrderDeadline[] = []
  result.rows.forEach((row, w) => {
    const start = weeks[w]?.start
    if (row.orderKg <= 0 || !start) return
    const orderBy = addDaysIso(start, -lead.days)
    out.push({
      rawMaterial: result.rawMaterial,
      week: w,
      deliveryWeekStart: start,
      orderKg: row.orderKg,
      leadTimeDays: lead.days,
      leadTimeEntered: lead.entered,
      orderBy,
      status: deadlineStatus(orderBy, todayIso),
    })
  })
  return out
}

/** "3 Nov" — tablolarda kısa tarih. */
export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
