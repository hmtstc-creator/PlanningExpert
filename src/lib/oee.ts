// OEE Trend and Losses — hesaplar. Saf fonksiyonlar.
//
// Kaynak: sistemden indirilen Excel (Shiftly KPI, Daily KPI, Weekly KPI,
// Monthly KPI, Shiftly Order Based KPI, Downtimes). Notlar ve kararlar:
// docs/oeedashboard.md; kullanım: OEE modülündeki "How to use" sayfası.
//
// Temel kural: hiçbir dönem için yüzde ORTALAMASI alınmaz. Süreler (Loading,
// Production, Operation) ve adetler toplanır, oran toplamdan hesaplanır:
//   Availability = Production ÷ Loading
//   Performance  = Operation ÷ Production
//   Quality      = Good ÷ (Good + Scrap + Reject)
//   OEE          = Availability × Performance × Quality
// Tek istisna planlamacının kararıyla kalıp OEE'sidir: dosyadaki gibi iyi
// adetle ağırlıklı (Σ OEE × Good ÷ Σ Good).
//
// Tesise özel hiçbir değer kodda yazılı değildir: alanlar, masraf yeri
// adları, vardiya numaraları, kayıp grupları, setup metinleri ve süreler
// kullanıcının OEE ayarlarındadır (OeeConfig). Program yalnızca verideki
// kodlardan bir ÖNERİ çıkarır (suggestConfig); kaydeden kullanıcıdır.

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

/** Dosyadaki oranlar (%), gösterim için; hesap toplamdan yapılır. */
interface FileRatios {
  availability: number
  quality: number
  performance: number
  oee: number
}

export interface ShiftRow extends OeeTimes, FileRatios {
  date: string
  plantKey: string
  responsible: string
  costCenter: string
  workCenter: string
  shiftGroup: string
  shiftDefinition: string
}

/** Daily KPI satırı (ilk kurulumda geçmiş için yüklenir). */
export interface DailyRow extends OeeTimes, FileRatios {
  date: string
  plantKey: string
  responsible: string
  costCenter: string
  workCenter: string
  scheduledSec: number
}

/**
 * Gün × iş merkezi — bütün hafta/ay hesaplarının tabanı. O günün vardiya
 * satırları varsa onların toplamı (source 'shiftly'), yoksa Daily KPI.
 */
export interface DayRow extends OeeTimes {
  date: string
  plantKey: string
  responsible: string
  costCenter: string
  workCenter: string
  source: 'shiftly' | 'daily'
}

export interface OrderRow extends OeeTimes, FileRatios {
  date: string
  plant: string
  plantName: string
  workCenter: string
  shift: string
  order: string
  equipment: string
  material: string
}

export interface WeeklyRow extends OeeTimes, FileRatios {
  year: number
  week: number
  plantKey: string
  responsible: string
  costCenter: string
  workCenter: string
  scheduledSec: number
  /** Hangi sayfadan geldiği (Weekly KPI / Weekly KPI_fix); yalnızca bilgi. */
  sheet?: string
}

export interface MonthlyRow extends OeeTimes, FileRatios {
  /** Dosyada yıl yok; yüklemede tarihlerden çıkarılır. */
  year: number
  month: string
  monthKey: string
  plantKey: string
  responsible: string
  costCenter: string
  workCenter: string
  scheduledSec: number
}

/** Bir duruş satırı. Sunucuda gün × iş merkezi kaydında dizi olarak durur. */
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

/**
 * Gün × iş merkezi duruş özeti — ham kodlarla (Reason Code 1 ve 2), ayardan
 * bağımsız. Ayar değişince özet yeniden hesaplanmaz; gruplama okurken yapılır.
 */
export interface LossDay {
  date: string
  costCenter: string
  workCenter: string
  /** `${rc1}|${rc2}` → [dakika, adet] */
  codes: Record<string, [number, number]>
  /** `${rc1}|${rc2}|${metin}` → [dakika, adet] */
  reasons: Record<string, [number, number]>
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

// ---- ayarlar -------------------------------------------------------------------

export type Pick = 'costCenter' | 'machine'

/** Kullanıcının OEE ayarları (OEE → Settings). */
export interface OeeConfig {
  /** Üstteki seçim düğmeleri; `pick`: masraf yeri mi makine mi seçilir. */
  areas: { name: string; pick: Pick }[]
  costCenters: { code: string; name: string; area: string }[]
  /** Vardiya grubu kodu (Shift Group) → vardiya numarası (1, 2, 3 …). */
  shifts: { code: string; number: number }[]
  /** Reason Code 1 değerleri: kayıp sayılan ve mola (planlı duruş) sayılan. */
  lossReasonCodes: string[]
  breakReasonCodes: string[]
  /** Reason Code 2 → kayıp grubu; `chart`: grafikteki sütun adı; `breakdown`: MTTR/MTBF tablosunda. */
  lossGroups: { code: string; label: string; chart: string; breakdown: boolean }[]
  /** Setup sayılan duruş metinleri (Reason Code Definition EN). */
  setupTexts: { text: string; kind: 'planned' | 'unplanned' }[]
  /** Setup'tan sonra bu kadar dakika üretim yapılırsa setup OK. */
  startupRunMin: number
  trendWeeks: number
  topN: number
}

export const EMPTY_CONFIG: OeeConfig = {
  areas: [],
  costCenters: [],
  shifts: [],
  lossReasonCodes: [],
  breakReasonCodes: [],
  lossGroups: [],
  setupTexts: [],
  startupRunMin: 0,
  trendWeeks: 0,
  topN: 0,
}

/** Ayarda eksik olan ve kullanıcıya söylenmesi gereken konular. */
export function configProblems(c: OeeConfig): string[] {
  const out: string[] = []
  if (!c.areas.length) out.push('No area is defined.')
  if (!c.costCenters.length) out.push('No cost center is defined.')
  const areas = new Set(c.areas.map((a) => a.name))
  const noArea = c.costCenters.filter((x) => !areas.has(x.area)).map((x) => x.code)
  if (noArea.length) out.push(`Cost center ${noArea.join(', ')} has no area.`)
  if (!c.shifts.length) out.push('Shift codes are not numbered.')
  if (!c.lossReasonCodes.length) out.push('No Reason Code 1 is marked as a loss.')
  if (!c.lossGroups.length) out.push('Loss groups are not named.')
  if (!c.setupTexts.length) out.push('No downtime text is marked as a die setup.')
  if (!(c.startupRunMin > 0)) out.push('Production time after a setup is not set.')
  if (!(c.trendWeeks > 0) || !(c.topN > 0)) out.push('Trend length and list size are not set.')
  return out
}

/** Ayarda olmayan masraf yerleri bu alanda toplanır — veri kaybolmaz. */
export const UNASSIGNED = 'Unassigned'

export const SPEED = 'Speed'

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

export const timesOf = (r: OeeTimes): OeeTimes => sumTimes([r])

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

// ---- kapsam: alan, masraf yeri, makine ------------------------------------------

export interface Scope {
  area: string
  /** 'all', bir masraf yeri ya da bir iş merkezi (alanın seçim türüne göre). */
  key: string
}

type Located = { workCenter: string; costCenter: string }

export function areaOfCostCenter(cc: string, c: OeeConfig): string {
  return c.costCenters.find((x) => x.code === cc)?.area || UNASSIGNED
}

export function pickOf(area: string, c: OeeConfig): Pick {
  return c.areas.find((a) => a.name === area)?.pick ?? 'machine'
}

export function costCenterName(cc: string, c: OeeConfig): string {
  return c.costCenters.find((x) => x.code === cc)?.name || cc
}

export function inScope(row: Located, scope: Scope, c: OeeConfig): boolean {
  if (areaOfCostCenter(row.costCenter, c) !== scope.area) return false
  if (scope.key === 'all') return true
  return pickOf(scope.area, c) === 'costCenter' ? row.costCenter === scope.key : row.workCenter === scope.key
}

/** Seçilebilir alanlar: ayardakiler + verideki tanımsız masraf yerleri için "Unassigned". */
export function areaNames(rows: Located[], c: OeeConfig): string[] {
  const names = c.areas.map((a) => a.name)
  if (rows.some((r) => r.costCenter && areaOfCostCenter(r.costCenter, c) === UNASSIGNED)) names.push(UNASSIGNED)
  return names
}

export function scopeLabel(scope: Scope, c: OeeConfig): string {
  if (scope.key === 'all') return `${scope.area} — all`
  return pickOf(scope.area, c) === 'costCenter' ? costCenterName(scope.key, c) : scope.key
}

/** Alanın seçenekleri: masraf yerleri ya da makineler (verideki). */
export function scopeOptions(area: string, rows: Located[], c: OeeConfig): { key: string; label: string }[] {
  const pick = pickOf(area, c)
  const keys = new Set<string>()
  for (const r of rows) {
    if (!r.costCenter || areaOfCostCenter(r.costCenter, c) !== area) continue
    keys.add(pick === 'costCenter' ? r.costCenter : r.workCenter)
  }
  const label = (k: string) => (pick === 'costCenter' ? costCenterName(k, c) : k)
  return [
    { key: 'all', label: `${area} — all` },
    ...[...keys].sort((a, b) => label(a).localeCompare(label(b))).map((k) => ({ key: k, label: label(k) })),
  ]
}

/** İş merkezi → masraf yeri (Order Based'de masraf yeri yok; gün verisinden). */
export function costCentersOf(rows: Located[]): Map<string, string> {
  return new Map(rows.filter((r) => r.costCenter).map((r) => [r.workCenter, r.costCenter]))
}

// ---- gün tabanı ----------------------------------------------------------------

/** Vardiya satırlarından gün × iş merkezi toplamı. */
export function daysFromShifts(shifts: ShiftRow[]): DayRow[] {
  const map = new Map<string, DayRow>()
  for (const s of shifts) {
    const key = `${s.date}|${s.workCenter}`
    const cur = map.get(key)
    map.set(key, {
      date: s.date,
      plantKey: s.plantKey,
      responsible: s.responsible,
      costCenter: s.costCenter,
      workCenter: s.workCenter,
      source: 'shiftly',
      ...addTimes(cur ?? EMPTY_TIMES, s),
    })
  }
  return [...map.values()]
}

export function dayFromDaily(d: DailyRow): DayRow {
  return {
    date: d.date,
    plantKey: d.plantKey,
    responsible: d.responsible,
    costCenter: d.costCenter,
    workCenter: d.workCenter,
    source: 'daily',
    ...timesOf(d),
  }
}

// ---- seriler -----------------------------------------------------------------

export interface SeriesPoint {
  key: string
  label: string
  times: OeeTimes
  oee: number | null
}

const point = (key: string, label: string, times: OeeTimes): SeriesPoint => ({ key, label, times, oee: oeeOf(times) })

export interface PeriodTimes {
  workCenter: string
  costCenter: string
  times: OeeTimes
  source: 'days' | 'upload'
}

/**
 * Bir dönemin (hafta ya da ay) iş merkezi süreleri: günlerin toplamı ile
 * yüklenen dönem satırından (Weekly / Monthly KPI) hangisi daha çok Loading
 * kapsıyorsa o. İkisi aynı verinin toplamıdır; büyük olan daha eksiksizdir
 * (ör. geçmişin başı yalnızca haftalık olarak var, ya da haftanın ilk günü
 * günlük veride eksik).
 */
function choosePeriod(fromDays: Map<string, PeriodTimes>, uploaded: Map<string, PeriodTimes>): Map<string, PeriodTimes> {
  const out = new Map(fromDays)
  for (const [key, u] of uploaded) {
    const d = out.get(key)
    if (!d || u.times.loadingMin > d.times.loadingMin + 0.5) out.set(key, u)
  }
  return out
}

function addTo(map: Map<string, PeriodTimes>, key: string, r: Located & OeeTimes, source: 'days' | 'upload') {
  const cur = map.get(key)
  map.set(key, { workCenter: r.workCenter, costCenter: r.costCenter || cur?.costCenter || '', times: addTimes(cur?.times ?? EMPTY_TIMES, r), source })
}

/** Hafta × iş merkezi: `${yıl}-W${hafta}|${iş merkezi}`. */
export function weekTimes(days: DayRow[], weekly: WeeklyRow[]): Map<string, PeriodTimes> {
  const fromDays = new Map<string, PeriodTimes>()
  for (const d of days) {
    const { year, week } = isoWeek(d.date)
    addTo(fromDays, `${weekKey(year, week)}|${d.workCenter}`, d, 'days')
  }
  const uploaded = new Map<string, PeriodTimes>()
  for (const w of weekly) addTo(uploaded, `${weekKey(w.year, w.week)}|${w.workCenter}`, w, 'upload')
  return choosePeriod(fromDays, uploaded)
}

export const monthKeyOf = (year: number, month: number | string) => `${year}-${String(month).padStart(2, '0')}`

/** Ay × iş merkezi: `${yıl}-${ay}|${iş merkezi}`. */
export function monthTimes(days: DayRow[], monthly: MonthlyRow[]): Map<string, PeriodTimes> {
  const fromDays = new Map<string, PeriodTimes>()
  for (const d of days) addTo(fromDays, `${d.date.slice(0, 7)}|${d.workCenter}`, d, 'days')
  const uploaded = new Map<string, PeriodTimes>()
  for (const m of monthly) addTo(uploaded, `${monthKeyOf(m.year, m.monthKey)}|${m.workCenter}`, m, 'upload')
  return choosePeriod(fromDays, uploaded)
}

function trend(
  all: Map<string, PeriodTimes>,
  keys: { key: string; label: string }[],
  scope: Scope,
  c: OeeConfig,
): { total: SeriesPoint[]; byWorkCenter: Map<string, SeriesPoint[]> } {
  const inRange = new Set(keys.map((k) => k.key))
  const wcs = [...new Set([...all].filter(([k, v]) => inRange.has(k.split('|')[0]) && inScope(v, scope, c)).map(([, v]) => v.workCenter))].sort()
  const byWc = new Map<string, SeriesPoint[]>(wcs.map((wc) => [wc, []]))
  const total: SeriesPoint[] = []
  for (const { key, label } of keys) {
    let sum = EMPTY_TIMES
    for (const wc of wcs) {
      const hit = all.get(`${key}|${wc}`)
      const t = hit && inScope(hit, scope, c) ? hit.times : EMPTY_TIMES
      sum = addTimes(sum, t)
      byWc.get(wc)!.push(point(key, label, t))
    }
    total.push(point(key, label, sum))
  }
  return { total, byWorkCenter: byWc }
}

/** Son n hafta (seçilen hafta dahil). */
export function weeklyTrend(days: DayRow[], weekly: WeeklyRow[], scope: Scope, c: OeeConfig, endMonday: string, n: number) {
  const keys = Array.from({ length: n }, (_, i) => {
    const { year, week } = isoWeek(addDaysIso(endMonday, -7 * (n - 1 - i)))
    return { key: weekKey(year, week), label: `W${week}` }
  })
  return trend(weekTimes(days, weekly), keys, scope, c)
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Seçilen tarihin yılının ocağından o aya kadar. */
export function monthlyTrend(days: DayRow[], monthly: MonthlyRow[], scope: Scope, c: OeeConfig, date: string) {
  const year = Number(date.slice(0, 4))
  const upTo = Number(date.slice(5, 7))
  const keys = Array.from({ length: upTo }, (_, i) => ({ key: monthKeyOf(year, i + 1), label: MONTH_LABELS[i] }))
  return trend(monthTimes(days, monthly), keys, scope, c)
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Vardiya numarası ayardan; tanımsız kod null. */
export const shiftNumber = (code: string, c: OeeConfig): number | null => c.shifts.find((s) => s.code === code)?.number ?? null

/** Seçilen haftanın vardiyaları (Pzt-1 … Paz-n), BoardReport'taki gibi. */
export function weekShiftTrend(shifts: ShiftRow[], scope: Scope, c: OeeConfig, monday: string) {
  const rows = shifts.filter((r) => inScope(r, scope, c))
  const numbers = [...new Set(c.shifts.map((s) => s.number))].sort((a, b) => a - b)
  const unknown = [...new Set(rows.filter((r) => shiftNumber(r.shiftGroup, c) === null).map((r) => r.shiftGroup))]
  const wcs = [...new Set(rows.map((r) => r.workCenter))].sort()
  const slots: SeriesPoint[] = []
  const byWc = new Map<string, SeriesPoint[]>(wcs.map((wc) => [wc, []]))
  for (let d = 0; d < 7; d++) {
    const date = addDaysIso(monday, d)
    for (const s of numbers) {
      const key = `${date}|${s}`
      const label = `${DAY_LABELS[d]}-${s}`
      const hit = rows.filter((r) => r.date === date && shiftNumber(r.shiftGroup, c) === s)
      slots.push(point(key, label, sumTimes(hit)))
      for (const wc of wcs) byWc.get(wc)!.push(point(key, label, sumTimes(hit.filter((r) => r.workCenter === wc))))
    }
  }
  return { slots, byWorkCenter: byWc, unknown }
}

/** Gün aralığının kapsam toplamı. */
export function totalsFor(days: DayRow[], scope: Scope, c: OeeConfig, from: string, to: string): OeeTimes {
  return sumTimes(days.filter((r) => r.date >= from && r.date <= to && inScope(r, scope, c)))
}

// ---- kayıplar ----------------------------------------------------------------

/** Duruş satırlarından gün × iş merkezi özeti, ham kodlarla. */
export function lossDayOf(day: DowntimeDay): LossDay {
  const codes: Record<string, [number, number]> = {}
  const reasons: Record<string, [number, number]> = {}
  for (const e of day.events) {
    const k = `${e.rc1}|${e.rc2}`
    const c = codes[k] ?? [0, 0]
    codes[k] = [c[0] + e.minutes, c[1] + 1]
    const rk = `${k}|${e.textEn}`
    const r = reasons[rk] ?? [0, 0]
    reasons[rk] = [r[0] + e.minutes, r[1] + 1]
  }
  return { date: day.date, costCenter: day.costCenter, workCenter: day.workCenter, codes, reasons }
}

/** Grafik sütunları: ayardaki sıra; tanımsız grup "Unassigned"; en sonda Speed. */
export function chartGroups(c: OeeConfig, lossDays: LossDay[] = []): string[] {
  const out: string[] = []
  for (const g of c.lossGroups) if (g.chart && !out.includes(g.chart)) out.push(g.chart)
  const known = new Set(c.lossGroups.map((g) => g.code))
  const hasUnknown = lossDays.some((d) =>
    Object.keys(d.codes).some((k) => {
      const [rc1, rc2] = k.split('|')
      return c.lossReasonCodes.includes(rc1) && !known.has(rc2)
    }),
  )
  if (hasUnknown && !out.includes(UNASSIGNED)) out.push(UNASSIGNED)
  out.push(SPEED)
  return out
}

export const groupLabel = (code: string, c: OeeConfig) => c.lossGroups.find((g) => g.code === code)?.label || code

export interface LossBreakdown {
  loadingMin: number
  /** Kayıp grubu kodu (Reason Code 2) → dakika. */
  groups: Record<string, number>
  counts: Record<string, number>
  /** Grafik sütunu → dakika (Speed dahil). */
  chart: Record<string, number>
  oee: number | null
}

/** Bir dönemin kayıpları: kayıp sayılan duruş dakikası ÷ Loading (% of Loading). */
export function lossBreakdown(times: OeeTimes, lossDays: LossDay[], c: OeeConfig): LossBreakdown {
  const groups: Record<string, number> = {}
  const counts: Record<string, number> = {}
  const chart: Record<string, number> = {}
  for (const d of lossDays) {
    for (const [k, [m, n]] of Object.entries(d.codes)) {
      const [rc1, rc2] = k.split('|')
      if (!c.lossReasonCodes.includes(rc1)) continue
      groups[rc2] = (groups[rc2] ?? 0) + m
      counts[rc2] = (counts[rc2] ?? 0) + n
      const col = c.lossGroups.find((g) => g.code === rc2)?.chart || UNASSIGNED
      chart[col] = (chart[col] ?? 0) + m
    }
  }
  chart[SPEED] = Math.max(0, times.productionMin - times.operatingMin)
  return { loadingMin: times.loadingMin, groups, counts, chart, oee: oeeOf(times) }
}

/** Grafik sütununun Loading'e oranı (0–1). */
export const chartShare = (b: LossBreakdown, col: string) => (b.loadingMin > 0 ? (b.chart[col] ?? 0) / b.loadingMin : 0)

export function lossForPeriod(
  days: DayRow[],
  lossDays: LossDay[],
  scope: Scope,
  c: OeeConfig,
  from: string,
  to: string,
  workCenter?: string,
): LossBreakdown {
  const sel = (r: { date: string } & Located) =>
    r.date >= from && r.date <= to && inScope(r, scope, c) && (!workCenter || r.workCenter === workCenter)
  return lossBreakdown(sumTimes(days.filter(sel)), lossDays.filter(sel), c)
}

export interface GapRow {
  key: string
  label: string
  isGroup: boolean
  current: LossBreakdown
  previous: LossBreakdown
}

/**
 * Bu hafta ile geçen hafta: masraf yeri toplamları (masraf yeri seçilen
 * alanlarda) ya da alan toplamı, altında iş merkezleri. Fark = bu − geçen.
 */
export function weekGap(days: DayRow[], lossDays: LossDay[], scope: Scope, c: OeeConfig, monday: string): GapRow[] {
  const prev = addDaysIso(monday, -7)
  const cur = { from: monday, to: addDaysIso(monday, 6) }
  const old = { from: prev, to: addDaysIso(prev, 6) }
  const rows = days.filter((r) => inScope(r, scope, c) && r.date >= old.from && r.date <= cur.to)
  const pick = pickOf(scope.area, c)
  const groupScopes: Scope[] =
    pick === 'costCenter'
      ? [...new Set(rows.map((r) => r.costCenter))].sort().map((cc) => ({ area: scope.area, key: cc }))
      : [scope]
  const out: GapRow[] = []
  for (const s of groupScopes) {
    out.push({
      key: `group:${s.key}`,
      label: scopeLabel(s, c),
      isGroup: true,
      current: lossForPeriod(days, lossDays, s, c, cur.from, cur.to),
      previous: lossForPeriod(days, lossDays, s, c, old.from, old.to),
    })
    const wcs = [...new Set(rows.filter((r) => inScope(r, s, c)).map((r) => r.workCenter))].sort()
    if (wcs.length === 1 && s.key === wcs[0]) continue
    for (const wc of wcs) {
      out.push({
        key: wc,
        label: wc,
        isGroup: false,
        current: lossForPeriod(days, lossDays, s, c, cur.from, cur.to, wc),
        previous: lossForPeriod(days, lossDays, s, c, old.from, old.to, wc),
      })
    }
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

/** Kayıp sayılan duruş nedenleri, bu hafta ve geçen hafta, çoktan aza. */
export function reasonPareto(lossDays: LossDay[], scope: Scope, c: OeeConfig, monday: string): ReasonRow[] {
  const prev = addDaysIso(monday, -7)
  const end = addDaysIso(monday, 6)
  const map = new Map<string, ReasonRow>()
  for (const d of lossDays) {
    if (!inScope(d, scope, c) || d.date < prev || d.date > end) continue
    const current = d.date >= monday
    for (const [k, [min, count]] of Object.entries(d.reasons)) {
      const [rc1, rc2, ...rest] = k.split('|')
      if (!c.lossReasonCodes.includes(rc1)) continue
      const text = rest.join('|') || rc2
      const row = map.get(text) ?? { text, group: rc2, minutes: 0, count: 0, previousMinutes: 0 }
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

/** Kalıp (Equipment) × iş merkezi: adet ağırlıklı OEE ve speed loss (Excel TOTAL1). */
export function dieTable(orders: OrderRow[], scope: Scope, c: OeeConfig, from: string, to: string, costCenterOf: Map<string, string>): DieRow[] {
  const map = new Map<string, DieRow & { weighted: number; orderSet: Set<string> }>()
  for (const o of orders) {
    if (o.date < from || o.date > to) continue
    if (!inScope({ workCenter: o.workCenter, costCenter: costCenterOf.get(o.workCenter) ?? '' }, scope, c)) continue
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

// ---- arızalar: MTTR / MTBF -------------------------------------------------------

export interface ReliabilityRow {
  workCenter: string
  /** Grup kodu → [arıza sayısı, dakika, MTTR, MTBF]. */
  groups: Record<string, { count: number; minutes: number; mttrMin: number | null; mtbfMin: number | null }>
}

/**
 * Ayarda "breakdown" işaretli her grup için: MTTR = arıza dakikası ÷ arıza
 * sayısı, MTBF = Production ÷ arıza sayısı.
 */
export function reliability(days: DayRow[], lossDays: LossDay[], scope: Scope, c: OeeConfig, from: string, to: string): ReliabilityRow[] {
  const sel = (r: { date: string } & Located) => r.date >= from && r.date <= to && inScope(r, scope, c)
  const codes = c.lossGroups.filter((g) => g.breakdown).map((g) => g.code)
  const wcs = [...new Set(days.filter(sel).map((r) => r.workCenter))].sort()
  return wcs.map((wc) => {
    const b = lossBreakdown(EMPTY_TIMES, lossDays.filter((d) => sel(d) && d.workCenter === wc), c)
    const production = sumTimes(days.filter((r) => sel(r) && r.workCenter === wc)).productionMin
    const groups: ReliabilityRow['groups'] = {}
    for (const code of codes) {
      const count = b.counts[code] ?? 0
      const minutes = b.groups[code] ?? 0
      groups[code] = { count, minutes, mttrMin: count ? minutes / count : null, mtbfMin: count ? production / count : null }
    }
    return { workCenter: wc, groups }
  })
}

// ---- setup analizi -------------------------------------------------------------

/** Molalar (planlı duruş) setup sonrası kayıplarda bu anahtarla ayrı tutulur. */
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
  /** Setup bitişinden ayardaki üretim süresine ulaşana kadar geçen süre (OK ise). */
  timeToRunMin: number | null
  /** Bir sonraki setup'a kadar yapılabilen üretim (en çok ayardaki süre). */
  runMin: number
  /** Setup bitişinden o üretime (ya da sonraki setup'a) kadar duruşlar: grup → dk. */
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
 * Setup'tan sonra üretime geçiş: setup (ayardaki setup metinleri) bittikten
 * sonra, bir sonraki setup'tan önce ayardaki süre kadar üretim (duruş
 * olmayan süre) yapılabildiyse OK, yapılamadıysa NOK. Aradaki duruşlar
 * nedendir; molalar (ayardaki mola kodları) ayrı. Veri bitmeden sonuç belli
 * değilse "open". Arada üretim olmayan setup kayıtları (vardiya değişimi,
 * mola) tek setup sayılır. Setup'ı [from, to] içinde başlayanlar.
 */
export function setupAnalysis(days: DowntimeDay[], orders: OrderRow[], scope: Scope, c: OeeConfig, from: string, to: string): SetupRow[] {
  const setupKind = new Map(c.setupTexts.map((t) => [t.text.trim().toUpperCase(), t.kind]))
  const need = c.startupRunMin
  if (!setupKind.size || !(need > 0)) return []
  const byWc = new Map<string, Span[]>()
  let dataEnd = -Infinity
  for (const d of days) {
    if (!inScope(d, scope, c)) continue
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
    const reachRun = (a: number, limit: number): number | null => {
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

    const blocks: { s: number; e: number; order: string; material: string; kinds: Set<string>; min: number }[] = []
    for (const sp of spans) {
      const kind = setupKind.get(sp.ev.textEn.trim().toUpperCase())
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
      const reached = reachRun(b.e, limit)
      const windowEnd = reached ?? limit
      const lost: Record<string, number> = {}
      for (const sp of spans) {
        if (sp.e <= b.e || sp.s >= windowEnd) continue
        const m = Math.min(sp.e, windowEnd) - Math.max(sp.s, b.e)
        if (m <= 0) continue
        const key = c.breakReasonCodes.includes(sp.ev.rc1) ? BREAK_KEY : sp.ev.rc2 || '#'
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
        runMin: Math.min(need, runBetween(b.e, windowEnd)),
        lost,
        mainReason: status === 'nok' ? (reasons[0]?.[0] ?? 'next-setup') : null,
        nextSetup: next ? fmtMin(next.s) : null,
        good: goodBy.get(`${wc}|${b.order}`) ?? 0,
      })
    })
  }
  return out.sort((a, b) => a.workCenter.localeCompare(b.workCenter) || a.start.localeCompare(b.start))
}

// ---- ayar önerisi ----------------------------------------------------------------

/**
 * Verideki masraf yerleri (günler, vardiyalar ve duruşlar birlikte — eski
 * yüklemelerde günler olmayabilir) → makineleri ve önerilen alan (iş merkezi
 * adının ön eki, PRS-106 → PRS).
 */
export function dataCostCenters(input: { days: Located[]; shifts: Located[]; downtimes: Located[] }): Map<string, { area: string; workCenters: string[] }> {
  const prefix = (wc: string) => wc.split(/[-\s_]/)[0]?.toUpperCase() || wc
  const wcs = new Map<string, Set<string>>()
  for (const r of [...input.days, ...input.shifts, ...input.downtimes]) {
    if (!r.costCenter) continue
    const set = wcs.get(r.costCenter) ?? new Set<string>()
    if (r.workCenter) set.add(r.workCenter)
    wcs.set(r.costCenter, set)
  }
  const out = new Map<string, { area: string; workCenters: string[] }>()
  for (const [code, set] of [...wcs].sort(([a], [b]) => a.localeCompare(b))) {
    const workCenters = [...set].sort()
    // En sık ön ek alan olur.
    const count = new Map<string, number>()
    for (const wc of workCenters) count.set(prefix(wc), (count.get(prefix(wc)) ?? 0) + 1)
    const area = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? code
    out.set(code, { area, workCenters })
  }
  return out
}

/**
 * Verideki kodlardan ayar ÖNERİSİ. Kullanıcı görür, düzeltir ve kaydeder;
 * kaydedilmeden hiçbir hesap bunu kullanmaz.
 *  - Alan: iş merkezi adının ön eki (PRS-106 → PRS); tek masraf yerli alanda
 *    makine, çok masraf yerli alanda masraf yeri seçilir.
 *  - Vardiya: aynı masraf yerlerinde görülen kodlar sıralanıp 1, 2, 3 …
 *  - Reason Code 1: adında "UN" geçen ya da "#" kayıp, diğerleri mola.
 *  - Kayıp grupları: kayıp satırlarındaki Reason Code 2 değerleri (ad = kod).
 *  - Setup: metninde SETUP ve PLAN geçenler (UNPLAN plansız); başka dildeki
 *    metinleri kullanıcı Settings'te işaretler.
 */
export function suggestConfig(
  input: { days: Located[]; shifts: (Located & { shiftGroup: string })[]; downtimes: DowntimeDay[] },
  current: OeeConfig,
  defaults: { startupRunMin: number; trendWeeks: number; topN: number },
): OeeConfig {
  const found = dataCostCenters(input)
  // Tanımlı masraf yeri korunur (adı ve alanı kullanıcının); yenisi ön ek alanına.
  // Alan seçimi boş kalmış ya da alanı silinmiş masraf yeri de ön ek alanına gider.
  const areaNamesNow = new Set(current.areas.map((a) => a.name))
  const costCenters = [
    ...[...found].map(([code, f]) => {
      const cur = current.costCenters.find((x) => x.code === code)
      if (!cur) return { code, name: code, area: f.area }
      return areaNamesNow.has(cur.area) && !found.has(cur.area) ? cur : { ...cur, area: f.area }
    }),
    ...current.costCenters.filter((x) => !found.has(x.code)),
  ]
  const used = new Set(costCenters.map((c) => c.area))
  const areas = [
    // Kullanıcının alanları kalır; yalnızca adı bir masraf yeri kodu olanlar (yanlışlıkla alan yazılmış) düşer.
    ...current.areas.filter((a) => !found.has(a.name) && !costCenters.some((c) => c.code === a.name)),
    ...[...used]
      .filter((name) => !current.areas.some((a) => a.name === name))
      .map((name) => {
        const n = costCenters.filter((c) => c.area === name).length
        return { name, pick: (n > 1 ? 'costCenter' : 'machine') as Pick }
      }),
  ]
  const codeCcs = new Map<string, Set<string>>()
  for (const s of input.shifts) {
    if (!s.shiftGroup) continue
    const set = codeCcs.get(s.shiftGroup) ?? new Set<string>()
    set.add(s.costCenter)
    codeCcs.set(s.shiftGroup, set)
  }
  const families = new Map<string, string[]>()
  for (const [code, ccs] of codeCcs) {
    const fam = [...ccs].sort().join(',')
    families.set(fam, [...(families.get(fam) ?? []), code])
  }
  const shifts = [...families.values()].flatMap((codes) =>
    codes.sort().map((code, i) => current.shifts.find((s) => s.code === code) ?? { code, number: i + 1 }),
  )
  const rc1 = new Set<string>()
  const events = input.downtimes.flatMap((d) => d.events)
  for (const e of events) rc1.add(e.rc1)
  const isLoss = (v: string) => v === '#' || /UN/i.test(v)
  const lossReasonCodes = current.lossReasonCodes.length ? current.lossReasonCodes : [...rc1].filter(isLoss).sort()
  const breakReasonCodes = current.breakReasonCodes.length ? current.breakReasonCodes : [...rc1].filter((v) => v && !isLoss(v)).sort()
  const rc2 = new Set(events.filter((e) => lossReasonCodes.includes(e.rc1)).map((e) => e.rc2 || '#'))
  const lossGroups = [...rc2].sort().map((code) => current.lossGroups.find((g) => g.code === code) ?? { code, label: code, chart: code, breakdown: false })
  const texts = new Set(events.map((e) => e.textEn.trim().toUpperCase()))
  const setupTexts = current.setupTexts.length
    ? current.setupTexts
    : [...texts]
        .filter((t) => /SETUP/.test(t) && /PLAN/.test(t))
        .sort()
        .map((text) => ({ text, kind: (/UNPLAN/.test(text) ? 'unplanned' : 'planned') as 'planned' | 'unplanned' }))
  return {
    areas,
    costCenters,
    shifts,
    lossReasonCodes,
    breakReasonCodes,
    lossGroups,
    setupTexts,
    startupRunMin: current.startupRunMin || defaults.startupRunMin,
    trendWeeks: current.trendWeeks || defaults.trendWeeks,
    topN: current.topN || defaults.topN,
  }
}

// ---- Excel'den okuma -------------------------------------------------------------

/** Bir sayfanın satırları: ilk satır başlık (sheet_to_json header:1, raw). */
export type SheetRows = unknown[][]

export const OEE_SHEET_NAMES = {
  shiftly: ['shiftly kpi'],
  daily: ['daily kpi'],
  orders: ['shiftly order based kpi', 'shiftly base order kpi', 'shiftly order base kpi'],
  weekly: ['weekly kpi', 'weekly kpi_fix'],
  monthly: ['monthly kpi'],
  downtimes: ['downtimes'],
} as const

/** Sayfa adını türüne eşler (dosya biçimi; tesise özel değil). */
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
  daily: DailyRow[]
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
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Tarihli sayfalar (Shiftly, Daily, Order Based, Downtimes) Pazartesi'den
 * başlamalı: yarım başlayan hafta, kayıtlı tam haftanın üstüne yazılmasın
 * (planlamacı, 2026-09-28). Yılın ilk günü de kabul edilir (sene başından
 * geçmiş yüklemesi). Uymayan dosya hiç yüklenmez.
 */
export function mondayStartProblem(sheet: string, dates: string[]): string | null {
  const first = dateRange(dates)?.from
  if (!first) return null
  const day = new Date(`${first}T00:00:00Z`).getUTCDay()
  if (day === 1 || first.slice(5) === '01-01') return null
  const fmt = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
  return `${sheet} starts on ${WEEKDAYS[day]} ${fmt(first)} — export from a Monday (${fmt(mondayOfIso(first))}). The file was not uploaded.`
}

export function parseOeeWorkbook(sheets: Record<string, SheetRows>, today = new Date().toISOString().slice(0, 10)): ParsedOee {
  const out: ParsedOee = { shifts: [], daily: [], orders: [], weekly: [], monthly: [], downtimes: [], read: [], problems: [] }
  const byKind = new Map<string, [string, SheetRows][]>()
  const checkMonday = (sheet: string, rows: { date: string }[]) => {
    const p = mondayStartProblem(sheet, rows.map((r) => r.date))
    if (p) out.problems.push(p)
  }
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
    checkMonday(name, out.shifts.slice(out.shifts.length - n))
  }

  for (const [name, rows] of byKind.get('daily') ?? []) {
    const r = reader(rows[0] ?? [], [
      { key: 'date', names: ['Date'] },
      { key: 'plant', names: ['Plant - Key'] },
      { key: 'resp', names: ['Production Responsible'] },
      { key: 'cc', names: ['Cost Center - Key', 'Cost Center'] },
      { key: 'wc', names: ['Work Center'] },
      { key: 'schedSec', names: ['Scheduled Downtime'] },
      ...TIME_COLS,
    ])
    if (r.missing.length) out.problems.push(`${name}: missing columns ${r.missing.join(', ')}`)
    let n = 0
    for (const row of rows.slice(1)) {
      const date = toIsoDate(r.get(row, 'date'))
      const wc = str(r.get(row, 'wc'))
      if (!date || !wc) continue
      out.daily.push({
        date,
        plantKey: str(r.get(row, 'plant')),
        responsible: str(r.get(row, 'resp')),
        costCenter: str(r.get(row, 'cc')),
        workCenter: wc,
        scheduledSec: num(r.get(row, 'schedSec')),
        ...timesFrom(r.get, row),
      })
      n++
    }
    out.read.push({ sheet: name, kind: 'daily', rows: n })
    checkMonday(name, out.daily.slice(out.daily.length - n))
  }

  // Haftalık sayfada yıl yok: dosyadaki en son günlük/vardiya tarihinden
  // (yoksa bugünden) geriye doğru sayılır. Aylıkta yıl sütunu var.
  const lastDate = [...out.shifts, ...out.daily].reduce((m, s) => (s.date > m ? s.date : m), '') || today
  const ref = isoWeek(lastDate)

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
    checkMonday(name, out.orders.slice(out.orders.length - n))
  }

  const periodCols: Col[] = [
    { key: 'plant', names: ['Plant - Key'] },
    { key: 'resp', names: ['Production Responsible'] },
    { key: 'cc', names: ['Cost Center - Key', 'Cost Center'] },
    { key: 'wc', names: ['Work Center'] },
    { key: 'schedSec', names: ['Scheduled Downtime'] },
    ...TIME_COLS,
  ]

  // Aynı hafta ve iş merkezi iki sayfada varsa (Weekly KPI, Weekly KPI_fix) daha çok
  // Loading kapsayan satır alınır — daha eksiksizdir.
  const weeklySheets = byKind.get('weekly') ?? []
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
      const key = `${year}|${week}|${wc}`
      const loading = num(r.get(row, 'loading'))
      if ((weekly.get(key)?.loadingMin ?? -1) >= loading) {
        n++
        continue
      }
      weekly.set(key, {
        year,
        week,
        plantKey: str(r.get(row, 'plant')),
        responsible: str(r.get(row, 'resp')),
        costCenter: str(r.get(row, 'cc')),
        workCenter: wc,
        scheduledSec: num(r.get(row, 'schedSec')),
        ...timesFrom(r.get, row),
        sheet: name,
      })
      n++
    }
    out.read.push({ sheet: name, kind: 'weekly', rows: n })
  }
  out.weekly = [...weekly.values()]

  for (const [name, rows] of byKind.get('monthly') ?? []) {
    // Yıl ilk sütunda (Year) gelir; tahmin edilmez (planlamacı, 2026-09-28).
    const r = reader(rows[0] ?? [], [{ key: 'year', names: ['Year'] }, { key: 'month', names: ['Month'] }, { key: 'key', names: ['Month Key'] }, ...periodCols])
    if (r.missing.length) out.problems.push(`${name}: missing columns ${r.missing.join(', ')}`)
    let n = 0
    const badYear: number[] = []
    for (const [i, row] of rows.slice(1).entries()) {
      const wc = str(r.get(row, 'wc'))
      const rawKey = str(r.get(row, 'key'))
      if (!wc || !rawKey) continue
      const year = Math.round(num(r.get(row, 'year')))
      if (!(year >= 2000 && year <= 2100)) {
        badYear.push(i + 2)
        continue
      }
      const monthKey = rawKey.padStart(2, '0')
      out.monthly.push({
        year,
        month: str(r.get(row, 'month')),
        monthKey,
        plantKey: str(r.get(row, 'plant')),
        responsible: str(r.get(row, 'resp')),
        costCenter: str(r.get(row, 'cc')),
        workCenter: wc,
        scheduledSec: num(r.get(row, 'schedSec')),
        ...timesFrom(r.get, row),
      })
      n++
    }
    if (badYear.length && !r.missing.includes('Year')) out.problems.push(`${name}: no valid Year in rows ${badYear.slice(0, 5).join(', ')}${badYear.length > 5 ? ' …' : ''}`)
    out.read.push({ sheet: name, kind: 'monthly', rows: n })
  }

  // Bir gün × makinenin bütün duruşları tek kayıtta (yüklemede o günün duruşları bununla yenilenir).
  const days = new Map<string, DowntimeDay>()
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
    const sheetDates: { date: string }[] = []
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
      sheetDates.push({ date })
      n++
    }
    out.read.push({ sheet: name, kind: 'downtimes', rows: n })
    checkMonday(name, sheetDates)
  }
  out.downtimes.push(...days.values())
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
export const downtimeFormulas = (date: string, e: DowntimeEvent, c: OeeConfig) => ({
  shift: shiftNumber(e.shiftDefinition, c),
  week: isoWeek(date).week,
  material: e.material,
  min: e.minutes,
})
