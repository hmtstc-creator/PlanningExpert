// OEE Loss Bridge (src/routes/oee/bridge.tsx; kavram: docs/oee-bridge.md).
//
// Seçilen makine / hat ve dönem için kayıpların yüzdesel şelalesi:
//
//   Loading time %100 → (plansız duruş grupları, fark) → Availability (C/B)
//   → (performans) → A × P (D/B) → (kalite) → OEE (E/B).
//
// Kurallar (planlamacı, 2026-10-06 — ikinci tur):
// - Taban HER ZAMAN Loading time'dır: MES'in Loading'i planlı duruşları
//   (mola, planlı toplantı …) zaten dışarıda bırakır; köprüde bir daha
//   düşülmezler. Planlı duruşlar yalnızca bilgi ("Outside OEE").
// - Köprünün OEE / A / P / Q değerleri OEE Dashboard'unkiyle birebir aynıdır
//   (A = Production ÷ Loading, P = Operation ÷ Production). Kayıplar
//   Loading'in yüzdesidir: OEE + Σ kayıp = %100. Örn. A %80, P %80 → OEE
//   %64; availability kaybı %20, performans kaybı %80 × %20 = %16.
// - Plansız duruş grupları kayıtlı süreleriyle gösterilir; Loading −
//   Production ile kayıtların farkı ayrı küçük adımdır ("Not explained" ya
//   da "Over-recorded downtime") — gruplara dağıtılmaz, köprü kapanır.
// - Kayıp grubunun ailesi (availability / performance) ayardan; varsayılan
//   MES gibi availability. Ailesi değişen grup OEE'yi değiştirmez, yalnızca
//   A ve P payını.
// - Hız kaybı işaretlidir: üretim standardın üstündeyse (P > %100) negatif
//   adım ("Speed above standard") — 0'a kırpılmaz.
// - Oranların ortalaması alınmaz: süreler ve adetler toplanır, sonra bölünür.
// - Öncelik: kayıplar arasında en çok dakika. Açıklanmayan, tanımsız, hız
//   kazancı ve planlı duruşlar öncelik olamaz.

import {
  UNASSIGNED,
  daysFromShifts,
  lossDayOf,
  shiftNumber,
  type DayRow,
  type DowntimeDay,
  type LossDay,
  type OeeConfig,
  type OrderRow,
  type ShiftRow,
} from './oee'

export type BridgeFamily = 'notScheduled' | 'planned' | 'availability' | 'performance' | 'quality'
export type LossFamily = 'availability' | 'performance'

export const NOT_EXPLAINED = 'Not explained'
/** Kayıtlı duruşlar Loading − Production'dan fazlaysa (negatif açıklanmayan). */
export const OVER_RECORDED = 'Over-recorded downtime'
export const SPEED_LOSS = 'Speed loss'
export const SPEED_GAIN = 'Speed above standard'
export const OTHER_PLANNED = 'Other planned stops'
export const OVER_PLANNED = 'Over-recorded planned stops'
/** Köprünün toplam çubukları (Loading tabanının yüzdesi). */
export const TOTAL_LABEL = { L: 'Loading time', C: 'Availability', D: 'A × P', E: 'OEE' } as const

export interface BridgeStep {
  key: string
  label: string
  kind: 'total' | 'loss'
  family?: BridgeFamily
  /** Toplam çubuğunda süre; kayıpta düşülen süre (negatifse kazanç). */
  minutes: number
  note?: string
}

export interface LossItem {
  key: string
  label: string
  family: BridgeFamily
  minutes: number
  /** Loading time'a oranı (0–1). */
  share: number
  count: number
  /** Bu kalemin Reason Code 2 kodları (Level 3 için). */
  groups: string[]
  /** Öncelik olabilir mi (açıklanmayan, tanımsız, OEE dışı planlı duruş olamaz). */
  rankable: boolean
  priority?: boolean
}

export interface Bridge {
  steps: BridgeStep[]
  /** shift = Loading + planlı süre (bilgi); production = C (köprüdeki). */
  totals: { shift: number; loading: number; production: number; operating: number; effective: number }
  /** Köprünün tabanı: Loading time (dakika) = %100. */
  baseMinutes: number
  oee: number | null
  /** A, P, Q (köprüdeki C/B, D/C, E/D) — varsayılan ailelerle Dashboard'unkiyle aynı. */
  availability: number | null
  performance: number | null
  quality: number | null
  /** Loading'in payları: OEE + availability + performance + quality kaybı = 1. */
  level1: { oee: number; availability: number; performance: number; quality: number } | null
  /** Level 2: kayıp kalemleri, çoktan aza. */
  items: LossItem[]
  /** Planlı duruşlar: OEE dışında (Loading bunları zaten içermez); bilgi. */
  outside: LossItem[]
  notExplained: number
  speed: number
  warnings: string[]
  /** Köprüye giren gün × makine kayıtları ve duruş kaydı olmayanlar (veri notu). */
  coverage: { dayRows: number; withoutDowntimes: string[]; downtimesWithoutShift: string[] }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** Kayıp grubunun köprüdeki ailesi (ayar; varsayılan availability = MES). */
export const familyOf = (code: string, c: OeeConfig): LossFamily => c.lossGroups.find((g) => g.code === code)?.family ?? 'availability'

const chartOf = (code: string, c: OeeConfig) => c.lossGroups.find((g) => g.code === code)?.chart || UNASSIGNED
const hiddenGroup = (code: string, c: OeeConfig) => !!c.lossGroups.find((g) => g.code === code)?.hidden

/** Grup → [dakika, adet], Reason Code 1 kümesine göre. */
function groupMinutes(lossDays: LossDay[], rc1s: string[]): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>()
  for (const d of lossDays) {
    for (const [k, [m, n]] of Object.entries(d.codes)) {
      const [rc1, rc2] = k.split('|')
      if (!rc1s.includes(rc1)) continue
      const cur = out.get(rc2) ?? [0, 0]
      out.set(rc2, [cur[0] + m, cur[1] + n])
    }
  }
  return out
}

/** Grupları köprü kalemlerine topla: grafik sütunu (Settings → Chart column) başına bir kalem. */
function columns(groups: Map<string, [number, number]>, c: OeeConfig, pick: (code: string) => boolean, labelOf: (code: string) => string) {
  const by = new Map<string, { minutes: number; count: number; groups: string[] }>()
  for (const [code, [m, n]] of groups) {
    if (!pick(code)) continue
    const label = labelOf(code)
    const cur = by.get(label) ?? { minutes: 0, count: 0, groups: [] }
    cur.minutes += m
    cur.count += n
    cur.groups.push(code)
    by.set(label, cur)
  }
  return [...by].map(([label, v]) => ({ label, ...v }))
}

const key = (r: { date: string; workCenter: string }) => `${r.date}|${r.workCenter}`

/** Yalnızca vardiya verisi olan gün × makinelerin duruşları (köprü ve Level 3 aynı tabanı kullanır). */
export function matchedLossDays(days: DayRow[], lossDays: LossDay[]): LossDay[] {
  const keys = new Set(days.filter((d) => d.loadingMin + d.scheduledMin > 0).map(key))
  return lossDays.filter((l) => keys.has(key(l)))
}

export interface PlannedReason {
  rc2: string
  text: string
  minutes: number
  count: number
}

/**
 * Bir gün × makinenin planlı duruşları (Reason Code 1 = mola / planlı),
 * vardiyaların planlı süresiyle (`scheduledMin`) sınırlı. Fazlası, hiç
 * çalışılmamış bir vardiyanın "scheduled downtime" kaydıdır (ör. 480 dk):
 * planlı duruş değil, planlanmamış süredir — en uzun kayıttan başlayarak
 * düşülür ve `excess` olarak döner.
 */
export function cappedPlanned(l: LossDay, scheduledMin: number, c: OeeConfig): { reasons: PlannedReason[]; excess: number } {
  const reasons: PlannedReason[] = []
  for (const [k, [m, n]] of Object.entries(l.reasons)) {
    const [rc1, rc2, ...rest] = k.split('|')
    if (!c.breakReasonCodes.includes(rc1)) continue
    reasons.push({ rc2, text: rest.join('|') || rc2, minutes: m, count: n })
  }
  const total = sum(reasons.map((r) => r.minutes))
  let excess = Math.max(0, total - Math.max(0, scheduledMin))
  const out = excess
  for (const r of [...reasons].sort((a, b) => b.minutes - a.minutes)) {
    if (excess <= 0) break
    const cut = Math.min(r.minutes, excess)
    r.minutes -= cut
    excess -= cut
    if (r.minutes <= 0) r.count = 0
  }
  return { reasons: reasons.filter((r) => r.minutes > 0), excess: out }
}

/** Gün × makine → vardiyaların planlı süresi. */
const scheduledBy = (days: DayRow[]) => {
  const m = new Map<string, number>()
  for (const d of days) m.set(key(d), (m.get(key(d)) ?? 0) + d.scheduledMin)
  return m
}

/** Kalem öncelik olabilir mi: tanımsız sütun, yalnızca gizli ya da "#" / boş kodlu gruplar olamaz. */
const rankableColumn = (label: string, groups: string[], c: OeeConfig) =>
  label !== UNASSIGNED && groups.some((code) => code !== '#' && code !== '' && !hiddenGroup(code, c))

/**
 * Köprü. `days` ve `lossDays` seçilen kapsam ve döneme süzülmüş olmalı.
 * Taban Loading time (= %100); planlı duruşlar köprüye girmez.
 */
export function buildBridge(days: DayRow[], allLossDays: LossDay[], c: OeeConfig): Bridge {
  // Zaman tabanı gün × makine kayıtlarıdır: duruşlar yalnızca vardiya verisi
  // olan gün × makinede sayılır (vardiyası olmayan günün duruşu — ör. hiç
  // çalışılmamış vardiyanın 480 dk "scheduled downtime" kaydı — tabanı olmadan
  // kayıp sayılmasın). Eşleşmeyenler veri notunda.
  const dayKeys = new Set(days.filter((d) => d.loadingMin + d.scheduledMin > 0).map(key))
  const lossDays = matchedLossDays(days, allLossDays)
  const lossKeys = new Set(allLossDays.map(key))
  const coverage = {
    dayRows: dayKeys.size,
    withoutDowntimes: [...new Set(days.filter((d) => d.loadingMin > 0 && !lossKeys.has(key(d))).map(key))].sort(),
    downtimesWithoutShift: [...new Set(allLossDays.filter((l) => !dayKeys.has(key(l))).map(key))].sort(),
  }
  const L = sum(days.map((d) => d.loadingMin))
  const S = sum(days.map((d) => d.scheduledMin))
  const P = sum(days.map((d) => d.productionMin))
  const Op = sum(days.map((d) => d.operatingMin))
  const good = sum(days.map((d) => d.good))
  const scrap = sum(days.map((d) => d.scrap))
  const reject = sum(days.map((d) => d.reject))
  const pieces = good + scrap + reject
  const Q = pieces > 0 ? good / pieces : 1
  const E = Op * Q
  const warnings: string[] = []

  // Planlı duruşlar (Reason Code 1 = mola / planlı): Loading'in dışında, yalnızca bilgi.
  // Gün × makine başına vardiyaların planlı süresiyle sınırlı (fazlası çalışılmamış vardiya).
  const sched = scheduledBy(days)
  const planned = new Map<string, [number, number]>()
  for (const l of lossDays) {
    for (const x of cappedPlanned(l, sched.get(key(l)) ?? 0, c).reasons) {
      const cur = planned.get(x.rc2) ?? [0, 0]
      planned.set(x.rc2, [cur[0] + x.minutes, cur[1] + x.count])
    }
  }
  const plannedCols = columns(
    planned,
    c,
    () => true,
    (code) => c.lossGroups.find((g) => g.code === code)?.label || code,
  )
  const otherPlanned = S - sum(plannedCols.map((x) => x.minutes))

  // Kayıp duruşlar (Reason Code 1 = kayıp): availability ya da performance ailesi.
  // Gizli gruplar (Settings → "In charts" işaretsiz, ör. "#") kendi kalemidir — öncelik olamaz.
  const losses = groupMinutes(lossDays, c.lossReasonCodes)
  const availCols = columns(
    losses,
    c,
    (code) => familyOf(code, c) === 'availability',
    (code) => chartOf(code, c),
  )
  const perfCols = columns(
    losses,
    c,
    (code) => familyOf(code, c) === 'performance',
    (code) => chartOf(code, c),
  )
  // Köprüde büyükten küçüğe (Pareto gibi okunur).
  availCols.sort((a, b) => b.minutes - a.minutes)
  perfCols.sort((a, b) => b.minutes - a.minutes)
  const recAvail = sum(availCols.map((x) => x.minutes))
  const recPerf = sum(perfCols.map((x) => x.minutes))
  // Kayıtların Loading − Production ile farkı (az kayıt: açıklanmayan; fazla kayıt: eksi).
  const notExplained = L - P - recAvail - recPerf
  const C = P + recPerf
  const speed = P - Op
  const qualityMin = Op - E
  const scrapMin = pieces > 0 ? (qualityMin * scrap) / Math.max(1, scrap + reject) : 0
  const rejectMin = qualityMin - scrapMin
  const pct = (v: number, base: number) => (base > 0 ? `${((v / base) * 100).toFixed(1)}%` : '—')

  const steps: BridgeStep[] = [
    {
      key: 'L',
      label: TOTAL_LABEL.L,
      kind: 'total',
      minutes: L,
      note: 'shift time − planned stops (breaks …): the planned stops are already outside, as in the MES and OEE Trend Analysis',
    },
  ]
  const hiddenNote = (groups: string[]) =>
    groups.every((g) => hiddenGroup(g, c)) ? 'hidden in the other charts (OEE Settings → Loss groups)' : undefined
  for (const a of availCols)
    steps.push({
      key: `av:${a.label}`,
      label: a.label,
      kind: 'loss',
      family: 'availability',
      minutes: a.minutes,
      note: hiddenNote(a.groups),
    })
  const unexplainedLabel = notExplained < 0 ? OVER_RECORDED : NOT_EXPLAINED
  if (Math.abs(notExplained) >= 0.5) {
    steps.push({
      key: 'av:unexplained',
      label: unexplainedLabel,
      kind: 'loss',
      family: 'availability',
      minutes: notExplained,
      note:
        notExplained < 0
          ? 'the downtime records add up to a little more than Loading − Production (normal: the MES counts some stops differently)'
          : 'Loading − Production not covered by a downtime with a reason (incl. undefined “#”)',
    })
  }
  steps.push({ key: 'C', label: TOTAL_LABEL.C, kind: 'total', minutes: C, note: `Production time ÷ Loading time = ${pct(C, L)}` })
  for (const p of perfCols)
    steps.push({
      key: `pf:${p.label}`,
      label: p.label,
      kind: 'loss',
      family: 'performance',
      minutes: p.minutes,
      note: hiddenNote(p.groups),
    })
  steps.push({
    key: 'pf:speed',
    label: speed < 0 ? SPEED_GAIN : SPEED_LOSS,
    kind: 'loss',
    family: 'performance',
    minutes: speed,
    note: `Production − Operation time: ${pct(speed, C)} of the production time = ${pct(speed, L)} of the loading time`,
  })
  steps.push({
    key: 'D',
    label: TOTAL_LABEL.D,
    kind: 'total',
    minutes: Op,
    note: `Operation time ÷ Loading time; Performance = ${pct(Op, C)}`,
  })
  steps.push({
    key: 'q:scrap',
    label: 'Scrap',
    kind: 'loss',
    family: 'quality',
    minutes: scrapMin,
    note: `${scrap.toLocaleString('en-GB')} pcs`,
  })
  steps.push({
    key: 'q:reject',
    label: 'Reject',
    kind: 'loss',
    family: 'quality',
    minutes: rejectMin,
    note: `${reject.toLocaleString('en-GB')} pcs`,
  })
  steps.push({ key: 'E', label: TOTAL_LABEL.E, kind: 'total', minutes: E, note: `Effective time ÷ Loading time; Quality = ${pct(E, Op)}` })

  // Level 2 kalemleri (Loading'in kayıpları).
  const item = (
    key: string,
    label: string,
    family: BridgeFamily,
    minutes: number,
    count: number,
    groups: string[],
    rankable: boolean,
  ): LossItem => ({
    key,
    label,
    family,
    minutes,
    share: L > 0 ? minutes / L : 0,
    count,
    groups,
    rankable,
  })
  // Planlı duruşlar (mola, planlı toplantı …) yönetimin planıdır ve OEE dışındadır: öncelik olmaz.
  const plannedItems = [
    ...plannedCols.map((p) => item(`pl:${p.label}`, p.label, 'planned', p.minutes, p.count, p.groups, false)),
    ...(Math.abs(otherPlanned) >= 0.5
      ? [item('pl:other', otherPlanned < 0 ? OVER_PLANNED : OTHER_PLANNED, 'planned', otherPlanned, 0, [], false)]
      : []),
  ]
  const items: LossItem[] = [
    ...availCols.map((a) =>
      item(`av:${a.label}`, a.label, 'availability', a.minutes, a.count, a.groups, rankableColumn(a.label, a.groups, c)),
    ),
    ...(Math.abs(notExplained) >= 0.5 ? [item('av:unexplained', unexplainedLabel, 'availability', notExplained, 0, [], false)] : []),
    ...perfCols.map((p) =>
      item(`pf:${p.label}`, p.label, 'performance', p.minutes, p.count, p.groups, rankableColumn(p.label, p.groups, c)),
    ),
    item('pf:speed', speed < 0 ? SPEED_GAIN : SPEED_LOSS, 'performance', speed, 0, [], speed > 0),
    item('q:scrap', 'Scrap', 'quality', scrapMin, scrap, [], scrapMin > 0),
    item('q:reject', 'Reject', 'quality', rejectMin, reject, [], rejectMin > 0),
  ]
  const ranked = items.filter((i) => i.rankable && i.minutes > 0).sort((a, b) => b.minutes - a.minutes)
  if (ranked[0]) ranked[0].priority = true

  // Level 1: Loading'in payları (köprüdeki adımlar; toplamları 1).
  const level1 = L > 0 ? { oee: E / L, availability: (L - C) / L, performance: (C - Op) / L, quality: (Op - E) / L } : null

  // Reason Code 1'i ne kayıp ne mola olan duruşlar: açıklanmayana düşer; söylenir.
  let unclassified = 0
  for (const d of lossDays)
    for (const [k, [m]] of Object.entries(d.codes)) {
      const rc1 = k.split('|')[0]
      if (!c.lossReasonCodes.includes(rc1) && !c.breakReasonCodes.includes(rc1)) unclassified += m
    }
  if (unclassified >= 0.5)
    warnings.push(
      `${Math.round(unclassified)} min of downtime have a Reason Code 1 that is neither a loss nor a break (OEE Settings) — counted in “${NOT_EXPLAINED}”.`,
    )
  if (coverage.withoutDowntimes.length) {
    warnings.push(
      `${coverage.withoutDowntimes.length} machine-day(s) have shift data but no downtime upload — their availability loss is all “${NOT_EXPLAINED}”.`,
    )
  }
  if (coverage.downtimesWithoutShift.length) {
    warnings.push(
      `${coverage.downtimesWithoutShift.length} machine-day(s) have downtimes but no shift data — left out (no loading time to lose).`,
    )
  }
  if (L > 0 && notExplained > 0 && notExplained / Math.max(1, L - P) >= 0.2) {
    warnings.push(
      `${Math.round((notExplained / (L - P)) * 100)}% of the availability loss has no downtime reason (${Math.round(notExplained)} min) — record the reasons, or the priorities below are incomplete.`,
    )
  }
  if (speed < 0)
    warnings.push(
      `Operation time is ${Math.round(-speed)} min above production time (performance over 100%) — shown as a gain, as recorded.`,
    )

  return {
    steps,
    totals: { shift: L + S, loading: L, production: C, operating: Op, effective: E },
    baseMinutes: L,
    oee: L > 0 ? E / L : null,
    availability: L > 0 ? C / L : null,
    performance: C > 0 ? Op / C : null,
    quality: Op > 0 ? E / Op : null,
    level1,
    items: items.filter((i) => Math.abs(i.minutes) >= 0.5).sort((a, b) => b.minutes - a.minutes),
    outside: plannedItems.filter((i) => Math.abs(i.minutes) >= 0.5).sort((a, b) => b.minutes - a.minutes),
    notExplained,
    speed,
    warnings,
    coverage,
  }
}

// ---- Level 3 -------------------------------------------------------------------------

export interface Level3Row {
  key: string
  label: string
  minutes: number
  count: number
  /** Ortalama duruş süresi (dk) — kayıtlı duruşlarda. */
  mttr: number | null
  /** Önceki dönemde aynı satır (dk). */
  previous: number
  sub?: string
}

export type Level3By = 'reason' | 'machine' | 'die'

/**
 * Bir kalemin Level 3 kırılımında hangi görünümler var. Kayıtlı kayıp
 * duruşlarında kalıp görünümü ham duruşlarla (en çok 8 gün) olur.
 */
export function level3Views(item: LossItem, withEvents = false): Level3By[] {
  if (item.key === 'pf:speed') return ['die', 'machine']
  if (item.family === 'quality') return ['die', 'machine']
  if (item.key === 'av:unexplained' || item.key === 'pl:other') return ['machine']
  if (item.family === 'planned') return ['reason', 'machine']
  return withEvents ? ['reason', 'machine', 'die'] : ['reason', 'machine']
}

function addRow(map: Map<string, Level3Row>, key: string, label: string, minutes: number, count: number, prev: boolean, sub?: string) {
  const r = map.get(key) ?? { key, label, minutes: 0, count: 0, mttr: null, previous: 0, sub }
  if (prev) r.previous += minutes
  else {
    r.minutes += minutes
    r.count += count
  }
  map.set(key, r)
}

const finish = (map: Map<string, Level3Row>, withMttr: boolean) =>
  [...map.values()]
    .map((r) => ({ ...r, mttr: withMttr && r.count > 0 ? r.minutes / r.count : null }))
    .filter((r) => Math.abs(r.minutes) > 0.05 || Math.abs(r.previous) > 0.05)
    .sort((a, b) => b.minutes - a.minutes)

export interface Level3Set {
  days: DayRow[]
  lossDays: LossDay[]
  orders: OrderRow[]
  /** Ham duruşlar (kalıp kırılımı için; en çok 8 gün okunur). */
  events?: DowntimeDay[]
}

/** Bir veri kümesinin kalite kaybı (dk): köprüdeki gibi toplamdan, hurda ya da ret payı. */
function qualityMinutes(days: DayRow[], scrap: boolean): { minutes: number; count: number } {
  const op = sum(days.map((d) => d.operatingMin))
  const good = sum(days.map((d) => d.good))
  const sc = sum(days.map((d) => d.scrap))
  const rj = sum(days.map((d) => d.reject))
  const pcs = good + sc + rj
  const q = pcs > 0 ? op * ((sc + rj) / pcs) : 0
  const bad = sc + rj
  return { minutes: bad > 0 ? (q * (scrap ? sc : rj)) / bad : 0, count: scrap ? sc : rj }
}

export const NOT_IN_ORDERS = 'Not in order data'

/**
 * Level 3 kırılımı. `cur` ve `prev`: bu ve önceki dönemin (kapsama süzülmüş,
 * vardiyası olan gün × makineyle eşleşmiş) verisi. Satırların toplamı her
 * zaman Level 2 kalemine eşittir:
 * - kayıtlı duruş kalemleri: nedene ya da makineye göre (planlıda vardiya
 *   süresiyle sınırlı, köprüdeki gibi),
 * - hız: kalıba (Order Based) ya da makineye göre; sipariş verisinin
 *   kapsamadığı kısım "Not in order data",
 * - hurda / ret: kalemin süresi adede göre dağıtılır (kalıp ya da makine),
 * - açıklanmayan ve diğer planlı: makine başına fark.
 */
export function level3(item: LossItem, by: Level3By, c: OeeConfig, cur: Level3Set, prev: Level3Set): Level3Row[] {
  const map = new Map<string, Level3Row>()
  const sets = [
    [cur, false],
    [prev, true],
  ] as const

  if (item.key === 'pf:speed') {
    for (const [set, isPrev] of sets) {
      if (by === 'die') {
        let covered = 0
        for (const o of set.orders) {
          const m = o.productionMin - o.operatingMin
          covered += m
          addRow(map, `${o.workCenter}|${o.equipment}`, o.equipment || '(no die)', m, 0, isPrev, o.workCenter)
        }
        const total = sum(set.days.map((d) => d.productionMin - d.operatingMin))
        if (Math.abs(total - covered) >= 0.05) addRow(map, '__noorders', NOT_IN_ORDERS, total - covered, 0, isPrev)
      } else for (const d of set.days) addRow(map, d.workCenter, d.workCenter, d.productionMin - d.operatingMin, 0, isPrev)
    }
    return finish(map, false)
  }

  if (item.family === 'quality') {
    const scrap = item.key === 'q:scrap'
    for (const [set, isPrev] of sets) {
      const { minutes, count } = qualityMinutes(set.days, scrap)
      if (count <= 0) continue
      const per = minutes / count
      let covered = 0
      const rows: { key: string; label: string; n: number; sub?: string }[] =
        by === 'die'
          ? set.orders.map((o) => ({
              key: `${o.workCenter}|${o.equipment}`,
              label: o.equipment || '(no die)',
              n: scrap ? o.scrap : o.reject,
              sub: o.workCenter,
            }))
          : set.days.map((d) => ({ key: d.workCenter, label: d.workCenter, n: scrap ? d.scrap : d.reject }))
      for (const r of rows) {
        if (!r.n) continue
        covered += r.n
        addRow(map, r.key, r.label, r.n * per, r.n, isPrev, r.sub)
      }
      if (count - covered > 0) addRow(map, '__noorders', NOT_IN_ORDERS, (count - covered) * per, count - covered, isPrev)
    }
    return finish(map, false)
  }

  if (item.key === 'av:unexplained' || item.key === 'pl:other') {
    // Makine başına: süre farkı − o makinenin kayıtlı duruşları (köprüyle aynı kural).
    const planned = item.key === 'pl:other'
    for (const [set, isPrev] of sets) {
      const sched = scheduledBy(set.days)
      const gap = new Map<string, number>()
      for (const d of set.days)
        gap.set(d.workCenter, (gap.get(d.workCenter) ?? 0) + (planned ? d.scheduledMin : d.loadingMin - d.productionMin))
      for (const l of set.lossDays) {
        if (planned) {
          const r = cappedPlanned(l, sched.get(key(l)) ?? 0, c)
          gap.set(l.workCenter, (gap.get(l.workCenter) ?? 0) - sum(r.reasons.map((x) => x.minutes)))
          continue
        }
        for (const [k, [m]] of Object.entries(l.codes)) {
          if (c.lossReasonCodes.includes(k.split('|')[0])) gap.set(l.workCenter, (gap.get(l.workCenter) ?? 0) - m)
        }
      }
      for (const [wc, m] of gap) addRow(map, wc, wc, m, 0, isPrev)
    }
    return finish(map, false)
  }

  const groups = new Set(item.groups)
  if (item.family === 'planned') {
    for (const [set, isPrev] of sets) {
      const sched = scheduledBy(set.days)
      for (const l of set.lossDays) {
        for (const r of cappedPlanned(l, sched.get(key(l)) ?? 0, c).reasons) {
          if (!groups.has(r.rc2)) continue
          if (by === 'machine') addRow(map, l.workCenter, l.workCenter, r.minutes, r.count, isPrev)
          else addRow(map, r.text, r.text, r.minutes, r.count, isPrev)
        }
      }
    }
    return finish(map, true)
  }

  // Kayıtlı kayıp duruş kalemi: grupları; nedene, makineye ya da kalıba göre.
  if (by === 'die') {
    for (const [set, isPrev] of sets)
      for (const d of set.events ?? [])
        for (const e of d.events) {
          if (!c.lossReasonCodes.includes(e.rc1) || !groups.has(e.rc2)) continue
          addRow(map, `${d.workCenter}|${e.mold}`, e.mold || '(no die)', e.minutes, 1, isPrev, d.workCenter)
        }
    return finish(map, true)
  }
  for (const [set, isPrev] of sets) {
    for (const l of set.lossDays) {
      if (by === 'machine') {
        for (const [k, [m, n]] of Object.entries(l.codes)) {
          const [rc1, rc2] = k.split('|')
          if (c.lossReasonCodes.includes(rc1) && groups.has(rc2)) addRow(map, l.workCenter, l.workCenter, m, n, isPrev)
        }
      } else {
        for (const [k, [m, n]] of Object.entries(l.reasons)) {
          const [rc1, rc2, ...rest] = k.split('|')
          if (!c.lossReasonCodes.includes(rc1) || !groups.has(rc2)) continue
          const text = rest.join('|') || rc2
          addRow(map, text, text, m, n, isPrev)
        }
      }
    }
  }
  return finish(map, true)
}

/** En çok `n` satır; kalanı "Others" satırında. */
export function topN(rows: Level3Row[], n = 5): Level3Row[] {
  if (rows.length <= n) return rows
  const rest = rows.slice(n)
  const others: Level3Row = {
    key: '__others',
    label: `Others (${rest.length})`,
    minutes: sum(rest.map((r) => r.minutes)),
    count: sum(rest.map((r) => r.count)),
    mttr: null,
    previous: sum(rest.map((r) => r.previous)),
  }
  return [...rows.slice(0, n), others]
}

// ---- dönem ---------------------------------------------------------------------------

/** Dönem seçimi: tek gün ya da tarih aralığı (planlamacı, 2026-10-07). */
export type PeriodMode = 'day' | 'range'

/** Tarih aralığı en çok bu kadar gün (önceki dönemle birlikte okunur). */
export const MAX_RANGE_DAYS = 31

const shiftDay = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1

/** Seçilen günler: tek gün ya da aralık (ters girilirse çevrilir, en çok MAX_RANGE_DAYS). */
export function selectedRange(mode: PeriodMode, day: string, range: { from: string; to: string }): { from: string; to: string } {
  if (mode === 'day') return { from: day, to: day }
  const from = range.from <= range.to ? range.from : range.to
  let to = range.from <= range.to ? range.to : range.from
  if (daysBetween(from, to) > MAX_RANGE_DAYS) to = shiftDay(from, MAX_RANGE_DAYS - 1)
  return { from, to }
}

/** Aralık bir takvim ayının tamamı mı (karşılaştırma önceki ayın tamamıyla). */
export const isWholeMonth = (r: { from: string; to: string }) =>
  r.from.endsWith('-01') && r.from.slice(0, 7) === r.to.slice(0, 7) && shiftDay(r.to, 1).endsWith('-01')

/**
 * Karşılaştırma dönemi: ay dönemlerinde önceki takvim ayı (tam ay ↔ önceki
 * ayın tamamı; ay başından bugüne ↔ önceki ayın aynı günleri); diğerlerinde
 * hemen önceki eşit uzunlukta dönem.
 */
export function previousRange(r: { from: string; to: string }, monthly = false): { from: string; to: string } {
  const n = daysBetween(r.from, r.to)
  if (monthly && r.from.endsWith('-01')) {
    const lastOfPrev = shiftDay(r.from, -1)
    const first = `${lastOfPrev.slice(0, 8)}01`
    // Tam ay ↔ önceki ayın tamamı.
    if (shiftDay(r.to, 1).endsWith('-01')) return { from: first, to: lastOfPrev }
    const to = shiftDay(first, n - 1)
    return { from: first, to: to > lastOfPrev ? lastOfPrev : to }
  }
  return { from: shiftDay(r.from, -n), to: shiftDay(r.from, -1) }
}

/** Dönemi son yüklenen güne kırpar (gelecek günler "vardiyasız" sayılmasın). */
export function clipToData(
  r: { from: string; to: string },
  lastDataDay: string | null,
): { from: string; to: string; clipped: boolean } | null {
  if (!lastDataDay) return null
  if (r.from > lastDataDay) return null
  return r.to > lastDataDay ? { from: r.from, to: lastDataDay, clipped: true } : { ...r, clipped: false }
}

// ---- vardiya ---------------------------------------------------------------------

/** Ham duruşlar en çok bu kadar gün okunur (convex/oee.ts MAX_EVENT_DAYS). */
export const MAX_EVENT_DAYS = 8

/** Duruşun vardiyası: kod Shift Definition'da ya da Shift Group'ta (dosyaya göre). */
export const eventShift = (e: { shiftDefinition: string; shiftGroup: string }, c: OeeConfig) =>
  shiftNumber(e.shiftDefinition, c) ?? shiftNumber(e.shiftGroup, c)

/**
 * Tek vardiyanın verisi: vardiya satırlarından gün × makine, o vardiyanın
 * duruşlarından kayıp özeti, o vardiyanın siparişleri. `shift` 0 = hepsi.
 */
export function shiftSlice(
  shift: number,
  c: OeeConfig,
  input: { shifts: ShiftRow[]; events: DowntimeDay[]; orders: OrderRow[] },
): { days: DayRow[]; lossDays: LossDay[]; events: DowntimeDay[]; orders: OrderRow[] } {
  const events = input.events
    .map((d) => ({ ...d, events: shift ? d.events.filter((e) => eventShift(e, c) === shift) : d.events }))
    .filter((d) => d.events.length)
  return {
    days: daysFromShifts(shift ? input.shifts.filter((r) => shiftNumber(r.shiftGroup, c) === shift) : input.shifts),
    lossDays: events.map(lossDayOf),
    events,
    orders: shift ? input.orders.filter((o) => shiftNumber(o.shift, c) === shift) : input.orders,
  }
}
