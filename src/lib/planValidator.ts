// Bitmiş planın BAĞIMSIZ doğrulaması.
//
// Motorun talep zamanlamasını, lot hesabını, readyMoment/isLate/deadlineOf
// ve shiftTimeline kodunu KULLANMAZ. Talep, takvim, net dakika ↔ saat
// çevirisi ve eş ürün fiziği ham girdilerden yeniden türetilir; plandan
// yalnızca işlerin ham gerçekleri (pres, malzeme, adet, vuruş, parçalar)
// okunur. Böylece motordaki bir hata burada yakalanır.
//
// Dört bölüm:
//  1. Stok simülasyonu — müşteri duruyor mu? (gerçek stok bitişleri)
//  2. Yapılabilirlik — o stok bitişini HİÇBİR plan önleyebilir miydi?
//  3. Verimlilik — setup alt sınırı, doluluk üst sınırı, boşta kalma nedeni
//  4. Kesin kurallar — mutlak zaman ekseninde yeniden denetim
//
// Tek zaman ekseni: tesis duvar saati dakikası
//   abs(tarih, saat) = (1970'ten gün sayısı) × 1440 + saat
// Saat ≥ 1440 olabilir (üretim gününün gece vardiyası). Yaz saati yok sayılır
// (motor da yok sayıyor).
//
// Çıktı küçük ve JSON'a çevrilebilir (Convex dokümanında saklanır): listeler
// sınırlı, undefined/Infinity/NaN yok.
//
// DİKKAT: sunucuda da derlenir — yalnızca göreli, tip importları.

import type { PlanInputs, PlanRun } from './planPipeline'
import type { ProductSpec } from './planning'
import type { ScheduledJob } from './scheduler'
import { countedLocations } from './stockLocations'
import { DEFAULT_WORKING_DAYS, SETTINGS_DEFAULTS } from './settingsDefaults'

// ---------------------------------------------------------------- çıktı tipleri

export type MaterialVerdictKind =
  | 'agree' // simülasyon ve motor ikisi de geç diyor
  | 'engine-missed' // müşteri duruyor, motor geç iş göstermiyor
  | 'engine-false-late' // motor geç diyor, stok hiç eksiye düşmüyor
  | 'explained-unplanned' // stok bitiyor, motor malzemeyi plansız listeliyor
  | 'frozen-late' // stok bitişini dondurulmuş işin zamanı yapıyor (motor dondurulmuşu değerlendirmez)

export type FeasibilityKind = 'capacity-proven' | 'avoidable' | 'undecided'

export interface StockoutRow {
  group: string
  material: string
  /** "Tue 2026-09-15 08:00" */
  at: string
  /** Eksik (birikimli) adet o anda. */
  shortQty: number
  /** Bu ihtiyaç anının eksik adedi. */
  shortHere: number
  recoveredAt: string | null
  lateHours: number | null
  cause: 'plan' | 'frozen-timing'
}

export interface FeasibilityResult {
  verdict: FeasibilityKind
  test: 'alone' | 'press-load' | 'pooled-load' | 'setup-crew' | 'hall-crew' | 'idle-gap' | 'none'
  /**
   * capacity-proven: eksik kalan dakika · avoidable: boşlukta artan dakika ·
   * undecided: tek başına en iyi preste artan dakika (negatif = yetişmez).
   */
  gapMinutes: number
  /** Gereken pay ve bunun için en az iş dakikası. */
  needQty: number
  needMinutes: number
  reason: string
}

export interface MaterialVerdict {
  group: string
  materials: string[]
  verdict: MaterialVerdictKind
  firstShortAt: string | null
  shortQty: number
  stockouts: number
  lateHours: number | null
  engineLateJobs: number
  engineDeadline: string | null
  feasibility: FeasibilityResult | null
  dataFlags: string[]
}

export interface RuleCheck {
  id: string
  label: string
  checked: number
  broken: number
  examples: string[]
}

export interface PressEfficiency {
  press: string
  setupsPlan: number
  setupsLowerBound: number
  capacityHours: number
  runHours: number
  utilisation: number
  upperBound: number
  idleHours: number
  idleNoWork: number
  idleNotReleased: number
  /** Serbest parça var ama o sırada setup ekibi başka preste. */
  idleWaitingCrew: number
  idleLeft: number
}

export interface EfficiencyReport {
  windowDays: number
  setups: { plan: number; lowerBound: number }
  utilisation: { capacityHours: number; runHours: number; plan: number; upperBound: number }
  idleHours: { noWork: number; notReleased: number; waitingCrew: number; leftIdle: number }
  perPress: PressEfficiency[]
}

export interface ValidationSummary {
  verdicts: Record<MaterialVerdictKind, number>
  /** Gerçek stok bitişi olan malzeme (grup) sayısı ve an sayısı. */
  realStockouts: number
  stockoutMoments: number
  /** Motorun geç gösterdiği malzeme (grup) sayısı. */
  engineLate: number
  capacityProven: number
  /**
   * Kanıtlanmış en az geç malzeme sayısı: HİÇBİR plan bundan azına inemez
   * (pres yükü, setup ekibi ve hol vinci alt sınırlarının en büyüğü).
   */
  lateLowerBound: number
  lateLowerBoundBy: { press: number; setupCrew: number; hallCrane: number }
  avoidable: number
  undecided: number
  dataSuspect: number
  rulesBroken: number
  rulesFailed: string[]
  setups: { plan: number; lowerBound: number }
  utilisation: { plan: number; upperBound: number }
  ok: boolean
}

export interface PlanValidation {
  version: 1
  todayIso: string
  horizon: { from: string; to: string }
  elapsedMs: number
  summary: ValidationSummary
  materials: MaterialVerdict[]
  stockouts: StockoutRow[]
  efficiency: EfficiencyReport
  rules: RuleCheck[]
  warnings: string[]
}

// ------------------------------------------------------------- sabitler/yardımcı

const MAX_ROWS = 300
const MAX_EXAMPLES = 12
const MAX_WARNINGS = 50
const QTY_TOL = 0.5
const MIN_TOL = 1
const EPS = 0.01
const UTIL_WINDOW_DAYS = 7
const PLACEHOLDER_COIL_KG = 1

const DAY_KEYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const dayNo = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)
const isoOf = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10)
const plusDays = (iso: string, n: number) => isoOf(dayNo(iso) + n)
const weekdayIndex = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7
const mondayOfIso = (iso: string) => plusDays(iso, -weekdayIndex(iso))
const absMinute = (iso: string, clock: number) => dayNo(iso) * 1440 + clock
const round1 = (x: number) => Math.round(x * 10) / 10
const hours = (min: number) => round1(min / 60)

export function labelOfAbs(abs: number): string {
  const d = Math.floor(abs / 1440)
  const m = Math.round(abs - d * 1440)
  const iso = isoOf(d + Math.floor(m / 1440))
  const mm = m % 1440
  return `${WEEKDAY[weekdayIndex(iso)]} ${iso} ${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`
}

function wallClock(ms: number, timeZone: string): { iso: string; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(ms))
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '0'
    return { iso: `${g('year')}-${g('month')}-${g('day')}`, minute: (Number(g('hour')) % 24) * 60 + Number(g('minute')) }
  } catch {
    const d = new Date(ms)
    return { iso: d.toISOString().slice(0, 10), minute: d.getUTCHours() * 60 + d.getUTCMinutes() }
  }
}

interface Block {
  start: number
  end: number
}

/** Aralık listesi: sıralı, çakışmasız birleşim. */
function mergeBlocks(list: Block[]): Block[] {
  const sorted = list.filter((b) => b.end > b.start).sort((a, b) => a.start - b.start)
  const out: Block[] = []
  for (const b of sorted) {
    const last = out[out.length - 1]
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end)
    else out.push({ ...b })
  }
  return out
}

/** `base` eksi `cut` (ikisi de birleşik liste). */
function subtractBlocks(base: Block[], cut: Block[]): Block[] {
  const out: Block[] = []
  let j = 0
  for (const b of base) {
    let s = b.start
    while (j < cut.length && cut[j].end <= s) j++
    let k = j
    while (k < cut.length && cut[k].start < b.end) {
      if (cut[k].start > s) out.push({ start: s, end: cut[k].start })
      s = Math.max(s, cut[k].end)
      k++
    }
    if (s < b.end) out.push({ start: s, end: b.end })
  }
  return out
}

/** Önek toplamlı serbest zaman: [a, b) içindeki dakika ve "w dakika ne zaman birikir". */
class FreeTime {
  readonly blocks: Block[]
  private prefix: number[]
  constructor(blocks: Block[]) {
    this.blocks = blocks
    this.prefix = [0]
    for (const b of blocks) this.prefix.push(this.prefix[this.prefix.length - 1] + (b.end - b.start))
  }
  /** (-∞, t) içindeki serbest dakika. */
  before(t: number): number {
    let lo = 0
    let hi = this.blocks.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.blocks[mid].end <= t) lo = mid + 1
      else hi = mid
    }
    const b = this.blocks[lo]
    return this.prefix[lo] + (b && t > b.start ? t - b.start : 0)
  }
  between(a: number, b: number): number {
    return b > a ? this.before(b) - this.before(a) : 0
  }
  /** Birikimli serbest dakikanın `cum`a ulaştığı an; ufukta yoksa null. */
  timeAt(cum: number): number | null {
    if (cum <= 0) return this.blocks.length ? this.blocks[0].start : null
    const total = this.prefix[this.prefix.length - 1]
    if (cum > total + 1e-9) return null
    let lo = 0
    let hi = this.blocks.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.prefix[mid + 1] < cum - 1e-9) lo = mid + 1
      else hi = mid
    }
    return this.blocks[lo].start + (cum - this.prefix[lo])
  }
  /** `from`dan itibaren `w` serbest dakikanın biriktiği an; ufukta yoksa null. */
  reach(from: number, w: number): number | null {
    const target = this.before(from) + w
    if (w <= 0) return from
    const total = this.prefix[this.prefix.length - 1]
    if (target > total + 1e-9) return null
    let lo = 0
    let hi = this.blocks.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.prefix[mid + 1] < target - 1e-9) lo = mid + 1
      else hi = mid
    }
    const b = this.blocks[lo]
    return b.start + (target - this.prefix[lo])
  }
}

/**
 * Moore–Hodgson: tek makinede (ortak başlangıç) en az geç iş sayısı. Gevşetilmiş
 * modelde en iyi sonuçtur, bu yüzden gerçek plan için geçerli bir ALT SINIRDIR.
 */
export function mooreHodgson(items: { g: string; p: number; d: number }[]): { rejected: Set<string>; overload: number } {
  const sorted = [...items].sort((a, b) => a.d - b.d)
  const chosen: typeof sorted = []
  const rejected = new Set<string>()
  let sum = 0
  let prefix = 0
  let overload = 0
  for (const it of sorted) {
    prefix += it.p
    overload = Math.max(overload, prefix - it.d)
    chosen.push(it)
    sum += it.p
    if (sum > it.d + EPS) {
      let k = 0
      for (let i = 1; i < chosen.length; i++) if (chosen[i].p > chosen[k].p) k = i
      sum -= chosen[k].p
      rejected.add(chosen[k].g)
      chosen.splice(k, 1)
    }
  }
  return { rejected, overload: Math.max(0, overload) }
}

function capList<T>(list: T[], n = MAX_ROWS): T[] {
  return list.length > n ? list.slice(0, n) : list
}

// ------------------------------------------------------------------ ana fonksiyon

type Job = ScheduledJob & { frozen?: boolean }

interface Seg {
  kind: string
  date: string
  netStart: number
  netEnd: number
  start: number
  end: number
}

interface AJob {
  id: string
  job: Job | null
  material: string
  group: string
  press: string
  hall: string
  frozen: boolean
  /** Bugünden önce başlamış, hâlâ süren onaylı iş (motor planında yok). */
  running: boolean
  quantity: number
  shots: number
  segs: Seg[]
  start: number
  end: number
  setupSegs: Block[]
  coilSegs: Block[]
  runSegs: Block[]
}

interface Piece {
  start: number
  end: number
  qty: number
  frozen: boolean
  /** Parçayı üreten işin kimliği. */
  src: string
}

interface NeedEvent {
  at: number
  qty: number
  day: string
}

export function validatePlan(inputs: PlanInputs, run: PlanRun, nowMs: number): PlanValidation {
  const t0 = Date.now()
  const warnings: string[] = []
  const warn = (w: string) => {
    if (warnings.length < MAX_WARNINGS) warnings.push(w)
  }

  // ---- ayarlar
  const s = inputs.settings ?? {}
  const timeZone = s.timeZone || run.timeZone || 'Europe/Bucharest'
  const shiftStart = s.shiftStartMinute ?? SETTINGS_DEFAULTS.shiftStartMinute
  const shiftLen = s.shiftMinutes ?? SETTINGS_DEFAULTS.shiftMinutes
  const cutoff = s.deliveryCutoffMinute ?? SETTINGS_DEFAULTS.deliveryCutoffMinute
  const weeks = Math.min(30, Math.max(1, s.planningHorizonWeeks ?? SETTINGS_DEFAULTS.planningHorizonWeeks))
  const capacityFactor = s.capacityFactor ?? SETTINGS_DEFAULTS.capacityFactor
  const setupGap = s.setupGapMinutes ?? SETTINGS_DEFAULTS.setupGapMinutes
  // Setup çay/yemek molasında durmaz: presten en fazla en uzun mola kadar
  // az yer tutabilir. Alt sınırlar (kanıt) bu kısalmayı hesaba katar;
  // "boşluğa sığardı" denemesi tam süreyle yapılır (iyimser olmasın).
  const setupAbsorb = Math.max(
    0,
    ...inputs.plannedStops.filter((st) => ['tea', 'meal', 'break'].includes(st.kind)).map((st) => st.durationMinutes),
  )
  const pressSetupOf = (p: ProductSpec | undefined) => Math.max(0, (p?.setupMinutes ?? 0) - setupAbsorb)
  const coilGap = s.coilSetupGapMinutes ?? SETTINGS_DEFAULTS.coilSetupGapMinutes
  const hallConcurrent = Math.max(1, s.concurrentSetupsPerHall ?? SETTINGS_DEFAULTS.concurrentSetupsPerHall)
  const plantUrgentCap = Math.max(1, s.maxSetupsPlantWide ?? SETTINGS_DEFAULTS.maxSetupsPlantWide)
  // Bakiye / geç riskli işin setup'ı holde de fabrika acil sınırına kadar çakışabilir.
  const hallUrgentCap = Math.max(hallConcurrent, plantUrgentCap)
  const plantNormalCap = Math.max(1, Math.min(plantUrgentCap, s.maxSetupsPlantWideNormal ?? SETTINGS_DEFAULTS.maxSetupsPlantWideNormal))
  const setupsCrossShifts = s.setupsCrossShifts ?? SETTINGS_DEFAULTS.setupsCrossShifts
  const pullForwardDays = Math.max(0, s.pullForwardDays ?? SETTINGS_DEFAULTS.pullForwardDays)
  const safetyDays = Math.max(0, Math.round(run.safetyStockDays ?? s.safetyStockDays ?? SETTINGS_DEFAULTS.safetyStockDays))
  const holidays = new Set<string>([
    ...(inputs.workCalendar?.holidays ?? []),
    ...inputs.officialHolidays.map((h) => h.date),
  ])
  const stopsByShift = [0, 0, 0]
  for (const st of inputs.plannedStops) if (st.shiftIndex >= 1 && st.shiftIndex <= 3) stopsByShift[st.shiftIndex - 1] += st.durationMinutes

  // ---- bugün
  const wall = wallClock(nowMs, timeZone)
  const today = wall.minute >= shiftStart ? wall.iso : plusDays(wall.iso, -1)
  const nowAbs = absMinute(wall.iso, wall.minute)
  if (today !== run.todayIso) warn(`Production day differs: validator ${today}, engine ${run.todayIso}.`)
  const monday = mondayOfIso(wall.iso)
  const demandToday = today > monday ? today : monday
  const horizonEnd = plusDays(monday, weeks * 7 - 1)

  // ---- pres takvimi (bağımsız): haftalık düzen Pazartesiden sırayla, tatil
  // günü kaybolur (kaymaz); istisna hafta şablonun önüne geçer.
  const tplBy = new Map(inputs.templates.map((t) => [t.press, t]))
  const ovBy = new Map((inputs.weekOverrides ?? []).map((o) => [`${o.press}|${o.weekStart}`, o]))
  const normalShiftsOn = (press: string, iso: string) => {
    if (holidays.has(iso)) return 0
    const pat = ovBy.get(`${press}|${mondayOfIso(iso)}`) ?? tplBy.get(press)
    if (!pat) return 0
    return weekdayIndex(iso) < pat.workingDays ? pat.shiftsPerDay : 0
  }
  /** Fabrikanın iş günü: tatil değil ve en az bir presin normal vardiyası var. */
  const isWorkingDay = (iso: string) => !holidays.has(iso) && inputs.presses.some((p) => normalShiftsOn(p.name, iso) > 0)
  // Teslimde tatil gözetilmez: bakiye ve bugünün ihtiyacı ertesi gün, teslim saatinde.
  const needMoment = (day: string) => absMinute(day <= demandToday ? plusDays(demandToday, 1) : day, cutoff)
  /** `iso`dan `n` iş günü geriye (iş günü = takvim çalışma günü). */
  const backWorkingDays = (iso: string, n: number) => {
    let d = iso
    let left = n
    for (let guard = 0; left > 0 && guard < 60; guard++) {
      d = plusDays(d, -1)
      if (isWorkingDay(d)) left--
    }
    return d
  }

  // ---- ürünler, eş ürün grupları, uygun presler
  const productBy = new Map<string, ProductSpec & { maxShots?: number }>(inputs.products.map((p) => [p.code, p]))
  const cav = (m: string) => {
    const c = productBy.get(m)?.moldCavities
    return c && c > 0 ? c : 1
  }
  const partnerOf = new Map<string, string>()
  for (const p of inputs.products) {
    const co = p.coProduct?.trim()
    if (!co || co === p.code) continue
    if (!partnerOf.has(p.code)) partnerOf.set(p.code, co)
    if (!partnerOf.has(co)) partnerOf.set(co, p.code)
  }
  const groupOf = (m: string) => {
    const p = partnerOf.get(m)
    return p ? [m, p].sort().join('+') : m
  }
  const membersOf = (g: string) => g.split('+')
  /** Çiftin asıl ürünü: eş ürünü tanımlayan taraf. */
  const primaryOf = (g: string): ProductSpec | undefined => {
    const ms = membersOf(g)
    if (ms.length === 1) return productBy.get(ms[0])
    const [a, b] = ms
    if (productBy.get(a)?.coProduct?.trim() === b) return productBy.get(a)
    if (productBy.get(b)?.coProduct?.trim() === a) return productBy.get(b)
    return productBy.get(a) ?? productBy.get(b)
  }
  const pressByName = new Map((inputs.presses ?? []).map((p) => [p.name, p]))
  const pins = new Map<string, string>()
  for (const o of inputs.overrides) if (o.kind === 'pin' && o.press) pins.set(o.material, o.press)
  const excluded = new Set(inputs.overrides.filter((o) => o.kind === 'exclude').map((o) => o.material))
  const eligibleOf = (g: string): string[] => {
    const p = primaryOf(g)
    if (!p) return []
    const pin = membersOf(g).map((m) => pins.get(m)).find((x) => x)
    if (pin) return pressByName.has(pin) ? [pin] : []
    const list = [p.mainMachine, ...(p.flexiblePress ? [p.altMachine1, p.altMachine2, p.altMachine3, p.altMachine4] : [])]
    return Array.from(new Set(list.map((x) => x?.trim()).filter((x): x is string => !!x && pressByName.has(x))))
  }
  const piecesPerCoil = (p: ProductSpec | undefined) => {
    if (!p || (p.minLotQty ?? 0) > 0) return 0
    const gw = p.grossWeight ?? 0
    const cw = p.coilWeight ?? 0
    return gw > 0 && cw > PLACEHOLDER_COIL_KG ? Math.floor(cw / gw) : 0
  }
  /** Rulo başına parça, göz sayısına tam bölünür hâliyle (bir rulonun verdiği adet). */
  const coilUnit = (p: ProductSpec | undefined) => {
    const pcs = piecesPerCoil(p)
    if (!p || pcs <= 0) return 0
    const c = p.moldCavities && p.moldCavities > 0 ? p.moldCavities : 1
    return Math.floor(pcs / c) * c
  }

  // ---- takvim: pres × gün vardiyası, net kapasite, saat blokları
  const horizonDates: string[] = []
  for (let i = 0; i < weeks * 7; i++) horizonDates.push(plusDays(monday, i))
  const blocksCache = new Map<string, Block[]>()
  /** Stopları çıkarılmış saat blokları: normal vardiyalar + mesai pencereleri. */
  function productiveBlocks(shifts: number, overtime: Block[] = []): Block[] {
    const key = `${shifts}|${overtime.map((o) => `${o.start}-${o.end}`).join(',')}`
    const hit = blocksCache.get(key)
    if (hit) return hit
    const windows: { ws: number; we: number; shift: number | null }[] = []
    for (let i = 1; i <= shifts; i++) windows.push({ ws: shiftStart + (i - 1) * shiftLen, we: shiftStart + i * shiftLen, shift: i })
    for (const o of overtime) windows.push({ ws: o.start, we: o.end, shift: null })
    windows.sort((a, b) => a.ws - b.ws)
    const out: Block[] = []
    for (const { ws, we, shift } of windows) {
      const cuts: Block[] = []
      for (const st of inputs.plannedStops) {
        // Normal vardiyada kendi vardiyasının duruşu; mesaide saatine denk gelen her duruş.
        if (shift !== null && st.shiftIndex !== shift) continue
        for (let k = 0; k <= 2; k++) {
          const a = st.startMinute + k * 1440
          if (a >= ws && a < we) {
            cuts.push({ start: a, end: Math.min(we, a + st.durationMinutes) })
            break
          }
        }
      }
      cuts.sort((a, b) => a.start - b.start)
      let c = ws
      for (const cut of cuts) {
        if (cut.start > c) out.push({ start: c, end: cut.start })
        c = Math.max(c, cut.end)
      }
      if (c < we) out.push({ start: c, end: we })
    }
    blocksCache.set(key, out)
    return out
  }
  // Mesai: tarihli ya da (tatil dışında) tekrarlayan, tanımın saat ve
  // süresiyle; üretim günü dışına taşan, normal vardiyayla ya da başka
  // mesaiyle çakışan pencere sayılmaz.
  const defBy = new Map((inputs.overtimeDefinitions ?? []).map((d) => [d.id, d]))
  const datedBy = new Map<string, string[]>()
  for (const o of inputs.pressOvertime ?? []) {
    const key = `${o.press}|${o.date}`
    datedBy.set(key, [...(datedBy.get(key) ?? []), o.definitionId])
  }
  const overtimeOn = (press: string, iso: string, shifts: number): Block[] => {
    const ids = [...(datedBy.get(`${press}|${iso}`) ?? [])]
    if (!holidays.has(iso)) {
      for (const r of tplBy.get(press)?.recurringOvertime ?? []) if (r.dayKey === DAY_KEYS[weekdayIndex(iso)]) ids.push(r.definitionId)
    }
    const normalEnd = shiftStart + shifts * shiftLen
    const out: Block[] = []
    const cand = ids
      .map((id) => defBy.get(id))
      .filter((d): d is NonNullable<typeof d> => !!d)
      .map((d) => {
        const a = d.startMinute < shiftStart ? d.startMinute + 1440 : d.startMinute
        return { start: a, end: a + d.durationMinutes }
      })
      .sort((x, y) => x.start - y.start)
    for (const w of cand) {
      if (w.end <= w.start || w.end > shiftStart + 1440) continue
      if (shifts > 0 && w.start < normalEnd && shiftStart < w.end) continue
      if (out.some((x) => w.start < x.end && x.start < w.end)) continue
      out.push(w)
    }
    return out
  }
  const dayInfo = new Map<string, { shifts: number; overtime: Block[]; netCap: number }>()
  for (const p of inputs.presses) {
    for (const d of horizonDates) {
      const shifts = normalShiftsOn(p.name, d)
      const overtime = overtimeOn(p.name, d, shifts)
      let net = 0
      for (const b of productiveBlocks(shifts, overtime)) net += b.end - b.start
      dayInfo.set(`${p.name}|${d}`, { shifts, overtime, netCap: capacityFactor === 1 ? net : Math.floor(net * capacityFactor) })
    }
  }
  for (const d of run.days ?? []) {
    const mine = dayInfo.get(`${d.press}|${d.date}`)
    if (mine && mine.shifts !== d.shifts) warn(`Calendar differs on ${d.press} ${d.date}: validator ${mine.shifts} shifts, engine ${d.shifts}.`)
  }
  /** Net aralık → saat blokları (günün gece yarısından dakika). Gün sonunu aşan kısım uzatılır. */
  const netToClock = (a: number, b: number, blocks: Block[]): Block[] => {
    const res: Block[] = []
    let net = 0
    for (const blk of blocks) {
      const len = blk.end - blk.start
      const from = Math.max(a, net)
      const to = Math.min(b, net + len)
      if (to > from) res.push({ start: blk.start + (from - net), end: blk.start + (to - net) })
      net += len
    }
    if (b > net) {
      const tail = blocks.length ? blocks[blocks.length - 1].end : shiftStart
      const from = Math.max(a, net)
      res.push({ start: tail + (from - net), end: tail + (b - net) })
    }
    return res
  }
  const netPointToAbs = (date: string, net: number, shifts: number, overtime: Block[] = []) => {
    const blocks = shifts > 0 || overtime.length ? productiveBlocks(shifts, overtime) : productiveBlocks(1)
    let acc = 0
    for (const blk of blocks) {
      const len = blk.end - blk.start
      if (net <= acc + len) return absMinute(date, blk.start + (net - acc))
      acc += len
    }
    const tail = blocks.length ? blocks[blocks.length - 1].end : shiftStart
    return absMinute(date, tail + (net - acc))
  }
  const shiftsOn = (press: string, date: string) => dayInfo.get(`${press}|${date}`)?.shifts ?? 0
  const overtimeOnDay = (press: string, date: string) => dayInfo.get(`${press}|${date}`)?.overtime ?? []
  const segToAbs = (press: string, date: string, a: number, b: number): Block[] => {
    const sh = shiftsOn(press, date)
    const ot = overtimeOnDay(press, date)
    return netToClock(a, b, sh > 0 || ot.length ? productiveBlocks(sh, ot) : productiveBlocks(3)).map((x) => ({
      start: absMinute(date, x.start),
      end: absMinute(date, x.end),
    }))
  }
  /** Presin çalışma zamanı (kapasite çarpanı uygulanmış), mutlak eksende. */
  const workingBlocks = new Map<string, Block[]>()
  for (const p of inputs.presses) {
    const list: Block[] = []
    for (const d of horizonDates) {
      const info = dayInfo.get(`${p.name}|${d}`)
      if (!info || info.netCap <= 0) continue
      for (const x of netToClock(0, info.netCap, productiveBlocks(info.shifts, info.overtime))) {
        list.push({ start: absMinute(d, x.start), end: absMinute(d, x.end) })
      }
    }
    workingBlocks.set(p.name, mergeBlocks(list))
  }

  // ---- işler mutlak eksende
  const hallOf = (press: string) => pressByName.get(press)?.hall ?? run.presses.find((p) => p.name === press)?.hall ?? '?'
  const toAJob = (
    id: string,
    job: Job | null,
    material: string,
    press: string,
    segments: { kind: string; date: string; start: number; end: number }[],
    quantity: number,
    shots: number,
    frozen: boolean,
    running: boolean,
  ): AJob => {
    const segs: Seg[] = []
    for (const g of segments) {
      if (!(g.end > g.start)) continue
      for (const b of segToAbs(press, g.date, g.start, g.end)) {
        segs.push({ kind: g.kind, date: g.date, netStart: g.start, netEnd: g.end, start: b.start, end: b.end })
      }
    }
    segs.sort((a, b) => a.start - b.start)
    const of = (k: string) => mergeBlocks(segs.filter((x) => x.kind === k).map((x) => ({ start: x.start, end: x.end })))
    // Setup ve rulo değişimi bir moladan geçerse saatte iki parçaya bölünür;
    // yine TEK setup'tır. Motorun her parçası tek blok (baştan sona) sayılır,
    // yoksa aynı setup'ın iki yarısı "iki setup" diye vinç kuralına takılır.
    const spans = (k: string) => {
      const bySeg = new Map<string, Block>()
      for (const x of segs) {
        if (x.kind !== k) continue
        const key = `${x.date}|${x.netStart}|${x.netEnd}`
        const cur = bySeg.get(key)
        bySeg.set(key, cur ? { start: Math.min(cur.start, x.start), end: Math.max(cur.end, x.end) } : { start: x.start, end: x.end })
      }
      return mergeBlocks([...bySeg.values()])
    }
    return {
      id,
      job,
      material,
      group: groupOf(material),
      press,
      hall: hallOf(press),
      frozen,
      running,
      quantity,
      shots,
      segs,
      start: segs.length ? segs[0].start : 0,
      end: segs.length ? Math.max(...segs.map((x) => x.end)) : 0,
      setupSegs: spans('setup'),
      coilSegs: spans('coil'),
      runSegs: of('run'),
    }
  }
  const jobs: AJob[] = []
  run.jobs.forEach((j, i) => {
    const job = j as Job
    const label = `${j.material}@${j.press} ${j.date}${job.frozen ? ' (frozen)' : ''}`
    jobs.push(
      toAJob(
        `${label}#${i}`,
        job,
        j.material,
        j.press,
        j.segments ?? [],
        j.quantity,
        j.shots || Math.ceil(j.quantity / cav(j.material)),
        !!job.frozen,
        false,
      ),
    )
  })
  // Bugünden önce başlamış, hâlâ süren onaylı işler: motorun planında yoklar
  // ama pres ve kalıp sahada meşgul.
  const snap = inputs.latestSnapshot
  const stockUploadedAt = inputs.stock.reduce((m, r) => Math.max(m, r.uploadedAt ?? 0), 0)
  const uploadAbs = stockUploadedAt > 0 ? (() => {
    const u = wallClock(stockUploadedAt, timeZone)
    return absMinute(u.iso, u.minute)
  })() : null
  const pastSnapshotJobs: AJob[] = []
  if (snap && !snap.truncated) {
    snap.jobs.forEach((j, i) => {
      if (j.date >= today) return
      // Motor süren onaylı işi dondurulmuş iş olarak plana koyduysa aynı iştir:
      // ikinci kez eklenmez (pres çakışması ve çift çıktı olurdu).
      const same = jobs.find(
        (x) =>
          x.frozen &&
          x.job &&
          x.material === j.material &&
          x.press === j.press &&
          x.job.date === j.date &&
          Math.abs((x.job.setupStartMinute ?? 0) - (j.setupStartMinute ?? 0)) < 0.5,
      )
      if (same) {
        pastSnapshotJobs.push(same)
        return
      }
      const a = toAJob(`${j.material}@${j.press} ${j.date} (approved earlier)#s${i}`, null, j.material, j.press, j.segments ?? [], j.quantity, j.shots || Math.ceil(j.quantity / cav(j.material)), false, false)
      pastSnapshotJobs.push(a)
      if (a.segs.length && a.end > nowAbs + EPS) {
        a.running = true
        jobs.push(a)
      }
    })
  }
  const planJobs = jobs.filter((j) => !j.frozen && !j.running)
  const jobsByPress = new Map<string, AJob[]>()
  for (const j of jobs) {
    const list = jobsByPress.get(j.press) ?? []
    list.push(j)
    jobsByPress.set(j.press, list)
  }
  for (const list of jobsByPress.values()) list.sort((a, b) => a.start - b.start)

  // Bakım / arıza blokları.
  const maintenanceBy = new Map<string, Block[]>()
  for (const m of run.maintenance ?? []) {
    const list = maintenanceBy.get(m.press) ?? []
    list.push(...segToAbs(m.press, m.date, m.start, m.end))
    maintenanceBy.set(m.press, list)
  }
  for (const [k, v] of maintenanceBy) maintenanceBy.set(k, mergeBlocks(v))

  // Kalıp kapalılıkları (bakım günleri, hazır değil).
  const blackoutBy = new Map<string, Block[]>()
  const addBlackout = (m: string, b: Block) => {
    const list = blackoutBy.get(m) ?? []
    list.push(b)
    blackoutBy.set(m, list)
  }
  for (const row of inputs.moldMaintenance ?? []) {
    const to = row.dateTo && row.dateTo > row.date ? row.dateTo : row.date
    addBlackout(row.material, { start: absMinute(row.date, shiftStart), end: absMinute(plusDays(to, 1), shiftStart) })
  }
  for (const row of inputs.readiness ?? []) {
    if (row.ready || !row.readyDate) continue
    const until = row.readyMinute !== undefined ? absMinute(row.readyDate, row.readyMinute) : absMinute(row.readyDate, shiftStart)
    addBlackout(row.material, { start: absMinute(monday, 0), end: until })
  }

  // ---- 1) talep olayları --------------------------------------------------
  const dailyRows = inputs.dailyDemand ?? []
  const labels = Array.from(new Set(dailyRows.flatMap((r) => r.periods.map((p) => p.label))))
  const parseLabel = (label: string, dmy: boolean): string | null => {
    const m = /(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(String(label).trim())
    if (!m) return null
    let y: number
    let mo: number
    let d: number
    if (m[1]) {
      y = +m[1]
      mo = +m[2]
      d = +m[3]
    } else {
      y = +m[6] < 100 ? +m[6] + 2000 : +m[6]
      d = dmy ? +m[4] : +m[5]
      mo = dmy ? +m[5] : +m[4]
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
    const dt = new Date(Date.UTC(y, mo - 1, d))
    if (dt.getUTCMonth() !== mo - 1) return null
    return dt.toISOString().slice(0, 10)
  }
  let labelDate = new Map<string, string>()
  let bestScore = -1
  for (const dmy of [true, false]) {
    const map = new Map<string, string>()
    let prev = ''
    let ordered = true
    for (const l of labels) {
      const iso = parseLabel(l, dmy)
      if (!iso) continue
      if (iso <= prev) ordered = false
      prev = iso
      map.set(l, iso)
    }
    const score = map.size * (ordered ? 2 : 1)
    if (score > bestScore) {
      labelDate = map
      bestScore = score
    }
  }
  let dailyUntil: string | null = null
  for (const d of labelDate.values()) if (!dailyUntil || d > dailyUntil) dailyUntil = d
  const dailyBy = new Map<string, Map<string, number>>()
  for (const r of dailyRows) {
    const m = dailyBy.get(r.material) ?? new Map<string, number>()
    for (const p of r.periods) {
      const iso = labelDate.get(p.label)
      const q = Math.abs(Number(p.qty) || 0)
      if (iso && q > 0) m.set(iso, (m.get(iso) ?? 0) + q)
    }
    dailyBy.set(r.material, m)
  }
  const weeklyBy = new Map(inputs.weeklyDemand.map((w) => [w.material, w]))
  const events = new Map<string, NeedEvent[]>()
  const addEvent = (material: string, day: string, qty: number) => {
    if (!(qty > 0)) return
    const list = events.get(material) ?? []
    list.push({ at: needMoment(day), qty, day })
    events.set(material, list)
  }
  for (const material of new Set([...weeklyBy.keys(), ...dailyBy.keys()])) {
    const w = weeklyBy.get(material)
    addEvent(material, demandToday, Math.abs(w?.overdue ?? 0))
    const daily = dailyBy.get(material)
    for (let k = 0; k < weeks; k++) {
      const ws = plusDays(monday, 7 * k)
      const we = plusDays(ws, 6)
      const weeklyQty = Math.abs(Number(w?.periods[k]?.qty) || 0)
      const open: string[] = []
      for (let i = 0; i < 7; i++) {
        const d = plusDays(ws, i)
        if (isWorkingDay(d) && d >= demandToday) open.push(d)
      }
      if (!daily || !dailyUntil || dailyUntil < ws) {
        const days = open.length ? open : [demandToday]
        if (weeklyQty > 0) for (const d of days) addEvent(material, d, weeklyQty / days.length)
        continue
      }
      let dailySum = 0
      for (const [d, q] of daily) {
        if (d < ws || d > we || d < demandToday) continue
        addEvent(material, d, q)
        dailySum += q
      }
      if (dailyUntil >= we) continue
      const rest = Math.max(0, weeklyQty - dailySum)
      const uncovered = open.filter((d) => d > dailyUntil!)
      const days = uncovered.length ? uncovered : open.length ? open : [demandToday]
      if (rest > 0) for (const d of days) addEvent(material, d, rest / days.length)
    }
  }
  for (const list of events.values()) list.sort((a, b) => a.at - b.at)

  // ---- 1) arz --------------------------------------------------------------
  const stock0 = new Map<string, number>()
  const otherStock = new Map<string, Map<string, number>>()
  const stockAge = new Map<string, number>()
  const counted = countedLocations(inputs.locations ?? [])
  for (const r of inputs.stock) {
    const loc = r.storageLocation?.trim()
    if (!loc || counted.finished.has(loc)) stock0.set(r.material, (stock0.get(r.material) ?? 0) + (r.unrestricted ?? 0))
    else {
      const m = otherStock.get(r.material) ?? new Map<string, number>()
      m.set(loc, (m.get(loc) ?? 0) + (r.unrestricted ?? 0))
      otherStock.set(r.material, m)
    }
    if (r.uploadedAt) stockAge.set(r.material, Math.max(stockAge.get(r.material) ?? 0, r.uploadedAt))
  }
  const pieces = new Map<string, Piece[]>()
  const pushPiece = (m: string, p: Piece) => {
    if (!(p.qty > 0)) return
    const list = pieces.get(m) ?? []
    list.push(p)
    pieces.set(m, list)
  }
  /** Bir işin çıktısı (ve eşinin) çalışma parçalarına oranla; `from`dan önceki pay t0'da. */
  const addOutput = (a: AJob, material: string, qty: number, countFrom: number | null) => {
    if (!(qty > 0)) return
    const runs = a.runSegs.length ? a.runSegs : a.segs.length ? [{ start: a.end, end: a.end }] : []
    const total = runs.reduce((x, b) => x + (b.end - b.start), 0)
    for (const b of runs) {
      const share = total > 0 ? (qty * (b.end - b.start)) / total : qty / runs.length
      // Stok dosyasından önce üretilen pay zaten MB52'de.
      if (countFrom !== null && b.end <= countFrom) continue
      const s0 = countFrom !== null ? Math.max(b.start, countFrom) : b.start
      const q = b.end > b.start ? (share * (b.end - s0)) / (b.end - b.start) : share
      // Geçmişte kalan pay "şimdi" stokta.
      if (b.end <= nowAbs) pushPiece(material, { start: nowAbs, end: nowAbs, qty: q, frozen: a.frozen, src: a.id })
      else if (s0 < nowAbs) {
        const before = (q * (nowAbs - s0)) / (b.end - s0)
        pushPiece(material, { start: nowAbs, end: nowAbs, qty: before, frozen: a.frozen, src: a.id })
        pushPiece(material, { start: nowAbs, end: b.end, qty: q - before, frozen: a.frozen, src: a.id })
      } else pushPiece(material, { start: s0, end: b.end, qty: q, frozen: a.frozen, src: a.id })
    }
  }
  const coWarnings: string[] = []
  const outputOf = (a: AJob, countFrom: number | null) => {
    addOutput(a, a.material, a.quantity, countFrom)
    const partner = partnerOf.get(a.material)
    if (!partner) return
    const physical = a.shots * cav(partner)
    const claimed = a.job?.coProductQuantity
    if (a.job && !a.frozen && claimed !== undefined && claimed > 0 && Math.abs(claimed - physical) >= cav(partner)) {
      coWarnings.push(`Co-product ${partner} of ${a.material} on ${a.press} ${a.segs[0]?.date ?? ''}: plan says ${claimed} pcs, strokes give ${physical}.`)
    }
    addOutput(a, partner, physical, countFrom)
  }
  const pastSet = new Set(pastSnapshotJobs)
  for (const a of jobs) if (!a.running && !pastSet.has(a)) outputOf(a, null)
  // Önceki günlerin onaylı işleri: stok dosyasından sonra üretilen pay.
  for (const a of pastSnapshotJobs) outputOf(a, uploadAbs ?? nowAbs)
  for (const w of coWarnings.slice(0, 10)) warn(w)

  const producedBy = (list: Piece[], t: number, onlyFrozen = false) => {
    let p = 0
    for (const pc of list) {
      if (onlyFrozen && !pc.frozen) continue
      if (t >= pc.end) p += pc.qty
      else if (t > pc.start) p += (pc.qty * (t - pc.start)) / (pc.end - pc.start)
    }
    return p
  }
  const catchUp = (list: Piece[], base: number, target: number, from: number): number | null => {
    if (base + producedBy(list, from) >= target - QTY_TOL) return from
    const pts = Array.from(new Set(list.flatMap((p) => [p.start, p.end])))
      .filter((x) => x > from)
      .sort((a, b) => a - b)
    let prevT = from
    let prevV = base + producedBy(list, from)
    for (const t of pts) {
      const v = base + producedBy(list, t)
      if (v >= target - QTY_TOL) return v === prevV ? t : prevT + ((target - QTY_TOL - prevV) * (t - prevT)) / (v - prevV)
      prevT = t
      prevV = v
    }
    return null
  }

  // ---- 1) stok yürüyüşü ------------------------------------------------------
  interface SO {
    material: string
    group: string
    at: number
    short: number
    shortHere: number
    recoveredAt: number | null
    cause: 'plan' | 'frozen-timing'
  }
  const stockouts: SO[] = []
  const materialsAll = new Set([...events.keys(), ...pieces.keys()])
  const frozenTotal = new Map<string, number>()
  for (const [m, list] of pieces) frozenTotal.set(m, list.filter((p) => p.frozen).reduce((x, p) => x + p.qty, 0))
  const shortAtEnd = new Map<string, number>()
  for (const material of materialsAll) {
    const list = pieces.get(material) ?? []
    const base = stock0.get(material) ?? 0
    const evs = events.get(material) ?? []
    let cum = 0
    for (let i = 0; i < evs.length; i++) {
      cum += evs[i].qty
      if (i + 1 < evs.length && evs[i + 1].at === evs[i].at) continue
      const t = evs[i].at
      const short = cum - (base + producedBy(list, t))
      if (short <= QTY_TOL) continue
      const rec = catchUp(list, base, cum, t)
      if (rec !== null && rec - t <= MIN_TOL) continue
      let here = 0
      for (let k = i; k >= 0 && evs[k].at === t; k--) here += evs[k].qty
      const nonFrozen = list.filter((p) => !p.frozen)
      const alt = cum - (base + (frozenTotal.get(material) ?? 0) + producedBy(nonFrozen, t))
      stockouts.push({
        material,
        group: groupOf(material),
        at: t,
        short,
        shortHere: Math.min(here, short),
        recoveredAt: rec,
        cause: alt <= QTY_TOL ? 'frozen-timing' : 'plan',
      })
    }
    const totalSupply = base + list.reduce((x, p) => x + p.qty, 0)
    if (cum - totalSupply > QTY_TOL) shortAtEnd.set(material, cum - totalSupply)
  }
  stockouts.sort((a, b) => a.at - b.at)

  // ---- 1) motorla karşılaştırma ---------------------------------------------
  const engineLate = new Map<string, Job[]>()
  for (const j of run.jobs as Job[]) {
    if (!j.late || j.frozen) continue
    const g = groupOf(j.material)
    engineLate.set(g, [...(engineLate.get(g) ?? []), j])
  }
  const unplannedGroups = new Set(run.unplanned.map((u) => groupOf(u.material)))
  const simShort = new Map<string, SO[]>()
  for (const so of stockouts) simShort.set(so.group, [...(simShort.get(so.group) ?? []), so])

  // ---- 2) yapılabilirlik ---------------------------------------------------
  // Presin serbest zamanı: çalışma zamanı − bakım − dondurulmuş/süren işler, şimdiden sonra.
  const free = new Map<string, FreeTime>()
  for (const p of inputs.presses) {
    const fixed = mergeBlocks([
      ...(maintenanceBy.get(p.name) ?? []),
      ...jobs.filter((j) => j.press === p.name && (j.frozen || j.running)).flatMap((j) => j.segs.map((x) => ({ start: x.start, end: x.end }))),
      { start: -1e12, end: nowAbs },
    ])
    free.set(p.name, new FreeTime(subtractBlocks(workingBlocks.get(p.name) ?? [], fixed)))
  }
  const plantUnion = new FreeTime(
    subtractBlocks(mergeBlocks(Array.from(workingBlocks.values()).flat()), [{ start: -1e12, end: nowAbs }]),
  )
  const hallUnion = new Map<string, FreeTime>()
  for (const hall of new Set(inputs.presses.map((p) => p.hall))) {
    hallUnion.set(
      hall,
      new FreeTime(
        subtractBlocks(
          mergeBlocks(inputs.presses.filter((p) => p.hall === hall).flatMap((p) => workingBlocks.get(p.name) ?? [])),
          [{ start: -1e12, end: nowAbs }],
        ),
      ),
    )
  }
  // Şimdi takılı kalıp: presin şimdiden önce başlamış son işi.
  const mountedAt0 = new Map<string, string>()
  for (const p of inputs.presses) {
    const before = [...pastSnapshotJobs, ...jobs.filter((j) => j.frozen || j.running)]
      .filter((j) => j.press === p.name && j.segs.length && j.start <= nowAbs)
      .sort((a, b) => a.start - b.start)
    const last = before[before.length - 1]
    if (last) mountedAt0.set(p.name, last.group)
  }

  /** Gereken adet için en az iş dakikası (setup, onay, rulo değişimi, üretim). */
  const minWork = (g: string, strokes: number, press: string, qPrimary: number) => {
    const p = primaryOf(g)
    if (!p) return 0
    const spm = p.spm && p.spm > 0 ? p.spm : 0
    const theor = spm > 0 ? strokes / spm : 0
    const f = p.performanceFactor && p.performanceFactor > 0 ? Math.min(1, p.performanceFactor) : 1
    const pc = piecesPerCoil(p)
    const feeds = pressByName.get(press)?.feedsCoil !== false
    const coilChanges = feeds && pc > 0 ? Math.max(0, Math.ceil(qPrimary / pc) - 1) : 0
    const setup = mountedAt0.get(press) === g ? 0 : pressSetupOf(p)
    const fullNonProd = (p.setupMinutes ?? 0) + (p.qualityApprovalMinutes ?? 0) + coilChanges * (p.coilSetupMinutes ?? 0)
    const usedNonProd = setup + (p.qualityApprovalMinutes ?? 0) + coilChanges * (p.coilSetupMinutes ?? 0)
    const runMin = f < 1 ? Math.max(theor / f - fullNonProd, theor) : theor
    return runMin + usedNonProd
  }
  /** Grubun t anına kadar YENİ üretimden gereken payı: vuruş ve asıl ürün adedi. */
  const needByNewProduction = (g: string, t: number) => {
    let strokes = 0
    let qPrimary = 0
    let qty = 0
    const primary = primaryOf(g)
    for (const m of membersOf(g)) {
      const evs = events.get(m) ?? []
      let cum = 0
      for (const e of evs) if (e.at <= t) cum += e.qty
      const list = pieces.get(m) ?? []
      const fixedSupply = (stock0.get(m) ?? 0) + producedBy(list.filter((p) => p.frozen || p.start <= nowAbs), t)
      const q = Math.max(0, cum - fixedSupply)
      strokes = Math.max(strokes, Math.ceil(q / cav(m)))
      if (m === primary?.code) qPrimary = q
      qty = Math.max(qty, q)
    }
    return { strokes, qPrimary: qPrimary || qty, qty }
  }
  // Her grubun ilk yeni üretim ihtiyacı (aile testleri için).
  interface FirstNeed {
    group: string
    at: number
    strokes: number
    qPrimary: number
    qty: number
    presses: string[]
  }
  const firstNeed = new Map<string, FirstNeed>()
  const groupsAll = new Set(Array.from(materialsAll).map(groupOf))
  for (const g of groupsAll) {
    const moments = Array.from(new Set(membersOf(g).flatMap((m) => (events.get(m) ?? []).map((e) => e.at)))).sort((a, b) => a - b)
    for (const t of moments) {
      const need = needByNewProduction(g, t)
      if (need.qty > QTY_TOL) {
        firstNeed.set(g, { group: g, at: t, ...need, presses: eligibleOf(g) })
        break
      }
    }
  }
  const minWorkBest = (fn: FirstNeed) =>
    fn.presses.length ? Math.min(...fn.presses.map((p) => minWork(fn.group, fn.strokes, p, fn.qPrimary))) : 0

  // Tek presli ailelerde Moore–Hodgson: en az kaç ihtiyaç geç kalır.
  interface PressFamily {
    minLate: number
    members: Set<string>
    rejected: Set<string>
    overload: number
    planLate: number
  }
  const pressFamilies = new Map<string, PressFamily>()
  for (const p of inputs.presses) {
    const ft = free.get(p.name)!
    const items = Array.from(firstNeed.values())
      .filter((fn) => fn.presses.length === 1 && fn.presses[0] === p.name && !excluded.has(fn.group))
      .map((fn) => ({ g: fn.group, p: minWork(fn.group, fn.strokes, p.name, fn.qPrimary), d: ft.before(fn.at) - ft.before(nowAbs) }))
    const { rejected, overload } = mooreHodgson(items)
    const members = new Set(items.map((i) => i.g))
    const planLate = Array.from(members).filter((g) => simShort.has(g)).length
    pressFamilies.set(p.name, { minLate: rejected.size, members, rejected, overload: Math.max(0, overload), planLate })
  }

  // Hol / fabrika setup sınırı, teslim anına göre birikimli.
  const needsSetup = (fn: FirstNeed) => !fn.presses.some((p) => mountedAt0.get(p) === fn.group)
  const setupOf = (g: string) => primaryOf(g)?.setupMinutes ?? 0
  /**
   * Setup'ın en geç bitmesi gereken an: ondan sonra onay + gereken üretim hâlâ
   * teslimden önce bitebilmeli. Uygun preslerden en cömert olanı alınır.
   */
  const setupDeadline = (fn: FirstNeed): number => {
    let best = -Infinity
    for (const p of fn.presses) {
      const ft = free.get(p)!
      const after = minWork(fn.group, fn.strokes, p, fn.qPrimary) - (mountedAt0.get(p) === fn.group ? 0 : setupOf(fn.group))
      const t = ft.timeAt(ft.before(fn.at) - after)
      if (t !== null) best = Math.max(best, Math.min(t, fn.at))
    }
    return best
  }
  interface CrewFamily {
    minLate: number
    members: Set<string>
    overload: number
    planLate: number
    label: string
  }
  const crewNeeds = Array.from(firstNeed.values()).filter((fn) => needsSetup(fn) && fn.presses.length > 0 && !excluded.has(fn.group))
  const crewFamily = (list: FirstNeed[], axis: FreeTime, per: (fn: FirstNeed) => number, label: string): CrewFamily => {
    const items = list.map((fn) => {
      const dl = setupDeadline(fn)
      return { g: fn.group, p: per(fn), d: Number.isFinite(dl) ? axis.between(nowAbs, dl) : -1 }
    })
    const { rejected, overload } = mooreHodgson(items)
    const members = new Set(list.map((fn) => fn.group))
    return { minLate: rejected.size, members, overload, planLate: Array.from(members).filter((g) => simShort.has(g)).length, label }
  }
  // Fabrika: aynı anda en fazla `plantUrgentCap` setup (gevşetme: hız × cap).
  const plantCrew = crewFamily(crewNeeds, plantUnion, (fn) => setupOf(fn.group) / plantUrgentCap, 'plant')
  // Hol: bütün presleri o holde olan parçalar, setup + ara süre.
  const hallCrews = new Map<string, CrewFamily>()
  for (const hall of new Set(inputs.presses.map((p) => p.hall))) {
    const list = crewNeeds.filter((fn) => fn.presses.every((p) => hallOf(p) === hall))
    if (!list.length) continue
    // Geç kalma riski olan işler acil sayılır ve holde çakışabilir: gevşetme,
    // ara süresiz ve acil sınırıyla (alt sınır geçerli kalsın).
    hallCrews.set(hall, crewFamily(list, hallUnion.get(hall)!, (fn) => setupOf(fn.group) / hallUrgentCap, hall))
  }
  const pressLB = Array.from(pressFamilies.values()).reduce((x, f) => x + f.minLate, 0)
  const hallLB = Array.from(hallCrews.values()).reduce((x, f) => x + f.minLate, 0)
  const lateLowerBound = Math.max(pressLB, plantCrew.minLate, hallLB)

  // Boşluk testi için plan işleri ve kurulum kayıtları.
  const hallSetupsAll = new Map<string, Block[]>()
  const hallCoilsAll = new Map<string, Block[]>()
  const plantSetups: Block[] = []
  for (const j of jobs) {
    hallSetupsAll.set(j.hall, [...(hallSetupsAll.get(j.hall) ?? []), ...j.setupSegs])
    hallCoilsAll.set(j.hall, [...(hallCoilsAll.get(j.hall) ?? []), ...j.coilSegs])
    plantSetups.push(...j.setupSegs)
  }

  const feasibilityOf = (g: string, so: SO): FeasibilityResult => {
    const presses = eligibleOf(g)
    const need = needByNewProduction(g, so.at)
    const T = so.at
    if (presses.length === 0) {
      return {
        verdict: 'capacity-proven',
        test: 'alone',
        gapMinutes: 0,
        needQty: round1(need.qty),
        needMinutes: 0,
        reason: 'No eligible press in the plan (main press missing, or alternatives without Flexible press).',
      }
    }
    // a) Tek başına en iyi preste.
    let best: { press: string; w: number; cap: number } | null = null
    for (const p of presses) {
      const w = minWork(g, need.strokes, p, need.qPrimary)
      const cap = free.get(p)!.between(nowAbs, T)
      if (!best || cap - w > best.cap - best.w) best = { press: p, w, cap }
    }
    const b = best!
    if (b.w > b.cap + MIN_TOL) {
      return {
        verdict: 'capacity-proven',
        test: 'alone',
        gapMinutes: Math.round(b.w - b.cap),
        needQty: round1(need.qty),
        needMinutes: Math.round(b.w),
        reason: `Even alone on ${b.press} it needs ${hours(b.w)} h before ${labelOfAbs(T)}; only ${hours(b.cap)} h of free press time is left.`,
      }
    }
    // b) Tek presli aile: Moore–Hodgson.
    if (presses.length === 1) {
      const fam = pressFamilies.get(presses[0])
      if (fam && fam.members.has(g) && fam.minLate > 0 && fam.planLate <= fam.minLate) {
        return {
          verdict: 'capacity-proven',
          test: 'press-load',
          gapMinutes: Math.round(fam.overload),
          needQty: round1(need.qty),
          needMinutes: Math.round(b.w),
          reason: `${presses[0]} is overloaded: at least ${fam.minLate} of its ${fam.members.size} single-press parts must be late (${hours(fam.overload)} h short); the plan has ${fam.planLate}.`,
        }
      }
    }
    // c) Çok presli aile: birleşik yük (Hall koşulu).
    const S = new Set(presses)
    const family = Array.from(firstNeed.values()).filter((fn) => fn.at <= T && fn.presses.length > 0 && fn.presses.every((p) => S.has(p)))
    const load = family.reduce((x, fn) => x + minWorkBest(fn), 0)
    const cap = presses.reduce((x, p) => x + free.get(p)!.between(nowAbs, T), 0)
    const familyLate = family.filter((fn) => simShort.has(fn.group)).length
    if (load > cap + MIN_TOL && familyLate <= 1) {
      return {
        verdict: 'capacity-proven',
        test: 'pooled-load',
        gapMinutes: Math.round(load - cap),
        needQty: round1(need.qty),
        needMinutes: Math.round(b.w),
        reason: `Presses ${presses.join('/')} need ${hours(load)} h for ${family.length} parts due by ${labelOfAbs(T)} but have ${hours(cap)} h; at least one must be late.`,
      }
    }
    // d) Setup ekibi: fabrika ve hol (Moore–Hodgson, sayı alt sınırı).
    const hall = hallOf(presses[0])
    const hallCrew = presses.every((p) => hallOf(p) === hall) ? hallCrews.get(hall) : undefined
    for (const [fam, test] of [[plantCrew, 'setup-crew'], [hallCrew, 'hall-crew']] as const) {
      if (!fam || !fam.members.has(g) || fam.minLate === 0 || fam.planLate > fam.minLate) continue
      return {
        verdict: 'capacity-proven',
        test,
        gapMinutes: Math.round(fam.overload),
        needQty: round1(need.qty),
        needMinutes: Math.round(b.w),
        reason:
          test === 'setup-crew'
            ? `Setup crew (${plantUrgentCap} at once): at least ${fam.minLate} of ${fam.members.size} dies needing a setup cannot be set up in time; the plan has ${fam.planLate} late.`
            : `Hall ${hall} crane (${hallUrgentCap} setups at a time for late-risk work): at least ${fam.minLate} of ${fam.members.size} dies must be late; the plan has ${fam.planLate}.`,
      }
    }
    // e) Tanık: geç lot, uygun bir preste teslimden önceki boşluğa sığıyor mu?
    const witness = idleGapWitness(g, T, presses)
    if (witness) {
      return {
        verdict: 'avoidable',
        test: 'idle-gap',
        gapMinutes: Math.round(witness.spare),
        needQty: round1(need.qty),
        needMinutes: Math.round(b.w),
        reason: witness.reason,
      }
    }
    const fam = presses.length === 1 ? pressFamilies.get(presses[0]) : undefined
    return {
      verdict: 'undecided',
      test: 'none',
      gapMinutes: Math.round(b.cap - b.w),
      needQty: round1(need.qty),
      needMinutes: Math.round(b.w),
      reason:
        `Bounds pass: alone on ${b.press} it would need ${hours(b.w)} h of ${hours(b.cap)} h free before ${labelOfAbs(T)}` +
        (fam ? `; ${presses[0]} must have ≥ ${fam.minLate} late, plan has ${fam.planLate}` : '') +
        '; no idle gap fits the lot without moving other jobs.',
    }
  }

  function idleGapWitness(g: string, T: number, presses: string[]): { spare: number; reason: string } | null {
    const lots = planJobs
      .filter((j) => j.group === g && j.end > T && j.segs.length > 0)
      .sort((a, b) => a.start - b.start)
    const J = lots[0]
    if (!J) return null
    const oldList = jobsByPress.get(J.press) ?? []
    const oldNext = oldList[oldList.indexOf(J) + 1]
    if (oldNext && oldNext.group === g && oldNext.setupSegs.length === 0) return null
    const product = primaryOf(g)
    // Lotun tamamı (bağlanan rulo yarıda kesilmez): mevcut parçaları + gerekirse setup.
    const lotWork = J.segs.reduce((x, sg) => x + (sg.end - sg.start), 0) + (J.setupSegs.length ? 0 : product?.setupMinutes ?? 0)
    // Bu lottan T'ye kadar gereken pay: diğer arz çıkarılır.
    let strokes = 0
    let qPrimary = 0
    for (const m of membersOf(g)) {
      let cum = 0
      for (const e of events.get(m) ?? []) if (e.at <= T) cum += e.qty
      const others = (pieces.get(m) ?? []).filter((p) => p.src !== J.id)
      const q = Math.max(0, cum - (stock0.get(m) ?? 0) - producedBy(others, T))
      strokes = Math.max(strokes, Math.ceil(q / cav(m)))
      if (m === product?.code) qPrimary = q
    }
    for (const press of presses) {
      const ft = free.get(press)!
      const list = (jobsByPress.get(press) ?? []).filter((j) => j !== J)
      const bounds: { from: number; to: number; prev: AJob | null; next: AJob | null }[] = []
      let cursor = nowAbs
      let prev: AJob | null = null
      for (const j of list) {
        if (j.end <= nowAbs) {
          prev = j
          continue
        }
        if (j.start > cursor) bounds.push({ from: cursor, to: j.start, prev, next: j })
        cursor = Math.max(cursor, j.end)
        prev = j
      }
      bounds.push({ from: cursor, to: T, prev, next: null })
      for (const gap of bounds) {
        if (gap.from >= T) continue
        if (gap.next && gap.prev && gap.next.group === gap.prev.group && gap.next.setupSegs.length === 0 && gap.next.group !== g) continue
        const mounted = gap.prev ? gap.prev.group === g : mountedAt0.get(press) === g
        const setup = mounted ? 0 : product?.setupMinutes ?? 0
        const start = ft.reach(gap.from, 0.0001)
        if (start === null || start >= gap.to) continue
        const needW = minWork(g, strokes, press, qPrimary) - (mountedAt0.get(press) === g ? 0 : pressSetupOf(product)) + setup
        const readyAt = ft.reach(gap.from, needW)
        if (readyAt === null || readyAt > T + MIN_TOL) continue
        const whole = lotWork - (J.setupSegs.length && mounted ? product?.setupMinutes ?? 0 : 0)
        const endAt = ft.reach(gap.from, whole)
        if (gap.next && (endAt === null || endAt > gap.next.start + EPS)) continue
        if (endAt === null) continue
        // Vinç: hol ve fabrika kurulumları.
        if (setup > 0) {
          const hall = hallOf(press)
          const s0 = start
          const s1 = start + setup
          const hallBusy = (hallSetupsAll.get(hall) ?? []).filter((b) => b.start < s1 + setupGap && s0 < b.end + setupGap).length
          const coilBusy = (hallCoilsAll.get(hall) ?? []).some((b) => b.start < s1 && s0 < b.end)
          const plantBusy = plantSetups.filter((b) => b.start < s1 && s0 < b.end).length
          if (hallBusy >= hallUrgentCap || coilBusy || plantBusy >= plantUrgentCap) continue
        }
        // Kalıp başka preste mi, kapalı mı?
        const dieBusy = jobs.some((j) => j !== J && j.group === g && j.press !== press && j.start < endAt && start < j.end)
        if (dieBusy) continue
        const blocked = membersOf(g).some((m) => (blackoutBy.get(m) ?? []).some((bl) => bl.start < endAt && start < bl.end))
        if (blocked) continue
        return {
          spare: T - readyAt,
          reason: `The ${J.quantity}-pc lot (${hours(whole)} h) fits into the idle time on ${press} from ${labelOfAbs(start)}` +
            ` (crane and die free); the needed ${Math.round(qPrimary)} pcs would be ready ${labelOfAbs(readyAt)}, before ${labelOfAbs(T)}.`,
        }
      }
    }
    return null
  }

  // ---- 1+2) malzeme hükümleri ----------------------------------------------
  const dataFlagsOf = (g: string, firstShort: number): string[] => {
    const flags: string[] = []
    for (const m of membersOf(g)) {
      const other = otherStock.get(m)
      if (other) {
        const total = Array.from(other.values()).reduce((a, b) => a + b, 0)
        const where = Array.from(other.entries()).map(([l, q]) => `${l} ${Math.round(q)}`).join(', ')
        if (total >= firstShort - QTY_TOL && total > 0) flags.push(`${m}: stock in non-counted locations (${where}) would cover the ${Math.round(firstShort)} pcs short — only locations ticked "Finished goods" on Storage Locations count.`)
        else if (total > 0) flags.push(`${m}: ${Math.round(total)} pcs in non-counted locations (${where}).`)
      }
      const w = weeklyBy.get(m)
      if (w) {
        const pos = [(w.overdue ?? 0) > 0 ? `overdue +${w.overdue}` : '', ...w.periods.filter((p) => Number(p.qty) > 0).map((p) => `${p.label} +${p.qty}`)].filter(Boolean)
        if (pos.length) flags.push(`${m}: ZPP has positive quantities (${pos.slice(0, 3).join(', ')}) — counted as demand.`)
        const backlog = Math.abs(w.overdue ?? 0)
        const st = stock0.get(m) ?? 0
        if (backlog > 0 && backlog <= st) flags.push(`${m}: backlog ${Math.round(backlog)} ≤ stock ${Math.round(st)} in 2009/1009 — check whether it has already shipped.`)
      }
      const daily = inputs.dailyDemand?.find((d) => d.material === m)
      if (daily?.periods.some((p) => Number(p.qty) > 0)) flags.push(`${m}: ZPP_DAILY has positive quantities — counted as demand.`)
      if (!inputs.stock.some((r) => r.material === m) && (events.get(m)?.length ?? 0) > 0) flags.push(`${m}: no MB52 stock row — stock 0 assumed.`)
      const up = stockAge.get(m)
      if (up && nowMs - up > 3 * 86_400_000) flags.push(`${m}: stock file is ${Math.floor((nowMs - up) / 86_400_000)} days old.`)
      const p = productBy.get(m)
      if (!p) flags.push(`${m}: no master data record.`)
    }
    const primary = primaryOf(g)
    if (primary) {
      if (!(primary.spm && primary.spm > 0)) flags.push(`${primary.code}: no SPM in master data.`)
      if (!primary.mainMachine?.trim()) flags.push(`${primary.code}: no main press in master data.`)
      if (!((primary.minLotQty ?? 0) > 0) && piecesPerCoil(primary) <= 0) flags.push(`${primary.code}: no Min. lot and no real coil weight — lot size unknown.`)
    }
    return flags
  }

  const verdicts: MaterialVerdict[] = []
  const groupsToJudge = new Set([...simShort.keys(), ...engineLate.keys()])
  for (const g of groupsToJudge) {
    const sos = simShort.get(g) ?? []
    const late = engineLate.get(g) ?? []
    let verdict: MaterialVerdictKind
    if (sos.length && late.length) verdict = 'agree'
    else if (sos.length && unplannedGroups.has(g)) verdict = 'explained-unplanned'
    else if (sos.length && sos.every((x) => x.cause === 'frozen-timing')) verdict = 'frozen-late'
    else if (sos.length) verdict = 'engine-missed'
    else verdict = 'engine-false-late'
    const first = sos[0] ?? null
    const firstLate = [...late].sort((a, b) =>
      (a.deadlineDate ?? a.dueDate).localeCompare(b.deadlineDate ?? b.dueDate) || (a.deadlineMinute ?? 0) - (b.deadlineMinute ?? 0),
    )[0]
    const engineDeadline =
      firstLate && firstLate.deadlineDate && firstLate.deadlineMinute !== undefined
        ? labelOfAbs(netPointToAbs(firstLate.deadlineDate, firstLate.deadlineMinute, 3))
        : firstLate?.deadlineLabel ?? null
    const lateH = sos.reduce<number | null>((mx, x) => {
      if (x.recoveredAt === null) return mx
      const h = (x.recoveredAt - x.at) / 60
      return mx === null || h > mx ? h : mx
    }, null)
    verdicts.push({
      group: g,
      materials: membersOf(g),
      verdict,
      firstShortAt: first ? labelOfAbs(first.at) : null,
      shortQty: first ? round1(first.short) : 0,
      stockouts: sos.length,
      lateHours: lateH === null ? null : round1(lateH),
      engineLateJobs: late.length,
      engineDeadline,
      feasibility: first ? feasibilityOf(g, first) : null,
      dataFlags: first ? dataFlagsOf(g, first.short).slice(0, 6) : [],
    })
  }
  const verdictRank: Record<MaterialVerdictKind, number> = {
    'engine-missed': 0,
    'engine-false-late': 1,
    'frozen-late': 2,
    'explained-unplanned': 3,
    agree: 4,
  }
  verdicts.sort((a, b) => verdictRank[a.verdict] - verdictRank[b.verdict] || a.group.localeCompare(b.group))

  // ---- 3) verimlilik -------------------------------------------------------
  const windowStart = nowAbs
  const windowEnd = nowAbs + UTIL_WINDOW_DAYS * 1440
  const windowEndDay = isoOf(Math.floor(windowEnd / 1440))
  const within = (list: Block[], a = windowStart, b = windowEnd) =>
    list.reduce((x, bl) => x + Math.max(0, Math.min(b, bl.end) - Math.max(a, bl.start)), 0)
  // Grubun ufuktaki yeni üretim ihtiyacı ve penceredeki yasal işi.
  interface GroupWork {
    group: string
    presses: string[]
    allowedFrom: number
    windowRun: number
    needsNew: boolean
  }
  const groupWork = new Map<string, GroupWork>()
  for (const g of groupsAll) {
    const fn = firstNeed.get(g)
    const presses = eligibleOf(g)
    if (!fn || excluded.has(g)) {
      groupWork.set(g, { group: g, presses, allowedFrom: Infinity, windowRun: 0, needsNew: false })
      continue
    }
    const firstDay = isoOf(Math.floor(fn.at / 1440))
    const allowedDay = plusDays(backWorkingDays(firstDay, safetyDays), -pullForwardDays)
    const allowedFrom = Math.max(nowAbs, absMinute(allowedDay, shiftStart))
    // Pencerede başlayabilecek ihtiyaçlar: ihtiyaç günü − emniyet − öne çekme ≤ pencere sonu.
    const lastDay = plusDays(windowEndDay, pullForwardDays + safetyDays + 2)
    const moments = Array.from(new Set(membersOf(g).flatMap((m) => (events.get(m) ?? []).map((e) => e.at))))
      .filter((t) => t <= absMinute(lastDay, cutoff))
      .sort((a, b) => a - b)
    const tLast = moments[moments.length - 1] ?? fn.at
    const need = needByNewProduction(g, tLast)
    const p = primaryOf(g)
    const unit = coilUnit(p)
    const strokes = unit > 0 ? Math.ceil(need.qPrimary / unit) * Math.floor(unit / cav(p!.code)) : need.strokes
    const spm = p?.spm && p.spm > 0 ? p.spm : 0
    const f = p?.performanceFactor && p.performanceFactor > 0 ? Math.min(1, p.performanceFactor) : 1
    const windowRun = spm > 0 && allowedFrom < windowEnd ? Math.max(strokes, need.strokes) / spm / f : 0
    groupWork.set(g, { group: g, presses, allowedFrom, windowRun, needsNew: true })
  }
  const perPress: PressEfficiency[] = []
  let capTotal = 0
  let runTotal = 0
  let idleNoWork = 0
  let idleNotReleased = 0
  let idleLeft = 0
  let idleCrew = 0
  for (const p of inputs.presses) {
    const working = subtractBlocks(workingBlocks.get(p.name) ?? [], maintenanceBy.get(p.name) ?? [])
    const cap = within(working)
    const pj = jobs.filter((j) => j.press === p.name)
    const runMin = within(mergeBlocks(pj.flatMap((j) => j.runSegs)))
    const busy = mergeBlocks(pj.flatMap((j) => j.segs.map((x) => ({ start: x.start, end: x.end }))))
    const frozenRun = within(mergeBlocks(pj.filter((j) => j.frozen || j.running).flatMap((j) => j.runSegs)))
    const eligible = Array.from(groupWork.values()).filter((w) => w.needsNew && w.presses.includes(p.name))
    const ub = Math.min(cap, frozenRun + eligible.reduce((x, w) => x + w.windowRun, 0))
    // Boşta kalan zaman, gün gün nedeniyle.
    const idleBlocks = subtractBlocks(working, busy)
    let noWork = 0
    let notReleased = 0
    let left = 0
    let crewWait = 0
    const otherSetups = mergeBlocks(jobs.filter((j) => j.press !== p.name).flatMap((j) => j.setupSegs))
    for (const bl of idleBlocks) {
      const a = Math.max(windowStart, bl.start)
      const b = Math.min(windowEnd, bl.end)
      if (b <= a) continue
      const len = b - a
      if (eligible.length === 0) noWork += len
      else {
        const released = eligible.filter((w) => w.allowedFrom <= a + EPS)
        const couldFill = released.some(
          (w) => simShort.has(w.group) || planJobs.some((j) => j.group === w.group && j.start >= b - EPS),
        )
        if (released.length === 0) notReleased += len
        else if (couldFill) {
          const busyCrew = within(otherSetups, a, b)
          crewWait += busyCrew
          left += len - busyCrew
        }
        else noWork += len
      }
    }
    const setupsPlan = planJobs.filter((j) => j.press === p.name && j.setupSegs.length > 0).length
    const single = Array.from(firstNeed.values()).filter((fn) => fn.presses.length === 1 && fn.presses[0] === p.name && !excluded.has(fn.group))
    const setupsLB = Math.max(0, single.length - (single.some((fn) => mountedAt0.get(p.name) === fn.group) ? 1 : 0))
    capTotal += cap
    runTotal += runMin
    idleNoWork += noWork
    idleNotReleased += notReleased
    idleLeft += left
    idleCrew += crewWait
    perPress.push({
      press: p.name,
      setupsPlan,
      setupsLowerBound: setupsLB,
      capacityHours: hours(cap),
      runHours: hours(runMin),
      utilisation: cap > 0 ? round1((runMin / cap) * 100) : 0,
      upperBound: cap > 0 ? round1((ub / cap) * 100) : 0,
      idleHours: hours(noWork + notReleased + left + crewWait),
      idleNoWork: hours(noWork),
      idleNotReleased: hours(notReleased),
      idleWaitingCrew: hours(crewWait),
      idleLeft: hours(left),
    })
  }
  const needing = Array.from(firstNeed.values()).filter((fn) => !excluded.has(fn.group))
  const mountedNeeded = new Set(inputs.presses.map((p) => mountedAt0.get(p.name)).filter((g): g is string => !!g && firstNeed.has(g)))
  const setupsLowerBound = Math.max(0, needing.length - mountedNeeded.size)
  const setupsPlan = planJobs.filter((j) => j.setupSegs.length > 0).length
  const frozenRunAll = jobs.filter((j) => j.frozen || j.running).reduce((x, j) => x + within(j.runSegs), 0)
  const workAll = Array.from(groupWork.values()).reduce((x, w) => x + (w.presses.length ? w.windowRun : 0), 0)
  const ubPlant = Math.min(
    capTotal,
    frozenRunAll + workAll,
    perPress.reduce((x, p) => x + (p.upperBound / 100) * p.capacityHours * 60, 0),
  )
  const efficiency: EfficiencyReport = {
    windowDays: UTIL_WINDOW_DAYS,
    setups: { plan: setupsPlan, lowerBound: setupsLowerBound },
    utilisation: {
      capacityHours: hours(capTotal),
      runHours: hours(runTotal),
      plan: capTotal > 0 ? round1((runTotal / capTotal) * 100) : 0,
      upperBound: capTotal > 0 ? round1((ubPlant / capTotal) * 100) : 0,
    },
    idleHours: { noWork: hours(idleNoWork), notReleased: hours(idleNotReleased), waitingCrew: hours(idleCrew), leftIdle: hours(idleLeft) },
    perPress,
  }

  // ---- 4) kesin kurallar ----------------------------------------------------
  const rules: RuleCheck[] = []
  const rule = (id: string, label: string) => {
    const r: RuleCheck = { id, label, checked: 0, broken: 0, examples: [] }
    rules.push(r)
    return {
      check: (n = 1) => {
        r.checked += n
      },
      fail: (text: string) => {
        r.broken += 1
        if (r.examples.length < MAX_EXAMPLES) r.examples.push(text)
      },
    }
  }
  const at = (t: number) => labelOfAbs(t)
  const overlap = (a: Block, b: Block) => Math.min(a.end, b.end) - Math.max(a.start, b.start)

  // R1 pres çakışması (süren onaylı işler ve bakım dahil)
  const r1 = rule('press-overlap', 'A press runs one job at a time (incl. jobs still running from earlier days and maintenance)')
  for (const [press, list] of jobsByPress) {
    const items = [
      ...list.flatMap((j) => j.segs.map((x) => ({ start: x.start, end: x.end, id: j.id, j }))),
      ...(maintenanceBy.get(press) ?? []).map((b) => ({ start: b.start, end: b.end, id: `maintenance ${press}`, j: null as AJob | null })),
    ].sort((a, b) => a.start - b.start)
    let reach: (typeof items)[number] | null = null
    for (const it of items) {
      r1.check()
      if (reach && reach.id !== it.id && reach.end > it.start + EPS && !(reach.j?.frozen && it.j?.frozen)) {
        r1.fail(`${press}: ${reach.id} and ${it.id} overlap at ${at(it.start)} (${Math.round(Math.min(reach.end, it.end) - it.start)} min).`)
      }
      if (!reach || it.end > reach.end) reach = it
    }
  }

  // R2 kalıp iki preste
  const r2 = rule('mould-twice', 'A mould is on one press at a time (a job holds its die from first to last segment)')
  const byGroup = new Map<string, AJob[]>()
  for (const j of jobs) if (j.segs.length) byGroup.set(j.group, [...(byGroup.get(j.group) ?? []), j])
  for (const [g, list] of byGroup) {
    list.sort((a, b) => a.start - b.start)
    for (let i = 0; i < list.length; i++) {
      r2.check()
      for (let k = i + 1; k < list.length && list[k].start < list[i].end; k++) {
        if (list[k].press !== list[i].press && overlap(list[i], list[k]) > EPS && !(list[i].frozen && list[k].frozen)) {
          r2.fail(`${g}: on ${list[i].press} (${at(list[i].start)}–${at(list[i].end)}) and ${list[k].press} from ${at(list[k].start)}.`)
        }
      }
    }
  }

  // R3 hol vinci: normal işte tek kalıp setup'ı, aralıklar, rulo değişimi.
  // Acil (bakiye / geç risk) setup holdeki bir setup'la çakışabilir; onun
  // sınırı R4'teki fabrika geneli acil sınırıdır (kullanıcı kararı).
  const r3 = rule(
    'crane-hall',
    `Hall crane: ≤ ${hallConcurrent} mould setup at a time for normal jobs (backlog / late-risk setups may overlap up to the plant-wide limit), ${setupGap} min between setups, ${coilGap} min between coil changes, setup and coil change never together`,
  )
  const urgentJobIds = new Set(jobs.filter((j) => j.job?.urgentSetup || j.job?.phase === 'backlog').map((j) => j.id))
  const hallItems = new Map<string, { kind: 'mold' | 'coil'; start: number; end: number; id: string; frozen: boolean; urgent?: boolean }[]>()
  for (const j of jobs) {
    const list = hallItems.get(j.hall) ?? []
    for (const b of j.setupSegs) list.push({ kind: 'mold', start: b.start, end: b.end, id: j.id, frozen: j.frozen || j.running, urgent: urgentJobIds.has(j.id) })
    for (const b of j.coilSegs) list.push({ kind: 'coil', start: b.start, end: b.end, id: j.id, frozen: j.frozen || j.running })
    hallItems.set(j.hall, list)
  }
  for (const [hall, list] of hallItems) {
    list.sort((a, b) => a.start - b.start)
    for (let i = 0; i < list.length; i++) {
      const a = list[i]
      r3.check()
      let sameCount = 0
      for (let k = 0; k < list.length; k++) {
        if (k === i) continue
        const b = list[k]
        if (a.frozen && b.frozen) continue
        if (b.start > a.end + Math.max(setupGap, coilGap)) {
          if (k > i) break
          continue
        }
        if (a.kind === b.kind) {
          if (a.kind === 'mold' && (a.urgent || b.urgent)) continue
          const gap = a.kind === 'mold' ? setupGap : coilGap
          if (b.start < a.end + gap - EPS && a.start < b.end + gap - EPS) {
            if (a.kind === 'mold') sameCount++
            else if (k > i && b.id !== a.id) r3.fail(`Hall ${hall}: coil changes ${a.id} and ${b.id} less than ${coilGap} min apart at ${at(b.start)}.`)
            else if (k > i && b.id === a.id && b.start < a.end + gap - EPS) r3.fail(`Hall ${hall}: coil changes of ${a.id} less than ${coilGap} min apart at ${at(b.start)}.`)
          }
        } else if (k > i && overlap(a, b) > EPS) {
          r3.fail(`Hall ${hall}: mould setup and coil change at the same time (${a.id} / ${b.id}) at ${at(Math.max(a.start, b.start))}.`)
        }
      }
      if (a.kind === 'mold' && sameCount >= hallConcurrent) {
        r3.fail(`Hall ${hall}: ${sameCount + 1} mould setups within ${setupGap} min of each other around ${at(a.start)} (${a.id}).`)
      }
    }
  }

  // R4 fabrika geneli setup sınırı
  const r4 = rule('plant-setups', `Plant-wide ≤ ${plantNormalCap} mould setup at once (≤ ${plantUrgentCap} with backlog/late-risk jobs)`)
  const urgentIds = urgentJobIds
  const plantList = jobs.flatMap((j) => j.setupSegs.map((b) => ({ ...b, id: j.id, fixed: j.frozen || j.running }))).sort((a, b) => a.start - b.start)
  for (let i = 0; i < plantList.length; i++) {
    r4.check()
    const a = plantList[i]
    const concurrent = plantList.filter((b) => b !== a && overlap(a, b) > EPS && b.start <= a.start)
    if (concurrent.length === 0 || (a.fixed && concurrent.every((c) => c.fixed))) continue
    const n = concurrent.length + 1
    const urgent = urgentIds.has(a.id) || concurrent.some((c) => urgentIds.has(c.id))
    const cap = urgent ? plantUrgentCap : plantNormalCap
    if (n > cap) r4.fail(`${n} mould setups at once at ${at(a.start)} (${[a.id, ...concurrent.map((c) => c.id)].join(', ')}); limit ${cap}.`)
  }

  // R5 uygun pres
  const r5 = rule('eligible-press', 'Non-flexible parts only on their main press (or the pinned press); flexible parts only on main/alternatives')
  for (const j of planJobs) {
    r5.check()
    const allowed = eligibleOf(j.group)
    const pinned = pins.get(j.material)
    if (!allowed.includes(j.press) && pinned !== j.press) {
      r5.fail(`${j.id}: ${j.press} is not allowed (allowed: ${allowed.join(', ') || 'none'}).`)
    }
  }

  // R6 çalışma zamanı, bakım, kalıp kapalılığı, geçmiş
  const r6 = rule('working-time', 'Work only in working time: no day without shifts or overtime, not beyond the day capacity, not in the past, not in maintenance or a mould blackout')
  for (const j of planJobs) {
    for (const sg of j.segs) {
      r6.check()
      const info = dayInfo.get(`${j.press}|${sg.date}`)
      if (!info || (info.shifts <= 0 && info.overtime.length === 0)) {
        r6.fail(`${j.id}: ${sg.kind} on ${sg.date}, a non-working day for ${j.press}.`)
        continue
      }
      if (sg.netEnd > info.netCap + 0.5) r6.fail(`${j.id}: ${sg.kind} ends at net ${Math.round(sg.netEnd)} on ${sg.date}; the day has ${info.netCap} net min.`)
      if (sg.start < nowAbs - MIN_TOL) r6.fail(`${j.id}: ${sg.kind} at ${at(sg.start)} is in the past.`)
      const m = (maintenanceBy.get(j.press) ?? []).find((b) => overlap(b, sg) > EPS)
      if (m) r6.fail(`${j.id}: ${sg.kind} overlaps maintenance on ${j.press} at ${at(Math.max(m.start, sg.start))}.`)
      const bl = membersOf(j.group).flatMap((mm) => blackoutBy.get(mm) ?? []).find((b) => overlap(b, sg) > EPS)
      if (bl) r6.fail(`${j.id}: die not available (maintenance / not ready) at ${at(Math.max(bl.start, sg.start))}.`)
    }
  }

  // R7 setup gün sınırını (ve gerekiyorsa vardiya sınırını) aşmaz
  const r7 = rule('setup-in-day', setupsCrossShifts ? 'A setup or coil change does not cross the end of the production day' : 'A setup or coil change does not cross a shift change')
  const shiftNet = stopsByShift.map((st) => Math.max(1, shiftLen - st))
  for (const j of planJobs) {
    // Gün sınırını aşan setup, aynı türden ardışık iki parça olarak farklı günlere düşer.
    const raw = j.job?.segments ?? []
    for (let i = 0; i < raw.length; i++) {
      const sg = raw[i]
      if (sg.kind !== 'setup' && sg.kind !== 'coil') continue
      r7.check()
      const nextSeg = raw[i + 1]
      if (nextSeg && nextSeg.kind === sg.kind && nextSeg.date !== sg.date) {
        r7.fail(`${j.id}: ${sg.kind} continues from ${sg.date} into ${nextSeg.date}.`)
      }
      if (!setupsCrossShifts) {
        let bound = 0
        for (const len of shiftNet) {
          bound += len
          if (sg.start < bound - EPS && sg.end > bound + EPS) {
            r7.fail(`${j.id}: ${sg.kind} on ${sg.date} crosses the shift change (net ${Math.round(bound)}).`)
            break
          }
        }
      }
    }
  }

  // R8 lot fiziği
  const r8 = rule('lot-rules', 'Whole coils (or ≥ Min. lot), mould shot limit, run not faster than SPM, no coil changes on transfer presses')
  const lotSums = new Map<string, { qty: number; jobs: AJob[] }>()
  for (const j of planJobs) {
    const key = `${j.material}|${j.job?.bucketLabel ?? ''}|${j.job?.dueDate ?? ''}`
    const e = lotSums.get(key) ?? { qty: 0, jobs: [] }
    e.qty += j.quantity
    e.jobs.push(j)
    lotSums.set(key, e)
  }
  for (const j of planJobs) {
    r8.check()
    const p = productBy.get(j.material)
    if (!p) continue
    const unit = coilUnit(p)
    const minLot = p.minLotQty ?? 0
    if (minLot <= 0 && unit > 0 && j.quantity % unit !== 0) {
      r8.fail(`${j.id}: ${j.quantity} pcs is not whole coils (${unit} pcs per coil).`)
    }
    const maxShots = p.maxShots ?? 0
    const shotsPerCoil = unit > 0 ? unit / cav(j.material) : 0
    if (maxShots > 0 && j.shots > maxShots && !(shotsPerCoil > maxShots && j.shots <= shotsPerCoil)) {
      r8.fail(`${j.id}: ${j.shots} shots exceeds the mould limit ${maxShots}.`)
    }
    const spm = p.spm && p.spm > 0 ? p.spm : 0
    const runMin = j.runSegs.reduce((x, b) => x + (b.end - b.start), 0)
    if (spm > 0 && runMin < j.shots / spm - 0.5) r8.fail(`${j.id}: runs ${Math.round(runMin)} min, faster than ${spm} SPM allows (${Math.round(j.shots / spm)} min).`)
    if (pressByName.get(j.press)?.feedsCoil === false && j.coilSegs.length > 0) r8.fail(`${j.id}: coil change on transfer press ${j.press}.`)
  }
  for (const [key, e] of lotSums) {
    const p = productBy.get(key.split('|')[0])
    const minLot = p?.minLotQty ?? 0
    if (minLot > 0 && e.qty < minLot - QTY_TOL) r8.fail(`${e.jobs[0].id}: lot ${e.qty} pcs is below Min. lot ${minLot}.`)
  }

  // R9 öne çekme penceresi.
  // Her lot, stoğu (ve kendinden önceki lotları) bittiği gün − emniyet − öne
  // çekme gününden önce başlayamaz. Lotlar sahada sırasız koşabilir (W2 108'de
  // W1'den önce): o zaman hangi işin hangi ihtiyacı karşıladığı sıraya bağlıdır.
  // Kural, işlerin EN AZ BİR sıralaması (motorun lot sırası ya da fiili başlama
  // sırası) pencereye uyuyorsa sağlanmış sayılır; yalnızca her sıralamada bir
  // lot penceresinden önce başlıyorsa — yani stok gerçekten pencerenin ötesine
  // yığılıyorsa — ihlaldir.
  const r9 = rule(
    'pull-forward',
    `No lot starts before its first need day − ${safetyDays} safety working day(s) − ${pullForwardDays} pull-forward days (in the engine's lot order or the actual start order)`,
  )
  const windowViolations = (order: AJob[]): { job: AJob; needDay: string; allowedDay: string; covered: number }[] => {
    const firstNeedOfJob = new Map<AJob, { t: number; covered: number }>()
    for (const m of membersOf(order[0].group)) {
      const evs = events.get(m) ?? []
      let supply = (stock0.get(m) ?? 0) + producedBy((pieces.get(m) ?? []).filter((p) => p.end <= nowAbs && !order.some((j) => j.id === p.src)), nowAbs)
      let cum = 0
      let idx = 0
      for (const j of order) {
        const out = m === j.material ? j.quantity : j.shots * cav(m)
        while (idx < evs.length && cum + evs[idx].qty <= supply + QTY_TOL) cum += evs[idx++].qty
        if (idx < evs.length) {
          const prev = firstNeedOfJob.get(j)
          if (!prev || evs[idx].at < prev.t) firstNeedOfJob.set(j, { t: evs[idx].at, covered: supply })
        } else if (!firstNeedOfJob.has(j)) firstNeedOfJob.set(j, { t: Infinity, covered: supply })
        supply += out
      }
    }
    // Kalıp limitiyle bölünen lot TEK lottur (aynı malzeme, kova ve ihtiyaç
    // günü): pencere lotun ilk ihtiyacına göre açılır, sonraki partiler de
    // o pencereye girer.
    const lotKey = (j: AJob) => (j.job ? `${j.material}|${j.job.bucketLabel}|${j.job.dueDate}` : j.id)
    const lotFirst = new Map<string, { t: number; covered: number }>()
    for (const j of order) {
      const f = firstNeedOfJob.get(j)
      if (!f) continue
      const k = lotKey(j)
      const cur = lotFirst.get(k)
      if (!cur || f.t < cur.t) lotFirst.set(k, f)
    }
    const out: { job: AJob; needDay: string; allowedDay: string; covered: number }[] = []
    for (const j of order) {
      if (j.frozen || j.running) continue
      const f = lotFirst.get(lotKey(j))
      if (!f || !Number.isFinite(f.t)) continue // ufukta ihtiyacı yok (eş ürün/rulo artığı): pencere yok
      const needDay = isoOf(Math.floor(f.t / 1440))
      const allowedDay = plusDays(backWorkingDays(needDay, safetyDays), -pullForwardDays)
      if (j.segs[0].date < allowedDay) out.push({ job: j, needDay, allowedDay, covered: f.covered })
    }
    return out
  }
  for (const g of groupsAll) {
    const list = jobs.filter((j) => j.group === g && j.segs.length)
    if (!list.length) continue
    r9.check(list.filter((j) => !j.frozen && !j.running).length)
    const byStart = [...list].sort((a, b) => a.start - b.start)
    const byLot = [...list].sort(
      (a, b) =>
        Number(!!a.job) - Number(!!b.job) || // süren işler önce
        (a.job?.dueDate ?? '').localeCompare(b.job?.dueDate ?? '') ||
        a.start - b.start,
    )
    const physical = windowViolations(byStart)
    if (physical.length === 0) continue
    if (windowViolations(byLot).length === 0) continue
    for (const v of physical) {
      r9.fail(
        `${v.job.id}: starts ${v.job.segs[0].date}; stock + lots started before it (${Math.round(v.covered)} pcs) already cover demand until ${v.needDay}, so the window opens ${v.allowedDay}.`,
      )
    }
  }

  // R10 dondurulmuş işler aynen
  const r10 = rule('frozen-intact', 'Frozen jobs are exactly the approved segments')
  for (const j of jobs.filter((x) => x.frozen && x.job)) {
    r10.check()
    const s0 = snap?.jobs.find((x) => x.material === j.material && x.press === j.press && x.date === j.job!.date)
    const a = JSON.stringify((s0?.segments ?? []).map((x) => [x.kind, x.date, Math.round(x.start), Math.round(x.end)]))
    const b = JSON.stringify((j.job!.segments ?? []).map((x) => [x.kind, x.date, Math.round(x.start), Math.round(x.end)]))
    if (!s0 || a !== b) r10.fail(`${j.id}: differs from the approved plan.`)
  }

  // R11 miktar korunumu
  const r11 = rule('conservation', 'Horizon demand is covered by stock + production, or the rest is listed as unplanned')
  for (const [m, short] of shortAtEnd) {
    r11.check()
    if (unplannedGroups.has(groupOf(m)) || excluded.has(m)) continue
    r11.fail(`${m}: ${Math.round(short)} pcs of horizon demand have no stock, production or unplanned entry.`)
  }
  r11.check(Math.max(0, groupsAll.size - shortAtEnd.size))

  // R12 setup'sız kalıp değişimi
  const r12 = rule('die-change-without-setup', 'A job without a setup follows the same die on the same press, and the die has not been elsewhere in between')
  for (const j of planJobs) {
    const p = primaryOf(j.group)
    if (j.setupSegs.length > 0 || !j.segs.length || !((p?.setupMinutes ?? 0) > 0)) continue
    r12.check()
    const list = jobsByPress.get(j.press) ?? []
    const prev = list.filter((x) => x !== j && x.segs.length && x.start < j.start - EPS).sort((a, b) => a.end - b.end).pop()
    const prevGroup = prev ? prev.group : mountedAt0.get(j.press)
    if (prevGroup !== j.group) {
      r12.fail(`${j.id}: no setup, but the die before it on ${j.press} is ${prevGroup ?? 'none'}.`)
      continue
    }
    const from = prev ? prev.end : nowAbs
    const elsewhere = jobs.find((x) => x.group === j.group && x.press !== j.press && x.start < j.start && x.end > from)
    if (elsewhere) r12.fail(`${j.id}: no setup, but the die ran on ${elsewhere.press} at ${at(elsewhere.start)} in between.`)
  }

  // R13 bakiye önce: yalnızca bakiye lotu acil lotun başladığı anda gerçekten
  // başlayabilecekken (pres uygun, kalıp hazır ve boşta) arkada kaldıysa.
  const r13 = rule(
    'backlog-first',
    'A backlog part that runs out is not left behind an urgent lot on a press where it could have started (die ready and free; unless priority/pinned/moved forward)',
  )
  const prioritised = new Set(inputs.overrides.filter((o) => o.kind === 'priority' || o.kind === 'pin').map((o) => o.material))
  const dieHeld = new Set<string>([
    ...(run.unavailableMolds ?? []),
    ...(run.alarmedMolds ?? []),
    ...inputs.alarms.filter((a) => a.status === 'open').map((a) => a.material),
    ...(inputs.readiness ?? []).filter((r) => !r.ready && !r.readyDate).map((r) => r.material),
  ])
  const dieAvailable = (b: AJob, from: number, to: number) =>
    !membersOf(b.group).some(
      (m) => dieHeld.has(m) || excluded.has(m) || (blackoutBy.get(m) ?? []).some((bl) => bl.start < to && from < bl.end),
    ) && !jobs.some((x) => x !== b && x.group === b.group && x.press !== b.press && x.start < to && from < x.end)
  for (const [press, list] of jobsByPress) {
    const plan = list.filter((j) => !j.frozen && !j.running && j.job)
    for (const b of plan.filter((j) => j.job!.phase === 'backlog' && simShort.has(j.group))) {
      r13.check()
      if (!eligibleOf(b.group).includes(press) && pins.get(b.material) !== press) continue
      const duration = b.end - b.start
      const before = plan.find(
        (u) =>
          u.job!.phase === 'urgent' &&
          u.start < b.start - EPS &&
          u.start >= nowAbs - EPS &&
          !prioritised.has(u.material) &&
          !(u.job!.reason ?? '').includes('moved forward') &&
          dieAvailable(b, u.start, u.start + duration),
      )
      if (before) r13.fail(`${press}: urgent ${before.id} runs before backlog ${b.id}, which could have started at ${at(before.start)}.`)
    }
  }

  // ---- özet -----------------------------------------------------------------
  const count = (k: MaterialVerdictKind) => verdicts.filter((v) => v.verdict === k).length
  const fcount = (k: FeasibilityKind) => verdicts.filter((v) => v.feasibility?.verdict === k).length
  const rulesBroken = rules.reduce((x, r) => x + r.broken, 0)
  const summary: ValidationSummary = {
    verdicts: {
      agree: count('agree'),
      'engine-missed': count('engine-missed'),
      'engine-false-late': count('engine-false-late'),
      'explained-unplanned': count('explained-unplanned'),
      'frozen-late': count('frozen-late'),
    },
    realStockouts: simShort.size,
    stockoutMoments: stockouts.length,
    engineLate: engineLate.size,
    capacityProven: fcount('capacity-proven'),
    lateLowerBound,
    lateLowerBoundBy: { press: pressLB, setupCrew: plantCrew.minLate, hallCrane: hallLB },
    avoidable: fcount('avoidable'),
    undecided: fcount('undecided'),
    dataSuspect: verdicts.filter((v) => v.dataFlags.length > 0).length,
    rulesBroken,
    rulesFailed: rules.filter((r) => r.broken > 0).map((r) => r.id),
    setups: efficiency.setups,
    utilisation: { plan: efficiency.utilisation.plan, upperBound: efficiency.utilisation.upperBound },
    ok: count('engine-missed') === 0 && count('engine-false-late') === 0 && rulesBroken === 0 && fcount('avoidable') === 0,
  }

  return {
    version: 1,
    todayIso: today,
    horizon: { from: monday, to: horizonEnd },
    elapsedMs: Date.now() - t0,
    summary,
    materials: capList(verdicts),
    stockouts: capList(stockouts).map((so) => ({
      group: so.group,
      material: so.material,
      at: labelOfAbs(so.at),
      shortQty: round1(so.short),
      shortHere: round1(so.shortHere),
      recoveredAt: so.recoveredAt === null ? null : labelOfAbs(so.recoveredAt),
      lateHours: so.recoveredAt === null ? null : round1((so.recoveredAt - so.at) / 60),
      cause: so.cause,
    })),
    efficiency: sanitize(efficiency),
    rules,
    warnings,
  }
}

/** Sayıları sonlu tutar (Convex/JSON). */
function sanitize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? 0 : v)))
}

/**
 * Planı durdurmayan sarmalayıcı: doğrulama hata verirse plan yine döner,
 * hata uyarı olarak görünür. computePlan'ın sonunda bunu çağırın.
 */
export function safeValidatePlan(inputs: PlanInputs, run: PlanRun, nowMs: number): PlanValidation | null {
  try {
    return validatePlan(inputs, run, nowMs)
  } catch {
    return null
  }
}
