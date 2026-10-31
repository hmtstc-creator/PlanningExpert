// Operatör planının kapasite tarafı (saf hesap). 'operator' modelli cost
// center'da makineler her iş gününde OPERATOR_SHIFTS_PER_DAY (3) vardiya açık
// sayılır; makine takvimi şablonu / istisna hafta okunmaz. Hattın gerçekten
// çalışıp çalışmadığına adam sayısı karar verir:
//
//   - Kısa vade: gün × vardiya adam sayısı (operatorHeadcount) → motor
//     adamları hatlara dağıtır (src/lib/operatorAllocation.ts).
//   - Uzun vade: hafta × operatör sayısı (operatorWeekly). O haftanın gün ×
//     vardiya değeri girilmemiş iş günlerinde vardiya başına
//     floor(haftalık ÷ 3) adam kullanılır (ızgara her zaman önce gelir).
//   - Capacity dashboard: haftalık kapasite (vardiya) =
//     min(makine × 3 × iş günü, haftalık operatör ÷ ortalama ekip × iş günü);
//     haftalık değer yoksa makine × 3 × iş günü.

import type { OperatorHeadcountRow } from './operatorAllocation'
import { DEFAULT_WORKING_DAYS, OPERATOR_SHIFTS_PER_DAY } from './settingsDefaults'

export { OPERATOR_SHIFTS_PER_DAY }

export interface OperatorWeeklyRow {
  costCenter: string
  /** Haftanın Pazartesi'si (ISO). */
  weekStart: string
  /** O hafta sahadaki kişi sayısı (vardiyalara bölünmeden). */
  operators: number
}

const crew = (c: number | undefined) => Math.max(1, Math.round(c ?? 1))
const round2 = (n: number) => Math.round(n * 100) / 100

const mondayIso = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * capacityModel'e verilen operatör düzeni: 'operator' modelli cost center'ların
 * hatları ve iş günü sayısı (Work Calendar'daki çalışma günleri; yoksa 5).
 */
export function operatorPattern(
  presses: { name: string; costCenter?: string }[],
  operatorCostCenters: Iterable<string>,
  workingDayKeys?: readonly string[] | null,
): { presses: string[]; workingDays: number } {
  const codes = new Set(operatorCostCenters)
  return {
    presses: presses.filter((p) => p.costCenter && codes.has(p.costCenter.trim())).map((p) => p.name),
    workingDays: Math.min(7, (workingDayKeys?.length ? workingDayKeys : DEFAULT_WORKING_DAYS).length),
  }
}

/** Haftalık operatör sayısından vardiya başına adam: floor(haftalık ÷ 3). */
export function shiftHeadcountFromWeekly(weekly: number): number {
  return Math.floor(Math.max(0, weekly) / OPERATOR_SHIFTS_PER_DAY)
}

/**
 * Motorun ve doğrulayıcının okuduğu birleşik adam sayısı: gün × vardiya
 * satırları aynen; o cost center'a o gün hiç satır girilmemiş iş günlerinde,
 * o haftanın haftalık değeri varsa 1..3. vardiyaya floor(haftalık ÷ 3).
 */
export function mergeWeeklyHeadcount(
  headcount: OperatorHeadcountRow[],
  weekly: OperatorWeeklyRow[],
  isWorkingDate: (iso: string) => boolean,
): OperatorHeadcountRow[] {
  const daily = new Set(headcount.map((h) => `${h.costCenter}|${h.date}`))
  const out = [...headcount]
  for (const w of weekly) {
    const monday = mondayIso(w.weekStart)
    const perShift = shiftHeadcountFromWeekly(w.operators)
    for (let i = 0; i < 7; i++) {
      const date = plusDays(monday, i)
      if (daily.has(`${w.costCenter}|${date}`) || !isWorkingDate(date)) continue
      for (let shift = 1; shift <= OPERATOR_SHIFTS_PER_DAY; shift++) {
        out.push({ costCenter: w.costCenter, date, shift, operators: perShift })
      }
    }
  }
  return out
}

export interface OperatorWeekCapacity {
  /** Makine sınırı: makine × 3 × iş günü (vardiya). */
  machineShifts: number
  /** Operatör sınırı: haftalık ÷ ortalama ekip × iş günü; haftalık yoksa null. */
  operatorShifts: number | null
  /** Haftanın kapasitesi (vardiya): ikisinin küçüğü. */
  shifts: number
  /** Makine kapasitesine oranı (0..1): hatların dakikası bununla çarpılır. */
  factor: number
}

/** Bir 'operator' cost center'ının haftalık kapasitesi (Capacity dashboard). */
export function operatorWeekCapacity(input: {
  /** Hatların ekip büyüklüğü (yok = 1); uzunluk = makine sayısı. */
  crewSizes: readonly (number | undefined)[]
  workingDays: number
  weeklyOperators?: number
}): OperatorWeekCapacity {
  const machines = input.crewSizes.length
  const machineShifts = machines * OPERATOR_SHIFTS_PER_DAY * Math.max(0, input.workingDays)
  if (input.weeklyOperators === undefined) return { machineShifts, operatorShifts: null, shifts: machineShifts, factor: 1 }
  const avgCrew = machines ? input.crewSizes.reduce<number>((s, c) => s + crew(c), 0) / machines : 1
  const operatorShifts = round2((Math.max(0, input.weeklyOperators) / avgCrew) * Math.max(0, input.workingDays))
  const shifts = Math.min(machineShifts, operatorShifts)
  return { machineShifts, operatorShifts, shifts, factor: machineShifts > 0 ? shifts / machineShifts : 0 }
}

/**
 * Planning Logic sayfasındaki ve testteki örnek (aynı sayılar): ekipleri
 * 1, 1, 2, 2 kişilik 4 hat, 5 iş günü, haftalık 12 operatör. Makine sınırı
 * 4 × 3 × 5 = 60 vardiya, operatör sınırı 12 ÷ 1,5 × 5 = 40 vardiya →
 * kapasite 40 vardiya. Motor gün × vardiya girilmemiş günlerde vardiya başına
 * floor(12 ÷ 3) = 4 adam kullanır.
 */
export const OPERATOR_WEEKLY_EXAMPLE = {
  crewSizes: [1, 1, 2, 2],
  workingDays: 5,
  weeklyOperators: 12,
} as const

export interface OperatorWeekHours {
  /** Makine sınırı (saat): makine × 3 vardiya × iş günü × vardiya saati. */
  machineHours: number
  /** Operatör sınırı (saat); haftalık yoksa null. */
  operatorHours: number | null
  /** Haftanın kapasitesi (saat): ikisinin küçüğü. */
  hours: number
}

/**
 * Aynı hafta, saat cinsinden. Vardiya saati Work Calendar'daki vardiya
 * süresinden gelir (`shiftMinutes`). Örnek: 1 hat, 3 vardiya, 5 iş günü,
 * vardiya 7,5 saat → makine sınırı 3 × 5 × 7,5 = 112,5 saat.
 */
export function operatorWeekHours(input: {
  crewSizes: readonly (number | undefined)[]
  workingDays: number
  weeklyOperators?: number
  shiftMinutes: number
}): OperatorWeekHours {
  const shifts = operatorWeekCapacity(input)
  const shiftHours = Math.max(0, input.shiftMinutes) / 60
  const machineHours = round2(shifts.machineShifts * shiftHours)
  if (shifts.operatorShifts === null) return { machineHours, operatorHours: null, hours: machineHours }
  const operatorHours = round2(shifts.operatorShifts * shiftHours)
  return { machineHours, operatorHours, hours: Math.min(machineHours, operatorHours) }
}
