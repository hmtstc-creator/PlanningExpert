// Bakım kayıtlarını planlama motorunun anladığı dile çeviren katman.
//
// Bakım departmanı saatlerle konuşur ("108 numaralı pres Salı 08:00–12:00
// kapalı"). Motor ise presin net üretim dakikası ekseninde çalışır ve o
// eksende çay molası, yemek, vardiya devri yoktur. İkisinin arasındaki
// çeviri burada; saf fonksiyon olduğu için test edilebilir.

import { addDays, isoDate } from './dates'
import { clockToNet, type DayTimeline } from './shiftTimeline'

export interface PressMaintenanceRow {
  press: string
  date: string
  /** Gece yarısından dakika. */
  startMinute: number
  endMinute: number
  reason: string
  status: string
  actualDate?: string
  actualStartMinute?: number
  actualEndMinute?: number
}

export interface MoldMaintenanceRow {
  material: string
  date: string
  dateTo?: string
  kind?: string
  note?: string
}

export interface MoldReadinessRow {
  material: string
  ready: boolean
  readyDate?: string
  /** Hazır olma saati, gece yarısından dakika. */
  readyMinute?: number
  reason?: string
}

/**
 * Hazır olma anını (takvim günü + saat) üretim gününe ve o günün net
 * dakikasına çevirir. Gece vardiyasındaki bir saat bir önceki üretim
 * gününe aittir. Çağıran taraf vardiya çizelgesini bilir; burada yalnızca
 * sözleşme tanımlı.
 */
export type ReadyMomentToNet = (
  readyDate: string,
  readyMinute: number,
) => { date: string; untilNet: number } | null

/**
 * Pres bakımını, motorun `fixedJobs` olarak yerleştirebileceği bir bloğa
 * çevirir.
 *
 * Kapasiteyi azaltmak yanlış olurdu: gün 60 dakika kısalmaz, günün BELLİ
 * bir saati kapanır. Bloğun kendisi yer kaplarsa iş etrafından akar.
 *
 * `timeline` o günün gerçek saat çizelgesidir. Bakım tümüyle bir molanın
 * içine düşerse net karşılığı sıfır olur ve blok üretilmez — mola zaten
 * üretim değildir, iki kere düşmemek gerekir.
 */
export function pressMaintenanceBlock(
  row: PressMaintenanceRow,
  timeline: DayTimeline,
): { press: string; date: string; start: number; end: number; label: string } | null {
  if (row.status === 'cancelled') return null
  const start = clockToNet(Math.min(row.startMinute, row.endMinute), timeline)
  const end = clockToNet(Math.max(row.startMinute, row.endMinute), timeline)
  if (end <= start) return null
  return {
    press: row.press,
    date: row.date,
    start,
    end,
    label: row.reason,
  }
}

/** Bir bakımın kapladığı günler; `dateTo` yoksa tek gün. */
export function maintenanceDates(row: MoldMaintenanceRow): string[] {
  const from = row.date
  const to = row.dateTo && row.dateTo > row.date ? row.dateTo : row.date
  const dates: string[] = []
  let cursor = new Date(`${from}T00:00:00`)
  const last = new Date(`${to}T00:00:00`)
  // Makul bir üst sınır: tek bir bakım kaydı bir yılı aşamaz.
  for (let guard = 0; guard < 366 && cursor <= last; guard++) {
    dates.push(isoDate(cursor))
    cursor = addDays(cursor, 1)
  }
  return dates
}

/**
 * Kalıbın çalışamayacağı günler: bakım günleri + hazır olmadığı günler.
 *
 * "Hazır değil" bir tarih aralığı değil, bir eşiktir: kalıp o tarihe kadar
 * hiç çalışamaz. Ufkun başından hazır olma tarihine kadarki her gün kapalı
 * sayılır. Hazır olma tarihi verilmemişse kalıp süresiz kapalıdır ve bunu
 * gün listesiyle ifade edemeyiz — o yüzden ayrıca bildirilir.
 */
export function moldBlackouts(
  maintenance: MoldMaintenanceRow[],
  readiness: MoldReadinessRow[],
  horizonDates: string[],
  /**
   * Ömür alarmı açık olan kalıplar. Limit aşılmasına izin verilir ama
   * aşıldıktan sonra alarm kapanana kadar kalıp plana alınmaz — süresiz
   * bir kapalılıktır, gün listesiyle ifade edilemez.
   */
  alarmed: string[] = [],
  /** Verilirse hazır olma saati de uygulanır: o gün o saate kadar kapalı. */
  readyMomentToNet?: ReadyMomentToNet,
): {
  blackouts: { material: string; date: string; untilNet?: number }[]
  unavailable: string[]
} {
  const blackouts: { material: string; date: string; untilNet?: number }[] = []
  const unavailable: string[] = [...alarmed]

  for (const row of maintenance) {
    for (const date of maintenanceDates(row)) {
      blackouts.push({ material: row.material, date })
    }
  }

  for (const row of readiness) {
    if (row.ready) continue
    if (!row.readyDate) {
      if (!unavailable.includes(row.material)) unavailable.push(row.material)
      continue
    }
    // Saat verilmişse hazır olma anı gün içindedir: o güne kadar bütün
    // günler, o gün de o saate kadar kapalı.
    const moment =
      row.readyMinute !== undefined && readyMomentToNet
        ? readyMomentToNet(row.readyDate, row.readyMinute)
        : null
    const fullUntil = moment ? moment.date : row.readyDate
    for (const date of horizonDates) {
      if (date < fullUntil) blackouts.push({ material: row.material, date })
    }
    if (moment && moment.untilNet > 0 && horizonDates.includes(moment.date)) {
      blackouts.push({ material: row.material, date: moment.date, untilNet: moment.untilNet })
    }
  }

  return { blackouts, unavailable }
}

export interface MaintenancePerformance {
  planned: number
  completed: number
  /** Gerçekleşen süresi girilmiş bakımlar. */
  measured: number
  plannedMinutes: number
  actualMinutes: number
  /** Gerçekleşen / planlanan; ölçüm yoksa null. */
  ratio: number | null
  /** Planlanandan uzun süren bakım sayısı. */
  overran: number
}

/**
 * Bakım performansı: planlanan süreye karşı gerçekleşen.
 *
 * Yalnızca gerçekleşen saatleri girilmiş kayıtlar oranı etkiler. Girilmemiş
 * bir bakımı "planında bitti" saymak oranı olduğundan iyi gösterirdi.
 */
export function maintenancePerformance(
  rows: PressMaintenanceRow[],
): MaintenancePerformance {
  let plannedMinutes = 0
  let actualMinutes = 0
  let measured = 0
  let completed = 0
  let overran = 0

  for (const row of rows) {
    if (row.status === 'cancelled') continue
    if (row.status === 'done') completed++
    const planned = Math.abs(row.endMinute - row.startMinute)
    if (
      row.actualStartMinute === undefined ||
      row.actualEndMinute === undefined ||
      row.actualEndMinute <= row.actualStartMinute
    ) {
      continue
    }
    const actual = row.actualEndMinute - row.actualStartMinute
    plannedMinutes += planned
    actualMinutes += actual
    measured++
    if (actual > planned) overran++
  }

  return {
    planned: rows.filter((r) => r.status !== 'cancelled').length,
    completed,
    measured,
    plannedMinutes,
    actualMinutes,
    ratio: plannedMinutes > 0 ? actualMinutes / plannedMinutes : null,
    overran,
  }
}
