/**
 * Duruş süreleri: MTTR / MTBF ve duruşların vardiya, parça ayrıntısı
 * (Aksiyonlar sunumu, planlamacı 2026-10-14).
 *
 * Duruş satırı çok (ayda ~30 000): yılın MTTR / MTBF'i ham satırlardan
 * okunmaz. Yüklemede gün × iş merkezi başına bir **süre histogramı** saklanır
 * (oeeStopDays): Reason Code 1, 2, metin ve tam dakika dilimi → adet, dakika.
 * Kullanıcının "en az N dakika" eşiği ve < 2 / 2–10 / ≥ 10 dk kovaları
 * buradan hesaplanır. Hangi parça, hangi vardiya gibi ayrıntı ham duruşlardan
 * (en çok 8 gün) gelir.
 */
import {
  UNDEFINED_RC1,
  classifyLoss,
  inScope,
  shortStopMinOf,
  shiftNumber,
  type DayRow,
  type DowntimeDay,
  type DowntimeEvent,
  type OeeConfig,
  type OrderRow,
  type Scope,
} from './oee'

type Cell = string | number

/** Histogram dilimi: tam dakika (9.7 dk → 9); bu ve üstü tek dilim. */
export const BIN_CAP = 240

export interface StopBin {
  rc1: string
  rc2: string
  text: string
  /** Tam dakika (floor), en çok BIN_CAP. */
  bin: number
  count: number
  minutes: number
}

export interface StopDay {
  date: string
  costCenter: string
  workCenter: string
  bins: StopBin[]
}

/** Sunucudaki biçim: `bins` = [rc1, rc2, metin, dilim, adet, dakika]. */
export interface StoredStopDay {
  date: string
  costCenter: string
  workCenter: string
  bins: Cell[][]
}

export const binOf = (minutes: number) => Math.max(0, Math.min(BIN_CAP, Math.floor(minutes + 1e-9)))

/** Bir gün × iş merkezinin duruşlarından süre histogramı (ayardan bağımsız, ham kodlarla). */
export function stopDayOf(day: DowntimeDay): StoredStopDay {
  const map = new Map<string, [string, string, string, number, number, number]>()
  for (const e of day.events) {
    const bin = binOf(e.minutes)
    const k = `${e.rc1}\u0000${e.rc2}\u0000${e.textEn}\u0000${bin}`
    const r = map.get(k) ?? [e.rc1, e.rc2, e.textEn, bin, 0, 0]
    r[4] += 1
    r[5] = Math.round((r[5] + e.minutes) * 100) / 100
    map.set(k, r)
  }
  return { date: day.date, costCenter: day.costCenter, workCenter: day.workCenter, bins: [...map.values()] }
}

const s = (c: Cell | undefined) => (c === undefined ? '' : String(c))
const n = (c: Cell | undefined) => (typeof c === 'number' ? c : Number(c) || 0)

export const fromStoredStops = (list: StoredStopDay[]): StopDay[] =>
  list.map((d) => ({
    date: d.date,
    costCenter: d.costCenter,
    workCenter: d.workCenter,
    bins: d.bins.map((b) => ({ rc1: s(b[0]), rc2: s(b[1]), text: s(b[2]), bin: n(b[3]), count: n(b[4]), minutes: n(b[5]) })),
  }))

// ---- kategoriler ------------------------------------------------------------------

/** MTTR / MTBF kategorisi: arıza grubu (ARZ, KLP …) ya da setup metinleri (STP). */
export interface RelCategory {
  key: string
  label: string
  /** Açıklama (STP'de hangi metinler). */
  note?: string
  match: (rc1: string, rc2: string, text: string) => boolean
}

const norm = (t: string) => t.trim().toUpperCase().replace(/\s+/g, ' ').replace(/[–—]/g, '-')
/** Sebebi girilmemiş duruş: arıza / setup kategorisine girmez (RC1 "#" kaybı Unassigned'dadır, classifyLoss). */
const undefinedCode = (rc1: string, rc2: string) => rc1 === UNDEFINED_RC1 || rc2 === '#'

/** STP'de varsayılan metinler: kalıp setup'ları (planlı, plansız) ve rulo setup'ı; yoksa bütün setup metinleri. */
export function defaultSetupTexts(c: OeeConfig): string[] {
  const all = c.setupTexts.map((t) => t.text)
  const picked = all.filter((t) => /DIE SETUP|COIL SETUP/.test(norm(t)))
  return picked.length ? picked : all
}

/**
 * Kategoriler: OEE Settings'te "breakdown" işaretli her kayıp grubu (ARZ,
 * KLP …; kayıp sayılan Reason Code 1 ile) ve seçilen setup metinleri (STP).
 */
export function relCategories(c: OeeConfig, setupTexts: string[]): RelCategory[] {
  const out: RelCategory[] = c.lossGroups
    .filter((g) => g.breakdown)
    .map((g) => ({
      key: g.code,
      label: g.label || g.code,
      match: (rc1: string, rc2: string) => !undefinedCode(rc1, rc2) && classifyLoss(rc1, rc2, c)?.group === g.code,
    }))
  const texts = new Set(setupTexts.map(norm))
  if (texts.size) {
    const stp = c.lossGroups.find((g) => g.code === 'STP')
    out.push({
      key: 'setup',
      label: stp?.label && stp.label !== 'STP' ? `STP · ${stp.label}` : 'STP',
      note: setupTexts.join(', '),
      match: (rc1, rc2, text) => !undefinedCode(rc1, rc2) && texts.has(norm(text)),
    })
  }
  return out
}

// ---- hesap -------------------------------------------------------------------------

export interface RelCell {
  count: number
  minutes: number
  /** Production time (dk) — MTBF'in payı. */
  production: number
  /** Ortalama duruş (dk). */
  mttr: number | null
  /** Ortalama iki duruş arası üretim (dk). */
  mtbf: number | null
}

export const relCell = (count: number, minutes: number, production: number): RelCell => ({
  count,
  minutes,
  production,
  mttr: count ? minutes / count : null,
  mtbf: count ? production / count : null,
})

/** Süre aralığı [lo, hi): tam dakika dilimiyle (9.7 dk, 10'un altındadır). */
export interface DurationRange {
  lo: number
  hi: number
}

const inRange = (bin: number, r: DurationRange) => bin >= r.lo && bin < r.hi

export type Bucket = { key: string; label: string; range: DurationRange }

/**
 * Süre kovaları: ilk kova kısa duruşlar (< eşik, performans kaybı; OEE
 * Settings), sonra eşik – 10 dk ve ≥ 10 dk (kullanılabilirlik kaybı).
 */
export function bucketsOf(c: { shortStopMin?: number }): Bucket[] {
  const t = shortStopMinOf(c)
  if (t >= 10) return [
    { key: 'short', label: `< ${t} min`, range: { lo: 0, hi: t } },
    { key: 'long', label: `≥ ${t} min`, range: { lo: t, hi: Infinity } },
  ]
  return [
    { key: 'short', label: `< ${t} min`, range: { lo: 0, hi: t } },
    { key: 'mid', label: `${t} – 10 min`, range: { lo: t, hi: 10 } },
    { key: 'long', label: '≥ 10 min', range: { lo: 10, hi: Infinity } },
  ]
}

/** Varsayılan eşikle kovalar (< 2, 2–10, ≥ 10 dk). */
export const BUCKETS: Bucket[] = bucketsOf({})

export interface RelPeriod {
  key: string
  label: string
  from: string
  to: string
}

export interface RelGrid {
  periods: RelPeriod[]
  rows: { workCenter: string; cells: RelCell[] }[]
  total: RelCell[]
}

/**
 * Production time yalnızca duruş verisi yüklü günlerden sayılır. Shiftly KPI
 * bir günü içerip Downtimes dosyası içermiyorsa (dosya daha erken bitiyor ya
 * da histogram henüz kurulmamış) o günün üretimi MTBF'in payına girer ama
 * duruşları paydaya girmez: MTBF olduğundan yüksek çıkar. Duruş verisi olan
 * günler: herhangi bir iş merkezinde en az bir duruş satırı olan tarihler
 * (molalar da duruş satırıdır; çalışılan her gün en az bir satır vardır).
 */
export const stopDates = (stops: StopDay[]) => new Set(stops.map((d) => d.date))

/**
 * İş merkezi × dönem MTTR / MTBF. Yalnızca `range` içindeki duruşlar sayılır
 * (ör. en az 10 dk). MTBF = dönemin production time'ı ÷ duruş sayısı;
 * production time yalnızca duruş verisi olan günlerden (stopDates).
 */
export function relGrid(
  stops: StopDay[],
  days: DayRow[],
  periods: RelPeriod[],
  cat: RelCategory,
  range: DurationRange,
  scope: Scope,
  c: OeeConfig,
): RelGrid {
  const sc = (r: { workCenter: string; costCenter: string }) => inScope(r, scope, c)
  const covered = stopDates(stops)
  const scopedDays = days.filter(sc)
  const scopedStops = stops.filter(sc)
  const wcs = [...new Set(scopedDays.map((d) => d.workCenter))].sort()
  const cellOf = (from: string, to: string, wc?: string) => {
    let count = 0
    let minutes = 0
    for (const d of scopedStops) {
      if (d.date < from || d.date > to || (wc && d.workCenter !== wc)) continue
      for (const b of d.bins) {
        if (!inRange(b.bin, range) || !cat.match(b.rc1, b.rc2, b.text)) continue
        count += b.count
        minutes += b.minutes
      }
    }
    let production = 0
    for (const d of scopedDays) if (d.date >= from && d.date <= to && covered.has(d.date) && (!wc || d.workCenter === wc)) production += d.productionMin
    return relCell(count, minutes, production)
  }
  return {
    periods,
    rows: wcs.map((wc) => ({ workCenter: wc, cells: periods.map((p) => cellOf(p.from, p.to, wc)) })),
    total: periods.map((p) => cellOf(p.from, p.to)),
  }
}

export interface BucketRow {
  key: string
  label: string
  cell: RelCell
  /** İş merkezi → [adet, dakika], çoktan aza. */
  byPress: { workCenter: string; count: number; minutes: number }[]
}

/** Süre kovaları (< eşik, eşik–10, ≥ 10 dk; bucketsOf): toplam dakika, adet, MTTR, MTBF ve preslere dağılımı. */
export function bucketRows(stops: StopDay[], days: DayRow[], from: string, to: string, cat: RelCategory, scope: Scope, c: OeeConfig): BucketRow[] {
  const sc = (r: { date: string; workCenter: string; costCenter: string }) => r.date >= from && r.date <= to && inScope(r, scope, c)
  const covered = stopDates(stops)
  const production = days.filter((d) => sc(d) && covered.has(d.date)).reduce((a, d) => a + d.productionMin, 0)
  return bucketsOf(c).map((bk) => {
    const press = new Map<string, { count: number; minutes: number }>()
    let count = 0
    let minutes = 0
    for (const d of stops) {
      if (!sc(d)) continue
      for (const b of d.bins) {
        if (!inRange(b.bin, bk.range) || !cat.match(b.rc1, b.rc2, b.text)) continue
        count += b.count
        minutes += b.minutes
        const p = press.get(d.workCenter) ?? { count: 0, minutes: 0 }
        p.count += b.count
        p.minutes += b.minutes
        press.set(d.workCenter, p)
      }
    }
    return {
      key: bk.key,
      label: bk.label,
      cell: relCell(count, minutes, production),
      byPress: [...press].map(([workCenter, v]) => ({ workCenter, ...v })).sort((a, b) => b.minutes - a.minutes),
    }
  })
}

// ---- ham duruşlardan ayrıntı (en çok 8 gün) ------------------------------------------

/** Duruşun vardiyası: kod Shift Definition'da ya da Shift Group'ta (oeeBridge.eventShift ile aynı). */
const shiftOf = (e: { shiftDefinition: string; shiftGroup: string }, c: OeeConfig) =>
  shiftNumber(e.shiftDefinition, c) ?? shiftNumber(e.shiftGroup, c)

export interface Tally {
  key: string
  count: number
  minutes: number
}

const tally = (map: Map<string, Tally>, key: string, minutes: number, count = 1) => {
  const t = map.get(key) ?? { key, count: 0, minutes: 0 }
  t.count += count
  t.minutes += minutes
  map.set(key, t)
}
const sorted = (map: Map<string, Tally>) => [...map.values()].sort((a, b) => b.minutes - a.minutes)

export interface BucketDetail {
  materials: Tally[]
  shifts: Tally[]
  presses: Tally[]
}

/** Bir kovanın hangi pres, hangi malzeme, hangi vardiyada olduğu — ham duruşlardan. */
export function bucketDetail(events: DowntimeDay[], cat: RelCategory, range: DurationRange, scope: Scope, c: OeeConfig): BucketDetail {
  const materials = new Map<string, Tally>()
  const shifts = new Map<string, Tally>()
  const presses = new Map<string, Tally>()
  for (const d of events) {
    if (!inScope(d, scope, c)) continue
    for (const e of d.events) {
      if (!inRange(binOf(e.minutes), range) || !cat.match(e.rc1, e.rc2, e.textEn)) continue
      tally(materials, e.material && e.material !== '#' ? e.material : '(no part)', e.minutes)
      const sh = shiftOf(e, c)
      tally(shifts, sh ? `Shift ${sh}` : 'Shift ?', e.minutes)
      tally(presses, d.workCenter, e.minutes)
    }
  }
  return { materials: sorted(materials), shifts: sorted(shifts), presses: sorted(presses) }
}

export interface DetailRow {
  date: string
  shift: number | null
  /** Kayıp grubu kodu (Reason Code 2) ya da "Speed" / "Scrap" / "Reject". */
  group: string
  text: string
  count: number
  minutes: number
  /** İlk duruşun başlangıç saati (HH:MM). */
  start: string
}

/**
 * Bir parçanın (referans) bir iş merkezindeki kayıpları: gün × vardiya ×
 * neden (Daily Report sağ paneli). Yalnızca kayıp sayılan duruşlar; "#"
 * duruşları köprüdeki gibi dışarıda.
 */
export function partStops(events: DowntimeDay[], workCenter: string | null, material: string, c: OeeConfig): DetailRow[] {
  const map = new Map<string, DetailRow>()
  for (const d of events) {
    if (workCenter && d.workCenter !== workCenter) continue
    for (const e of d.events) {
      // Tanımsızlar (RC1 / RC2 "#") → Unassigned (classifyLoss).
      const group = e.material === material ? classifyLoss(e.rc1, e.rc2, c)?.group : undefined
      if (group === undefined) continue
      const shift = shiftOf(e, c)
      const k = `${d.date}|${shift ?? ''}|${group}|${e.textEn}`
      const r = map.get(k) ?? { date: d.date, shift, group, text: e.textEn || e.rc2, count: 0, minutes: 0, start: e.startTime.slice(0, 5) }
      r.count += 1
      r.minutes += e.minutes
      if (e.startTime && (!r.start || e.startTime.slice(0, 5) < r.start)) r.start = e.startTime.slice(0, 5)
      map.set(k, r)
    }
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.shift ?? 99) - (b.shift ?? 99) || b.minutes - a.minutes)
}

/** Bir parçanın siparişlerinden hız kaybı ya da hurda / ret: gün × vardiya. */
export function partOrders(orders: OrderRow[], workCenter: string | null, material: string, kind: 'speed' | 'scrap' | 'reject', c: OeeConfig): DetailRow[] {
  const map = new Map<string, DetailRow>()
  for (const o of orders) {
    if (o.material !== material || (workCenter && o.workCenter !== workCenter)) continue
    const shift = shiftNumber(o.shift, c)
    const value = kind === 'speed' ? o.productionMin - o.operatingMin : kind === 'scrap' ? o.scrap : o.reject
    if (!(Math.abs(value) > 0.05)) continue
    const k = `${o.date}|${shift ?? ''}`
    const label = kind === 'speed' ? 'Speed' : kind === 'scrap' ? 'Scrap' : 'Reject'
    const r = map.get(k) ?? { date: o.date, shift, group: label, text: o.order ? `Order ${o.order}` : label, count: 0, minutes: 0, start: '' }
    r.count += kind === 'speed' ? 1 : value
    r.minutes += kind === 'speed' ? value : 0
    map.set(k, r)
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.shift ?? 99) - (b.shift ?? 99))
}

/** Neden × parça × vardiya satırı; `days`: o satırın duruşları gün gün (Die Follow-up tarihi). */
export interface ReasonPartRow {
  material: string
  workCenter: string
  shift: number | null
  count: number
  minutes: number
  days: { date: string; minutes: number }[]
}

/**
 * Köprüde seçili kalemin nedenleri için vardiya dağılımı ve neden × parça ×
 * vardiya satırları (Loss Bridge yan paneli: "MARKING LABEL UPDATING hangi
 * referansta, hangi vardiyada"). `groups`: kalemin Reason Code 2 kodları.
 */
export function reasonShiftParts(
  events: DowntimeDay[],
  groups: string[],
  c: OeeConfig,
): { shifts: Map<string, Map<number | null, number>>; parts: Map<string, ReasonPartRow[]> } {
  const gs = new Set(groups)
  const shifts = new Map<string, Map<number | null, number>>()
  const partMap = new Map<string, Map<string, ReasonPartRow>>()
  for (const d of events) {
    for (const e of d.events as DowntimeEvent[]) {
      const group = classifyLoss(e.rc1, e.rc2, c)?.group
      if (group === undefined || !gs.has(group)) continue
      const text = e.textEn || e.rc2
      const sh = shiftOf(e, c)
      const byShift = shifts.get(text) ?? new Map<number | null, number>()
      byShift.set(sh, (byShift.get(sh) ?? 0) + e.minutes)
      shifts.set(text, byShift)
      const pm = partMap.get(text) ?? new Map()
      const material = e.material && e.material !== '#' ? e.material : '(no part)'
      const k = `${d.workCenter}|${material}|${sh ?? ''}`
      const r = pm.get(k) ?? { material, workCenter: d.workCenter, shift: sh, count: 0, minutes: 0, days: [] }
      r.count += 1
      r.minutes += e.minutes
      const day = r.days.find((x) => x.date === d.date)
      if (day) day.minutes += e.minutes
      else r.days.push({ date: d.date, minutes: e.minutes })
      pm.set(k, r)
      partMap.set(text, pm)
    }
  }
  for (const m of partMap.values()) for (const r of m.values()) r.days.sort((a, b) => a.date.localeCompare(b.date))
  const parts = new Map([...partMap].map(([t, m]) => [t, [...m.values()].sort((a, b) => b.minutes - a.minutes)]))
  return { shifts, parts }
}
