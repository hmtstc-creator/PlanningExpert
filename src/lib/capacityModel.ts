// Kapasitenin TEK formülü: bir presin bir haftadaki gün kovaları.
//
// Aynı soru ("bu pres bu hafta kaç dakika çalışır?") eskiden dört yerde ayrı
// hesaplanıyordu: plan, Work Calendar tablosu, Capacity Dashboard ve
// Performance sayfası. Kimi planlı duruşları düşmüyor, kimi istisna haftayı
// (fazla mesai) ya da resmi tatili görmüyordu; aynı girdiyle farklı sayılar
// çıkıyordu. Artık hepsi buradan okur.

import { buildWeekBuckets, type DayBucket, type ShiftSettings } from './planning'
import { isoDate } from './dates'
import { DEFAULT_WORKING_DAYS } from './settingsDefaults'

export interface WeekPatternLike {
  workingDays: number
  shiftsPerDay: number
  overtimeShifts: number
}

export interface CapacitySources {
  shiftMinutes: number
  overtimeShiftMinutes: number
  plannedStops: { shiftIndex: number; durationMinutes: number }[]
  templates: ({ press: string } & WeekPatternLike)[]
  weekOverrides?: ({ press: string; weekStart: string } & WeekPatternLike)[]
  /** Work Calendar'daki çalışma günleri (MO..SU). */
  workingDayKeys?: readonly string[]
  /** Elle girilen + resmi tatiller. */
  holidays: Set<string>
}

/** Vardiya başına planlı duruş (çay, yemek, devir…), index 0 = 1. vardiya. */
export function stopMinutesByShift(stops: CapacitySources['plannedStops']): number[] {
  const out = [0, 0, 0]
  for (const stop of stops) {
    const i = stop.shiftIndex - 1
    if (i >= 0 && i < 3) out[i] += stop.durationMinutes
  }
  return out
}

export interface CapacityModel {
  workingDayKeys: string[]
  shiftSettings: ShiftSettings
  /** O haftanın düzeni: istisna hafta > pres şablonu > takvim varsayılanı. */
  patternOf: (press: string, weekStart: Date) => WeekPatternLike
  /** Presin o haftadaki gün kovaları, planlı duruşlar düşülmüş (net dakika). */
  weekBuckets: (press: string, weekStart: Date) => DayBucket[]
}

export function capacityModel(src: CapacitySources): CapacityModel {
  const workingDayKeys = [...(src.workingDayKeys && src.workingDayKeys.length > 0 ? src.workingDayKeys : DEFAULT_WORKING_DAYS)]
  const shiftSettings: ShiftSettings = {
    shiftMinutes: src.shiftMinutes,
    overtimeShiftMinutes: src.overtimeShiftMinutes,
    // Duruşlar her zaman planlı duruş tablosundan; eski "vardiya başı mola"
    // alanı artık okunmaz (arayüzde yok, iki kez düşülmesin).
    stopMinutesByShift: stopMinutesByShift(src.plannedStops),
  }
  const templateByPress = new Map(src.templates.map((t) => [t.press, t]))
  const overrideByPressWeek = new Map((src.weekOverrides ?? []).map((o) => [`${o.press}|${o.weekStart}`, o]))
  const fallback = { workingDays: workingDayKeys.length, shiftsPerDay: 1, overtimeShifts: 0 }
  const patternOf = (press: string, weekStart: Date) =>
    overrideByPressWeek.get(`${press}|${isoDate(weekStart)}`) ?? templateByPress.get(press) ?? fallback
  return {
    workingDayKeys,
    shiftSettings,
    patternOf,
    weekBuckets: (press, weekStart) =>
      buildWeekBuckets(weekStart, patternOf(press, weekStart), shiftSettings, src.holidays, workingDayKeys),
  }
}
