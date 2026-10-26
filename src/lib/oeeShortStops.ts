/**
 * Kısa duruşlar: plansız duruş < eşik → performans kaybı, ≥ eşik →
 * kullanılabilirlik kaybı (Ahmet, 2026-10-23; docs/oeedashboard.md karar 14).
 *
 * MES'in Net Production Time'ı zaten yalnızca ≥ 2 dk (MES_SHORT_STOP_MIN)
 * plansız duruşları düşer; < 2 dk duruşlar Production − Operation'ın (hız
 * kaybı) içindedir. Bu yüzden A = Production ÷ Loading ve P = Operation ÷
 * Production dosyadaki gibi kalır (ratios değişmez). Burada yalnızca kayıp
 * özeti (oeeLossDays: gün × iş merkezi, ham kodlar) süre histogramıyla
 * (oeeStopDays, 01.09.2026'dan beri) ikiye bölünür: aynı kodun kısa duruşları
 * `ARZ<` gibi ayrı bir Reason Code 2'ye taşınır. Loss Bridge, Losses Trend ve
 * Level 3 bu kodu performans ailesinde gösterir; sayılar toplamda değişmez.
 *
 * Histogram dilimi tam dakikadır (9.7 dk → 9): eşik T için "< T dk" = dilim < T.
 * Histogramı olmayan gün × iş merkezi bölünmez (eski hesap, hepsi availability).
 */
import { SHORT_MARK, classifyLossKey, isLossRc1, isShortCode, shortStopMinOf, type LossDay, type OeeConfig } from './oee'
import type { StopDay } from './oeeReliability'

/** Süre histogramının (oeeStopDays) başladığı gün; öncesinde bölünme yok. */
export const SHORT_STOP_DATA_FROM = '2026-09-01'

const key = (r: { date: string; workCenter: string }) => `${r.date}|${r.workCenter}`
const round2 = (v: number) => Math.round(v * 100) / 100
/**
 * Kayıp sayılan bütün kodlar bölünür (isLossRc1), "#" dahil: MES onların kısalarını da
 * Production'dan düşmez. RC1 "#" kısaları `#|STP<` olur → grup `Unassigned<` → Short stops
 * (classifyLoss). Köprü RC2 "#" ve "#<"i kalemlere almaz (isUndefinedCode).
 */
const splittable = (rc1: string, rc2: string, c: OeeConfig) => isLossRc1(rc1, c) && !isShortCode(rc2)

export interface ShortStopSplit {
  lossDays: LossDay[]
  /** Süre verisi olmadığı için bölünemeyen (kayıp duruşu olan) gün × iş merkezleri. */
  withoutDurations: { date: string; workCenter: string }[]
}

/** Bir gün × iş merkezinin kısa duruşları: `rc1|rc2` ve `rc1|rc2|metin` → [dakika, adet]. */
function shortOf(stop: StopDay, t: number, c: OeeConfig) {
  const codes = new Map<string, [number, number]>()
  const reasons = new Map<string, [number, number]>()
  for (const b of stop.bins) {
    if (b.bin >= t || !splittable(b.rc1, b.rc2, c)) continue
    const ck = `${b.rc1}|${b.rc2}`
    const cc = codes.get(ck) ?? [0, 0]
    codes.set(ck, [cc[0] + b.minutes, cc[1] + b.count])
    const rk = `${ck}|${b.text}`
    const rr = reasons.get(rk) ?? [0, 0]
    reasons.set(rk, [rr[0] + b.minutes, rr[1] + b.count])
  }
  return { codes, reasons }
}

/** `rc1|rc2|…` anahtarının kısa duruş karşılığı: `rc1|rc2<|…`. */
const shortKey = (k: string) => {
  const [rc1, rc2, ...rest] = k.split('|')
  return [rc1, rc2 + SHORT_MARK, ...rest].join('|')
}

/**
 * Kayıp özetini kısa (< eşik) ve uzun (≥ eşik) duruşlara böler. Kodun toplam
 * dakikası ve adedi değişmez (kısa + uzun = eski). Parça kırılımı süre
 * verisinde yok: kodun kısa payıyla orantılı bölünür.
 */
export function splitShortStops(lossDays: LossDay[], stopDays: StopDay[], c: OeeConfig): ShortStopSplit {
  const t = shortStopMinOf(c)
  const stops = new Map(stopDays.map((s) => [key(s), s]))
  const withoutDurations: ShortStopSplit['withoutDurations'] = []
  const out = lossDays.map((l): LossDay => {
    const stop = stops.get(key(l))
    if (!stop) {
      const hasLoss = Object.keys(l.codes).some((k) => {
        const [rc1, rc2] = k.split('|')
        return splittable(rc1, rc2, c)
      })
      if (hasLoss) withoutDurations.push({ date: l.date, workCenter: l.workCenter })
      return l
    }
    const short = shortOf(stop, t, c)
    // Kodun kısa payı (dakika ve adet), özetteki değerle sınırlı.
    const share = new Map<string, [number, number]>()
    const codes: LossDay['codes'] = {}
    for (const [k, [m, n]] of Object.entries(l.codes)) {
      const s = short.codes.get(k)
      if (!s || !(m > 0)) {
        codes[k] = [m, n]
        continue
      }
      const sm = Math.min(m, round2(s[0]))
      const sn = Math.min(n, s[1])
      share.set(k, [m > 0 ? sm / m : 0, n > 0 ? sn / n : 0])
      if (n - sn > 0 || m - sm > 0.005) codes[k] = [round2(m - sm), n - sn]
      codes[shortKey(k)] = [sm, sn]
    }
    const reasons: LossDay['reasons'] = {}
    for (const [k, [m, n]] of Object.entries(l.reasons)) {
      const s = short.reasons.get(k)
      if (!s) {
        reasons[k] = [m, n]
        continue
      }
      const sm = Math.min(m, round2(s[0]))
      const sn = Math.min(n, s[1])
      if (n - sn > 0 || m - sm > 0.005) reasons[k] = [round2(m - sm), n - sn]
      reasons[shortKey(k)] = [sm, sn]
    }
    let parts: LossDay['parts']
    if (l.parts) {
      parts = {}
      for (const [k, [m, n]] of Object.entries(l.parts)) {
        const [rc1, rc2] = k.split('|')
        const f = share.get(`${rc1}|${rc2}`)
        if (!f) {
          parts[k] = [m, n]
          continue
        }
        const [fm, fn] = f
        if (fm < 1 || fn < 1) parts[k] = [m * (1 - fm), n * (1 - fn)]
        if (fm > 0 || fn > 0) parts[shortKey(k)] = [m * fm, n * fn]
      }
    }
    return { ...l, codes, reasons, ...(parts && { parts }) }
  })
  return { lossDays: out, withoutDurations }
}

/**
 * Bölünemeyen gün × iş merkezleri için ekran notu (yoksa null). 01.09.2026
 * öncesi için sabit cümle (planlamacı, 2026-10-23).
 */
export function shortStopNote(split: ShortStopSplit, c: OeeConfig): string | null {
  if (!split.withoutDurations.length) return null
  const t = shortStopMinOf(c)
  const before = split.withoutDurations.some((d) => d.date < SHORT_STOP_DATA_FROM)
  const head = before
    ? 'Duration split not available before 01.09.2026'
    : `${split.withoutDurations.length} machine-day(s) have no stop-duration data`
  return `${head} — those stops all stay in availability (short stops < ${t} min are counted in performance only where the durations are known).`
}

/** Köprünün veri notlarına bölünme notunu ekler (varsa). */
export function withShortStopNote<T extends { warnings: string[] }>(b: T, split: ShortStopSplit, c: OeeConfig): T {
  const note = shortStopNote(split, c)
  return note ? { ...b, warnings: [...b.warnings, note] } : b
}

/** Bölünmüş özette kısa duruşların toplamı (dk, adet). */
export function shortStopTotals(lossDays: LossDay[], c: OeeConfig): { minutes: number; count: number } {
  let minutes = 0
  let count = 0
  for (const l of lossDays)
    for (const [k, [m, n]] of Object.entries(l.codes)) {
      const group = classifyLossKey(k, c)?.group
      if (group === undefined || !isShortCode(group)) continue
      minutes += m
      count += n
    }
  return { minutes, count }
}
