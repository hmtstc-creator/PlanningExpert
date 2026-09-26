// Kapasitenin TEK formülü: bir presin bir haftadaki gün kovaları.
//
// Aynı soru ("bu pres bu hafta kaç dakika çalışır?") eskiden dört yerde ayrı
// hesaplanıyordu: plan, Work Calendar tablosu, Capacity Dashboard ve
// Performance sayfası. Artık hepsi buradan okur. Takvim kuralları
// pressCalendar.ts'tedir (Pazartesiden sırayla gün, tatilde kayma yok,
// tarihli mesai, günde en fazla 24 saat).

import { buildWeekBuckets, type DayBucket, type ShiftSettings } from './planning'
import { addDays, isoDate } from './dates'
import {
  pressDay,
  type DatedOvertime,
  type OvertimeDefinition,
  type PressDaySources,
  type RecurringOvertime,
  type WeekPattern,
} from './pressCalendar'
import type { PlannedStop } from './shiftTimeline'

export type { WeekPattern }
/** @deprecated Adı eski; WeekPattern ile aynı. */
export type WeekPatternLike = WeekPattern

export interface CapacitySources {
  shiftMinutes: number
  /** Birinci vardiyanın başlangıcı (gece yarısından dakika). */
  shiftStartMinute: number
  plannedStops: PlannedStop[]
  templates: ({ press: string; recurringOvertime?: RecurringOvertime[] } & WeekPattern)[]
  weekOverrides?: ({ press: string; weekStart: string } & WeekPattern)[]
  overtimeDefinitions?: OvertimeDefinition[]
  pressOvertime?: DatedOvertime[]
  /** Elle girilen + resmi tatiller. */
  holidays: Set<string>
}

/** Vardiya başına planlı duruş (çay, yemek, devir…), index 0 = 1. vardiya. */
export function stopMinutesByShift(stops: { shiftIndex: number; durationMinutes: number }[]): number[] {
  const out = [0, 0, 0]
  for (const stop of stops) {
    const i = stop.shiftIndex - 1
    if (i >= 0 && i < 3) out[i] += stop.durationMinutes
  }
  return out
}

export interface CapacityModel {
  shiftSettings: ShiftSettings
  /** Presin Work Calendar düzeni var mı (yoksa kapasitesi 0). */
  hasCalendar: (press: string) => boolean
  /** O haftanın düzeni: istisna hafta > pres şablonu; tanımsızsa null. */
  patternOf: (press: string, weekStart: Date) => WeekPattern | null
  /** Presin o haftadaki gün kovaları, planlı duruşlar düşülmüş (net dakika). */
  weekBuckets: (press: string, weekStart: Date) => DayBucket[]
  /** Plana alınamayan mesai kayıtları (çakışma, 24 saat). */
  overtimeProblems: (press: string, weekStart: Date) => string[]
  /**
   * Fabrikanın iş günü: tatil değil ve en az bir presin normal vardiyası var.
   * Presler dışındaki hesaplar (hammadde, talep dağıtımı) bunu kullanır.
   */
  isPlantWorkingDate: (iso: string) => boolean
}

const mondayIso = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

export function capacityModel(src: CapacitySources): CapacityModel {
  const shiftSettings: ShiftSettings = {
    shiftMinutes: src.shiftMinutes,
    overtimeShiftMinutes: src.shiftMinutes,
    // Duruşlar her zaman planlı duruş tablosundan.
    stopMinutesByShift: stopMinutesByShift(src.plannedStops),
    shiftStartMinute: src.shiftStartMinute,
    plannedStops: src.plannedStops,
  }
  const datedOvertime = new Map<string, DatedOvertime[]>()
  for (const o of src.pressOvertime ?? []) {
    const key = `${o.press}|${o.date}`
    datedOvertime.set(key, [...(datedOvertime.get(key) ?? []), o])
  }
  const day: PressDaySources = {
    shiftStartMinute: src.shiftStartMinute,
    shiftMinutes: src.shiftMinutes,
    templates: new Map(src.templates.map((t) => [t.press, t])),
    weekOverrides: new Map((src.weekOverrides ?? []).map((o) => [`${o.press}|${o.weekStart}`, o])),
    datedOvertime,
    definitions: new Map((src.overtimeDefinitions ?? []).map((d) => [d.id, d])),
    holidays: src.holidays,
  }
  const patternOf = (press: string, weekStart: Date) =>
    day.weekOverrides.get(`${press}|${isoDate(weekStart)}`) ?? day.templates.get(press) ?? null
  const weekBuckets = (press: string, weekStart: Date) => {
    const ws = isoDate(weekStart)
    return buildWeekBuckets(
      weekStart,
      patternOf(press, weekStart) ?? { workingDays: 0, shiftsPerDay: 0 },
      shiftSettings,
      src.holidays,
      undefined,
      (date) => {
        const d = pressDay(day, press, ws, date)
        return { shifts: d.shifts, overtime: d.overtime }
      },
    )
  }
  const presses = Array.from(day.templates.keys())
  const workingCache = new Map<string, boolean>()
  return {
    shiftSettings,
    hasCalendar: (press) => day.templates.has(press),
    patternOf,
    weekBuckets,
    overtimeProblems: (press, weekStart) => {
      const ws = isoDate(weekStart)
      const out: string[] = []
      for (let i = 0; i < 7; i++) {
        const date = isoDate(addDays(weekStart, i))
        for (const p of pressDay(day, press, ws, date).problems) out.push(`${press} ${date}: ${p}`)
      }
      return out
    },
    isPlantWorkingDate: (iso) => {
      const hit = workingCache.get(iso)
      if (hit !== undefined) return hit
      const ws = mondayIso(iso)
      const value = !src.holidays.has(iso) && presses.some((press) => pressDay(day, press, ws, iso).shifts > 0)
      workingCache.set(iso, value)
      return value
    },
  }
}
