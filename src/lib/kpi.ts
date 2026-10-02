/**
 * KPI modülü (docs/kpi.md): masraf yeri × dönem (ay ya da ISO hafta) için
 * planlanan ve gerçekleşen değerler. Hesapların tek yeri burası; sayfalar ve
 * sunucu bunu kullanır.
 *
 * Toplama kuralı (OEE ile aynı): yüzdelerin ortalaması alınmaz — saat ve
 * adetler toplanır, oran toplamdan bir kez hesaplanır.
 *
 * Girilenler: operatör sayısı (direct / indirect), üretim adedi, üretim saati,
 * normal mevcudiyet saati (fazla mesaisiz), fazla mesai saati, devamsızlık
 * saati; planda ayrıca OEE hedefi.
 * Hesaplananlar:
 *   Total presence   = normal mevcudiyet + fazla mesai
 *   Overtime %       = fazla mesai ÷ normal mevcudiyet
 *   Absenteeism %    = devamsızlık ÷ (normal mevcudiyet + devamsızlık)
 *   Productivity     = üretim saati ÷ total presence
 *   OEE (gerçekleşen) = OEE modülünün kök verisi: Σ operating ÷ Σ loading
 * Gerçekleşen üretim adedi ve saati girilmemişse OEE verisinden gelir (iyi
 * adet, net üretim süresi).
 */

export type KpiPeriod = 'month' | 'week'
export type OperatorType = 'direct' | 'indirect'

/** Girilen değerler (boş = girilmedi). OEE yalnızca planda, kesir (0,85). */
export interface KpiValues {
  operators?: number
  volume?: number
  productionHours?: number
  presenceHours?: number
  overtimeHours?: number
  absenceHours?: number
  oee?: number
}

export interface KpiEntry {
  period: KpiPeriod
  year: number
  num: number
  costCenter: string
  operatorType: OperatorType
  plan: KpiValues
  actual: KpiValues
}

/** Bir masraf yerinin bir dönemdeki OEE kök verisi (dakika, adet). */
export interface OeeSum {
  costCenter: string
  good: number
  operatingMin: number
  productionMin: number
  loadingMin: number
}

export interface KpiMetrics {
  operators: number | null
  operatorsDirect: number | null
  operatorsIndirect: number | null
  volume: number | null
  productionHours: number | null
  presenceHours: number | null
  overtimeHours: number | null
  totalPresenceHours: number | null
  overtimePct: number | null
  absenceHours: number | null
  absenteeismPct: number | null
  productivity: number | null
  oee: number | null
}

export interface KpiResult {
  plan: KpiMetrics
  actual: KpiMetrics
  /** Gerçekleşen adet / saat OEE verisinden geldi mi (girilmediği için). */
  fromOee: { volume: boolean; productionHours: boolean }
}

/** Dashboard'daki sıra ve biçim. `higher`: artışı iyi mi (gap rengi). */
export const KPI_ROWS: { key: keyof KpiMetrics; label: string; short?: string; unit: 'n' | 'h' | 'pcs' | '%'; higher: boolean | null }[] = [
  { key: 'operators', label: 'Operator number', unit: 'n', higher: null },
  { key: 'volume', label: 'Production volume', unit: 'pcs', higher: true },
  { key: 'productionHours', label: 'Production hour', unit: 'h', higher: true },
  { key: 'presenceHours', label: 'Normal presence hour (w/o overtime)', short: 'Normal presence h', unit: 'h', higher: null },
  { key: 'overtimeHours', label: 'Overtime', unit: 'h', higher: false },
  { key: 'overtimePct', label: 'Overtime %', unit: '%', higher: false },
  { key: 'totalPresenceHours', label: 'Total presence hour', short: 'Total presence h', unit: 'h', higher: null },
  { key: 'absenteeismPct', label: 'Absenteeism %', unit: '%', higher: false },
  { key: 'productivity', label: 'Productivity', unit: '%', higher: true },
  { key: 'oee', label: 'OEE', unit: '%', higher: true },
]

/** Giriş sayfasında girilen alanlar (planda OEE de). */
export const KPI_INPUTS: { key: keyof KpiValues; label: string; unit: string; planOnly?: boolean }[] = [
  { key: 'operators', label: 'Operator number', unit: 'persons' },
  { key: 'volume', label: 'Production volume', unit: 'pcs' },
  { key: 'productionHours', label: 'Production hour', unit: 'h' },
  { key: 'presenceHours', label: 'Normal presence hour (w/o overtime)', unit: 'h' },
  { key: 'overtimeHours', label: 'Overtime', unit: 'h' },
  { key: 'absenceHours', label: 'Absence hour (for absenteeism %)', unit: 'h' },
  { key: 'oee', label: 'OEE target', unit: '%', planOnly: true },
]

const ratio = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 ? a / b : null)

function addOpt(a: number | null, b: number | undefined | null): number | null {
  if (b === undefined || b === null || !Number.isFinite(b)) return a
  return (a ?? 0) + b
}

function metrics(parts: {
  direct: number | null
  indirect: number | null
  volume: number | null
  productionHours: number | null
  presence: number | null
  overtime: number | null
  absence: number | null
  oee: number | null
}): KpiMetrics {
  const total = parts.presence === null && parts.overtime === null ? null : (parts.presence ?? 0) + (parts.overtime ?? 0)
  const operators = parts.direct === null && parts.indirect === null ? null : (parts.direct ?? 0) + (parts.indirect ?? 0)
  return {
    operators,
    operatorsDirect: parts.direct,
    operatorsIndirect: parts.indirect,
    volume: parts.volume,
    productionHours: parts.productionHours,
    presenceHours: parts.presence,
    overtimeHours: parts.overtime,
    totalPresenceHours: total,
    overtimePct: ratio(parts.overtime, parts.presence),
    absenceHours: parts.absence,
    absenteeismPct: parts.absence === null ? null : ratio(parts.absence, (parts.presence ?? 0) + parts.absence),
    productivity: ratio(parts.productionHours, total),
    oee: parts.oee,
  }
}

/**
 * Seçilen masraf yerlerinin bir dönemdeki planı ve gerçekleşeni. `entries`
 * ve `oee` aynı dönemin (ya da birleştirilecek dönemlerin) kayıtları.
 */
export function kpiFor(entries: KpiEntry[], oee: OeeSum[]): KpiResult {
  const side = (pick: (e: KpiEntry) => KpiValues) => {
    let direct: number | null = null
    let indirect: number | null = null
    let volume: number | null = null
    let productionHours: number | null = null
    let presence: number | null = null
    let overtime: number | null = null
    let absence: number | null = null
    for (const e of entries) {
      const v = pick(e)
      if (e.operatorType === 'indirect') indirect = addOpt(indirect, v.operators)
      else direct = addOpt(direct, v.operators)
      volume = addOpt(volume, v.volume)
      productionHours = addOpt(productionHours, v.productionHours)
      presence = addOpt(presence, v.presenceHours)
      overtime = addOpt(overtime, v.overtimeHours)
      absence = addOpt(absence, v.absenceHours)
    }
    return { direct, indirect, volume, productionHours, presence, overtime, absence }
  }

  // Plan OEE: masraf yerlerinin hedefleri, planlanan üretim saatiyle ağırlıklı
  // (saat yoksa eşit ağırlık).
  const targets = entries.filter((e) => e.plan.oee !== undefined && e.plan.oee !== null)
  const weight = (e: KpiEntry) => (e.plan.productionHours && e.plan.productionHours > 0 ? e.plan.productionHours : 0)
  const wSum = targets.reduce((a, e) => a + weight(e), 0)
  const planOee = !targets.length
    ? null
    : wSum > 0
      ? targets.reduce((a, e) => a + (e.plan.oee ?? 0) * weight(e), 0) / wSum
      : targets.reduce((a, e) => a + (e.plan.oee ?? 0), 0) / targets.length

  const plan = metrics({ ...side((e) => e.plan), oee: planOee })

  // Gerçekleşen: girilmeyen adet / saat masraf yeri bazında OEE verisinden.
  const act = side((e) => e.actual)
  const byCc = new Map<string, OeeSum>()
  for (const o of oee) {
    const cur = byCc.get(o.costCenter) ?? { costCenter: o.costCenter, good: 0, operatingMin: 0, productionMin: 0, loadingMin: 0 }
    byCc.set(o.costCenter, {
      costCenter: o.costCenter,
      good: cur.good + o.good,
      operatingMin: cur.operatingMin + o.operatingMin,
      productionMin: cur.productionMin + o.productionMin,
      loadingMin: cur.loadingMin + o.loadingMin,
    })
  }
  const ccs = new Set([...entries.map((e) => e.costCenter), ...byCc.keys()])
  let volumeFromOee = false
  let hoursFromOee = false
  for (const cc of ccs) {
    const own = entries.filter((e) => e.costCenter === cc)
    const o = byCc.get(cc)
    if (!o || !(o.loadingMin > 0)) continue
    if (!own.some((e) => e.actual.volume !== undefined && e.actual.volume !== null)) {
      act.volume = addOpt(act.volume, o.good)
      volumeFromOee = true
    }
    if (!own.some((e) => e.actual.productionHours !== undefined && e.actual.productionHours !== null)) {
      act.productionHours = addOpt(act.productionHours, o.productionMin / 60)
      hoursFromOee = true
    }
  }
  let op = 0
  let load = 0
  for (const o of byCc.values()) {
    op += o.operatingMin
    load += o.loadingMin
  }
  const actual = metrics({ ...act, oee: load > 0 ? op / load : null })
  return { plan, actual, fromOee: { volume: volumeFromOee, productionHours: hoursFromOee } }
}

// ---- dönemler ------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export interface KpiSlot {
  year: number
  num: number
  label: string
  /** Gün aralığı (OEE verisi için), YYYY-MM-DD. */
  from: string
  to: string
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** ISO haftanın Pazartesisi (UTC). */
export function isoWeekMonday(year: number, week: number): string {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = jan4.getUTCDay() || 7
  const monday = new Date(jan4.getTime() - (dow - 1) * 86_400_000 + (week - 1) * 7 * 86_400_000)
  return iso(monday)
}

/** Yılın ISO hafta sayısı (52 ya da 53). */
export function isoWeeksInYear(year: number): number {
  const dec28 = new Date(Date.UTC(year, 11, 28))
  const thursday = new Date(dec28.getTime() + (4 - (dec28.getUTCDay() || 7)) * 86_400_000)
  const jan1 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1))
  return Math.ceil(((thursday.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7)
}

export function monthSlot(year: number, month: number): KpiSlot {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const mm = String(month).padStart(2, '0')
  return { year, num: month, label: MONTHS[month - 1], from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` }
}

export function weekSlot(year: number, week: number): KpiSlot {
  const from = isoWeekMonday(year, week)
  const to = iso(new Date(Date.parse(`${from}T00:00:00Z`) + 6 * 86_400_000))
  return { year, num: week, label: `W${week}`, from, to }
}

/** Dashboard trendinin sabit sayıda dilimi (Ocak'ta da Aralık'ta da aynı ölçü). */
export const MONTH_SLOTS = 12
export const WEEK_SLOTS = 13

/**
 * Trend dilimleri: aylıkta seçilen yılın 12 ayı (Ocak–Aralık, gelecek aylar
 * boş); haftalıkta seçilen haftayla biten 13 hafta (yıl geçişi dahil).
 */
export function trendSlots(period: KpiPeriod, year: number, num: number): KpiSlot[] {
  if (period === 'month') return Array.from({ length: MONTH_SLOTS }, (_, i) => monthSlot(year, i + 1))
  const out: KpiSlot[] = []
  let y = year
  let w = num
  for (let i = 0; i < WEEK_SLOTS; i++) {
    out.unshift(weekSlot(y, w))
    w--
    if (w < 1) {
      y--
      w = isoWeeksInYear(y)
    }
  }
  return out
}

export const slotOf = (period: KpiPeriod, year: number, num: number) => (period === 'month' ? monthSlot(year, num) : weekSlot(year, num))

export const slotKey = (s: { year: number; num: number }) => `${s.year}-${String(s.num).padStart(2, '0')}`

export function periodTitle(period: KpiPeriod, year: number, num: number): string {
  return period === 'month' ? `${MONTHS[num - 1]} ${year}` : `W${num} ${year}`
}

// ---- biçim -------------------------------------------------------------------------

export function formatKpi(v: number | null | undefined, unit: 'n' | 'h' | 'pcs' | '%'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  if (unit === '%') return `${(v * 100).toFixed(1)}%`
  if (unit === 'n') return Number.isInteger(v) ? String(v) : v.toFixed(1)
  return Math.round(v).toLocaleString('en-GB')
}

/** Gerçekleşen − plan; yüzdede puan. */
export function kpiGap(plan: number | null, actual: number | null): number | null {
  return plan === null || actual === null ? null : actual - plan
}
