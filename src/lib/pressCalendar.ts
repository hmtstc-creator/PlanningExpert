// Pres takviminin kuralları — tek yer. Motor, bağımsız kontrol, Work Calendar
// ve Capacity Dashboard aynı fonksiyonları kullanır.
//
// Planlamacıyla netleşen kurallar (docs/decisions.md):
//  - Bir presin tek takvimi vardır: haftalık düzeni (gün, vardiya), istisna
//    haftaları ve açılan mesaileri.
//  - "Haftada N gün" Pazartesiden başlayarak sırayla dolar (5 = Pzt–Cuma).
//  - Resmi tatil tatildir: o günün vardiyaları başka güne kaymaz.
//  - Vardiyalar aynı uzunluktadır, birinci vardiyanın başlangıcından
//    itibaren art arda dizilir.
//  - Mesai yalnızca tarihli (ya da şablonda tekrarlayan) ve bir mesai
//    tanımıyla açılır. Normal düzen dışındaki her çalışma mesaidir.
//  - Bir üretim günü 24 saati geçemez (planlı duruşlar dahil); bu yüzden bir
//    presin haftası da 168 saati geçemez.

import type { OvertimeWindow } from './shiftTimeline'

export const DAY_MINUTES = 1440
export const WEEK_MINUTES = 7 * DAY_MINUTES
export const WEEKDAY_KEYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const
export const WEEKDAY_LABELS: Record<string, string> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
}

export interface WeekPattern {
  workingDays: number
  shiftsPerDay: number
}

export interface OvertimeDefinition {
  id: string
  name: string
  description?: string
  /** Saat (gece yarısından dakika). */
  startMinute: number
  durationMinutes: number
}

export interface DatedOvertime {
  press: string
  /** Üretim günü (ISO). */
  date: string
  definitionId: string
}

export interface RecurringOvertime {
  /** Haftanın günü: MO..SU. */
  dayKey: string
  definitionId: string
}

/** Pazartesi = 0 … Pazar = 6. */
export function weekdayIndex(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7
}

export function clockText(minute: number): string {
  const m = ((Math.round(minute) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * Mesai tanımının üretim günündeki penceresi. Birinci vardiyadan önceki saat
 * (ör. 01:00) aynı üretim gününün gecesidir: +1440.
 */
export function overtimeWindowOf(def: Pick<OvertimeDefinition, 'startMinute' | 'durationMinutes' | 'name'>, shiftStartMinute: number): OvertimeWindow {
  const start = def.startMinute < shiftStartMinute ? def.startMinute + DAY_MINUTES : def.startMinute
  return { start, end: start + Math.max(0, def.durationMinutes), name: def.name }
}

/** Normal vardiyaların penceresi (tek parça: vardiyalar art arda). */
export function normalWindow(shifts: number, shiftStartMinute: number, shiftMinutes: number) {
  return { start: shiftStartMinute, end: shiftStartMinute + Math.max(0, shifts) * shiftMinutes }
}

/** Düzen kontrolü: günde vardiya × süre 24 saati geçemez. */
export function patternProblem(pattern: WeekPattern, shiftMinutes: number): string | null {
  if (!Number.isInteger(pattern.workingDays) || pattern.workingDays < 0 || pattern.workingDays > 7) {
    return 'Working days must be between 0 and 7.'
  }
  if (!Number.isInteger(pattern.shiftsPerDay) || pattern.shiftsPerDay < 0) return 'Shifts per day cannot be negative.'
  if (pattern.shiftsPerDay * shiftMinutes > DAY_MINUTES) {
    const max = Math.floor(DAY_MINUTES / Math.max(1, shiftMinutes))
    return `${pattern.shiftsPerDay} shifts × ${shiftMinutes / 60} h is more than 24 hours a day — at most ${max} shifts of this length fit in a day.`
  }
  return null
}

/**
 * Bir günün mesai pencereleri ve sorunları. Kurallar: pencere üretim günü
 * içinde kalır (en fazla 24 saat), normal vardiyalarla ve birbiriyle
 * çakışmaz. Sorunlu pencere plana alınmaz, sorun metni döner.
 */
export function dayOvertime(
  shifts: number,
  shiftStartMinute: number,
  shiftMinutes: number,
  defs: Pick<OvertimeDefinition, 'startMinute' | 'durationMinutes' | 'name'>[],
): { windows: OvertimeWindow[]; problems: string[] } {
  const dayEnd = shiftStartMinute + DAY_MINUTES
  const normal = normalWindow(shifts, shiftStartMinute, shiftMinutes)
  const windows: OvertimeWindow[] = []
  const problems: string[] = []
  const sorted = defs
    .map((d) => overtimeWindowOf(d, shiftStartMinute))
    .sort((a, b) => a.start - b.start)
  for (const w of sorted) {
    const label = `${w.name ?? 'Overtime'} ${clockText(w.start)}–${clockText(w.end)}`
    if (w.end <= w.start) {
      problems.push(`${label}: no duration.`)
    } else if (w.end > dayEnd) {
      problems.push(`${label} runs past ${clockText(dayEnd)}: a day cannot exceed 24 hours.`)
    } else if (normal.end > normal.start && w.start < normal.end && normal.start < w.end) {
      problems.push(`${label} overlaps the normal shifts ${clockText(normal.start)}–${clockText(normal.end)}.`)
    } else if (windows.some((x) => w.start < x.end && x.start < w.end)) {
      problems.push(`${label} overlaps another overtime on the same day.`)
    } else {
      windows.push(w)
    }
  }
  return { windows, problems }
}

export interface PressDaySources {
  shiftStartMinute: number
  shiftMinutes: number
  /** Pres → şablon (yoksa pres takvimi tanımsız: kapasite 0). */
  templates: Map<string, WeekPattern & { recurringOvertime?: RecurringOvertime[] }>
  /** `${press}|${weekStart}` → istisna hafta. */
  weekOverrides: Map<string, WeekPattern>
  /** `${press}|${date}` → o güne açılan mesailer. */
  datedOvertime: Map<string, DatedOvertime[]>
  definitions: Map<string, OvertimeDefinition>
  holidays: Set<string>
}

export interface PressDay {
  date: string
  dayKey: string
  isHoliday: boolean
  /** Normal vardiya sayısı. */
  shifts: number
  overtime: OvertimeWindow[]
  /** Plana alınamayan mesai kayıtları (çakışma, 24 saat). */
  problems: string[]
}

/** Bir presin bir üretim günü: normal vardiyalar + açılan mesailer. */
export function pressDay(src: PressDaySources, press: string, weekStart: string, date: string): PressDay {
  const index = weekdayIndex(date)
  const dayKey = WEEKDAY_KEYS[index]
  const isHoliday = src.holidays.has(date)
  const template = src.templates.get(press)
  const pattern = src.weekOverrides.get(`${press}|${weekStart}`) ?? template
  if (!pattern) return { date, dayKey, isHoliday, shifts: 0, overtime: [], problems: [] }
  // Pazartesiden sırayla; tatil günü kaybolur, kaymaz.
  const shifts = !isHoliday && index < pattern.workingDays ? pattern.shiftsPerDay : 0
  const defs: OvertimeDefinition[] = []
  for (const o of src.datedOvertime.get(`${press}|${date}`) ?? []) {
    const def = src.definitions.get(o.definitionId)
    if (def) defs.push(def)
  }
  // Tekrarlayan mesai tatilde çalışmaz: tatilde mesai tarihli açılır.
  if (!isHoliday) {
    for (const r of template?.recurringOvertime ?? []) {
      if (r.dayKey !== dayKey) continue
      const def = src.definitions.get(r.definitionId)
      if (def) defs.push(def)
    }
  }
  const { windows, problems } = dayOvertime(shifts, src.shiftStartMinute, src.shiftMinutes, defs)
  return { date, dayKey, isHoliday, shifts, overtime: windows, problems }
}

/**
 * Sunucu hatasının kullanıcıya gösterilecek kısmı. Convex hatayı birkaç
 * satırda verir ("[CONVEX M(...)] ... Uncaught Error: <mesaj>\n    at ...");
 * yalnızca mesaj kalır.
 */
export function serverErrorText(e: unknown, fallback = 'Could not save'): string {
  if (!(e instanceof Error)) return fallback
  return (
    e.message
      .replace(/^[\s\S]*Uncaught Error:\s*/, '')
      .replace(/\s+at [\s\S]*$/, '')
      .replace(/\s*Called by client\s*$/, '')
      .trim() || fallback
  )
}
