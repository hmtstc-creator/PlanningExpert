// OEE Loss Bridge (src/routes/oee/bridge.tsx; kavram: docs/oee-bridge.md).
//
// Seçilen makine / hat ve dönem için zamanın şelalesi:
//
//   A Takvim → (planlanmamış) → Vardiya süresi → (planlı duruşlar) → Loading
//   → (availability kayıpları, açıklanmayan) → C Üretim → (performans) →
//   D Çalışma → (kalite) → E Efektif süre.        TEEP = E/A, OEE = E/B.
//
// Kurallar (komite, 2026-10-06):
// - OEE tabanı (B) şirketin seçimi: 'loading' (MES — varsayılan; planlı
//   duruşlar OEE dışında) ya da 'shift' (TPM — planlı duruşlar da kayıp).
//   Varsayılanda köprünün OEE'si OEE Dashboard'unkiyle birebir aynıdır.
// - Adımlar süre FARKLARINDAN hesaplanır (Loading − Production …); duruş
//   kayıtları bu farkı yalnızca gruplara ayırır. Kayıtların açıklamadığı
//   kısım işaretli "Not explained" adımıdır — hiçbir zaman orantılı
//   dağıtılmaz. Böylece köprü her zaman kapanır: A − Σkayıp = E.
// - Kayıp grubunun ailesi (availability / performance) ayardan; varsayılan
//   MES gibi availability. Ailesi değişen grup OEE'yi değiştirmez, yalnızca
//   A ve P payını.
// - Hız kaybı işaretlidir: üretim standardın üstündeyse (P > %100) negatif
//   adım ("Speed above standard") — 0'a kırpılmaz.
// - Oranların ortalaması alınmaz: süreler ve adetler toplanır, sonra bölünür.
// - Öncelik: OEE tabanındaki kayıplar arasında en çok dakika. Açıklanmayan,
//   tanımsız, hız kazancı ve planlı duruşlar (her iki tabanda) öncelik olamaz.

import { UNASSIGNED, type DayRow, type LossDay, type OeeConfig, type OrderRow } from './oee'

export type BridgeBase = 'loading' | 'shift'
export type BridgeFamily = 'notScheduled' | 'planned' | 'availability' | 'performance' | 'quality'
export type LossFamily = 'availability' | 'performance'

export const NOT_EXPLAINED = 'Not explained'
/** Kayıtlı duruşlar Loading − Production'dan fazlaysa (negatif açıklanmayan). */
export const OVER_RECORDED = 'Over-recorded downtime'
export const SPEED_LOSS = 'Speed loss'
export const SPEED_GAIN = 'Speed above standard'
export const OTHER_PLANNED = 'Other planned stops'
export const OVER_PLANNED = 'Over-recorded planned stops'

export interface BridgeStep {
  key: string
  label: string
  kind: 'total' | 'loss'
  family?: BridgeFamily
  /** Toplam çubuğunda süre; kayıpta düşülen süre (negatifse kazanç). */
  minutes: number
  /** Toplam çubuğunun kısa adı (A, B …) ve TPM karşılığı. */
  letter?: string
  note?: string
}

export interface LossItem {
  key: string
  label: string
  family: BridgeFamily
  minutes: number
  /** OEE tabanına oranı (0–1). */
  share: number
  count: number
  /** Bu kalemin Reason Code 2 kodları (Level 3 için). */
  groups: string[]
  /** Öncelik olabilir mi (açıklanmayan, tanımsız, OEE dışı planlı duruş olamaz). */
  rankable: boolean
  priority?: boolean
}

export interface Bridge {
  base: BridgeBase
  steps: BridgeStep[]
  totals: { calendar: number | null; shift: number; loading: number; production: number; operating: number; effective: number }
  /** OEE tabanı (dakika). */
  baseMinutes: number
  oee: number | null
  teep: number | null
  /** Seçilen tabana göre A, P, Q (köprüdeki C/B, D/C, E/D). */
  availability: number | null
  performance: number | null
  quality: number | null
  /** MES OEE (Operating × Q ÷ Loading) — Dashboard'daki. */
  mesOee: number | null
  /** OEE tabanının payları: OEE + availability + performance + quality kaybı = 1. */
  level1: { oee: number; availability: number; performance: number; quality: number } | null
  /** Level 2: kayıp kalemleri, aileye göre, çoktan aza. */
  items: LossItem[]
  /** OEE dışı planlı duruşlar (Loading tabanında; bilgi). */
  outside: LossItem[]
  notExplained: number
  speed: number
  warnings: string[]
  /** Köprüye giren gün × makine kayıtları ve duruş kaydı olmayanlar (veri notu). */
  coverage: { dayRows: number; withoutDowntimes: string[]; downtimesWithoutShift: string[] }
}

export interface CalendarInfo {
  /** A: gün × 1440 × makine sayısı. */
  minutes: number
  machines: number
  days: number
  /** Hiç vardiyası olmayan resmi tatil günleri. */
  holidayMin: number
  /** Hiç vardiyası olmayan diğer günler (hafta sonu, talep yok). */
  idleDayMin: number
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
  // Ayardaki sıra korunur; sonra büyükten küçüğe (ekranda).
  return [...by].map(([label, v]) => ({ label, ...v }))
}

const key = (r: { date: string; workCenter: string }) => `${r.date}|${r.workCenter}`

/** Yalnızca vardiya verisi olan gün × makinelerin duruşları (köprü ve Level 3 aynı tabanı kullanır). */
export function matchedLossDays(days: DayRow[], lossDays: LossDay[]): LossDay[] {
  const keys = new Set(days.filter((d) => d.loadingMin + d.scheduledMin > 0).map(key))
  return lossDays.filter((l) => keys.has(key(l)))
}

/**
 * Köprü. `days` ve `lossDays` seçilen kapsam ve döneme süzülmüş olmalı;
 * `calendar` yoksa takvim / planlanmamış adımları çıkmaz (TEEP yok).
 */
export function buildBridge(
  days: DayRow[],
  allLossDays: LossDay[],
  c: OeeConfig,
  base: BridgeBase,
  calendar: CalendarInfo | null = null,
): Bridge {
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
  const shift = L + S
  const B = base === 'shift' ? shift : L
  const warnings: string[] = []

  // Planlı duruşlar (Reason Code 1 = mola / planlı): Shiftly'deki planlı süre, gruplara ayrılır.
  const planned = groupMinutes(lossDays, c.breakReasonCodes)
  const plannedCols = columns(
    planned,
    c,
    () => true,
    (code) => c.lossGroups.find((g) => g.code === code)?.label || code,
  )
  const plannedRec = sum(plannedCols.map((x) => x.minutes))
  const otherPlanned = S - plannedRec

  // Kayıp duruşlar (Reason Code 1 = kayıp): availability ya da performance ailesi.
  const losses = groupMinutes(lossDays, c.lossReasonCodes)
  const visible = (code: string) => !hiddenGroup(code, c)
  const availCols = columns(
    losses,
    c,
    (code) => visible(code) && familyOf(code, c) === 'availability',
    (code) => chartOf(code, c),
  )
  const perfCols = columns(
    losses,
    c,
    (code) => visible(code) && familyOf(code, c) === 'performance',
    (code) => chartOf(code, c),
  )
  const recAvail = sum(availCols.map((x) => x.minutes))
  const recPerf = sum(perfCols.map((x) => x.minutes))
  // Gizli gruplar ("#", açıklanmayan) ve kaydı olmayan süre: açıklanmayan.
  const notExplained = L - P - recAvail - recPerf
  const C = P + recPerf
  const speed = P - Op
  const qualityMin = Op - E
  const scrapMin = pieces > 0 ? (qualityMin * scrap) / Math.max(1, scrap + reject) : 0
  const rejectMin = qualityMin - scrapMin

  const steps: BridgeStep[] = []
  if (calendar) {
    steps.push({
      key: 'A',
      label: 'Calendar time',
      kind: 'total',
      minutes: calendar.minutes,
      letter: 'A',
      note: `${calendar.machines} machine(s) × ${calendar.days} day(s) × 24 h`,
    })
    const otherIdle = calendar.minutes - shift - calendar.holidayMin - calendar.idleDayMin
    if (calendar.holidayMin)
      steps.push({ key: 'ns:holiday', label: 'Official holidays', kind: 'loss', family: 'notScheduled', minutes: calendar.holidayMin })
    if (calendar.idleDayMin)
      steps.push({
        key: 'ns:idle',
        label: 'Days without shift',
        kind: 'loss',
        family: 'notScheduled',
        minutes: calendar.idleDayMin,
        note: 'weekends, no demand, machine not used',
      })
    steps.push({
      key: 'ns:other',
      label: 'Hours without shift',
      kind: 'loss',
      family: 'notScheduled',
      minutes: otherIdle,
      note: 'outside the shifts on working days',
    })
  }
  steps.push({
    key: 'S',
    label: 'Shift time',
    kind: 'total',
    minutes: shift,
    letter: base === 'shift' ? 'B' : undefined,
    note: 'Loading + scheduled downtime',
  })
  for (const p of plannedCols) steps.push({ key: `pl:${p.label}`, label: p.label, kind: 'loss', family: 'planned', minutes: p.minutes })
  const otherPlannedLabel = otherPlanned < 0 ? OVER_PLANNED : OTHER_PLANNED
  if (Math.abs(otherPlanned) >= 0.5)
    steps.push({
      key: 'pl:other',
      label: otherPlannedLabel,
      kind: 'loss',
      family: 'planned',
      minutes: otherPlanned,
      note:
        otherPlanned < 0
          ? 'planned downtime records exceed the scheduled downtime of the shifts'
          : 'scheduled downtime without a matching downtime record',
    })
  steps.push({ key: 'L', label: 'Loading time', kind: 'total', minutes: L, letter: base === 'loading' ? 'B' : undefined })
  for (const a of availCols) steps.push({ key: `av:${a.label}`, label: a.label, kind: 'loss', family: 'availability', minutes: a.minutes })
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
          ? 'the downtime records add up to more than Loading − Production; the groups are shown as recorded'
          : 'Loading − Production not covered by a downtime with a reason (incl. undefined “#”)',
    })
  }
  steps.push({ key: 'C', label: 'Production time', kind: 'total', minutes: C, letter: 'C' })
  for (const p of perfCols) steps.push({ key: `pf:${p.label}`, label: p.label, kind: 'loss', family: 'performance', minutes: p.minutes })
  steps.push({
    key: 'pf:speed',
    label: speed < 0 ? SPEED_GAIN : SPEED_LOSS,
    kind: 'loss',
    family: 'performance',
    minutes: speed,
    note: 'Production − Operation time',
  })
  steps.push({ key: 'D', label: 'Operation time', kind: 'total', minutes: Op, letter: 'D' })
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
  steps.push({ key: 'E', label: 'Effective time', kind: 'total', minutes: E, letter: 'E', note: 'Operation time × quality' })

  // Level 2 kalemleri (OEE tabanındaki kayıplar).
  const share = (m: number) => (B > 0 ? m / B : 0)
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
    share: share(minutes),
    count,
    groups,
    rankable,
  })
  const plannedItems = [
    // Planlı duruşlar (mola, planlı toplantı …) yönetimin planıdır, kaizen hedefi değil: öncelik olmaz (TPM tabanında da).
    ...plannedCols.map((p) => item(`pl:${p.label}`, p.label, 'planned', p.minutes, p.count, p.groups, false)),
    ...(Math.abs(otherPlanned) >= 0.5 ? [item('pl:other', otherPlannedLabel, 'planned', otherPlanned, 0, [], false)] : []),
  ]
  const items: LossItem[] = [
    ...(base === 'shift' ? plannedItems : []),
    ...availCols.map((a) => item(`av:${a.label}`, a.label, 'availability', a.minutes, a.count, a.groups, a.label !== UNASSIGNED)),
    ...(Math.abs(notExplained) >= 0.5 ? [item('av:unexplained', unexplainedLabel, 'availability', notExplained, 0, [], false)] : []),
    ...perfCols.map((p) => item(`pf:${p.label}`, p.label, 'performance', p.minutes, p.count, p.groups, p.label !== UNASSIGNED)),
    item('pf:speed', speed < 0 ? SPEED_GAIN : SPEED_LOSS, 'performance', speed, 0, [], speed > 0),
    item('q:scrap', 'Scrap', 'quality', scrapMin, scrap, [], scrapMin > 0),
    item('q:reject', 'Reject', 'quality', rejectMin, reject, [], rejectMin > 0),
  ]
  const ranked = items.filter((i) => i.rankable && i.minutes > 0).sort((a, b) => b.minutes - a.minutes)
  if (ranked[0]) ranked[0].priority = true

  // Level 1: tabanın payları (köprüdeki adımlar; toplamları 1).
  const level1 = B > 0 ? { oee: E / B, availability: (B - C) / B, performance: (C - Op) / B, quality: (Op - E) / B } : null

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
  if (notExplained < -0.5) {
    warnings.push(
      `Downtime records add up to ${Math.round(-notExplained)} min more than Loading − Production (shown as “${OVER_RECORDED}”) — the MES counts these stops differently; the groups are shown as recorded, never scaled.`,
    )
  }
  if (Math.abs(otherPlanned) >= 0.5) {
    warnings.push(
      `Scheduled downtime of the shifts and planned downtime records differ by ${Math.round(otherPlanned)} min (shown as “${otherPlannedLabel}”).`,
    )
  }
  if (speed < 0)
    warnings.push(
      `Operation time is ${Math.round(-speed)} min above production time (performance over 100%) — shown as a gain, as recorded.`,
    )

  return {
    base,
    steps,
    totals: { calendar: calendar?.minutes ?? null, shift, loading: L, production: C, operating: Op, effective: E },
    baseMinutes: B,
    oee: B > 0 ? E / B : null,
    teep: calendar && calendar.minutes > 0 ? E / calendar.minutes : null,
    availability: B > 0 ? C / B : null,
    performance: C > 0 ? Op / C : null,
    quality: Op > 0 ? E / Op : null,
    mesOee: L > 0 ? E / L : null,
    level1,
    items: items.filter((i) => Math.abs(i.minutes) >= 0.5).sort((a, b) => b.minutes - a.minutes),
    outside: base === 'loading' ? plannedItems.filter((i) => Math.abs(i.minutes) >= 0.5) : [],
    notExplained,
    speed,
    warnings,
    coverage,
  }
}

/**
 * Takvim süresi (A). Makine sayısı: tanımlı iş merkezleri ile verideki iş
 * merkezlerinin birleşimi — verisi olmayan makine de takvime girer. Hiç
 * vardiyası olmayan gün: resmi tatilse "Official holidays", değilse "Days
 * without shift".
 */
export function calendarInfo(days: DayRow[], machines: string[], from: string, to: string, holidays: string[]): CalendarInfo {
  const all = new Set([...machines, ...days.map((d) => d.workCenter)])
  const n = all.size
  const dates: string[] = []
  for (let d = from; d <= to; d = nextDay(d)) dates.push(d)
  const working = new Set(days.filter((d) => d.loadingMin + d.scheduledMin > 0).map((d) => d.date))
  const hol = new Set(holidays)
  let holidayDays = 0
  let idleDays = 0
  for (const d of dates) {
    if (working.has(d)) continue
    if (hol.has(d)) holidayDays++
    else idleDays++
  }
  return {
    minutes: dates.length * 1440 * n,
    machines: n,
    days: dates.length,
    holidayMin: holidayDays * 1440 * n,
    idleDayMin: idleDays * 1440 * n,
  }
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
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

/** Bir kalemin Level 3 kırılımında hangi görünümler var. */
export function level3Views(item: LossItem): Level3By[] {
  if (item.key === 'pf:speed') return ['die', 'machine']
  if (item.family === 'quality') return ['die', 'machine']
  if (item.key === 'av:unexplained' || item.key === 'pl:other') return ['machine']
  return ['reason', 'machine']
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

/**
 * Level 3 kırılımı. `cur` ve `prev`: bu ve önceki dönemin (kapsama süzülmüş)
 * verisi. Kayıtlı duruş kalemlerinde neden ya da makine; hız ve kalitede
 * kalıp (Order Based) ya da makine; açıklanmayanda makine başına fark.
 */
export function level3(
  item: LossItem,
  by: Level3By,
  c: OeeConfig,
  cur: { days: DayRow[]; lossDays: LossDay[]; orders: OrderRow[] },
  prev: { days: DayRow[]; lossDays: LossDay[]; orders: OrderRow[] },
): Level3Row[] {
  const map = new Map<string, Level3Row>()
  const rc1s = item.family === 'planned' ? c.breakReasonCodes : c.lossReasonCodes

  if (item.key === 'pf:speed') {
    if (by === 'die') {
      for (const [set, isPrev] of [
        [cur.orders, false],
        [prev.orders, true],
      ] as const)
        for (const o of set) {
          const m = o.productionMin - o.operatingMin
          addRow(map, `${o.workCenter}|${o.equipment}`, o.equipment || '(no die)', m, 1, isPrev, o.workCenter)
        }
      // Kalıp başına sipariş sayısı "count": MTTR anlamsız.
      return finish(map, false).map((r) => ({ ...r, count: 0 }))
    }
    for (const [set, isPrev] of [
      [cur.days, false],
      [prev.days, true],
    ] as const)
      for (const d of set) addRow(map, d.workCenter, d.workCenter, d.productionMin - d.operatingMin, 0, isPrev)
    return finish(map, false)
  }

  if (item.family === 'quality') {
    const scrap = item.key === 'q:scrap'
    const minutesOf = (r: { operatingMin: number; good: number; scrap: number; reject: number }) => {
      const pcs = r.good + r.scrap + r.reject
      return pcs > 0 ? (r.operatingMin * (scrap ? r.scrap : r.reject)) / pcs : 0
    }
    if (by === 'die') {
      for (const [set, isPrev] of [
        [cur.orders, false],
        [prev.orders, true],
      ] as const)
        for (const o of set)
          addRow(
            map,
            `${o.workCenter}|${o.equipment}`,
            o.equipment || '(no die)',
            minutesOf(o),
            scrap ? o.scrap : o.reject,
            isPrev,
            o.workCenter,
          )
      return finish(map, false)
    }
    for (const [set, isPrev] of [
      [cur.days, false],
      [prev.days, true],
    ] as const)
      for (const d of set) addRow(map, d.workCenter, d.workCenter, minutesOf(d), scrap ? d.scrap : d.reject, isPrev)
    return finish(map, false)
  }

  if (item.key === 'av:unexplained' || item.key === 'pl:other') {
    // Makine başına: süre farkı − o makinenin kayıtlı (görünür) duruşları.
    const planned = item.key === 'pl:other'
    for (const [set, isPrev] of [
      [cur, false],
      [prev, true],
    ] as const) {
      const gap = new Map<string, number>()
      for (const d of set.days)
        gap.set(d.workCenter, (gap.get(d.workCenter) ?? 0) + (planned ? d.scheduledMin : d.loadingMin - d.productionMin))
      for (const l of set.lossDays) {
        for (const [k, [m]] of Object.entries(l.codes)) {
          const [rc1, rc2] = k.split('|')
          const counts = planned ? c.breakReasonCodes.includes(rc1) : c.lossReasonCodes.includes(rc1) && !hiddenGroup(rc2, c)
          if (counts) gap.set(l.workCenter, (gap.get(l.workCenter) ?? 0) - m)
        }
      }
      for (const [wc, m] of gap) addRow(map, wc, wc, m, 0, isPrev)
    }
    return finish(map, false)
  }

  // Kayıtlı duruş kalemi: grupları; nedene ya da makineye göre.
  const groups = new Set(item.groups)
  for (const [set, isPrev] of [
    [cur.lossDays, false],
    [prev.lossDays, true],
  ] as const) {
    for (const l of set) {
      if (by === 'machine') {
        for (const [k, [m, n]] of Object.entries(l.codes)) {
          const [rc1, rc2] = k.split('|')
          if (rc1s.includes(rc1) && groups.has(rc2)) addRow(map, l.workCenter, l.workCenter, m, n, isPrev)
        }
      } else {
        for (const [k, [m, n]] of Object.entries(l.reasons)) {
          const [rc1, rc2, ...rest] = k.split('|')
          if (!rc1s.includes(rc1) || !groups.has(rc2)) continue
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

export type PeriodPreset = 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'custom'

export const PERIOD_PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'thisWeek', label: 'This week' },
  { key: 'lastWeek', label: 'Last week' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'custom', label: 'Custom' },
]

/** Özel aralık en çok bu kadar gün (önceki dönemle birlikte okunur). */
export const MAX_CUSTOM_DAYS = 31

const shiftDay = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
const mondayOf = (iso: string) => shiftDay(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7))

/**
 * Dönemin günleri. `today`: bugünün tarihi (yerel); veri dünle biter, bu
 * yüzden "this week / this month" bugünü içermez. Özel aralık en çok
 * MAX_CUSTOM_DAYS.
 */
export function periodRange(preset: PeriodPreset, today: string, custom?: { from: string; to: string }): { from: string; to: string } {
  const y = shiftDay(today, -1)
  switch (preset) {
    case 'yesterday':
      return { from: y, to: y }
    case 'thisWeek': {
      const m = mondayOf(today)
      return { from: m, to: m === today ? today : y }
    }
    case 'lastWeek': {
      const m = shiftDay(mondayOf(today), -7)
      return { from: m, to: shiftDay(m, 6) }
    }
    case 'thisMonth': {
      const first = `${today.slice(0, 8)}01`
      return { from: first, to: first === today ? today : y }
    }
    case 'lastMonth': {
      const first = `${today.slice(0, 8)}01`
      const last = shiftDay(first, -1)
      return { from: `${last.slice(0, 8)}01`, to: last }
    }
    case 'custom': {
      const from = custom?.from ?? y
      let to = custom?.to ?? y
      if (to < from) to = from
      if (daysBetween(from, to) > MAX_CUSTOM_DAYS) to = shiftDay(from, MAX_CUSTOM_DAYS - 1)
      return { from, to }
    }
  }
}

/** Hemen önceki eşit uzunlukta dönem (karşılaştırma). */
export function previousRange(r: { from: string; to: string }): { from: string; to: string } {
  const n = daysBetween(r.from, r.to)
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
