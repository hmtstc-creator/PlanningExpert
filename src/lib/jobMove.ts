/**
 * Gantt'ta işi taşımak (sürükle-bırak ya da iş penceresinde "Move"):
 * işin parçaları (setup → onay → üretim → rulo değişimi …) sırası ve net
 * süreleri korunarak hedef presin günlerine baştan dökülür. Sonuç kilitli iş
 * olarak yazılır (`planJobLocks`); motor onu yerinde tutar, adedini talepten
 * düşer ve diğer işleri etrafına dizer (kullanıcı kararı 2026-10-23).
 *
 * Süreler pres değişince de aynıdır: motor çevrim ve setup süresini parçadan
 * okur, presten değil (sabitlenen parça her prese gidebilir — `pin`).
 */

import { buildDayTimeline, clockToNet, type DayShape, type PlannedStop } from './shiftTimeline'

export interface MoveSegment {
  kind: string
  date: string
  /** Günün net (üretken) dakikası; 0 = günün ilk vardiyasının başı. */
  start: number
  end: number
}

export interface MoveDay {
  date: string
  /** O gün presin net kapasitesi (dakika). */
  capacityMinutes: number
}

export interface MovedJob {
  date: string
  endDate: string
  setupStartMinute: number
  endMinute: number
  segments: MoveSegment[]
}

/**
 * Parçaları `startDate` günü `startNet` net dakikasından itibaren hedef presin
 * günlerine sırayla döker; gün dolunca ertesi çalışma gününe geçer. Ufka
 * sığmazsa ya da başlangıç günü listede yoksa `null`.
 *
 * Örnek: 120 dk setup + 600 dk üretim, kapasitesi 1350 dk olan bir günde
 * 1200. dakikadan başlarsa setup 1200–1320, üretimin 30 dk'sı 1320–1350,
 * kalan 570 dk ertesi gün 0–570.
 */
export function reflowSegments(
  segments: MoveSegment[],
  days: MoveDay[],
  startDate: string,
  startNet: number,
): MovedJob | null {
  let dayIndex = days.findIndex((d) => d.date === startDate)
  if (dayIndex < 0 || segments.length === 0) return null
  let cursor = Math.max(0, startNet)
  const out: MoveSegment[] = []
  for (const seg of segments) {
    let remaining = Math.max(0, seg.end - seg.start)
    while (remaining > 0) {
      while (dayIndex < days.length && cursor >= days[dayIndex].capacityMinutes) {
        dayIndex++
        cursor = 0
      }
      if (dayIndex >= days.length) return null
      const day = days[dayIndex]
      const take = Math.min(remaining, day.capacityMinutes - cursor)
      const prev = out[out.length - 1]
      // Aynı türün aynı gündeki bitişik parçası tek parçadır.
      if (prev && prev.kind === seg.kind && prev.date === day.date && prev.end === cursor) prev.end = cursor + take
      else out.push({ kind: seg.kind, date: day.date, start: cursor, end: cursor + take })
      cursor += take
      remaining -= take
    }
  }
  if (out.length === 0) return null
  const first = out[0]
  const last = out[out.length - 1]
  return { date: first.date, endDate: last.date, setupStartMinute: first.start, endMinute: last.end, segments: out }
}

/** İki iş aynı günde aynı dakikaları kullanıyor mu? */
export function segmentsOverlap(a: MoveSegment[], b: MoveSegment[]): boolean {
  return a.some((x) => b.some((y) => x.date === y.date && x.start < y.end && y.start < x.end))
}

export interface MoveTarget {
  press: string
  date: string
  /** Gece yarısından saat dakikası (gece vardiyasında 1440'ı aşabilir). */
  clockMinute: number
}

export interface MoveInput {
  segments: MoveSegment[]
  target: MoveTarget
  /** Hedef presin günleri, sırayla. */
  days: MoveDay[]
  /** Hedef günün vardiyaları (saat → net dakika çevirisi için). */
  dayShape: DayShape
  shiftStartMinute: number
  shiftMinutes: number
  stops: PlannedStop[]
  now: { date: string; clockMinute: number }
  /** Hedef preste yerinde kalan (kilitli / dondurulmuş) diğer işlerin parçaları. */
  fixedOnTarget: MoveSegment[][]
}

/**
 * Bırakma noktasını kontrol eder ve işi yeniden döker: geçmişe taşınmaz,
 * ufka sığmalı, hedef presteki kilitli ya da dondurulmuş bir işle çakışmamalı.
 * Diğer işlerle çakışma sorun değildir — onlar yeniden hesapta kayar.
 */
export function planMove(input: MoveInput): { moved: MovedJob } | { error: string } {
  const { target, now } = input
  if (target.date < now.date || (target.date === now.date && target.clockMinute < now.clockMinute)) {
    return { error: 'A job cannot start in the past — drop it after the red "now" line.' }
  }
  const timeline = buildDayTimeline(input.shiftStartMinute, input.shiftMinutes, input.dayShape, input.stops)
  const moved = reflowSegments(input.segments, input.days, target.date, clockToNet(target.clockMinute, timeline))
  if (!moved) return { error: `${target.press} has no room for this job from there to the end of the plan.` }
  if (input.fixedOnTarget.some((other) => segmentsOverlap(moved.segments, other))) {
    return { error: `Overlaps an approved or frozen job on ${target.press} — pick another time.` }
  }
  return { moved }
}

/**
 * Elle eklenen iş (stok amaçlı, kullanıcı kararı 2026-10-23): motorun parçadan
 * hesapladığı süreler (`computeRunPlan`) motorla aynı sırada dizilir —
 * setup → kalite onayı → rulo başına üretim, rulolar arasında rulo değişimi
 * (pres rulo besliyorsa). Kalıp zaten takılıysa setup yoktur. Tarih boştur;
 * `reflowSegments` / `planMove` hedef güne döker.
 *
 * Örnek: 90 dk setup, 15 dk onay, iki rulo 200 + 150 dk, rulo değişimi 20 dk →
 * setup 90 · onay 15 · üretim 200 · rulo 20 · üretim 150 (toplam 475 dk).
 */
export function manualJobSegments(
  run: { setupMinutes: number; qualityApprovalMinutes: number; coilRunMinutes: number[]; coilChangeMinutes: number; runMinutes: number },
  options: { dieMounted: boolean; feedsCoil: boolean },
): MoveSegment[] {
  const out: MoveSegment[] = []
  let at = 0
  const push = (kind: string, minutes: number) => {
    if (!(minutes > 0)) return
    out.push({ kind, date: '', start: at, end: at + minutes })
    at += minutes
  }
  if (!options.dieMounted) push('setup', run.setupMinutes)
  push('quality', run.qualityApprovalMinutes)
  const coils = run.coilRunMinutes.filter((m) => m > 0)
  if (coils.length === 0) push('run', run.runMinutes)
  coils.forEach((minutes, i) => {
    if (i > 0 && options.feedsCoil) push('coil', run.coilChangeMinutes)
    push('run', minutes)
  })
  return out
}
