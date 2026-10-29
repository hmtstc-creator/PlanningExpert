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
//  - Gün kaydı (Production Plan → Work calendar, "nihai karar") o pres × günün
//    vardiyalarını tek tek belirler: gün kaydı > istisna hafta > şablon.
//    Tatil günü de gün kaydıyla açılabilir; vardiyalar art arda olmak zorunda
//    değildir (ör. yalnız 3. vardiya).

import { friendlyError } from './mutationErrors'
import { activeShiftList, type OvertimeWindow } from './shiftTimeline'

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

/** Bir pres × günün vardiya kaydı: çalışan vardiya numaraları (1'den). Boş liste = kapalı gün. */
export interface DayShifts {
  press: string
  /** Üretim günü (ISO). */
  date: string
  shifts: number[]
}

/** Günde sığan vardiya sayısı (ör. 8 saatlik vardiyada 3). */
export function maxShiftsPerDay(shiftMinutes: number): number {
  return Math.max(1, Math.floor(DAY_MINUTES / Math.max(1, shiftMinutes)))
}

/** Gün kaydı kontrolü: vardiya numarası 1..günde sığan vardiya, tekrar yok. */
export function dayShiftsProblem(shifts: number[], shiftMinutes: number): string | null {
  const max = maxShiftsPerDay(shiftMinutes)
  for (const n of shifts) {
    if (!Number.isInteger(n) || n < 1 || n > max) return `Shift ${n} does not exist — a day has shifts 1–${max}.`
  }
  if (new Set(shifts).size !== shifts.length) return 'A shift is listed twice.'
  return null
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

export interface Window {
  start: number
  end: number
}

const overlaps = (a: Window, b: Window) => a.start < b.end && b.start < a.end

/**
 * Çalışan vardiyaların pencereleri. Gün kaydıyla vardiyalar art arda olmak
 * zorunda değildir (ör. yalnız 3. vardiya), bu yüzden her vardiya ayrı pencere.
 */
export function normalWindows(shifts: number | number[], shiftStartMinute: number, shiftMinutes: number): Window[] {
  const active = Array.isArray(shifts) ? [...shifts].sort((a, b) => a - b) : activeShiftList(shifts)
  return active.map((n) => ({
    start: shiftStartMinute + (n - 1) * shiftMinutes,
    end: shiftStartMinute + n * shiftMinutes,
  }))
}

/**
 * Bir mesai penceresinin sorunu (tek kontrol — `dayOvertime` ve arayüzdeki
 * "bu mesai bu güne sığar mı?" aynı kuralı kullanır). `null` = plana alınır.
 */
export function overtimeWindowProblem(w: OvertimeWindow, normals: Window[], taken: Window[], dayEnd: number): string | null {
  const label = `${w.name ?? 'Overtime'} ${clockText(w.start)}–${clockText(w.end)}`
  if (w.end <= w.start) return `${label}: no duration.`
  if (w.end > dayEnd) return `${label} runs past ${clockText(dayEnd)}: a day cannot exceed 24 hours.`
  const n = normals.find((x) => overlaps(w, x))
  if (n) return `${label} overlaps the normal shift ${clockText(n.start)}–${clockText(n.end)}.`
  if (taken.some((x) => overlaps(w, x))) return `${label} overlaps another overtime on the same day.`
  return null
}

/**
 * Günün boş (çalışılmayan) aralıkları: üretim gününden normal vardiyalar ve
 * açılmış mesailer düşülür. Üç vardiya × 8 saat çalışan bir günde boşluk
 * yoktur (mesai açılamaz); 06:30'dan iki × 9 s 40 dk çalışan günde
 * 01:50–06:30 boştur, gece mesaisi oraya açılır.
 */
export function freeWindows(
  shifts: number | number[],
  shiftStartMinute: number,
  shiftMinutes: number,
  openOvertime: Window[] = [],
): Window[] {
  const dayEnd = shiftStartMinute + DAY_MINUTES
  const busy = [...normalWindows(shifts, shiftStartMinute, shiftMinutes), ...openOvertime].sort((a, b) => a.start - b.start)
  const free: Window[] = []
  let cursor = shiftStartMinute
  for (const b of busy) {
    if (b.start > cursor) free.push({ start: cursor, end: Math.min(b.start, dayEnd) })
    cursor = Math.max(cursor, b.end)
  }
  if (cursor < dayEnd) free.push({ start: cursor, end: dayEnd })
  return free.filter((w) => w.end > w.start)
}

/** Boş dakika toplamı (gün doluysa 0). */
export function freeMinutes(
  shifts: number | number[],
  shiftStartMinute: number,
  shiftMinutes: number,
  openOvertime: Window[] = [],
): number {
  return freeWindows(shifts, shiftStartMinute, shiftMinutes, openOvertime).reduce((a, w) => a + (w.end - w.start), 0)
}

/**
 * Bu mesai tanımı bu güne açılabilir mi? `null` = açılabilir, metin = nedeni.
 * Arayüz bunu seçenek listesinde kullanır; sunucu aynı kuralı `dayOvertime`
 * üzerinden uygular, böylece gösterilen ile kaydedilen ayrışmaz.
 */
export function overtimeFitProblem(
  def: Pick<OvertimeDefinition, 'startMinute' | 'durationMinutes' | 'name'>,
  shifts: number | number[],
  shiftStartMinute: number,
  shiftMinutes: number,
  openDefs: Pick<OvertimeDefinition, 'startMinute' | 'durationMinutes' | 'name'>[] = [],
): string | null {
  const taken = dayOvertime(shifts, shiftStartMinute, shiftMinutes, openDefs).windows
  return overtimeWindowProblem(
    overtimeWindowOf(def, shiftStartMinute),
    normalWindows(shifts, shiftStartMinute, shiftMinutes),
    taken,
    shiftStartMinute + DAY_MINUTES,
  )
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
 * `shifts`: vardiya sayısı (1'den art arda) ya da çalışan vardiya numaraları.
 */
export function dayOvertime(
  shifts: number | number[],
  shiftStartMinute: number,
  shiftMinutes: number,
  defs: Pick<OvertimeDefinition, 'startMinute' | 'durationMinutes' | 'name'>[],
): { windows: OvertimeWindow[]; problems: string[] } {
  const dayEnd = shiftStartMinute + DAY_MINUTES
  const normals = normalWindows(shifts, shiftStartMinute, shiftMinutes)
  const windows: OvertimeWindow[] = []
  const problems: string[] = []
  const sorted = defs.map((d) => overtimeWindowOf(d, shiftStartMinute)).sort((a, b) => a.start - b.start)
  for (const w of sorted) {
    const problem = overtimeWindowProblem(w, normals, windows, dayEnd)
    if (problem) problems.push(problem)
    else windows.push(w)
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
  /** `${press}|${date}` → gün kaydı (çalışan vardiya numaraları). */
  dayShifts?: Map<string, number[]>
}

export interface PressDay {
  date: string
  dayKey: string
  isHoliday: boolean
  /** Normal vardiya sayısı. */
  shifts: number
  /** Çalışan vardiya numaraları; yalnız 1'den art arda değilse dolu (bkz. DayShape). */
  activeShifts?: number[]
  /** Vardiyalar gün kaydından (Production Plan → Work calendar) geliyor. */
  fromDayRecord?: boolean
  overtime: OvertimeWindow[]
  /** Plana alınamayan mesai kayıtları (çakışma, 24 saat). */
  problems: string[]
}

/** Vardiya numaralarını sıralar; 1..n ise `activeShifts` gerekmez. */
export function shiftShape(list: number[]): { shifts: number; activeShifts?: number[] } {
  const sorted = Array.from(new Set(list)).sort((a, b) => a - b)
  const consecutive = sorted.every((n, i) => n === i + 1)
  return consecutive ? { shifts: sorted.length } : { shifts: sorted.length, activeShifts: sorted }
}

/** Bir presin bir üretim günü: normal vardiyalar + açılan mesailer. */
export function pressDay(src: PressDaySources, press: string, weekStart: string, date: string): PressDay {
  const index = weekdayIndex(date)
  const dayKey = WEEKDAY_KEYS[index]
  const isHoliday = src.holidays.has(date)
  const template = src.templates.get(press)
  const pattern = src.weekOverrides.get(`${press}|${weekStart}`) ?? template
  if (!pattern) return { date, dayKey, isHoliday, shifts: 0, overtime: [], problems: [] }
  // Gün kaydı (nihai karar) her şeyin önüne geçer, tatilde de.
  const record = src.dayShifts?.get(`${press}|${date}`)
  // Pazartesiden sırayla; tatil günü kaybolur, kaymaz.
  const shape = record
    ? shiftShape(record)
    : { shifts: !isHoliday && index < pattern.workingDays ? pattern.shiftsPerDay : 0 }
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
  const { windows, problems } = dayOvertime(shape.activeShifts ?? shape.shifts, src.shiftStartMinute, src.shiftMinutes, defs)
  return { date, dayKey, isHoliday, ...shape, ...(record ? { fromDayRecord: true } : {}), overtime: windows, problems }
}

/** Sunucu hatasının kullanıcıya gösterilecek kısmı (bkz. mutationErrors.friendlyError). */
export function serverErrorText(e: unknown, fallback = 'Could not save'): string {
  return friendlyError(e).message || fallback
}
