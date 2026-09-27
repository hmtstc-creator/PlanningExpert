// OEE Trend and Losses — ASAKAI raporunun hesapları. Saf fonksiyonlar.
//
// Kaynak: sistemden indirilen Excel (Shiftly KPI, Daily KPI, Weekly KPI,
// Monthly KPI, Shiftly Order Based KPI, Downtimes). Notlar ve kararlar:
// docs/oeedashboard.md.
//
// Temel kural: hiçbir dönem için yüzde ORTALAMASI alınmaz. Süreler (Loading,
// Production, Operation) ve adetler toplanır, oran toplamdan hesaplanır:
//   Availability = Production ÷ Loading
//   Performance  = Operation ÷ Production
//   Quality      = Good ÷ (Good + Scrap + Reject)
//   OEE          = Availability × Performance × Quality
// Tek istisna planlamacının kararıyla kalıp OEE'sidir: dosyadaki gibi iyi
// adetle ağırlıklı (Σ OEE × Good ÷ Σ Good).

// ---- sabitler (docs/fixeddefinitions.md) -----------------------------------

/** Masraf yeri → ad. Excel'deki BoardReport ile aynı. */
export const COST_CENTERS: Record<string, string> = {
  '51010171': 'Transfer',
  '51010173': 'Progressive',
  '51010172': 'APR',
}

/** Vardiya kodu → 1/2/3 (Excel "Data" sayfası AC:AD). */
export const SHIFT_NUMBER: Record<string, number> = {
  UB61: 1,
  UB62: 2,
  UB63: 3,
  UB64: 1,
  UB65: 2,
  UB66: 3,
}

/** Downtimes "Reason Code 2" → kayıp grubu (Excel Losses_Follow). */
export const LOSS_GROUPS: { code: string; label: string }[] = [
  { code: 'KLP', label: 'Die breakdown' },
  { code: 'STP', label: 'Setup' },
  { code: 'ARZ', label: 'Machine breakdown' },
  { code: 'KSD', label: 'Short stoppages' },
  { code: 'KON', label: 'Quality' },
  { code: 'OFC', label: 'Logistic' },
  { code: 'YNT', label: 'Management' },
  { code: '#', label: 'Undefined' },
]

/** BoardReport "% of Loading" grafiğinin sütunları; OTHERS = YNT + OFC + KON. */
export const LOSS_CHART_GROUPS: { key: string; label: string; codes: string[] }[] = [
  { key: 'die', label: 'Die', codes: ['KLP'] },
  { key: 'setup', label: 'Setup', codes: ['STP'] },
  { key: 'machine', label: 'Machine', codes: ['ARZ'] },
  { key: 'short', label: 'Short', codes: ['KSD'] },
  { key: 'others', label: 'Others', codes: ['YNT', 'OFC', 'KON'] },
  { key: 'speed', label: 'Speed', codes: [] },
]

export type Area = 'PRS' | 'APR'

// ---- tipler ------------------------------------------------------------------

export interface OeeTimes {
  good: number
  scrap: number
  reject: number
  scheduledMin: number
  unscheduledMin: number
  operatingMin: number
  productionMin: number
  loadingMin: number
}

export interface ShiftRow extends OeeTimes {
  date: string
  plantKey: string
  responsible: string
  costCenter: string
  workCenter: string
  shiftGroup: string
  shiftDefinition: string
  /** Dosyadaki oranlar (%), gösterim için; hesap toplamdan yapılır. */
  availability: number
  quality: number
  performance: number
  oee: number
}

export interface OrderRow extends OeeTimes {
  date: string
  plant: string
  plantName: string
  workCenter: string
  shift: string
  order: string
  equipment: string
  material: string
  availability: number
  quality: number
  performance: number
  oee: number
}

export interface WeeklyRow extends OeeTimes {
  year: number
  week: number
  plantKey: string
  responsible: string
  costCenter: string
  workCenter: string
  scheduledSec: number
  availability: number
  quality: number
  performance: number
  oee: number
  /** 'archive' = Weekly KPI_fix (geçmiş haftalar arşivi); yoksa Weekly KPI. */
  source?: 'archive' | 'weekly'
}

export interface MonthlyRow extends OeeTimes {
  month: string
  monthKey: string
  plantKey: string
  responsible: string
  costCenter: string
  workCenter: string
  scheduledSec: number
  availability: number
  quality: number
  performance: number
  oee: number
}

/**
 * Bir duruş satırı. Sunucuda gün × iş merkezi başına tek kayıtta dizi olarak
 * durur (satır sayısı çok), bu yüzden alan adları kısa tutulmadı ama gün,
 * iş merkezi ve masraf yeri üst kayıttadır.
 */
export interface DowntimeEvent {
  order: string
  material: string
  mold: string
  shiftGroup: string
  shiftDefinition: string
  rc1: string
  rc2: string
  rc3: string
  rc4: string
  rc5: string
  textEn: string
  textTr: string
  seconds: number
  minutes: number
  startDate: string
  startTime: string
  endDate: string
  endTime: string
}

export interface DowntimeDay {
  date: string
  plant: string
  plantKey: string
  costCenter: string
  workCenter: string
  events: DowntimeEvent[]
}

/** Gün × iş merkezi kayıp özeti (trend ve karşılaştırma bunu okur). */
export interface LossDay {
  date: string
  costCenter: string
  workCenter: string
  /** Kayıp grubu → dakika (plansız; "#" grubu bütün satırlar). */
  minutes: Record<string, number>
  counts: Record<string, number>
  /** Plansız duruş nedeni (EN) → [dakika, adet, grup]. */
  reasons: Record<string, [number, number, string]>
}

export const EMPTY_TIMES: OeeTimes = {
  good: 0,
  scrap: 0,
  reject: 0,
  scheduledMin: 0,
  unscheduledMin: 0,
  operatingMin: 0,
  productionMin: 0,
  loadingMin: 0,
}

// ---- oranlar -----------------------------------------------------------------

export interface OeeRatios {
  availability: number | null
  performance: number | null
  quality: number | null
  oee: number | null
}

export function addTimes(a: OeeTimes, b: OeeTimes): OeeTimes {
  return {
    good: a.good + b.good,
    scrap: a.scrap + b.scrap,
    reject: a.reject + b.reject,
    scheduledMin: a.scheduledMin + b.scheduledMin,
    unscheduledMin: a.unscheduledMin + b.unscheduledMin,
    operatingMin: a.operatingMin + b.operatingMin,
    productionMin: a.productionMin + b.productionMin,
    loadingMin: a.loadingMin + b.loadingMin,
  }
}

export function sumTimes(rows: OeeTimes[]): OeeTimes {
  return rows.reduce(addTimes, EMPTY_TIMES)
}

/** Toplam süreden oranlar (0–1). Loading yoksa oran yok. */
export function ratios(t: OeeTimes): OeeRatios {
  if (!(t.loadingMin > 0)) return { availability: null, performance: null, quality: null, oee: null }
  const availability = t.productionMin / t.loadingMin
  const performance = t.productionMin > 0 ? t.operatingMin / t.productionMin : 0
  const total = t.good + t.scrap + t.reject
  const quality = total > 0 ? t.good / total : 1
  return { availability, performance, quality, oee: availability * performance * quality }
}

export const oeeOf = (t: OeeTimes) => ratios(t).oee

// ---- tarih -------------------------------------------------------------------

const DAY_MS = 86_400_000

export function isoWeek(iso: string): { year: number; week: number } {
  const d = new Date(`${iso}T00:00:00Z`)
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3) // o haftanın Perşembesi
  const year = d.getUTCFullYear()
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const firstThursday = jan4.getTime() + (3 - ((jan4.getUTCDay() + 6) % 7)) * DAY_MS
  const week = 1 + Math.round((d.getTime() - firstThursday) / (7 * DAY_MS))
  return { year, week }
}

export function mondayOfIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** ISO yıl-haftanın Pazartesisi. */
export function mondayOfWeek(year: number, week: number): string {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY_MS)
  return new Date(monday.getTime() + (week - 1) * 7 * DAY_MS).toISOString().slice(0, 10)
}

export const weekKey = (year: number, week: number) => `${year}-W${String(week).padStart(2, '0')}`

// ---- kapsam: PRS / APR, masraf yeri, makine --------------------------------------

export function areaOf(workCenter: string): Area | null {
  const p = workCenter.trim().toUpperCase().slice(0, 3)
  return p === 'PRS' || p === 'APR' ? p : null
}

/**
 * Seçim: PRS için masraf yeri (Transfer / Progressive) ya da hepsi; APR'de
 * hepsi aynı masraf yerinde olduğundan makine (iş merkezi) ya da hepsi.
 */
export interface Scope {
  area: Area
  /** 'all', bir masraf yeri (PRS) ya da bir iş merkezi (APR). */
  key: string
}

export function inScope(row: { workCenter: string; costCenter: string }, scope: Scope): boolean {
  if (areaOf(row.workCenter) !== scope.area) return false
  if (scope.key === 'all') return true
  return scope.area === 'PRS' ? row.costCenter === scope.key : row.workCenter === scope.key
}

export function scopeLabel(scope: Scope): string {
  if (scope.key === 'all') return scope.area === 'PRS' ? 'All presses' : 'All APR machines'
  return scope.area === 'PRS' ? COST_CENTERS[scope.key] ?? scope.key : scope.key
}

/** Kapsam seçenekleri: PRS'de verideki masraf yerleri, APR'de makineler. */
export function scopeOptions(area: Area, rows: { workCenter: string; costCenter: string }[]): { key: string; label: string }[] {
  const out = [{ key: 'all', label: area === 'PRS' ? 'All presses' : 'All APR machines' }]
  const seen = new Set<string>()
  for (const r of rows) {
    if (areaOf(r.workCenter) !== area) continue
    const key = area === 'PRS' ? r.costCenter : r.workCenter
    if (key && !seen.has(key)) seen.add(key)
  }
  const keys = [...seen].sort((a, b) => (COST_CENTERS[a] ?? a).localeCompare(COST_CENTERS[b] ?? b))
  for (const key of keys) out.push({ key, label: area === 'PRS' ? COST_CENTERS[key] ?? key : key })
  return out
}

// ---- seriler -----------------------------------------------------------------

export interface SeriesPoint {
  key: string
  label: string
  times: OeeTimes
  oee: number | null
}

const point = (key: string, label: string, times: OeeTimes): SeriesPoint => ({ key, label, times, oee: oeeOf(times) })

/**
 * Hafta × iş merkezi süreleri. Yüklenen haftalık satır (Weekly KPI /
 * Weekly KPI_fix) o hafta ve iş merkezi için varsa o geçerlidir — haftanın
 * tamamını kapsar. Yoksa hafta, vardiya satırlarının toplamıdır.
 */
export function weekTimesByWorkCenter(
  shifts: ShiftRow[],
  weekly: WeeklyRow[],
): Map<string, { workCenter: string; costCenter: string; year: number; week: number; times: OeeTimes }> {
  const out = new Map<string, { workCenter: string; costCenter: string; year: number; week: number; times: OeeTimes }>()
  for (const r of shifts) {
    const { year, week } = isoWeek(r.date)
    const key = `${weekKey(year, week)}|${r.workCenter}`
    const cur = out.get(key)
    out.set(key, { workCenter: r.workCenter, costCenter: r.costCenter, year, week, times: addTimes(cur?.times ?? EMPTY_TIMES, r) })
  }
  const uploaded = new Map<string, { workCenter: string; costCenter: string; year: number; week: number; times: OeeTimes }>()
  for (const r of weekly) {
    const key = `${weekKey(r.year, r.week)}|${r.workCenter}`
    const cur = uploaded.get(key)
    uploaded.set(key, { workCenter: r.workCenter, costCenter: r.costCenter, year: r.year, week: r.week, times: addTimes(cur?.times ?? EMPTY_TIMES, r) })
  }
  for (const [key, value] of uploaded) out.set(key, value)
  return out
}

/** Programdaki Weekly KPI_fix arşivi (src/lib/oeeWeeklyArchive.ts) → satırlar. */
export function archiveRows(data: (string | number)[][], year: number): WeeklyRow[] {
  const n = (v: string | number) => (typeof v === 'number' ? v : Number(v) || 0)
  return data.map((r) => ({
    year,
    week: n(r[0]),
    plantKey: String(r[1]),
    responsible: String(r[2]),
    costCenter: String(r[3]),
    workCenter: String(r[4]),
    good: n(r[5]),
    scrap: n(r[6]),
    reject: n(r[7]),
    scheduledSec: n(r[8]),
    scheduledMin: n(r[9]),
    unscheduledMin: n(r[10]),
    operatingMin: n(r[11]),
    productionMin: n(r[12]),
    loadingMin: n(r[13]),
    availability: n(r[14]),
    quality: n(r[15]),
    performance: n(r[16]),
    oee: n(r[17]),
    source: 'archive',
  }))
}

/**
 * Haftalık satırların birleşimi. Öncelik (yüksekten düşüğe): yüklenen
 * Weekly KPI_fix (arşiv düzeltmesi) > programdaki arşiv > yüklenen Weekly
 * KPI. Arşivde olan bir hafta yeni yüklemeyle silinmez ya da ezilmez;
 * arşivde olmayan haftalar yüklenen Weekly KPI'dan (o da yoksa vardiyadan).
 */
export function mergeWeekly(archive: WeeklyRow[], uploaded: WeeklyRow[]): WeeklyRow[] {
  const key = (r: WeeklyRow) => `${r.year}|${r.week}|${r.workCenter}`
  const out = new Map<string, WeeklyRow>()
  const archivedWeeks = new Set(archive.map((r) => `${r.year}|${r.week}`))
  for (const r of uploaded) if (r.source !== 'archive' && !archivedWeeks.has(`${r.year}|${r.week}`)) out.set(key(r), r)
  for (const r of archive) out.set(key(r), r)
  for (const r of uploaded) if (r.source === 'archive') out.set(key(r), r)
  return [...out.values()]
}

/** Son n hafta (seçilen hafta dahil), kapsamın toplamı ve iş merkezi başına. */
export function weeklyTrend(
  shifts: ShiftRow[],
  weekly: WeeklyRow[],
  scope: Scope,
  endMonday: string,
  n = 10,
): { weeks: SeriesPoint[]; byWorkCenter: Map<string, SeriesPoint[]> } {
  const all = weekTimesByWorkCenter(shifts, weekly)
  const weeks: SeriesPoint[] = []
  const byWc = new Map<string, SeriesPoint[]>()
  const wcs = [...new Set([...all.values()].filter((v) => inScope(v, scope)).map((v) => v.workCenter))].sort()
  for (const wc of wcs) byWc.set(wc, [])
  for (let i = n - 1; i >= 0; i--) {
    const monday = addDaysIso(endMonday, -7 * i)
    const { year, week } = isoWeek(monday)
    const wk = weekKey(year, week)
    let total = EMPTY_TIMES
    for (const wc of wcs) {
      const hit = all.get(`${wk}|${wc}`)
      const t = hit && inScope(hit, scope) ? hit.times : EMPTY_TIMES
      total = addTimes(total, t)
      byWc.get(wc)!.push(point(wk, `W${week}`, t))
    }
    weeks.push(point(wk, `W${week}`, total))
  }
  return { weeks, byWorkCenter: byWc }
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Monthly KPI olduğu gibi: ay anahtarına göre, kapsamın toplamı ve iş merkezi başına. */
export function monthlyTrend(
  monthly: MonthlyRow[],
  scope: Scope,
): { months: SeriesPoint[]; byWorkCenter: Map<string, SeriesPoint[]> } {
  const rows = monthly.filter((r) => inScope(r, scope))
  const keys = [...new Set(rows.map((r) => r.monthKey))].sort()
  const wcs = [...new Set(rows.map((r) => r.workCenter))].sort()
  const label = (k: string) => MONTH_LABELS[Number(k) - 1] ?? k
  const months = keys.map((k) => point(k, label(k), sumTimes(rows.filter((r) => r.monthKey === k))))
  const byWc = new Map<string, SeriesPoint[]>()
  for (const wc of wcs) {
    byWc.set(
      wc,
      keys.map((k) => point(k, label(k), sumTimes(rows.filter((r) => r.monthKey === k && r.workCenter === wc)))),
    )
  }
  return { months, byWorkCenter: byWc }
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Seçilen haftanın 21 vardiyası (Pzt-1 … Paz-3), BoardReport'taki gibi. */
export function weekShiftTrend(
  shifts: ShiftRow[],
  scope: Scope,
  monday: string,
): { slots: SeriesPoint[]; byWorkCenter: Map<string, SeriesPoint[]> } {
  const rows = shifts.filter((r) => inScope(r, scope))
  const wcs = [...new Set(rows.map((r) => r.workCenter))].sort()
  const slots: SeriesPoint[] = []
  const byWc = new Map<string, SeriesPoint[]>(wcs.map((wc) => [wc, []]))
  for (let d = 0; d < 7; d++) {
    const date = addDaysIso(monday, d)
    for (let s = 1; s <= 3; s++) {
      const key = `${date}|${s}`
      const label = `${DAY_LABELS[d]}-${s}`
      const hit = rows.filter((r) => r.date === date && SHIFT_NUMBER[r.shiftGroup] === s)
      slots.push(point(key, label, sumTimes(hit)))
      for (const wc of wcs) byWc.get(wc)!.push(point(key, label, sumTimes(hit.filter((r) => r.workCenter === wc))))
    }
  }
  return { slots, byWorkCenter: byWc }
}

/** Bir günün (ya da gün aralığının) kapsam toplamı. */
export function totalsFor(shifts: ShiftRow[], scope: Scope, from: string, to: string): OeeTimes {
  return sumTimes(shifts.filter((r) => r.date >= from && r.date <= to && inScope(r, scope)))
}

// ---- kayıplar ----------------------------------------------------------------

/** Duruş satırlarından gün × iş merkezi özeti (yüklemede bir kez hesaplanır). */
export function lossDayOf(day: DowntimeDay): LossDay {
  const minutes: Record<string, number> = {}
  const counts: Record<string, number> = {}
  const reasons: Record<string, [number, number, string]> = {}
  for (const e of day.events) {
    const group = e.rc2 || '#'
    // Excel Losses_Follow: gruplar yalnızca plansız duruşla; "#" bütün satırlarla.
    const counted = group === '#' ? true : e.rc1 === 'UNSCD_DOWN'
    if (!counted) continue
    minutes[group] = (minutes[group] ?? 0) + e.minutes
    counts[group] = (counts[group] ?? 0) + 1
    const text = e.textEn || '#'
    const cur = reasons[text] ?? [0, 0, group]
    reasons[text] = [cur[0] + e.minutes, cur[1] + 1, group]
  }
  return { date: day.date, costCenter: day.costCenter, workCenter: day.workCenter, minutes, counts, reasons }
}

export interface LossBreakdown {
  loadingMin: number
  /** Grup → dakika; "speed" = Production − Operation. */
  minutes: Record<string, number>
  /** Grup → Loading'e oran (0–1). */
  share: Record<string, number>
  oee: number | null
}

/** Bir dönemin kayıpları: duruş dakikası ÷ Loading (Excel % of Loading). */
export function lossBreakdown(times: OeeTimes, lossDays: LossDay[]): LossBreakdown {
  const minutes: Record<string, number> = {}
  for (const d of lossDays) for (const [g, m] of Object.entries(d.minutes)) minutes[g] = (minutes[g] ?? 0) + m
  minutes.speed = Math.max(0, times.productionMin - times.operatingMin)
  const share: Record<string, number> = {}
  for (const [g, m] of Object.entries(minutes)) share[g] = times.loadingMin > 0 ? m / times.loadingMin : 0
  return { loadingMin: times.loadingMin, minutes, share, oee: oeeOf(times) }
}

/** Grafik grubu payı (OTHERS birden çok kodu toplar). */
export function chartShare(b: LossBreakdown, key: string): number {
  const g = LOSS_CHART_GROUPS.find((x) => x.key === key)
  if (!g) return 0
  if (key === 'speed') return b.share.speed ?? 0
  return g.codes.reduce((a, c) => a + (b.share[c] ?? 0), 0)
}

export function lossForPeriod(
  shifts: ShiftRow[],
  lossDays: LossDay[],
  scope: Scope,
  from: string,
  to: string,
  workCenter?: string,
): LossBreakdown {
  const sel = (r: { date: string; workCenter: string; costCenter: string }) =>
    r.date >= from && r.date <= to && inScope(r, scope) && (!workCenter || r.workCenter === workCenter)
  return lossBreakdown(sumTimes(shifts.filter(sel)), lossDays.filter(sel))
}

export interface GapRow {
  key: string
  label: string
  isGroup: boolean
  current: LossBreakdown
  previous: LossBreakdown
}

/**
 * Bu hafta ile geçen haftanın karşılaştırması: masraf yeri toplamları ve
 * pres (iş merkezi) satırları. Fark = bu hafta − geçen hafta (puan).
 */
export function weekGap(shifts: ShiftRow[], lossDays: LossDay[], scope: Scope, monday: string): GapRow[] {
  const prev = addDaysIso(monday, -7)
  const cur = { from: monday, to: addDaysIso(monday, 6) }
  const old = { from: prev, to: addDaysIso(prev, 6) }
  const rows = shifts.filter((r) => inScope(r, scope) && r.date >= old.from && r.date <= cur.to)
  const out: GapRow[] = []
  const groups =
    scope.area === 'PRS'
      ? [...new Set(rows.map((r) => r.costCenter))].sort()
      : scope.key === 'all'
        ? ['all']
        : []
  for (const g of groups) {
    const s: Scope = scope.area === 'PRS' ? { area: 'PRS', key: g } : { area: 'APR', key: 'all' }
    out.push({
      key: `group:${g}`,
      label: scopeLabel(s),
      isGroup: true,
      current: lossForPeriod(shifts, lossDays, s, cur.from, cur.to),
      previous: lossForPeriod(shifts, lossDays, s, old.from, old.to),
    })
    const wcs = [...new Set(rows.filter((r) => inScope(r, s)).map((r) => r.workCenter))].sort()
    for (const wc of wcs) {
      out.push({
        key: wc,
        label: wc,
        isGroup: false,
        current: lossForPeriod(shifts, lossDays, s, cur.from, cur.to, wc),
        previous: lossForPeriod(shifts, lossDays, s, old.from, old.to, wc),
      })
    }
  }
  if (scope.area === 'APR' && scope.key !== 'all') {
    out.push({
      key: scope.key,
      label: scope.key,
      isGroup: false,
      current: lossForPeriod(shifts, lossDays, scope, cur.from, cur.to),
      previous: lossForPeriod(shifts, lossDays, scope, old.from, old.to),
    })
  }
  return out
}

export interface ReasonRow {
  text: string
  group: string
  minutes: number
  count: number
  previousMinutes: number
}

/** Duruş nedenleri (plansız), bu hafta ve geçen hafta, çoktan aza. */
export function reasonPareto(lossDays: LossDay[], scope: Scope, monday: string): ReasonRow[] {
  const prev = addDaysIso(monday, -7)
  const end = addDaysIso(monday, 6)
  const map = new Map<string, ReasonRow>()
  for (const d of lossDays) {
    if (!inScope(d, scope) || d.date < prev || d.date > end) continue
    const current = d.date >= monday
    for (const [text, [min, count, group]] of Object.entries(d.reasons)) {
      const row = map.get(text) ?? { text, group, minutes: 0, count: 0, previousMinutes: 0 }
      if (current) {
        row.minutes += min
        row.count += count
      } else row.previousMinutes += min
      map.set(text, row)
    }
  }
  return [...map.values()].filter((r) => r.minutes > 0 || r.previousMinutes > 0).sort((a, b) => b.minutes - a.minutes)
}

// ---- kalıplar ----------------------------------------------------------------

export interface DieRow {
  workCenter: string
  equipment: string
  good: number
  loadingMin: number
  speedLossMin: number
  /** İyi adetle ağırlıklı OEE (0–1). */
  weightedOee: number | null
  orders: number
}

/** Kalıp (Equipment) × pres: adet ağırlıklı OEE ve speed loss (Excel TOTAL1). */
export function dieTable(
  orders: OrderRow[],
  scope: Scope,
  from: string,
  to: string,
  /** İş merkezi → masraf yeri (Order Based'de masraf yeri yok; vardiya verisinden). */
  costCenterOf: Map<string, string>,
): DieRow[] {
  const map = new Map<string, DieRow & { weighted: number; orderSet: Set<string> }>()
  for (const o of orders) {
    if (o.date < from || o.date > to) continue
    if (!inScope({ workCenter: o.workCenter, costCenter: costCenterOf.get(o.workCenter) ?? '' }, scope)) continue
    const key = `${o.workCenter}|${o.equipment}`
    const cur =
      map.get(key) ??
      { workCenter: o.workCenter, equipment: o.equipment, good: 0, loadingMin: 0, speedLossMin: 0, weightedOee: null, orders: 0, weighted: 0, orderSet: new Set<string>() }
    cur.good += o.good
    cur.loadingMin += o.loadingMin
    cur.speedLossMin += o.productionMin - o.operatingMin
    cur.weighted += o.oee * o.good
    cur.orderSet.add(o.order)
    map.set(key, cur)
  }
  return [...map.values()].map(({ weighted, orderSet, ...r }) => ({
    ...r,
    orders: orderSet.size,
    weightedOee: r.good > 0 ? weighted / r.good / 100 : null,
  }))
}

/** İş merkezi → masraf yeri, vardiya verisinden. */
export function costCentersOf(rows: { workCenter: string; costCenter: string }[]): Map<string, string> {
  return new Map(rows.filter((r) => r.costCenter).map((r) => [r.workCenter, r.costCenter]))
}

// ---- makine arızası: MTTR / MTBF ------------------------------------------------

export interface ReliabilityRow {
  workCenter: string
  breakdowns: number
  breakdownMin: number
  /** Ortalama onarım süresi (dk) = arıza dakikası ÷ arıza sayısı. */
  mttrMin: number | null
  /** Arızalar arası ortalama çalışma (dk) = Production ÷ arıza sayısı. */
  mtbfMin: number | null
}

export function reliability(
  shifts: ShiftRow[],
  lossDays: LossDay[],
  scope: Scope,
  from: string,
  to: string,
  group = 'ARZ',
): ReliabilityRow[] {
  const sel = (r: { date: string; workCenter: string; costCenter: string }) => r.date >= from && r.date <= to && inScope(r, scope)
  const wcs = [...new Set(shifts.filter(sel).map((r) => r.workCenter))].sort()
  return wcs.map((wc) => {
    const days = lossDays.filter((d) => sel(d) && d.workCenter === wc)
    const breakdowns = days.reduce((a, d) => a + (d.counts[group] ?? 0), 0)
    const breakdownMin = days.reduce((a, d) => a + (d.minutes[group] ?? 0), 0)
    const production = sumTimes(shifts.filter((r) => sel(r) && r.workCenter === wc)).productionMin
    return {
      workCenter: wc,
      breakdowns,
      breakdownMin,
      mttrMin: breakdowns > 0 ? breakdownMin / breakdowns : null,
      mtbfMin: breakdowns > 0 ? production / breakdowns : null,
    }
  })
}

// ---- setup analizi -------------------------------------------------------------

/**
 * Setup sayılan duruşlar: yalnızca planlı / plansız kalıp setup'ı (PRS
 * İngilizce, APR Rumence metin). Sensör ayarı, bobin setup'ı vb. setup
 * sayılmaz; setup'tan sonra olursa "üretime geçememe" nedenidir.
 */
export const DIE_SETUP_TEXTS: Record<string, 'planned' | 'unplanned'> = {
  'DIE SETUP - PLANNED': 'planned',
  'DIE SETUP - UNPLANNED': 'unplanned',
  'REGLAJ MATRITA - PLANIFICATA': 'planned',
  'REGLAJ MATRITA - NEPLANIFICATA': 'unplanned',
}

/** Setup'tan sonra bu kadar üretim yapılırsa setup OK (planlamacının kararı). */
export const STARTUP_RUN_MIN = 60

/** Planlı duruş (mola) kaybı bu anahtarla ayrı tutulur. */
export const BREAK_KEY = 'BREAK'

export type SetupStatus = 'ok' | 'nok' | 'open'

export interface SetupRow {
  workCenter: string
  order: string
  material: string
  /** "YYYY-MM-DD HH:MM" */
  start: string
  end: string
  kind: 'planned' | 'unplanned' | 'mixed'
  setupMin: number
  status: SetupStatus
  /** Setup bitişinden STARTUP_RUN_MIN üretime ulaşana kadar geçen süre (OK ise). */
  timeToRunMin: number | null
  /** Bir sonraki kalıp setup'ına kadar yapılabilen üretim (NOK ise < 60). */
  runMin: number
  /** Setup bitişinden 1 saat üretime (ya da sonraki setup'a) kadar duruşlar: grup → dk. */
  lost: Record<string, number>
  /** NOK'un ana nedeni: en çok kaybettiren grup; duruş yoksa "next-setup". */
  mainReason: string | null
  nextSetup: string | null
  good: number
}

const toMin = (date: string, time: string) => Date.parse(`${date}T${time || '00:00:00'}Z`) / 60_000
const fmtMin = (m: number) => new Date(m * 60_000).toISOString().slice(0, 16).replace('T', ' ')

interface Span {
  s: number
  e: number
  ev: DowntimeEvent
}

/**
 * Setup'tan sonra üretime geçiş: kalıp setup'ı bittikten sonra, bir sonraki
 * kalıp setup'ından önce toplam STARTUP_RUN_MIN dakika üretim (duruş
 * olmayan süre) yapılabildiyse OK, yapılamadıysa NOK. Aradaki duruşlar
 * nedendir (KSD, STP, KLP …; molalar ayrı). Veri bitmeden sonuç belli
 * değilse "open". Arka arkaya setup kayıtları (araya üretim girmemişse —
 * vardiya değişimi, mola) tek setup sayılır; sipariş sonuncusudur. Setup'ı
 * [from, to] içinde başlayanlar.
 */
export function setupAnalysis(days: DowntimeDay[], orders: OrderRow[], scope: Scope, from: string, to: string): SetupRow[] {
  const byWc = new Map<string, Span[]>()
  let dataEnd = -Infinity
  for (const d of days) {
    if (!inScope(d, scope)) continue
    const list = byWc.get(d.workCenter) ?? []
    for (const ev of d.events) {
      const s = toMin(ev.startDate || d.date, ev.startTime)
      let e = toMin(ev.endDate || ev.startDate || d.date, ev.endTime)
      if (!Number.isFinite(s)) continue
      if (!Number.isFinite(e) || e < s) e = s + ev.minutes
      list.push({ s, e, ev })
      dataEnd = Math.max(dataEnd, e)
    }
    byWc.set(d.workCenter, list)
  }
  const goodBy = new Map<string, number>()
  for (const o of orders) goodBy.set(`${o.workCenter}|${o.order}`, (goodBy.get(`${o.workCenter}|${o.order}`) ?? 0) + o.good)

  const out: SetupRow[] = []
  for (const [wc, spans] of byWc) {
    spans.sort((a, b) => a.s - b.s)
    // Duruşların birleşimi: üretim = bu aralıkların dışında kalan süre.
    const union: [number, number][] = []
    for (const sp of spans) {
      const last = union[union.length - 1]
      if (last && sp.s <= last[1]) last[1] = Math.max(last[1], sp.e)
      else union.push([sp.s, sp.e])
    }
    const runBetween = (a: number, b: number) => {
      let down = 0
      for (const [s, e] of union) {
        if (e <= a) continue
        if (s >= b) break
        down += Math.min(e, b) - Math.max(s, a)
      }
      return Math.max(0, b - a - down)
    }
    /** a'dan itibaren `need` dakika üretimin tamamlandığı an (limit'e kadar). */
    const reachRun = (a: number, need: number, limit: number): number | null => {
      let cur = a
      let run = 0
      for (const [s, e] of union) {
        if (e <= cur) continue
        if (s >= limit) break
        if (s > cur) {
          const gap = s - cur
          if (run + gap >= need) return cur + (need - run)
          run += gap
        }
        cur = Math.max(cur, e)
        if (cur >= limit) return null
      }
      return cur + (need - run) <= limit ? cur + (need - run) : null
    }

    // Kalıp setup blokları.
    const blocks: { s: number; e: number; order: string; material: string; kinds: Set<string>; min: number }[] = []
    for (const sp of spans) {
      const kind = DIE_SETUP_TEXTS[sp.ev.textEn.trim().toUpperCase()]
      if (!kind) continue
      const last = blocks[blocks.length - 1]
      // Arada üretim yoksa (vardiya değişimi, mola, başka duruş) aynı setup sürüyor.
      if (last && runBetween(last.e, sp.s) < 1) {
        last.e = Math.max(last.e, sp.e)
        last.order = sp.ev.order || last.order
        last.material = sp.ev.material || last.material
        last.kinds.add(kind)
        last.min += sp.ev.minutes
      } else {
        blocks.push({ s: sp.s, e: sp.e, order: sp.ev.order, material: sp.ev.material, kinds: new Set([kind]), min: sp.ev.minutes })
      }
    }

    blocks.forEach((b, i) => {
      const day = fmtMin(b.s).slice(0, 10)
      if (day < from || day > to) return
      const next = blocks[i + 1]
      const limit = next ? next.s : dataEnd
      const reached = reachRun(b.e, STARTUP_RUN_MIN, limit)
      const windowEnd = reached ?? limit
      const lost: Record<string, number> = {}
      for (const sp of spans) {
        if (sp.e <= b.e || sp.s >= windowEnd) continue
        const m = Math.min(sp.e, windowEnd) - Math.max(sp.s, b.e)
        if (m <= 0) continue
        const key = sp.ev.rc1 === 'SCHED_DOWN' ? BREAK_KEY : sp.ev.rc2 || '#'
        lost[key] = (lost[key] ?? 0) + m
      }
      const status: SetupStatus = reached !== null ? 'ok' : next ? 'nok' : 'open'
      const reasons = Object.entries(lost).filter(([k]) => k !== BREAK_KEY).sort((x, y) => y[1] - x[1])
      out.push({
        workCenter: wc,
        order: b.order,
        material: b.material,
        start: fmtMin(b.s),
        end: fmtMin(b.e),
        kind: b.kinds.size > 1 ? 'mixed' : (([...b.kinds][0] ?? 'planned') as 'planned' | 'unplanned'),
        setupMin: b.min,
        status,
        timeToRunMin: reached !== null ? reached - b.e : null,
        runMin: Math.min(STARTUP_RUN_MIN, runBetween(b.e, windowEnd)),
        lost,
        mainReason: status === 'nok' ? (reasons[0]?.[0] ?? 'next-setup') : null,
        nextSetup: next ? fmtMin(next.s) : null,
        good: goodBy.get(`${wc}|${b.order}`) ?? 0,
      })
    })
  }
  return out.sort((a, b) => a.workCenter.localeCompare(b.workCenter) || a.start.localeCompare(b.start))
}

// ---- Excel'den okuma -------------------------------------------------------------

/** Bir sayfanın satırları: ilk satır başlık (sheet_to_json header:1, raw). */
export type SheetRows = unknown[][]

export const OEE_SHEET_NAMES = {
  shiftly: ['shiftly kpi'],
  orders: ['shiftly order based kpi', 'shiftly base order kpi', 'shiftly order base kpi'],
  weekly: ['weekly kpi', 'weekly kpi_fix'],
  monthly: ['monthly kpi'],
  downtimes: ['downtimes'],
} as const

/** Sayfa adını türüne eşler; "Daily KPI" alınmaz (vardiyadan hesaplanır). */
export function sheetKind(name: string): keyof typeof OEE_SHEET_NAMES | null {
  const n = name.trim().toLowerCase()
  if (n.startsWith('downtimes')) return 'downtimes'
  for (const [kind, names] of Object.entries(OEE_SHEET_NAMES)) {
    if ((names as readonly string[]).includes(n)) return kind as keyof typeof OEE_SHEET_NAMES
  }
  return null
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

function headerIndex(header: unknown[], names: string[]): number {
  const h = header.map(norm)
  for (const n of names) {
    const i = h.indexOf(norm(n))
    if (i >= 0) return i
  }
  return -1
}

/** Excel seri günü, Date ya da metin → ISO tarih. */
export function toIsoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = Date.UTC(1899, 11, 30) + Math.floor(v) * DAY_MS
    return new Date(ms).toISOString().slice(0, 10)
  }
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

/** Excel saat kesri ya da "HH:MM:SS" → "HH:MM:SS". */
export function toTime(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const secs = Math.round((v - Math.floor(v)) * 86400)
    const h = Math.floor(secs / 3600) % 24
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  const s = String(v ?? '').trim()
  const m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}:${m[3] ?? '00'}` : ''
}

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())

type Col = { key: string; names: string[] }

function reader(header: unknown[], cols: Col[]) {
  const idx = new Map(cols.map((c) => [c.key, headerIndex(header, c.names)]))
  const missing = cols.filter((c) => idx.get(c.key)! < 0).map((c) => c.names[0])
  return {
    missing,
    get: (row: unknown[], key: string) => {
      const i = idx.get(key) ?? -1
      return i >= 0 ? row[i] : undefined
    },
  }
}

const TIME_COLS: Col[] = [
  { key: 'good', names: ['Good Quantity', 'GOODQUANTITY'] },
  { key: 'scrap', names: ['Scrap Quantity', 'SCRAPQUANTITY'] },
  { key: 'reject', names: ['Reject Quantity', 'REJECTQUANTITY'] },
  { key: 'sched', names: ['Scheduled Downtime(Min)', 'Scheduled Downtime (min)'] },
  { key: 'unsched', names: ['Unscheduled Downtime(Min)', 'Unscheduled Downtime (min)'] },
  { key: 'operating', names: ['Net Operating Time(Min)', 'Net Operating Time (min)'] },
  { key: 'production', names: ['Net Production Time(Min)', 'Net Production Time (min)'] },
  { key: 'loading', names: ['Loading Time(Min)', 'Loading Time (min)'] },
  { key: 'availability', names: ['Availability'] },
  { key: 'quality', names: ['Quality'] },
  { key: 'performance', names: ['Performance'] },
  { key: 'oee', names: ['Oee', 'OEE'] },
]

function timesFrom(get: (row: unknown[], key: string) => unknown, row: unknown[]) {
  return {
    good: num(get(row, 'good')),
    scrap: num(get(row, 'scrap')),
    reject: num(get(row, 'reject')),
    scheduledMin: num(get(row, 'sched')),
    unscheduledMin: num(get(row, 'unsched')),
    operatingMin: num(get(row, 'operating')),
    productionMin: num(get(row, 'production')),
    loadingMin: num(get(row, 'loading')),
    availability: num(get(row, 'availability')),
    quality: num(get(row, 'quality')),
    performance: num(get(row, 'performance')),
    oee: num(get(row, 'oee')),
  }
}

export interface ParsedOee {
  shifts: ShiftRow[]
  orders: OrderRow[]
  weekly: WeeklyRow[]
  monthly: MonthlyRow[]
  downtimes: DowntimeDay[]
  /** Okunan sayfalar ve satır sayıları. */
  read: { sheet: string; kind: string; rows: number }[]
  /** Eksik sütun gibi sorunlar. */
  problems: string[]
}

/**
 * Seçilen sayfaları okur. Haftalık sayfalarda yıl yok: hafta, dosyadaki en
 * son vardiya tarihinin haftasından büyükse bir önceki yıla aittir.
 */
export function parseOeeWorkbook(sheets: Record<string, SheetRows>, today = new Date().toISOString().slice(0, 10)): ParsedOee {
  const out: ParsedOee = { shifts: [], orders: [], weekly: [], monthly: [], downtimes: [], read: [], problems: [] }
  const byKind = new Map<string, [string, SheetRows][]>()
  for (const [name, rows] of Object.entries(sheets)) {
    const kind = sheetKind(name)
    if (!kind) continue
    byKind.set(kind, [...(byKind.get(kind) ?? []), [name, rows]])
  }

  for (const [name, rows] of byKind.get('shiftly') ?? []) {
    const r = reader(rows[0] ?? [], [
      { key: 'date', names: ['Date'] },
      { key: 'plant', names: ['Plant - Key', 'Plant'] },
      { key: 'resp', names: ['Production Responsible'] },
      { key: 'cc', names: ['Cost Center', 'Cost Center - Key'] },
      { key: 'wc', names: ['Work Center'] },
      { key: 'sg', names: ['Shift Group'] },
      { key: 'sd', names: ['Shift Definition'] },
      ...TIME_COLS,
    ])
    if (r.missing.length) out.problems.push(`${name}: missing columns ${r.missing.join(', ')}`)
    let n = 0
    for (const row of rows.slice(1)) {
      const date = toIsoDate(r.get(row, 'date'))
      const wc = str(r.get(row, 'wc'))
      if (!date || !wc) continue
      out.shifts.push({
        date,
        plantKey: str(r.get(row, 'plant')),
        responsible: str(r.get(row, 'resp')),
        costCenter: str(r.get(row, 'cc')),
        workCenter: wc,
        shiftGroup: str(r.get(row, 'sg')),
        shiftDefinition: str(r.get(row, 'sd')),
        ...timesFrom(r.get, row),
      })
      n++
    }
    out.read.push({ sheet: name, kind: 'shiftly', rows: n })
  }

  const lastShift = out.shifts.reduce((m, s) => (s.date > m ? s.date : m), '') || today
  const ref = isoWeek(lastShift)

  for (const [name, rows] of byKind.get('orders') ?? []) {
    const r = reader(rows[0] ?? [], [
      { key: 'date', names: ['Date'] },
      { key: 'plant', names: ['Plant'] },
      { key: 'plantName', names: ['Plant Name'] },
      { key: 'wc', names: ['workcenter', 'Work Center'] },
      { key: 'shift', names: ['Shift'] },
      { key: 'order', names: ['Order'] },
      { key: 'eq', names: ['Equipment'] },
      { key: 'mat', names: ['Material'] },
      ...TIME_COLS,
    ])
    if (r.missing.length) out.problems.push(`${name}: missing columns ${r.missing.join(', ')}`)
    let n = 0
    for (const row of rows.slice(1)) {
      const date = toIsoDate(r.get(row, 'date'))
      const wc = str(r.get(row, 'wc'))
      if (!date || !wc) continue
      out.orders.push({
        date,
        plant: str(r.get(row, 'plant')),
        plantName: str(r.get(row, 'plantName')),
        workCenter: wc,
        shift: str(r.get(row, 'shift')),
        order: str(r.get(row, 'order')),
        equipment: str(r.get(row, 'eq')),
        material: str(r.get(row, 'mat')),
        ...timesFrom(r.get, row),
      })
      n++
    }
    out.read.push({ sheet: name, kind: 'orders', rows: n })
  }

  const periodCols: Col[] = [
    { key: 'plant', names: ['Plant - Key'] },
    { key: 'resp', names: ['Production Responsible'] },
    { key: 'cc', names: ['Cost Center - Key', 'Cost Center'] },
    { key: 'wc', names: ['Work Center'] },
    { key: 'schedSec', names: ['Scheduled Downtime'] },
    ...TIME_COLS,
  ]

  // Aynı hafta iki sayfada varsa Weekly KPI_fix (arşiv) geçerlidir: Weekly KPI'ın
  // ilk haftası yarım olabiliyor (ör. 36. hafta 31 Ağustos'suz), arşiv tamdır.
  const isArchive = (name: string) => name.trim().toLowerCase() === 'weekly kpi_fix'
  const weeklySheets = [...(byKind.get('weekly') ?? [])].sort(([a], [b]) => (isArchive(a) ? 1 : 0) - (isArchive(b) ? 1 : 0))
  const weekly = new Map<string, WeeklyRow>()
  for (const [name, rows] of weeklySheets) {
    const r = reader(rows[0] ?? [], [{ key: 'week', names: ['Week'] }, ...periodCols])
    if (r.missing.length) out.problems.push(`${name}: missing columns ${r.missing.join(', ')}`)
    let n = 0
    for (const row of rows.slice(1)) {
      const week = Math.round(num(r.get(row, 'week')))
      const wc = str(r.get(row, 'wc'))
      if (!(week >= 1 && week <= 53) || !wc) continue
      const year = week > ref.week ? ref.year - 1 : ref.year
      weekly.set(`${year}|${week}|${wc}`, {
        year,
        week,
        plantKey: str(r.get(row, 'plant')),
        responsible: str(r.get(row, 'resp')),
        costCenter: str(r.get(row, 'cc')),
        workCenter: wc,
        scheduledSec: num(r.get(row, 'schedSec')),
        ...timesFrom(r.get, row),
        source: isArchive(name) ? 'archive' : 'weekly',
      })
      n++
    }
    out.read.push({ sheet: name, kind: 'weekly', rows: n })
  }
  out.weekly = [...weekly.values()]

  for (const [name, rows] of byKind.get('monthly') ?? []) {
    const r = reader(rows[0] ?? [], [{ key: 'month', names: ['Month'] }, { key: 'key', names: ['Month Key'] }, ...periodCols])
    if (r.missing.length) out.problems.push(`${name}: missing columns ${r.missing.join(', ')}`)
    let n = 0
    for (const row of rows.slice(1)) {
      const wc = str(r.get(row, 'wc'))
      const rawKey = str(r.get(row, 'key'))
      if (!wc || !rawKey) continue
      out.monthly.push({
        month: str(r.get(row, 'month')),
        monthKey: rawKey.padStart(2, '0'),
        plantKey: str(r.get(row, 'plant')),
        responsible: str(r.get(row, 'resp')),
        costCenter: str(r.get(row, 'cc')),
        workCenter: wc,
        scheduledSec: num(r.get(row, 'schedSec')),
        ...timesFrom(r.get, row),
      })
      n++
    }
    out.read.push({ sheet: name, kind: 'monthly', rows: n })
  }

  for (const [name, rows] of byKind.get('downtimes') ?? []) {
    const r = reader(rows[0] ?? [], [
      { key: 'date', names: ['Date'] },
      { key: 'plant', names: ['Plant'] },
      { key: 'plantKey', names: ['Plant - Key'] },
      { key: 'cc', names: ['Cost Center - Key'] },
      { key: 'wc', names: ['Work Center - Key (Not Compounded)', 'Work Center'] },
      { key: 'order', names: ['Order Number'] },
      { key: 'mat', names: ['Material'] },
      { key: 'mold', names: ['Mold Number'] },
      { key: 'sg', names: ['Shift Group'] },
      { key: 'sd', names: ['Shift Defination', 'Shift Definition'] },
      { key: 'rc1', names: ['Reason Code 1'] },
      { key: 'rc2', names: ['Reason Code 2'] },
      { key: 'rc3', names: ['Reason Code 3'] },
      { key: 'rc4', names: ['Reason Code 4'] },
      { key: 'rc5', names: ['Reason Code 5'] },
      { key: 'en', names: ['Reason Code Defination EN', 'Reason Code Definition EN'] },
      { key: 'tr', names: ['Reason Code Defination TR', 'Reason Code Definition TR'] },
      { key: 'sec', names: ['Stoppage Duration'] },
      { key: 'min', names: ['Stoppage Duration(Min)', 'Stoppage Duration (Min)'] },
      { key: 'sdate', names: ['StartDate'] },
      { key: 'stime', names: ['StartTime'] },
      { key: 'edate', names: ['EndDate'] },
      { key: 'etime', names: ['EndTime'] },
    ])
    if (r.missing.length) out.problems.push(`${name}: missing columns ${r.missing.join(', ')}`)
    const days = new Map<string, DowntimeDay>()
    let n = 0
    for (const row of rows.slice(1)) {
      const date = toIsoDate(r.get(row, 'date'))
      const wc = str(r.get(row, 'wc'))
      if (!date || !wc) continue
      const key = `${date}|${wc}`
      const day =
        days.get(key) ??
        { date, plant: str(r.get(row, 'plant')), plantKey: str(r.get(row, 'plantKey')), costCenter: str(r.get(row, 'cc')), workCenter: wc, events: [] }
      const seconds = num(r.get(row, 'sec'))
      const minutesRaw = r.get(row, 'min')
      day.events.push({
        order: str(r.get(row, 'order')),
        material: str(r.get(row, 'mat')),
        mold: str(r.get(row, 'mold')),
        shiftGroup: str(r.get(row, 'sg')),
        shiftDefinition: str(r.get(row, 'sd')),
        rc1: str(r.get(row, 'rc1')),
        rc2: str(r.get(row, 'rc2')),
        rc3: str(r.get(row, 'rc3')),
        rc4: str(r.get(row, 'rc4')),
        rc5: str(r.get(row, 'rc5')),
        textEn: str(r.get(row, 'en')),
        textTr: str(r.get(row, 'tr')),
        seconds,
        minutes: minutesRaw === undefined || minutesRaw === '' ? seconds / 60 : num(minutesRaw),
        startDate: toIsoDate(r.get(row, 'sdate')) ?? date,
        startTime: toTime(r.get(row, 'stime')),
        endDate: toIsoDate(r.get(row, 'edate')) ?? date,
        endTime: toTime(r.get(row, 'etime')),
      })
      days.set(key, day)
      n++
    }
    out.downtimes.push(...days.values())
    out.read.push({ sheet: name, kind: 'downtimes', rows: n })
  }
  return out
}

/** Bir tarih listesinin ilk ve son günü. */
export function dateRange(dates: string[]): { from: string; to: string } | null {
  if (!dates.length) return null
  let from = dates[0]
  let to = dates[0]
  for (const d of dates) {
    if (d < from) from = d
    if (d > to) to = d
  }
  return { from, to }
}

// ---- veri görünümü: dosyadaki sütun sırası ve formüller ---------------------------

/** Order Based'deki formül sütunları: WEEK = ISOWEEKNUM(Date), TOTAL1 = OEE × Good. */
export const orderFormulas = (o: OrderRow) => ({ week: isoWeek(o.date).week, total1: o.oee * o.good })

/**
 * Downtimes'daki formül sütunları: Shift = vardiya kodu → 1/2/3,
 * Week = ISOWEEKNUM(Date), material = Material, min = Stoppage Duration(Min).
 */
export const downtimeFormulas = (date: string, e: DowntimeEvent) => ({
  shift: SHIFT_NUMBER[e.shiftDefinition] ?? null,
  week: isoWeek(date).week,
  material: e.material,
  min: e.minutes,
})
