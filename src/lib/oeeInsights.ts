// OEE Agent Insights (planlamacı, 2026-10-23): seçilen masraf yeri / iş yeri ve
// tarih aralığı için "standart Pareto raporunda görünmeyen" 3–5 tespit.
//
// Eğitimin özü: yapay zekâya ham toplam verilmez. Burada istatistiksel SİNYALLER
// hesaplanır (gizli yoğunlaşma, parça × makine etkisi, sipariş değişimi etkisi,
// vardiya / gün deseni, mikro duruş, rejim değişimi, performans ve veri kalitesi
// hataları, sık ve kısa ayar, mola sonrası artık duruş, plansız 5S); kanıta o
// kayıptaki en büyük 3 alt neden (duruş metni) eklenir; her sinyalin kanıtı, kazancı (dk / hafta, adet) ve güveni koddan
// sayıyla yazılır. Model yalnızca bu sinyallerden en güçlü 3–5'ini seçip yorumlar;
// yapay zekâ yoksa en güçlü 3 sinyal kurallarla gösterilir.
// Kararlar: docs/oee-agent-report.md → Agent Insights.

import { baseCode, groupLabel, isShortCode, ratios, shiftNumber, shortStopMinOf, type DayRow, type LossDay, type OeeConfig, type OeeTimes, type OrderRow, type ShiftRow } from './oee'
import type { StopDay } from './oeeReliability'
import { splitShortStops } from './oeeShortStops'
import { LOSS_CODE_MEANINGS } from './settingsDefaults'

export interface InsightThresholds {
  /** Bir sinyalin sayılması için en az kayıp (dk / hafta). */
  minWeeklyMin: number
  /** Gizli yoğunlaşma: tek parçanın kayıp payı en az. */
  concentrationShare: number
  /** Gizli yoğunlaşma: kayıp payı ÷ yükleme payı en az (sürpriz). */
  concentrationLift: number
  /** Parça × iş yeri: iki iş yerinde yükleme saati başına kayıp oranı en az. */
  interactionRatio: number
  /** Karşılaştırmada en az yükleme (dk). */
  minLoadingMin: number
  /** Vardiya: iş yerinin geri kalanına göre en az OEE farkı (puan). */
  shiftGapPts: number
  /** Haftanın günü: kayıp oranı, günlerin ortalamasının en az bu katı. */
  weekdayFactor: number
  /** Mikro duruş: olay başına en çok dk. */
  microMaxMin: number
  /** Rejim değişimi: sonrası ÷ öncesi en az. */
  regimeFactor: number
  /** Sipariş sayısı ile availability arasındaki korelasyon en çok (negatif). */
  changeoverR: number
  /** Veri kalitesi: sebebi girilmemiş ("#") kaybın payı en az. */
  unclassifiedShare: number
  /** Sık ve kısa ayar: aynı ayar metni haftada en az bu kadar kez … */
  repeatPerWeek: number
  /** … ve olay başına en çok bu kadar dk. */
  repeatMaxMin: number
  /** Sebepsiz ("#") duruş olay başına en az bu kadar dk (ve kodlulara göre ≥ 2 kat) → büyük duruşlar nedensiz. */
  longUnclassifiedMin: number
  /** Yapay zekâya giden en çok sinyal. */
  maxSignals: number
}

export const INSIGHT_DEFAULTS: InsightThresholds = {
  minWeeklyMin: 60,
  concentrationShare: 0.5,
  concentrationLift: 1.5,
  interactionRatio: 2,
  minLoadingMin: 240,
  shiftGapPts: 8,
  weekdayFactor: 1.6,
  microMaxMin: 2,
  regimeFactor: 2,
  changeoverR: -0.5,
  unclassifiedShare: 0.1,
  repeatPerWeek: 50,
  repeatMaxMin: 5,
  longUnclassifiedMin: 20,
  maxSignals: 20,
}

export type SignalKind =
  | 'concentration'
  | 'interaction'
  | 'changeover'
  | 'shift'
  | 'weekday'
  | 'micro'
  | 'regime'
  | 'performance'
  | 'dataQuality'
  | 'setupRepeat'
  | 'afterBreak'
  | 'unplanned5S'

export type Confidence = 'high' | 'medium' | 'low'

export interface Signal {
  id: string
  kind: SignalKind
  title: string
  finding: string
  evidence: string
  whyNonObvious: string
  firstCheck: string
  gainMinPerWeek: number
  gainPiecesPerWeek: number | null
  confidence: Confidence
  score: number
  /** Kısa seri (ör. haftalık dk) — sayfada küçük çizgi. */
  spark?: number[]
}

export interface InsightInput {
  from: string
  to: string
  config: OeeConfig
  days: DayRow[]
  losses: LossDay[]
  shifts: ShiftRow[]
  orders: OrderRow[]
  /**
   * Süre histogramı (oeeStopDays). Varsa duruşlar bölünür (oeeShortStops.ts):
   * < eşik olaylar yalnız mikro duruş (hız) sinyaline, ≥ eşik olaylar diğer
   * (kullanılabilirlik) sinyallerine girer. Yoksa eski hesap.
   */
  stops?: StopDay[]
}

// ---- yardımcılar -------------------------------------------------------------------

const DAY_MS = 86_400_000
const dayIndex = (from: string, d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
export const rangeDays = (from: string, to: string) => dayIndex(from, to) + 1
const r0 = (x: number) => Math.round(x)
const pct = (x: number) => `${Math.round(x * 100)}%`
const dur = (min: number) => (Math.abs(min) < 60 ? `${Math.round(min)} min` : `${(min / 60).toFixed(1)} h`)
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const weekday = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7
const sumTimes = (rows: OeeTimes[]): OeeTimes =>
  rows.reduce(
    (a, r) => ({
      good: a.good + r.good,
      scrap: a.scrap + r.scrap,
      reject: a.reject + r.reject,
      scheduledMin: a.scheduledMin + r.scheduledMin,
      unscheduledMin: a.unscheduledMin + r.unscheduledMin,
      operatingMin: a.operatingMin + r.operatingMin,
      productionMin: a.productionMin + r.productionMin,
      loadingMin: a.loadingMin + r.loadingMin,
    }),
    { good: 0, scrap: 0, reject: 0, scheduledMin: 0, unscheduledMin: 0, operatingMin: 0, productionMin: 0, loadingMin: 0 },
  )
function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const x of xs) {
    const k = key(x)
    const list = m.get(k)
    if (list) list.push(x)
    else m.set(k, [x])
  }
  return m
}
const confWeight: Record<Confidence, number> = { high: 1, medium: 0.7, low: 0.4 }
const confidenceOf = (n: number, high: number, medium: number): Confidence => (n >= high ? 'high' : n >= medium ? 'medium' : 'low')

export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 3) return null
  const mx = xs.reduce((a, x) => a + x, 0) / n
  const my = ys.reduce((a, y) => a + y, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null
}

interface LossEntry {
  date: string
  workCenter: string
  group: string
  min: number
  count: number
}
interface PartEntry extends LossEntry {
  part: string
}
interface ReasonEntry extends LossEntry {
  /** Duruş metni (büyük harf); boşsa "(no text)". */
  text: string
}

/** Kayıp sayılan duruşlar (Reason Code 1 kayıp listesinde), "#" dahil. */
function lossEntries(losses: LossDay[], c: OeeConfig): { codes: LossEntry[]; parts: PartEntry[]; reasons: ReasonEntry[] } {
  const codes: LossEntry[] = []
  const parts: PartEntry[] = []
  const reasons: ReasonEntry[] = []
  for (const l of losses) {
    for (const [k, [min, count]] of Object.entries(l.reasons ?? {})) {
      const [rc1, rc2, ...rest] = k.split('|')
      if (!c.lossReasonCodes.includes(rc1)) continue
      reasons.push({ date: l.date, workCenter: l.workCenter, group: rc2 || '#', text: rest.join('|').trim().toUpperCase() || '(no text)', min, count })
    }
    for (const [k, [min, count]] of Object.entries(l.codes)) {
      const [rc1, rc2] = k.split('|')
      if (!c.lossReasonCodes.includes(rc1)) continue
      codes.push({ date: l.date, workCenter: l.workCenter, group: rc2 || '#', min, count })
    }
    for (const [k, [min, count]] of Object.entries(l.parts ?? {})) {
      const [rc1, rc2, part] = k.split('|')
      if (!c.lossReasonCodes.includes(rc1) || !part || part === '#') continue
      parts.push({ date: l.date, workCenter: l.workCenter, group: rc2 || '#', part, min, count })
    }
  }
  return { codes, parts, reasons }
}

const sumMin = (xs: { min: number }[]) => xs.reduce((a, x) => a + x.min, 0)

/** Haftalık seri (aralığın 7'şer günü, eskiden yeniye). */
function weekly(entries: { date: string; min: number }[], from: string, weeks: number): number[] {
  const out = Array(weeks).fill(0)
  for (const e of entries) {
    const w = Math.floor(dayIndex(from, e.date) / 7)
    if (w >= 0 && w < weeks) out[w] += e.min
  }
  return out.map(r0)
}

/** Bir kayıptaki en büyük 3 alt neden (duruş metni): dk ve olay. */
export function topReasons(list: { text: string; min: number; count: number }[], n = 3): { text: string; min: number; count: number }[] {
  const by = new Map<string, { text: string; min: number; count: number }>()
  for (const x of list) {
    const r = by.get(x.text) ?? { text: x.text, min: 0, count: 0 }
    r.min += x.min
    r.count += x.count
    by.set(x.text, r)
  }
  return [...by.values()]
    .sort((a, b) => b.min - a.min || a.text.localeCompare(b.text))
    .slice(0, n)
    .map((r) => ({ ...r, min: r0(r.min) }))
}

/** Kanıta alt nedenler eklenir: "… Top reasons: REGLAJ ELECTROT 5.2 h / 160 stops; …". */
function withReasons(evidence: string, list: ReasonEntry[]): string {
  const top = topReasons(list)
  return top.length ? `${evidence} Top reasons: ${top.map((r) => `${r.text} ${dur(r.min)} / ${r.count} stops`).join('; ')}.` : evidence
}

// ---- kayıp kodlarının anlamı ------------------------------------------------------------

/** Varsayılan anlam (src/lib/settingsDefaults.ts → LOSS_CODE_MEANINGS): önce "RC1 RC2", sonra RC2. */
export function defaultLossMeaning(code: string, c: OeeConfig): string {
  const k = code || '#'
  for (const rc1 of c.lossReasonCodes) {
    const m = LOSS_CODE_MEANINGS[`${rc1} ${k}`]
    if (m) return m
  }
  return LOSS_CODE_MEANINGS[k] ?? ''
}

/** Kodun anlamı: kullanıcının yazdığı (OEE Settings → Loss groups → Meaning) her zaman önce. */
export const lossMeaning = (code: string, c: OeeConfig): string =>
  c.lossGroups.find((g) => g.code === (code || '#'))?.meaning?.trim() || defaultLossMeaning(code, c)

/** Yapay zekâya giden kod sözlüğü: ayardaki gruplar + veride geçen tanımsız kodlar. */
export function lossCodeMeanings(c: OeeConfig, undefinedCodes: string[] = []): Record<string, string> {
  const out: Record<string, string> = {}
  for (const g of c.lossGroups) {
    const m = lossMeaning(g.code, c)
    out[g.code] = m ? `${g.label}: ${m}` : g.label
  }
  for (const code of undefinedCodes) {
    const m = defaultLossMeaning(code, c)
    out[code] = `not defined in OEE Settings${m ? `; ${m}` : ''}`
  }
  return out
}

export interface UndefinedCode {
  code: string
  min: number
  count: number
}

/** Veride kayıp olarak geçen ama Loss groups'ta tanımlı olmayan Reason Code 2'ler (dk'ya göre). */
export function undefinedLossCodes(losses: LossDay[], c: OeeConfig): UndefinedCode[] {
  const known = new Set(c.lossGroups.map((g) => g.code))
  const by = new Map<string, UndefinedCode>()
  for (const l of losses) {
    for (const [k, [min, count]] of Object.entries(l.codes)) {
      const [rc1, rc2] = k.split('|')
      const code = rc2 || '#'
      if (!c.lossReasonCodes.includes(rc1) || known.has(code)) continue
      const x = by.get(code) ?? { code, min: 0, count: 0 }
      x.min += min
      x.count += count
      by.set(code, x)
    }
  }
  return [...by.values()].sort((a, b) => b.min - a.min || a.code.localeCompare(b.code)).map((x) => ({ ...x, min: r0(x.min) }))
}

/** Ayar / setup sayılan alt neden: grubun anlamı ayar diyorsa, metin Setup texts'te ya da ayar kelimesi geçiyorsa. */
const SETUP_WORDS = /REGLAJ|SETUP|SET-UP|ADJUST|AYAR|SCHIMB/
const isSetupReason = (group: string, text: string, c: OeeConfig) =>
  /set-?up|adjust/i.test(lossMeaning(group, c)) || c.setupTexts.some((t) => t.text.trim().toUpperCase() === text) || SETUP_WORDS.test(text)
/**
 * Mola sonrası artık duruş (metin büyük harf; Türkçe, İngilizce, Rumence, aksanlı ya da aksansız).
 * "AFTER BREAKDOWN" arıza sonrasıdır, sayılmaz.
 */
export const AFTER_BREAK =
  /(AFTER|POST)[\s-]*(THE\s*)?((COFFEE|LUNCH|TEA)\s*)?BREAK(?!DOWN|AGE)|AFTER\s*LUNCH|DUP[AĂÂ]\s*(PAUZ|MAS[AĂ])|MOLA(DAN|SI|SINDAN)?\s*(SONRA|D[OÖ]N[UÜ][SŞ]|SONU)|YEMEK(TEN)?\s*SONRA/
/** 5S (metin): "5S", "5 S", "5-S"; "P15SX" gibi parça numaraları sayılmaz. */
export const FIVE_S = /(^|[^0-9A-Z])5[\s-]?S([^A-Z]|$)/

// ---- sinyaller -----------------------------------------------------------------------

/**
 * Bütün sinyaller, puana göre sıralı. Puan = kazanç (dk / hafta) × sürpriz × güven.
 * Sürpriz: sıradan bir Pareto'da görünmeme derecesi (tür ağırlığı, yoğunlaşmada lift).
 */
export function insightSignals(input: InsightInput, t: InsightThresholds = INSIGHT_DEFAULTS): Signal[] {
  const { from, to, config: c } = input
  const nDays = Math.max(1, rangeDays(from, to))
  const weeks = nDays / 7
  const nWeeks = Math.max(1, Math.ceil(nDays / 7))
  const days = input.days.filter((d) => d.date >= from && d.date <= to)
  const losses = input.losses.filter((d) => d.date >= from && d.date <= to)
  const shifts = input.shifts.filter((d) => d.date >= from && d.date <= to)
  const orders = input.orders.filter((d) => d.date >= from && d.date <= to)
  // Kısa duruşlar (< eşik) hız kaybıdır: yalnız mikro duruş sinyaline girer (2026-10-23).
  const entries = lossEntries(input.stops ? splitShortStops(losses, input.stops, c).lossDays : losses, c)
  const long = <T extends { group: string }>(xs: T[]) => xs.filter((x) => !isShortCode(x.group))
  const short = <T extends { group: string }>(xs: T[]) => xs.filter((x) => isShortCode(x.group)).map((x) => ({ ...x, group: baseCode(x.group) }))
  const codes = long(entries.codes)
  const parts = long(entries.parts)
  const reasons = long(entries.reasons)
  const shortCodes = short(entries.codes)
  const shortReasons = short(entries.reasons)
  const shortMin = shortStopMinOf(c)
  const label = (g: string) => (g === '#' ? 'unclassified (#)' : groupLabel(g, c))
  const minTotal = t.minWeeklyMin * weeks
  const out: Signal[] = []

  // İş yeri hızı: geri kazanılan dakika → adet (gerçekleşen hızla).
  const wcTimes = new Map([...groupBy(days, (d) => d.workCenter)].map(([wc, rows]) => [wc, sumTimes(rows)]))
  const allTimes = sumTimes(days)
  const rate = (wc?: string) => {
    const x = (wc && wcTimes.get(wc)) || allTimes
    return x.productionMin > 0 ? x.good / x.productionMin : 0
  }
  const pieces = (min: number, wc?: string) => (rate(wc) > 0 ? r0(min * rate(wc)) : null)
  const push = (s: Omit<Signal, 'score'>, surprise: number) =>
    out.push({ ...s, gainMinPerWeek: r0(s.gainMinPerWeek), score: Math.round(s.gainMinPerWeek * surprise * confWeight[s.confidence] * 10) / 10 })

  // 1. Gizli yoğunlaşma: bir kayıp grubunun büyük kısmı tek parçada, o parça yüklemenin küçük bir payı.
  const loadByPart = new Map<string, number>()
  for (const o of orders) if (o.material) loadByPart.set(o.material, (loadByPart.get(o.material) ?? 0) + o.loadingMin)
  const totalLoad = [...loadByPart.values()].reduce((a, x) => a + x, 0)
  for (const [group, list] of groupBy(parts.filter((p) => p.group !== '#'), (p) => p.group)) {
    const total = sumMin(list)
    if (total < minTotal) continue
    const byPart = [...groupBy(list, (p) => p.part)].map(([part, xs]) => ({ part, min: sumMin(xs), count: xs.reduce((a, x) => a + x.count, 0), xs }))
    byPart.sort((a, b) => b.min - a.min)
    const top = byPart[0]
    const share = top.min / total
    const loadShare = totalLoad > 0 ? (loadByPart.get(top.part) ?? 0) / totalLoad : null
    if (share < t.concentrationShare || loadShare === null || loadShare <= 0) continue
    const lift = share / loadShare
    if (lift < t.concentrationLift) continue
    const excess = top.min - loadShare * total
    const wcs = [...new Set(top.xs.map((x) => x.workCenter))]
    push(
      {
        id: `concentration|${group}|${top.part}`,
        kind: 'concentration',
        title: `${pct(share)} of ${label(group)} loss is on one part: ${top.part}`,
        finding: `${top.part} causes ${dur(top.min)} of ${dur(total)} ${label(group)} loss (${pct(share)}), but takes only ${pct(loadShare)} of the loading.`,
        evidence: withReasons(
          `${top.count} stops on ${wcs.join(', ')}; next part ${byPart[1] ? `${byPart[1].part} ${dur(byPart[1].min)}` : '—'}. Loss share ÷ loading share = ${lift.toFixed(1)}×.`,
          reasons.filter((r) => r.group === group && wcs.includes(r.workCenter)),
        ),
        whyNonObvious: `A loss-group Pareto shows ${label(group)} as one bar; it does not show that one part drives it far beyond its share of the run time.`,
        firstCheck: `Check the die / fixture of ${top.part} and the last stop texts of ${label(group)} on it.`,
        gainMinPerWeek: excess / weeks,
        gainPiecesPerWeek: pieces(excess / weeks, wcs[0]),
        confidence: confidenceOf(top.count, 15, 6),
        spark: weekly(top.xs, from, nWeeks),
      },
      Math.min(3, lift / 1.5) * 1.3,
    )
  }

  // 2. Parça × iş yeri: aynı parça bir iş yerinde yükleme saati başına çok daha fazla kayıp üretiyor.
  const loadPartWc = new Map<string, number>()
  for (const o of orders) if (o.material) loadPartWc.set(`${o.material}|${o.workCenter}`, (loadPartWc.get(`${o.material}|${o.workCenter}`) ?? 0) + o.loadingMin)
  for (const [part, list] of groupBy(parts.filter((p) => p.group !== '#'), (p) => p.part)) {
    const wcs = [...new Set([...loadPartWc.keys()].filter((k) => k.startsWith(`${part}|`)).map((k) => k.slice(part.length + 1)))]
    const rows = wcs
      .map((wc) => {
        const load = loadPartWc.get(`${part}|${wc}`) ?? 0
        const min = sumMin(list.filter((x) => x.workCenter === wc))
        return { wc, load, min, perHour: load > 0 ? (min / load) * 60 : 0 }
      })
      .filter((r) => r.load >= t.minLoadingMin)
    if (rows.length < 2) continue
    rows.sort((a, b) => b.perHour - a.perHour)
    const hi = rows[0]
    const lo = rows[rows.length - 1]
    if (hi.perHour < 5 || hi.perHour < t.interactionRatio * Math.max(lo.perHour, 0.5)) continue
    const excess = ((hi.perHour - lo.perHour) * hi.load) / 60
    if (excess < minTotal) continue
    push(
      {
        id: `interaction|${part}|${hi.wc}|${lo.wc}`,
        kind: 'interaction',
        title: `${part} loses ${(hi.perHour / Math.max(lo.perHour, 0.1)).toFixed(1)}× more time on ${hi.wc} than on ${lo.wc}`,
        finding: `On ${hi.wc} ${part} loses ${hi.perHour.toFixed(1)} min per loading hour, on ${lo.wc} only ${lo.perHour.toFixed(1)}.`,
        evidence: withReasons(
          rows.map((r) => `${r.wc}: ${dur(r.load)} loading, ${dur(r.min)} loss`).join('; ') + '.',
          reasons.filter((r) => r.workCenter === hi.wc && r.group !== '#'),
        ),
        whyNonObvious: 'Machine and part Paretos are read separately; the same part behaving differently on two machines points at the machine set-up, not at the part.',
        firstCheck: `Compare the set-up (shut height, feed, sensors) of ${hi.wc} with ${lo.wc} for ${part}.`,
        gainMinPerWeek: excess / weeks,
        gainPiecesPerWeek: pieces(excess / weeks, hi.wc),
        confidence: confidenceOf(Math.min(hi.load, lo.load), 1200, 480),
      },
      1.5,
    )
  }

  // 3. Sipariş değişimi: sipariş (değişim) sayısı arttıkça availability düşüyor.
  const dayRow = new Map(days.map((d) => [`${d.workCenter}|${d.date}`, d]))
  for (const [wc, list] of groupBy(orders, (o) => o.workCenter)) {
    const byDay = groupBy(list, (o) => o.date)
    const pts: { n: number; avail: number; load: number }[] = []
    for (const [date, os] of byDay) {
      const d = dayRow.get(`${wc}|${date}`)
      if (!d || d.loadingMin < 120) continue
      pts.push({ n: new Set(os.map((o) => o.order)).size, avail: d.productionMin / d.loadingMin, load: d.loadingMin })
    }
    if (pts.length < 8) continue
    const r = pearson(
      pts.map((p) => p.n),
      pts.map((p) => p.avail),
    )
    if (r === null || r > t.changeoverR) continue
    const sorted = [...pts].sort((a, b) => a.n - b.n)
    const half = Math.floor(sorted.length / 2)
    const few = sorted.slice(0, half)
    const many = sorted.slice(half)
    const avg = (xs: typeof pts, f: (p: (typeof pts)[0]) => number) => xs.reduce((a, p) => a + f(p), 0) / xs.length
    const gap = avg(few, (p) => p.avail) - avg(many, (p) => p.avail)
    const gain = (gap * many.reduce((a, p) => a + p.load, 0)) / weeks
    if (gain < t.minWeeklyMin) continue
    push(
      {
        id: `changeover|${wc}`,
        kind: 'changeover',
        title: `${wc}: availability falls with every extra order change`,
        finding: `On days with ${avg(many, (p) => p.n).toFixed(1)} orders availability is ${pct(avg(many, (p) => p.avail))}, with ${avg(few, (p) => p.n).toFixed(1)} orders ${pct(avg(few, (p) => p.avail))} (r = ${r.toFixed(2)}, ${pts.length} days).`,
        evidence: withReasons(
          `Correlation of orders per day and availability over ${pts.length} days: ${r.toFixed(2)}.`,
          reasons.filter((x) => x.workCenter === wc && x.group !== '#'),
        ),
        whyNonObvious: 'Changeover loss is spread over many small stops and reasons; only the day-by-day link to the number of orders shows that lot size, not a breakdown, is the lever.',
        firstCheck: `Check the set-up times of ${wc} and whether small lots could be combined in the plan.`,
        gainMinPerWeek: gain,
        gainPiecesPerWeek: pieces(gain, wc),
        confidence: confidenceOf(pts.length, 20, 10),
      },
      1.4,
    )
  }

  // 4. Vardiya: bir vardiya iş yerinin geri kalanından belirgin kötü ve haftaların çoğunda.
  for (const [wc, list] of groupBy(shifts, (s) => s.workCenter)) {
    const byShift = groupBy(
      list.filter((s) => shiftNumber(s.shiftGroup, c) !== null),
      (s) => String(shiftNumber(s.shiftGroup, c)),
    )
    if (byShift.size < 2) continue
    for (const [n, rows] of byShift) {
      const me = sumTimes(rows)
      const rest = sumTimes(list.filter((s) => !rows.includes(s)))
      const a = ratios(me).oee
      const b = ratios(rest).oee
      if (a === null || b === null || me.loadingMin < t.minLoadingMin * 2) continue
      const gapPts = (b - a) * 100
      if (gapPts < t.shiftGapPts) continue
      const worseWeeks = Array.from({ length: nWeeks }, (_, w) => {
        const inW = (s: ShiftRow) => Math.floor(dayIndex(from, s.date) / 7) === w
        const x = ratios(sumTimes(rows.filter(inW))).oee
        const y = ratios(sumTimes(list.filter((s) => inW(s) && !rows.includes(s)))).oee
        return x !== null && y !== null ? (x < y ? 1 : 0) : null
      }).filter((x): x is 0 | 1 => x !== null)
      const share = worseWeeks.length ? worseWeeks.reduce<number>((s, x) => s + x, 0) / worseWeeks.length : 0
      if (share < 0.6) continue
      const gain = ((b - a) * me.loadingMin) / weeks
      push(
        {
          id: `shift|${wc}|${n}`,
          kind: 'shift',
          title: `${wc}: shift ${n} runs ${gapPts.toFixed(0)} OEE points below the other shifts`,
          finding: `Shift ${n} OEE ${pct(a)} against ${pct(b)} for the other shifts on ${wc}; worse in ${Math.round(share * worseWeeks.length)} of ${worseWeeks.length} weeks.`,
          evidence: withReasons(
            `Shift ${n}: ${dur(me.loadingMin)} loading, availability ${pct(ratios(me).availability ?? 0)}, performance ${pct(ratios(me).performance ?? 0)}.`,
            reasons.filter((x) => x.workCenter === wc && x.group !== '#'),
          ),
          whyNonObvious: 'Daily and weekly OEE average the shifts; a steady gap of one shift on one machine disappears in the totals.',
          firstCheck: `Walk shift ${n} on ${wc}: start-up, staffing and the first hour after the handover.`,
          gainMinPerWeek: gain,
          gainPiecesPerWeek: pieces(gain, wc),
          confidence: confidenceOf(worseWeeks.length, 4, 2),
        },
        1.2,
      )
    }
  }

  // 5. Haftanın günü: bir günde kayıp oranı diğer günlerin belirgin üstünde.
  for (const [wc, list] of groupBy(
    codes.filter((x) => x.group !== '#'),
    (x) => x.workCenter,
  )) {
    const loadDay = Array(7).fill(0)
    for (const d of days) if (d.workCenter === wc) loadDay[weekday(d.date)] += d.loadingMin
    const lossDay = Array(7).fill(0)
    for (const x of list) lossDay[weekday(x.date)] += x.min
    const rates = loadDay.map((l, i) => (l >= t.minLoadingMin ? lossDay[i] / l : null))
    const valid = rates.filter((x): x is number => x !== null)
    if (valid.length < 5) continue
    const mean = valid.reduce((a, x) => a + x, 0) / valid.length
    rates.forEach((rt, i) => {
      if (rt === null || mean <= 0 || rt < t.weekdayFactor * mean) return
      const others = valid.filter((x) => x !== rt)
      const base = others.reduce((a, x) => a + x, 0) / Math.max(1, others.length)
      const excess = (rt - base) * loadDay[i]
      if (excess / weeks < t.minWeeklyMin / 2) return
      push(
        {
          id: `weekday|${wc}|${i}`,
          kind: 'weekday',
          title: `${wc} loses ${(rt / Math.max(base, 0.001)).toFixed(1)}× more time on ${WEEKDAYS[i]}s`,
          finding: `On ${WEEKDAYS[i]}s ${wc} loses ${(rt * 60).toFixed(1)} min per loading hour, on the other days ${(base * 60).toFixed(1)}.`,
          evidence: withReasons(
            WEEKDAYS.map((w, j) => `${w} ${rates[j] === null ? '—' : ((rates[j] as number) * 60).toFixed(1)}`).join(' · ') + ' min / loading h.',
            reasons.filter((x) => x.workCenter === wc && x.group !== '#' && weekday(x.date) === i),
          ),
          whyNonObvious: 'Weekly reports add the days together; a weekday pattern points at planning, staffing or the start of the week rather than at a machine fault.',
          firstCheck: `Look at what is different on ${WEEKDAYS[i]}s on ${wc}: first shift start, material supply, maintenance slot or the part mix.`,
          gainMinPerWeek: excess / weeks,
          gainPiecesPerWeek: pieces(excess / weeks, wc),
          confidence: confidenceOf(nWeeks, 8, 4),
          spark: lossDay.map(r0),
        },
        1.2,
      )
    })
  }

  // 6. Mikro duruş: çok sayıda kısa duruş. Süreler varsa < eşik olaylar
  // (bölünmüş özet); yoksa eski kural (ortalama ≤ microMaxMin).
  const split = shortCodes.length > 0
  for (const [key, list] of groupBy(
    (split ? shortCodes : codes).filter((x) => x.group !== '#'),
    (x) => `${x.workCenter}|${x.group}`,
  )) {
    const total = sumMin(list)
    const count = list.reduce((a, x) => a + x.count, 0)
    if (total < minTotal || count < 20 || (!split && total / count > t.microMaxMin)) continue
    const [wc, group] = key.split('|')
    const microReasons = split ? shortReasons : reasons
    push(
      {
        id: `micro|${wc}|${group}`,
        kind: 'micro',
        title: `${wc}: ${count} short ${label(group)} stops of ${(total / count).toFixed(1)} min each`,
        finding: `${count} stops, ${dur(total)} in total, ${(total / count).toFixed(1)} min per stop — a micro-stop signature${
          split ? ` (stops under ${shortMin} min: a speed loss, inside Production − Operation)` : ''
        }.`,
        evidence: withReasons(
          `${(count / weeks).toFixed(0)} stops a week on ${wc}.`,
          microReasons.filter((x) => x.workCenter === wc && x.group === group),
        ),
        whyNonObvious: 'Short stops are small one by one and drown in a minutes Pareto; their count shows a sensor, feeding or recording issue rather than breakdowns.',
        firstCheck: `Watch ${wc} for one hour: are these real stops, a sensor that trips, or how the stops are recorded?`,
        gainMinPerWeek: total / 2 / weeks,
        gainPiecesPerWeek: pieces(total / 2 / weeks, wc),
        confidence: confidenceOf(count, 100, 40),
        spark: weekly(list, from, nWeeks),
      },
      1.2,
    )
  }

  // 7. Rejim değişimi: kayıp bir tarihten sonra sıçradı.
  for (const [key, list] of groupBy(
    codes.filter((x) => x.group !== '#'),
    (x) => `${x.workCenter}|${x.group}`,
  )) {
    const [wc, group] = key.split('|')
    const loaded = days.filter((d) => d.workCenter === wc && d.loadingMin >= 120).map((d) => d.date).sort()
    if (loaded.length < 10) continue
    const byDate = new Map<string, number>()
    for (const x of list) byDate.set(x.date, (byDate.get(x.date) ?? 0) + x.min)
    const series = loaded.map((d) => byDate.get(d) ?? 0)
    let best: { k: number; before: number; after: number } | null = null
    for (let k = 5; k <= series.length - 5; k++) {
      const before = series.slice(0, k).reduce((a, x) => a + x, 0) / k
      const after = series.slice(k).reduce((a, x) => a + x, 0) / (series.length - k)
      if (!best || after - before > best.after - best.before) best = { k, before, after }
    }
    if (!best || best.after < 20 || best.after < t.regimeFactor * Math.max(best.before, 1)) continue
    const daysAfter = series.length - best.k
    const weeksAfter = Math.max(1, (dayIndex(loaded[best.k], to) + 1) / 7)
    const gain = ((best.after - best.before) * daysAfter) / weeksAfter
    if (gain < t.minWeeklyMin) continue
    push(
      {
        id: `regime|${wc}|${group}`,
        kind: 'regime',
        title: `${wc}: ${label(group)} loss jumped from ${loaded[best.k]}`,
        finding: `Since ${loaded[best.k]} ${wc} loses ${dur(best.after)} a day to ${label(group)}, before ${dur(best.before)}.`,
        evidence: withReasons(
          `${best.k} loaded days before, ${daysAfter} after; ${(best.after / Math.max(best.before, 1)).toFixed(1)}× higher.`,
          reasons.filter((x) => x.workCenter === wc && x.group === group && x.date >= loaded[best!.k]),
        ),
        whyNonObvious: 'A period total hides when a loss started; a clear start date points at a change on that day (new part, die repair, programme, operator).',
        firstCheck: `Find what changed on ${wc} around ${loaded[best.k]}: new part or die, repair, settings, staffing.`,
        gainMinPerWeek: gain,
        gainPiecesPerWeek: pieces(gain, wc),
        confidence: confidenceOf(Math.min(best.k, daysAfter), 10, 6),
        spark: weekly(list, from, nWeeks),
      },
      1.3,
    )
  }

  // 8. Performans anomalisi: %100'ün üstü ya da çok düşük → ideal çevrim süresi (master veri) hatalı.
  for (const [key, list] of groupBy(
    orders.filter((o) => o.material),
    (o) => `${o.workCenter}|${o.material}`,
  )) {
    const tm = sumTimes(list)
    const p = ratios(tm).performance
    if (p === null || tm.productionMin < t.minLoadingMin) continue
    if (p <= 1.05 && p >= 0.5) continue
    const [wc, part] = key.split('|')
    const high = p > 1.05
    push(
      {
        id: `performance|${wc}|${part}`,
        kind: 'performance',
        title: `${part} on ${wc} runs at ${pct(p)} performance — the ideal cycle time looks wrong`,
        finding: `Performance ${pct(p)} over ${dur(tm.productionMin)} of production: ${high ? 'faster than the ideal, so the standard is too slow' : 'far below the ideal, so the standard may be too fast'}.`,
        evidence: `${list.length} order lines, ${tm.good} good pieces.`,
        whyNonObvious: 'OEE takes the cycle-time master data for granted; a wrong standard shifts OEE for every report and hides or invents speed loss.',
        firstCheck: `Time ten strokes of ${part} on ${wc} and compare with the ideal cycle time in the master data.`,
        gainMinPerWeek: (Math.abs(1 - p) * tm.productionMin) / weeks,
        gainPiecesPerWeek: null,
        confidence: confidenceOf(tm.productionMin, 1200, 480),
      },
      high ? 1.6 : 1.1,
    )
  }

  // 9. Veri kalitesi: sebebi girilmemiş kayıp, hiç ıskarta / red yok.
  const allLoss = sumMin(codes)
  const unclassified = codes.filter((x) => x.group === '#')
  const un = sumMin(unclassified)
  if (allLoss > 0 && un / allLoss >= t.unclassifiedShare && un >= minTotal) {
    const byWc = [...groupBy(unclassified, (x) => x.workCenter)].map(([wc, xs]) => ({ wc, min: sumMin(xs) })).sort((a, b) => b.min - a.min)
    push(
      {
        id: 'dataQuality|unclassified',
        kind: 'dataQuality',
        title: `${pct(un / allLoss)} of the loss has no reason code`,
        finding: `${dur(un)} of ${dur(allLoss)} loss is recorded with "#" (no reason).`,
        evidence: withReasons(
          byWc
            .slice(0, 3)
            .map((x) => `${x.wc} ${dur(x.min)}`)
            .join(', ') + '.',
          reasons.filter((x) => x.group === '#'),
        ),
        whyNonObvious: 'Every loss Pareto is built only on the coded part; an uncoded share this large can change which loss looks biggest.',
        firstCheck: `Ask the operators of ${byWc[0]?.wc ?? 'the line'} why stops are left without a reason, and make the reason mandatory.`,
        gainMinPerWeek: un / weeks,
        gainPiecesPerWeek: null,
        confidence: 'high',
        spark: weekly(unclassified, from, nWeeks),
      },
      1.1,
    )
  }
  if (allTimes.good >= 1000 && allTimes.scrap + allTimes.reject === 0) {
    push(
      {
        id: 'dataQuality|noScrap',
        kind: 'dataQuality',
        title: 'No scrap and no reject recorded at all',
        finding: `${allTimes.good} good pieces and not one scrap or reject in the period: quality is shown as 100 %.`,
        evidence: `${days.length} work-centre days.`,
        whyNonObvious: 'A perfect quality rate is easy to read as good news; with zero scrap over thousands of pieces it is more likely not being recorded.',
        firstCheck: 'Check where scrap is booked on the line and whether it reaches the MES.',
        gainMinPerWeek: (allTimes.loadingMin * 0.01) / weeks,
        gainPiecesPerWeek: null,
        confidence: 'medium',
      },
      1,
    )
  }

  // 10. Sebepsiz büyük duruş: "#" olay başına çok uzun — büyük duruşlar nedensiz kalıyor.
  for (const [wc, list] of groupBy(codes, (x) => x.workCenter)) {
    const un = list.filter((x) => x.group === '#')
    const coded = list.filter((x) => x.group !== '#')
    const unMin = sumMin(un)
    const unCount = un.reduce((a, x) => a + x.count, 0)
    const codedCount = coded.reduce((a, x) => a + x.count, 0)
    if (unCount < 3 || unMin < minTotal) continue
    const unAvg = unMin / unCount
    const codedAvg = codedCount ? sumMin(coded) / codedCount : 0
    if (unAvg < t.longUnclassifiedMin || (codedAvg > 0 && unAvg < 2 * codedAvg)) continue
    push(
      {
        id: `dataQuality|longUnclassified|${wc}`,
        kind: 'dataQuality',
        title: `${wc}: stops without a reason last ${dur(unAvg)} each — the big stops stay unexplained`,
        finding: `${unCount} stops with "#" average ${dur(unAvg)}, coded stops ${codedCount ? dur(codedAvg) : '—'}; ${dur(unMin)} in total.`,
        evidence: withReasons(
          `${(unCount / weeks).toFixed(1)} uncoded stops a week on ${wc}.`,
          reasons.filter((x) => x.workCenter === wc && x.group === '#'),
        ),
        whyNonObvious: 'The uncoded share looks like a small count of stops; it is the longest stops that are left without a reason, so the biggest losses never reach the Pareto.',
        firstCheck: `Go through the longest "#" stops on ${wc} with the shift leaders and give each a reason; check whether the terminal lets a long stop close without one.`,
        gainMinPerWeek: unMin / weeks,
        gainPiecesPerWeek: null,
        confidence: confidenceOf(unCount, 20, 8),
        spark: weekly(un, from, nWeeks),
      },
      1.2,
    )
  }

  // 11. Sık ve kısa ayar: aynı ayar metni çok sık, her biri birkaç dakika (ör. elektrot ayarı).
  for (const [key, list] of groupBy(
    reasons.filter((x) => x.group !== '#' && isSetupReason(x.group, x.text, c)),
    (x) => `${x.workCenter}|${x.group}|${x.text}`,
  )) {
    const total = sumMin(list)
    const count = list.reduce((a, x) => a + x.count, 0)
    if (total < minTotal || count / weeks < t.repeatPerWeek || total / count > t.repeatMaxMin) continue
    const [wc, group] = key.split('|')
    const text = list[0].text
    push(
      {
        id: `setupRepeat|${wc}|${group}|${text}`,
        kind: 'setupRepeat',
        title: `${wc}: "${text}" ${count} times, ${(total / count).toFixed(1)} min each`,
        finding: `${count} ${label(group)} stops "${text}" (${(count / weeks).toFixed(0)} a week), ${dur(total)} in total — a short adjustment repeated all the time.`,
        evidence: `${(total / count).toFixed(1)} min per stop, ${dur(total / weeks)} a week on ${wc}.`,
        whyNonObvious: 'Each adjustment takes only a couple of minutes and never tops a Pareto; repeated this often it is a capacity loss and points at a root cause (wear, tool life, missing standard setting), not at set-up time.',
        firstCheck: `Find why "${text}" is needed so often on ${wc}: tip / tool wear, dressing interval, standard settings after a change.`,
        gainMinPerWeek: total / 2 / weeks,
        gainPiecesPerWeek: pieces(total / 2 / weeks, wc),
        confidence: confidenceOf(count, 500, 150),
        spark: weekly(list, from, nWeeks),
      },
      1.4,
    )
  }

  // 12. Mola sonrası artık duruş: moladan sonra hat geç başlıyor, kayıp olarak yazılıyor.
  for (const [wc, list] of groupBy(
    reasons.filter((x) => x.group !== '#' && AFTER_BREAK.test(x.text)),
    (x) => x.workCenter,
  )) {
    const total = sumMin(list)
    const count = list.reduce((a, x) => a + x.count, 0)
    if (total < minTotal) continue
    push(
      {
        id: `afterBreak|${wc}`,
        kind: 'afterBreak',
        title: `${wc}: ${dur(total / weeks)} a week lost after breaks`,
        finding: `${count} stops after a break, ${(total / count).toFixed(1)} min each, ${dur(total)} in total: the line restarts late after the planned break.`,
        evidence: withReasons(`${(count / weeks).toFixed(1)} a week on ${wc}.`, list),
        whyNonObvious: 'The break itself is planned and left out of the loading; the minutes until the line runs again are booked under an organisational code and look like scattered small stops.',
        firstCheck: `Watch the restart after a break on ${wc}: who starts the line, is the material and the first-off check ready before the break ends?`,
        gainMinPerWeek: total / weeks,
        gainPiecesPerWeek: pieces(total / weeks, wc),
        confidence: confidenceOf(count, 40, 15),
        spark: weekly(list, from, nWeeks),
      },
      1.3,
    )
  }

  // 13. Plansız 5S: 5S üretim süresi içinde plansız kayıp olarak yazılıyor.
  for (const [wc, list] of groupBy(
    reasons.filter((x) => FIVE_S.test(x.text)),
    (x) => x.workCenter,
  )) {
    const total = sumMin(list)
    const count = list.reduce((a, x) => a + x.count, 0)
    if (total < minTotal) continue
    push(
      {
        id: `unplanned5S|${wc}`,
        kind: 'unplanned5S',
        title: `${wc}: ${dur(total / weeks)} a week of 5S booked as an unplanned loss`,
        finding: `${count} 5S stops, ${(total / count).toFixed(1)} min each, ${dur(total)} in total, recorded inside production time under a loss code.`,
        evidence: withReasons(`${(count / weeks).toFixed(1)} a week on ${wc}.`, list),
        whyNonObvious: '5S is a planned activity; booked as an unplanned stop it lowers availability and hides among organisational losses instead of being planned and kept to a standard time.',
        firstCheck: `Agree a fixed 5S slot and length for ${wc} (planned stop), and check whether the recorded 5S time matches it.`,
        gainMinPerWeek: total / 2 / weeks,
        gainPiecesPerWeek: pieces(total / 2 / weeks, wc),
        confidence: confidenceOf(count, 20, 8),
        spark: weekly(list, from, nWeeks),
      },
      1.1,
    )
  }

  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
}

// ---- tespitler ---------------------------------------------------------------------------

export interface Finding {
  title: string
  finding: string
  evidence: string
  whyNonObvious: string
  firstCheck: string
  gainMinPerWeek: number
  gainPiecesPerWeek: number | null
  confidence: Confidence
  signalIds: string[]
  spark?: number[]
}

export const fromSignal = (s: Signal): Finding => ({
  title: s.title,
  finding: s.finding,
  evidence: s.evidence,
  whyNonObvious: s.whyNonObvious,
  firstCheck: s.firstCheck,
  gainMinPerWeek: s.gainMinPerWeek,
  gainPiecesPerWeek: s.gainPiecesPerWeek,
  confidence: s.confidence,
  signalIds: [s.id],
  spark: s.spark,
})

/** Yapay zekâ yoksa: en güçlü 3 sinyal. */
export const ruleFindings = (signals: Signal[]) => signals.slice(0, 3).map(fromSignal)

export const INSIGHT_SYSTEM = [
  'You are a senior lean / TPM engineer for a metal stamping and nut-welding plant.',
  'You receive pre-computed statistical signals for one cost centre / work centre and date range, each with its evidence.',
  'Choose the 3 to 5 findings that a plant manager would NOT see in a standard OEE Pareto report: hidden concentrations,',
  'interactions between part and machine, sequence and changeover effects, shift or weekday patterns, regime changes,',
  'data-quality problems that distort OEE, and the business value of fixing them. You may combine signals that tell one story.',
  "Reject generic statements (e.g. 'reduce downtime', 'improve maintenance'). Use only the numbers given and quote them;",
  'never invent causes. Say what to verify first on the shop floor. Write in English.',
  'lossCodes explains the loss codes; codes marked "not defined in OEE Settings" are missing from the settings — mention it if they matter.',
  'Each evidence may end with the top sub-reasons (stop texts, some in Romanian, minutes / stops) — use them to be specific.',
  'Answer with JSON only: {"findings":[{"signal_ids":["…"],"title":"…","finding":"…","evidence":"…","why_non_obvious":"…",',
  '"first_check":"…","estimated_gain_min_per_week":0,"confidence":"high|medium|low"}]}. Use signal ids exactly as given.',
].join(' ')

export interface InsightContext {
  costCenter: string
  workCenter: string
  from: string
  to: string
  /** Kayıp kodu → anlamı (lossCodeMeanings: Meaning, yoksa varsayılan; tanımsız kodlar işaretli). */
  codes: Record<string, string>
}

/** Yapay zekâya giden istek (kişi verisi yok; boyut sınırlı). */
export function insightUserMessage(ctx: InsightContext, signals: Signal[], max = INSIGHT_DEFAULTS.maxSignals): string {
  // Sınır aşılırsa en zayıf sinyaller düşer (JSON bozulmaz).
  let n = Math.min(max, signals.length)
  let text = insightMessageOf(ctx, signals, n)
  while (text.length > INSIGHT_MAX_CHARS && n > 1) text = insightMessageOf(ctx, signals, --n)
  return text.slice(0, INSIGHT_MAX_CHARS)
}

/** Yapay zekâya giden isteğin en çok uzunluğu (karakter). */
export const INSIGHT_MAX_CHARS = 24_000

function insightMessageOf(ctx: InsightContext, signals: Signal[], max: number): string {
  return JSON.stringify({
    scope: { costCentre: ctx.costCenter, workCentre: ctx.workCenter || 'all', from: ctx.from, to: ctx.to },
    lossCodes: ctx.codes,
    signals: signals.slice(0, max).map((s) => ({
      id: s.id,
      kind: s.kind,
      headline: s.title,
      finding: s.finding,
      evidence: s.evidence,
      gainMinPerWeek: s.gainMinPerWeek,
      gainPiecesPerWeek: s.gainPiecesPerWeek,
      confidence: s.confidence,
      ...(s.spark ? { series: s.spark } : {}),
    })),
  })
}

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : '')
const CONF = new Set(['high', 'medium', 'low'])

/**
 * Cevabı denetler: yalnızca verilen sinyallere dayanan tespitler; sayı ve güven
 * eksikse sinyalinkiler. Bozuk cevap → boş liste (kurallar gösterilir).
 */
export function parseInsightAnswer(text: string, signals: Signal[]): Finding[] {
  const byId = new Map(signals.map((s) => [s.id, s]))
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim())
  } catch {
    return []
  }
  const list = (data as { findings?: unknown })?.findings
  if (!Array.isArray(list)) return []
  const out: Finding[] = []
  for (const item of list) {
    const f = (item ?? {}) as Record<string, unknown>
    const ids = Array.isArray(f.signal_ids) ? f.signal_ids.filter((x): x is string => typeof x === 'string' && byId.has(x)) : []
    const title = clip(f.title, 160)
    if (!ids.length || !title) continue
    const base = byId.get(ids[0])!
    const gain = Number(f.estimated_gain_min_per_week)
    out.push({
      title,
      finding: clip(f.finding, 600) || base.finding,
      evidence: clip(f.evidence, 600) || base.evidence,
      whyNonObvious: clip(f.why_non_obvious, 400) || base.whyNonObvious,
      firstCheck: clip(f.first_check, 300) || base.firstCheck,
      // Kazanç sinyallerin toplamını aşamaz (model sayı uydurmasın).
      gainMinPerWeek: Math.round(
        Math.min(Number.isFinite(gain) && gain >= 0 ? gain : base.gainMinPerWeek, ids.reduce((a, id) => a + byId.get(id)!.gainMinPerWeek, 0)),
      ),
      gainPiecesPerWeek: base.gainPiecesPerWeek,
      confidence: CONF.has(f.confidence as string) ? (f.confidence as Confidence) : base.confidence,
      signalIds: ids,
      spark: base.spark,
    })
    if (out.length === 5) break
  }
  return out
}

/** Varsayılan aralık: son N tam hafta (Pzt–Paz), bugünü içeren hafta hariç. */
export function fullWeeks(today: string, n: number): { from: string; to: string } {
  const back = (today: string, k: number) => new Date(Date.parse(`${today}T00:00:00Z`) - k * DAY_MS).toISOString().slice(0, 10)
  const lastSunday = back(today, weekday(today) + 1)
  return { from: back(lastSunday, 7 * n - 1), to: lastSunday }
}
