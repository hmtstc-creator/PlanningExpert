// Planın uçtan uca hesabı: ham kayıtlardan ekranda gösterilen plana.
//
// Eskiden bu hesap Planlama sayfasının içindeydi, yani plan yalnızca biri
// sayfayı açtığında ve onun tarayıcısında vardı. Artık aynı fonksiyonu
// sunucu çalıştırıyor (convex/planEngine.ts) ve sonucu saklıyor; sayfa
// hazır sonucu okuyor. Saf fonksiyon — React'e de Convex'e de bağlı değil,
// o yüzden iki tarafta aynı sonucu verir ve test edilebilir.
//
// DİKKAT: bu dosya ve import ettikleri sunucuda da derlenir. `@/` takma adı
// orada çözülmez; yalnızca göreli import kullanılmalı.

import { addDays, DEFAULT_PLANT_TIME_ZONE, isoDate, isoWeek, isoWeekLabel, mondayOf, plantClock } from './dates'
import {
  DAY_KEYS,
  buildDemandSchedule,
  eligiblePressesOf,
  lotRuleOf,
  shotsPerCoil,
  buildRawMaterialPlan,
  buildWeekBuckets,
  materialsMissingRawSpec,
  type DayBucket,
  type DemandInput,
  type ProductSpec,
  type RawMaterialNeed,
} from './planning'
import {
  buildDayTimeline,
  clockToNet,
  netToClock,
  productionDayOf,
  remainingCapacityMinutes,
  type PlannedStop,
} from './shiftTimeline'
import {
  moldBlackouts as buildMoldBlackouts,
  pressMaintenanceBlock,
  type MoldMaintenanceRow,
  type MoldReadinessRow,
  type PressMaintenanceRow,
} from './maintenance'
import { alarmedMaterials } from './moldAlarm'
import { auditPlan, type PlanAudit } from './planAudit'
import { safeValidatePlan, type PlanValidation } from './planValidator'
import { buildRawRequirements, type RawRequirementPlan } from './rawMrp'
import { readDailyDemand } from './dailyDemand'
import { buildCapacityForecast, type CapacityForecast } from './capacityForecast'
import { capacityModel } from './capacityModel'
import { countedLocations, isFinishedStockRow, isRawStockRow } from './stockLocations'
import {
  buildPlanAlarms,
  type DieUnavailability,
  type MachineUnavailability,
  type PlanAlarms,
} from './planAlarms'
import {
  schedule,
  type PlanOverride,
  type ScheduledJob,
  type ScheduleVariant,
  type UnplannedItem,
} from './scheduler'
import { DEFAULT_WORKING_DAYS, SETTINGS_DEFAULTS } from './settingsDefaults'

/** Hammadde eksikliği bu kadar İŞ GÜNÜ içinde bir işi durduruyorsa acildir. */
export const RAW_URGENT_DAYS = 3
/** @deprecated SETTINGS_DEFAULTS.planningHorizonWeeks */
export const DEFAULT_HORIZON_WEEKS = SETTINGS_DEFAULTS.planningHorizonWeeks
/** Emniyet stoğu varsayılanı (iş günü). Work Calendar sayfasından değişir. */
export const DEFAULT_SAFETY_STOCK_DAYS = SETTINGS_DEFAULTS.safetyStockDays

export interface PlanPress {
  name: string
  hall: string
  category?: string
  feedsCoil?: boolean
  frozenDays?: number
}

export interface SnapshotJob {
  material: string
  press: string
  hall: string
  date: string
  phase: string
  quantity: number
  shots: number
  coilsNeeded: number
  setupStartMinute: number
  endMinute: number
  endDate?: string
  segments?: { kind: string; date: string; start: number; end: number }[]
  reason: string
}

export interface PlanSettings {
  shiftMinutes?: number
  overtimeShiftMinutes?: number
  setupGapMinutes?: number
  concurrentSetupsPerHall?: number
  coilSetupGapMinutes?: number
  shiftStartMinute?: number
  breakMinutesPerShift?: number
  capacityFactor?: number
  planningHorizonWeeks?: number
  frozenDays?: number
  safetyStockDays?: number
  /** Fabrika genelinde aynı anda en fazla kalıp setup'ı (bakiye kuralı). */
  maxSetupsPlantWide?: number
  /** Normal işlerde fabrika genelinde aynı anda en fazla kalıp setup'ı. */
  maxSetupsPlantWideNormal?: number
  /** Setup vardiya değişimini aşabilir mi. */
  setupsCrossShifts?: boolean
  /** Dolgu işi en fazla kaç gün öne çekilebilir (pres boş kalmasın). */
  pullForwardDays?: number
  /** Teslim saati: ihtiyaç günü bu dakikaya kadar hazır olan adet zamanındadır (480 = 08:00). */
  deliveryCutoffMinute?: number
  /** Doluluk hedefi (%): ulaşılmazsa motor başka senaryolar dener. */
  utilisationTarget?: number
  /** En fazla kaç senaryo denensin. */
  maxScenarios?: number
  country?: string
  timeZone?: string
}

/** Planın okuduğu her şey, veritabanındaki hâliyle. */
export interface PlanInputs {
  products: (ProductSpec & { maxShots?: number })[]
  weeklyDemand: { material: string; overdue?: number; periods: DemandInput['periods'] }[]
  /** ZPP_DAILY satırları — her sütun bir satış günü. Yoksa boş. */
  dailyDemand?: { material: string; periods: DemandInput['periods'] }[]
  stock: {
    material: string
    storageLocation?: string
    unrestricted?: number
    /** MB52 yükleme zamanı (ms). */
    uploadedAt?: number
  }[]
  locations: { code: string; category: string; countFinished?: boolean; countRaw?: boolean }[]
  /** Yoldaki hammadde (Excel listesi) — MRP'de varış haftasında giriş. */
  inTransit?: { material: string; quantityKg: number; eta?: string; poNumber?: string; supplier?: string }[]
  presses: PlanPress[]
  templates: { press: string; workingDays: number; shiftsPerDay: number; overtimeShifts: number }[]
  /**
   * Work Calendar'daki istisna haftalar (o haftaya özel gün, vardiya ve
   * fazla mesai). Hafta başı Pazartesi, ISO tarih.
   */
  weekOverrides?: {
    press: string
    weekStart: string
    workingDays: number
    shiftsPerDay: number
    overtimeShifts: number
  }[]
  settings: PlanSettings | null
  workCalendar: { workingDays?: string[]; holidays?: string[] } | null
  officialHolidays: { date: string; name: string }[]
  latestSnapshot: { createdAt: number; truncated?: boolean; jobs: SnapshotJob[] } | null
  plannedStops: PlannedStop[]
  overrides: { material: string; kind: string; press?: string; date?: string }[]
  moldMaintenance: MoldMaintenanceRow[]
  readiness: MoldReadinessRow[]
  pressMaintenance: PressMaintenanceRow[]
  alarms: { material: string; status: string }[]
  /** Açık makine arızaları. "Pres duruyor" olanlar planda presi kapatır. */
  machineProblems?: {
    press: string
    problemType: string
    occurredAt: string
    occurredMinute?: number
    stopsPress: boolean
    expectedUpDate?: string
    expectedUpMinute?: number
    status: string
  }[]
  /** Eksik okunan tablolar ('master data', 'demand', 'stock'). */
  truncatedInputs: string[]
  /**
   * Planlamacının pres bazında müdahalesi: plan başlangıcı (pres bu andan
   * önce yeni iş almaz) ve onaylı işlerin gecikmesi (+ geride, − ileride).
   */
  pressStarts?: {
    press: string
    fromDate?: string
    fromMinute?: number
    reason?: string
    delayMinutes?: number
  }[]
}

export type PlanJob = ScheduledJob & { frozen?: boolean }

export interface MaintenanceBlock {
  press: string
  date: string
  label: string
  start: number
  end: number
}

/** Bir presin bir günü: kaç vardiya çalışıyor, kaç net dakikası kaldı. */
export interface PlanDay {
  press: string
  date: string
  shifts: number
  minutes: number
}

/** Bir işte bundan fazla rulo, master data hatasına işaret eder. */
const MANY_COILS = 200
/** Setup'ın durmadan geçtiği planlı duruş türleri. Devir ve bakım setup'ı da durdurur. */
const SETUP_THROUGH_KINDS = new Set(['tea', 'meal', 'break'])

export interface ScenarioSummary {
  label: string
  late: number
  lateHours: number
  unplanned: number
  utilisation: number
  setups: number
}

export interface PlanOptimisation {
  /** Hedef doluluk (%) ve ulaşılan (ilk `windowDays` gün). */
  target: number
  achieved: number
  /** Standart planın doluluğu (karşılaştırma için). */
  standard: number
  chosen: string
  tried: number
  stoppedBecause: 'target' | 'noImprovement' | 'limit' | 'time'
  windowDays: number
  /** Geç kalemlere hedefli hamleler: kaç hamle denendi, kaçı tutuldu. */
  localSearch?: { evaluations: number; improvements: number }
  searchMs: number
  perPress: { press: string; capacityHours: number; busyHours: number; utilisation: number }[]
  scenarios: ScenarioSummary[]
}

/**
 * Master data kapsaması: master data'daki bir malzeme için yüklenen SAP
 * dosyalarında hiç satır var mı? Master data ana listedir; bir malzeme hiçbir
 * dosyada yoksa ya dosya eksik çekilmiştir ya da kod yanlıştır.
 */
export interface DataCoverage {
  materials: number
  files: Record<
    'weeklyDemand' | 'dailyDemand' | 'stock' | 'rawStock',
    { uploaded: boolean; missingCount: number; missing: string[] }
  >
  /** Yüklenen dosyaların hiçbirinde satırı olmayan malzemeler. */
  missingEverywhereCount: number
  missingEverywhere: string[]
}

export interface LateItem {
  material: string
  presses: string[]
  lots: number
  /** İlk geç lotun teslim anı ("Tue 29 Sep 08:00"). */
  deadline: string
  ready: string
  neededQuantity: number
  lateHours: number
  suggestion: string
}

/** Hesaplanmış plan — ekranın ihtiyacı olan her şey, düz veri olarak. */
export interface PlanRun {
  computedAt: number
  /** Hesabın yapıldığı üretim günü ve o anki saat (gece yarısından dakika). */
  todayIso: string
  nowClockMinute: number
  horizonStart: string
  timeZone: string
  shiftMinutes: number
  shiftStartMinute: number
  horizonWeeks: number
  capacityFactor: number
  globalFrozenDays: number
  safetyStockDays: number
  /** Geç iş onarımı: kaç tur, önce/sonra geç iş, öne alınan parçalar. */
  lateRepair: {
    rounds: number
    lateBefore: number
    lateAfter: number
    boosted: string[]
  }
  /** ZPP_DAILY'nin kapsadığı son gün; bu güne kadar satış günleri esas. */
  dailyUntil: string | null
  /** Son stok yüklemesinden beri üretilmiş sayılan onaylı iş. */
  producedSinceStock: { quantity: number; jobs: number; stockDay: string }
  presses: { name: string; hall: string; category?: string }[]
  plannedStops: PlannedStop[]
  days: PlanDay[]
  /** Ekranda gösterilen işler: dondurulmuşlar + motorun yeni planı. */
  jobs: PlanJob[]
  unplanned: UnplannedItem[]
  maintenance: MaintenanceBlock[]
  rawNeeds: RawMaterialNeed[]
  /** Acil hammadde sınırı: bugünden RAW_URGENT_DAYS iş günü (ISO). */
  rawUrgentUntil?: string
  warnings: string[]
  truncatedInputs: string[]
  /** Kapasite öngörüsü: pres ve grup bazında haftalık kapasite ve talep saati. */
  capacity?: CapacityForecast
  /** Senaryo araması: hedef doluluk, denenen senaryolar, seçilen plan. */
  optimisation?: PlanOptimisation
  /** Bağımsız doğrulama motorunun sonucu (bkz. planValidator.ts). */
  validation?: PlanValidation | null
  /** Master data'daki malzemelerin SAP dosyalarındaki karşılığı. */
  dataCoverage?: DataCoverage
  /** Hammadde MRP'si (plandan bağımsız) — Raw Material Coverage sayfası. */
  rawRequirements?: RawRequirementPlan
  /** Geç kalemler, malzeme bazında, gecikme saati ve kapasite önerisiyle. */
  lateItems?: LateItem[]
  frozenCount: number
  /** Dondurulmuş işlerin geldiği onaylı planın zamanı. */
  frozenFrom: number | null
  thisWeekCapacity: { full: number; remaining: number; elapsed: number }
  /** En az bir malzemenin listelediği presler — boş presin sebebi için. */
  eligiblePresses: string[]
  alarmedMolds: string[]
  unavailableMolds: string[]
  /** Bitmiş planın kurallara karşı bağımsız denetimi (planAudit.ts). */
  audit: PlanAudit
  /** Kalıp ve makine alarmları: planı aksatanlar ve bilgi için olanlar. */
  alarms: PlanAlarms
}

function sum<K>(map: Map<K, number>, key: K, add: number) {
  map.set(key, (map.get(key) ?? 0) + add)
}

export function computePlan(inputs: PlanInputs, nowMs: number): PlanRun {
  const s = inputs.settings ?? {}
  const timeZone = s.timeZone || DEFAULT_PLANT_TIME_ZONE
  const shiftMinutes = s.shiftMinutes ?? SETTINGS_DEFAULTS.shiftMinutes
  const overtimeShiftMinutes = s.overtimeShiftMinutes ?? SETTINGS_DEFAULTS.overtimeShiftMinutes
  const setupGapMinutes = s.setupGapMinutes ?? SETTINGS_DEFAULTS.setupGapMinutes
  const concurrentSetupsPerHall = s.concurrentSetupsPerHall ?? SETTINGS_DEFAULTS.concurrentSetupsPerHall
  const maxSetupsPlantWide = Math.max(1, s.maxSetupsPlantWide ?? SETTINGS_DEFAULTS.maxSetupsPlantWide)
  const maxSetupsPlantWideNormal = Math.max(1, Math.min(maxSetupsPlantWide, s.maxSetupsPlantWideNormal ?? SETTINGS_DEFAULTS.maxSetupsPlantWideNormal))
  const setupsCrossShifts = s.setupsCrossShifts ?? SETTINGS_DEFAULTS.setupsCrossShifts
  const pullForwardDays = Math.max(0, s.pullForwardDays ?? SETTINGS_DEFAULTS.pullForwardDays)
  const coilSetupGapMinutes = s.coilSetupGapMinutes ?? SETTINGS_DEFAULTS.coilSetupGapMinutes
  const shiftStartMinute = s.shiftStartMinute ?? SETTINGS_DEFAULTS.shiftStartMinute // 07:00
  const capacityFactor = s.capacityFactor ?? SETTINGS_DEFAULTS.capacityFactor
  const horizonWeeks = Math.min(30, Math.max(1, s.planningHorizonWeeks ?? SETTINGS_DEFAULTS.planningHorizonWeeks))
  const globalFrozenDays = Math.max(0, s.frozenDays ?? SETTINGS_DEFAULTS.frozenDays)
  const safetyStockDays = Math.max(0, s.safetyStockDays ?? SETTINGS_DEFAULTS.safetyStockDays)
  const { presses, templates, plannedStops } = inputs

  // Vardiya planlı duruşları: devir, çay, yemek her vardiyada farklı.
  const stopMinutesByShift = [0, 0, 0]
  for (const stop of plannedStops) {
    const i = stop.shiftIndex - 1
    if (i >= 0 && i < 3) stopMinutesByShift[i] += stop.durationMinutes
  }

  const stockByMaterial = new Map<string, number>()
  const rawStockByMaterial = new Map<string, number>()
  const rawCodes = new Set(inputs.products.map((p) => p.rawMaterialCode?.trim() ?? '').filter(Boolean))
  // Hangi depo neye sayılır Storage Locations matrisinden gelir; tik yoksa
  // 2009/1009 varsayılandır. Deposu yazılmamış satır (eski/elle veri) sayılır.
  const counted = countedLocations(inputs.locations)
  for (const row of inputs.stock) {
    if (isFinishedStockRow(counted, row.storageLocation)) sum(stockByMaterial, row.material, row.unrestricted ?? 0)
    // Rulo stoğu: yalnızca "hammadde" tiki olan depolardan.
    const material = row.material.trim()
    if (rawCodes.has(material) && isRawStockRow(counted, row.storageLocation)) {
      sum(rawStockByMaterial, material, row.unrestricted ?? 0)
    }
  }

  const productByCode = new Map<string, ProductSpec>()
  for (const p of inputs.products) productByCode.set(p.code, p)

  const workingDayKeys = inputs.workCalendar?.workingDays ?? [...DEFAULT_WORKING_DAYS]
  const workingDaysPerWeek = workingDayKeys.length || 5

  // Resmi tatiller + elle girilen tatiller birlikte kapasiteyi sıfırlar.
  const holidays = new Set<string>(inputs.workCalendar?.holidays ?? [])
  for (const h of inputs.officialHolidays) holidays.add(h.date)

  // Tesis saatiyle "şimdi". Sunucu UTC'de çalışır; yerel alanlar tesisin
  // duvar saatini göstermezse gün yanlış yerde değişir.
  const now = plantClock(nowMs, timeZone)
  const horizonMonday = mondayOf(now)
  // Plan günü gece yarısında değil birinci vardiyayla başlar.
  const { date: todayIso, clockMinute: nowClockMinute } = productionDayOf(now, shiftStartMinute)

  // ---- Dondurulmuş ufuk --------------------------------------------------
  // Yakın günler onaylı plandan alınır; sahanın hazırlığı bozulmasın.
  const frozenUntilByPress = new Map<string, string>()
  for (const press of presses) {
    const days = press.frozenDays ?? globalFrozenDays
    if (days <= 0) continue
    frozenUntilByPress.set(press.name, isoDate(addDays(new Date(`${todayIso}T00:00:00`), days - 1)))
  }
  const snapshot = inputs.latestSnapshot
  // Kırpılmış bir onaylı plan eksiktir; onunla dondurmak sahada olmayan bir
  // planı dondurmak olur.
  const dayFrozenJobs =
    !snapshot || snapshot.truncated || frozenUntilByPress.size === 0
      ? []
      : snapshot.jobs.filter((job) => {
          const until = frozenUntilByPress.get(job.press)
          if (!until || job.date < todayIso) return false
          return job.date <= until && (job.segments?.length ?? 0) > 0
        })
  // Şu an çalışan onaylı iş (dün başlamış olsa, dondurma kapalı olsa bile)
  // presinde kalır: kalıbı takılıdır, rulosu yarım. Eskiden her pres "şimdi
  // boş" sayılıyor, sekiz pres birden setup sırasına giriyordu.
  const nowNet = clockToNet(nowClockMinute, buildDayTimeline(shiftStartMinute, shiftMinutes, 3, plannedStops))
  const endsAfterNow = (job: SnapshotJob) => {
    const end = job.endDate ?? job.date
    return end > todayIso || (end === todayIso && job.endMinute > nowNet)
  }
  const startedBeforeNow = (job: SnapshotJob) =>
    job.date < todayIso || (job.date === todayIso && job.setupStartMinute < nowNet)
  const runningJobs =
    !snapshot || snapshot.truncated
      ? []
      : snapshot.jobs.filter(
          (job) =>
            (job.segments?.length ?? 0) > 0 &&
            startedBeforeNow(job) &&
            endsAfterNow(job) &&
            !dayFrozenJobs.includes(job),
        )
  // Planlamacı bir presi belli bir ana kadar tuttuysa (operatör yok,
  // hammadde yok…) o presin bu andan önce başlayan onaylı işleri yapılamaz:
  // serbest bırakılır, motor onları tutulma bittikten sonra yeniden planlar.
  const nowDay = buildDayTimeline(shiftStartMinute, shiftMinutes, 3, plannedStops)
  const heldUntil = new Map<string, { date: string; clock: number; net: number; reason: string }>()
  for (const ps of inputs.pressStarts ?? []) {
    if (!ps.fromDate) continue
    const minute = ps.fromMinute ?? shiftStartMinute
    const at =
      minute < shiftStartMinute
        ? { date: isoDate(addDays(new Date(`${ps.fromDate}T00:00:00`), -1)), clock: minute + 1440 }
        : { date: ps.fromDate, clock: minute }
    const net = clockToNet(at.clock, nowDay)
    // Geçmişte kalan bir başlangıç artık bir şey tutmaz.
    if (at.date < todayIso || (at.date === todayIso && net <= nowNet)) continue
    heldUntil.set(ps.press, { ...at, net, reason: ps.reason?.trim() || 'planner' })
  }
  const released = new Set<SnapshotJob>()
  for (const job of [...dayFrozenJobs, ...runningJobs]) {
    const held = heldUntil.get(job.press)
    if (held && (job.date < held.date || (job.date === held.date && job.setupStartMinute < held.net))) {
      released.add(job)
    }
  }
  const frozenJobs = [...dayFrozenJobs, ...runningJobs].filter((job) => !released.has(job))
  const frozenSet = new Set(frozenJobs)

  // Dondurulmuş işlerin ürettiği adet talebi karşılar — sayılmazsa aynı iş
  // iki kere planlanır.
  const committedByMaterial = new Map<string, number>()
  for (const job of frozenJobs) sum(committedByMaterial, job.material, job.quantity)

  // Son MB52'den SONRA üretilmiş, ama henüz stok dosyasında görünmeyen iş.
  // Örnek: Pazartesi 6000 basıldı, stok dosyası Salı sabahı yüklenecek. O
  // arada 6000 sayılmazsa motor aynı ruloyu bakiye diye yeniden planlar.
  // Onaylı planda, stok yüklemesinden sonra bitip bugünden önce başlamış
  // işler yeni MB52 gelene kadar stok gibi sayılır. (Bugün ve sonrası zaten
  // dondurulmuş ufuk olarak sayılıyor.) Varsayım: onaylı plan uygulandı.
  const stockUploadedAt = inputs.stock.reduce((max, r) => Math.max(max, r.uploadedAt ?? 0), 0)
  const producedSinceStock = { quantity: 0, jobs: 0, stockDay: '' }
  if (snapshot && !snapshot.truncated && stockUploadedAt > 0) {
    const upload = productionDayOf(plantClock(stockUploadedAt, timeZone), shiftStartMinute)
    producedSinceStock.stockDay = upload.date
    for (const job of snapshot.jobs) {
      // Dondurulmuş ya da şu an çalışan iş yukarıda sayıldı; henüz bitmemiş
      // iş üretilmiş sayılmaz. Bu sabah biten iş (dondurma kapalıyken
      // eskiden hiç sayılmıyordu) sayılır.
      if (frozenSet.has(job) || endsAfterNow(job)) continue
      const endDate = job.endDate ?? job.date
      // Net dakikayı saate kabaca çevirir (molalar hariç) — gün içi sıra için yeter.
      const endClock = shiftStartMinute + job.endMinute
      const afterUpload =
        endDate > upload.date || (endDate === upload.date && endClock > upload.clockMinute)
      if (!afterUpload) continue
      sum(committedByMaterial, job.material, job.quantity)
      producedSinceStock.quantity += job.quantity
      producedSinceStock.jobs += 1
    }
  }

  // ZPP_DAILY: kapsadığı günlerde satış günü oradaki tarihtir.
  const daily = readDailyDemand(inputs.dailyDemand ?? [])
  const weeklyByMaterial = new Map(inputs.weeklyDemand.map((d) => [d.material, d]))
  const materials = new Set<string>([...weeklyByMaterial.keys(), ...daily.byMaterial.keys()])

  const demandRows: DemandInput[] = 
    Array.from(materials).map((material) => {
      const d = weeklyByMaterial.get(material)
      return {
        material,
        overdue: d?.overdue ?? 0,
        periods: d?.periods ?? [],
        daily: daily.byMaterial.get(material),
        stock: (stockByMaterial.get(material) ?? 0) + (committedByMaterial.get(material) ?? 0),
      }
    })
  const demandOptions = {
      baseMonday: horizonMonday,
      horizonWeeks,
      workingDaysPerWeek,
      workingDayKeys,
      today: todayIso,
      safetyStockDays,
      dailyUntil: daily.until,
    }

  // ---- Kapasite kovaları ---------------------------------------------------
  // Tek formül (capacityModel): istisna hafta > pres şablonu, planlı duruşlar
  // düşülmüş. Work Calendar, Capacity Dashboard ve Performance da bunu okur.
  const capModel = capacityModel({
    shiftMinutes,
    overtimeShiftMinutes,
    plannedStops,
    templates,
    weekOverrides: inputs.weekOverrides,
    workingDayKeys,
    holidays,
  })
  const patternOf = capModel.patternOf

  const buckets = new Map<string, DayBucket[]>()
  for (const press of presses) {
    const all: DayBucket[] = []
    for (let w = 0; w < horizonWeeks; w++) {
      all.push(...capModel.weekBuckets(press.name, addDays(horizonMonday, w * 7)))
    }
    // Önce ölçülen gerçekleşme oranı, sonra bugünün geçmiş saatleri.
    buckets.set(
      press.name,
      all.map((b) => {
        const adjusted = capacityFactor === 1 ? b.minutes : Math.floor(b.minutes * capacityFactor)
        const timeline = buildDayTimeline(shiftStartMinute, shiftMinutes, b.shifts, plannedStops)
        const remaining = remainingCapacityMinutes(b.date, todayIso, nowClockMinute, adjusted, timeline)
        return {
          ...b,
          minutes: remaining,
          // Bugünün penceresi geçmiş dakikadan başlar; yoksa iş sabaha,
          // yani geçmişe konurdu.
          startMinute: b.date === todayIso && remaining > 0 ? adjusted - remaining : 0,
          // Çay ve yemek molası setup'ı durdurmaz (setup ekibi endirekt).
          setupBreaks: timeline.stops
            .filter((st) => SETUP_THROUGH_KINDS.has(st.kind))
            .map((st) => ({ at: clockToNet(st.start, timeline), minutes: st.end - st.start })),
        }
      }),
    )
  }

  const shiftsByPressDate = new Map<string, number>()
  const horizonDateSet = new Set<string>()
  for (const [pressName, list] of buckets) {
    for (const b of list) {
      shiftsByPressDate.set(`${pressName}|${b.date}`, b.shifts)
      horizonDateSet.add(b.date)
    }
  }
  const horizonDates = Array.from(horizonDateSet).sort()

  const alarmedMolds = alarmedMaterials(inputs.alarms)

  // Takvim günü + saat → üretim günü + o günün saati. Birinci vardiyadan
  // önceki saat (gece vardiyası) bir önceki üretim gününe aittir.
  const toProductionClock = (date: string, minute: number) =>
    minute < shiftStartMinute
      ? { date: isoDate(addDays(new Date(`${date}T00:00:00`), -1)), clock: minute + 1440 }
      : { date, clock: minute }
  // Gün içi net dakika için tam (3 vardiyalık) günün çizelgesi.
  const fullDay = buildDayTimeline(shiftStartMinute, shiftMinutes, 3, plannedStops)

  const { blackouts: moldBlackouts, unavailable: unavailableMolds } = buildMoldBlackouts(
    inputs.moldMaintenance,
    inputs.readiness,
    horizonDates,
    alarmedMolds,
    (readyDate, readyMinute) => {
      const at = toProductionClock(readyDate, readyMinute)
      return { date: at.date, untilNet: clockToNet(at.clock, fullDay) }
    },
  )

  // Açık, presi durduran arızalar: arızanın anından beklenen devreye girişe
  // kadar — tarih yoksa ufkun sonuna kadar — pres kapalı. Pres bakımıyla aynı
  // yoldan plana girer: kapalı aralık olarak.
  const openBreakdowns = (inputs.machineProblems ?? []).filter(
    (p) => p.status === 'open' && p.stopsPress,
  )
  const breakdownRows: PressMaintenanceRow[] = []
  for (const b of openBreakdowns) {
    const from = toProductionClock(b.occurredAt, b.occurredMinute ?? shiftStartMinute)
    const to = b.expectedUpDate
      ? toProductionClock(b.expectedUpDate, b.expectedUpMinute ?? shiftStartMinute)
      : null
    for (const date of horizonDates) {
      if (date < from.date || date < todayIso) continue
      if (to && date > to.date) break
      const start = date === from.date ? from.clock : shiftStartMinute
      const end = to && date === to.date ? to.clock : shiftStartMinute + 1440
      if (end <= start) continue
      breakdownRows.push({
        press: b.press,
        date,
        startMinute: start,
        endMinute: end,
        reason: `Breakdown: ${b.problemType}`,
        status: 'planned',
      })
    }
  }

  // Planlamacının tuttuğu pres: şu andan başlangıç anına kadar kapalı.
  for (const [press, held] of heldUntil) {
    for (const date of horizonDates) {
      if (date < todayIso) continue
      if (date > held.date) break
      const end = date === held.date ? held.clock : shiftStartMinute + 1440
      if (end <= shiftStartMinute) continue
      breakdownRows.push({
        press,
        date,
        startMinute: shiftStartMinute,
        endMinute: end,
        reason: `Held until ${held.date} ${clockText(held.clock % 1440)}: ${held.reason}`,
        status: 'planned',
      })
    }
  }

  // Pres bakımı dolu bir aralıktır: gün kısalmaz, günün bir saati kapanır.
  const maintenance: MaintenanceBlock[] = []
  for (const row of [...inputs.pressMaintenance, ...breakdownRows]) {
    const shifts = shiftsByPressDate.get(`${row.press}|${row.date}`) ?? 0
    if (shifts <= 0) continue
    const block = pressMaintenanceBlock(
      row,
      buildDayTimeline(shiftStartMinute, shiftMinutes, shifts, plannedStops),
    )
    if (block) maintenance.push(block)
  }

  // Hat plana uyamadı: onaylı işler (donmuş ve çalışan) presin ekseninde
  // kaydırılır. Geride ise şu andan itibaren o süre "Behind plan" olarak
  // kapanır (çalışan iş o süre daha sürüyor); ileride ise işler öne gelir.
  const shiftedJobs = new Map<SnapshotJob, SnapshotJob>()
  for (const ps of inputs.pressStarts ?? []) {
    const delay = Math.round(ps.delayMinutes ?? 0)
    if (!delay) continue
    const windows = pressWindows(buckets.get(ps.press) ?? [])
    const onPress = frozenJobs.filter((j) => j.press === ps.press)
    const placed = onPress.map((job) => ({ job, parts: toGlobalParts(windows, job.segments ?? []) }))
    const earliest = Math.min(...placed.flatMap((p) => p.parts.map((x) => x.start)), Number.POSITIVE_INFINITY)
    const shift = delay < 0 && Number.isFinite(earliest) ? Math.max(delay, -earliest) : delay
    for (const { job, parts } of placed) {
      if (parts.length === 0) continue
      const segments = parts.flatMap((x) => fromGlobal(windows, x.start + shift, x.end + shift, x.kind))
      if (segments.length === 0) continue
      const copy: SnapshotJob = {
        ...job,
        segments,
        date: segments[0].date,
        setupStartMinute: segments[0].start,
        endDate: segments[segments.length - 1].date,
        endMinute: segments[segments.length - 1].end,
      }
      shiftedJobs.set(job, copy)
      frozenJobs[frozenJobs.indexOf(job)] = copy
    }
    if (delay > 0) {
      for (const seg of fromGlobal(windows, 0, delay, 'maintenance')) {
        maintenance.push({
          press: ps.press,
          date: seg.date,
          start: seg.start,
          end: seg.end,
          label: `Behind plan: +${Math.round((delay / 60) * 10) / 10} h`,
        })
      }
    }
  }

  const overrides: PlanOverride[] = inputs.overrides.map((o) => ({
    material: o.material,
    kind: o.kind as PlanOverride['kind'],
    press: o.press,
    date: o.date,
  }))

  const scheduleOptions = {
    setupGapMinutes,
    coilSetupGapMinutes,
    concurrentSetupsPerHall,
    maxSetupsPlantWide,
    maxSetupsPlantWideNormal,
    setupsCrossShifts,
    pullForwardDays,
    // Süresiz kapalı kalıplar (alarm açık, ya da tarihsiz tutuluyor)
    // motora `exclude` olarak geçer.
    overrides: [
      ...overrides,
      ...unavailableMolds.map((material) => ({ material, kind: 'exclude' as const })),
    ],
    moldBlackouts,
    fixedJobs: [
      ...frozenJobs.map((job) => ({
        material: job.material,
        press: job.press,
        date: job.date,
        segments: job.segments ?? [],
      })),
      ...maintenance.map((block) => ({
        material: `⚙ ${block.press} maintenance`,
        press: block.press,
        date: block.date,
        segments: [{ kind: 'maintenance', date: block.date, start: block.start, end: block.end }],
      })),
    ],
    shiftNetMinutes: stopMinutesByShift.map((stopped) => Math.max(1, shiftMinutes - stopped)),
  }

  // ---- Planla; geç iş kalırsa yeniden planla -----------------------------
  //
  // Geç iş = stok bittikten sonra başlayan iş: müşteri durur. Bırakılmaz;
  // motor planı yeniden kurar. Her turda:
  //  1. geç kalan lotlar öne alınır — sıra değişince her lot yine TÜM
  //     uygun presleri dener, yani alternatif pres senaryoları da denenir;
  //  2. aynı preslerde geç işten önce yerleşmiş ve rulo yüzünden ihtiyaç
  //     fazlası basan parçaların lotu ihtiyaç kadara indirilir.
  // En az plansız, sonra en az geç iş, sonra en az geç gün, sonra en az
  // değişiklik yapan plan seçilir. Hiçbir deneme daha iyi değilse durulur.
  const lotKey = (e: { material: string; bucketLabel: string }) => `${e.material}|${e.bucketLabel}`
  // ---- Teslim anı -----------------------------------------------------------
  // İhtiyaç gününün sabahı (varsayılan 08:00) kadar gereken adet hazırsa lot
  // zamanındadır. Bakiye ve bugüne düşen ihtiyaç zaten bugün sabah
  // karşılanamaz: bir sonraki iş gününün sabahı esas alınır.
  const cutoffMinute = s.deliveryCutoffMinute ?? SETTINGS_DEFAULTS.deliveryCutoffMinute
  const isWorkingDate = (iso: string) => {
    const dayKey = DAY_KEYS[(new Date(`${iso}T00:00:00`).getDay() + 6) % 7]
    return workingDayKeys.includes(dayKey) && !holidays.has(iso)
  }
  const nextWorkingDate = (iso: string) => {
    let d = iso
    for (let i = 0; i < 14; i++) {
      d = isoDate(addDays(new Date(`${d}T00:00:00`), 1))
      if (isWorkingDate(d)) return d
    }
    return isoDate(addDays(new Date(`${iso}T00:00:00`), 1))
  }
  // Tarih etiketi (toLocaleDateString) pahalıdır; gün başına bir kez hesaplanır.
  const deadlineCache = new Map<string, { date: string; net: number; label: string }>()
  const deadlineOf = (due: string) => {
    const cached = deadlineCache.get(due)
    if (cached) return cached
    const value = computeDeadline(due)
    deadlineCache.set(due, value)
    return value
  }
  const computeDeadline = (due: string) => {
    const calendarDay = due <= todayIso ? nextWorkingDate(todayIso) : due
    // Takvim saati → üretim günü: birinci vardiyadan önceki saat bir önceki
    // üretim gününün gece vardiyasıdır.
    const early = cutoffMinute < shiftStartMinute
    const date = early ? isoDate(addDays(new Date(`${calendarDay}T00:00:00`), -1)) : calendarDay
    const clock = early ? cutoffMinute + 1440 : cutoffMinute
    const label =
      new Date(`${calendarDay}T00:00:00`).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
      }) + ` ${String(Math.floor(cutoffMinute / 60)).padStart(2, '0')}:${String(cutoffMinute % 60).padStart(2, '0')}`
    return { date, net: clockToNet(clock, fullDay), label }
  }

  const planOnce = (
    boost: Set<string>,
    variant: ScheduleVariant = {},
    shifts: Map<string, number> = new Map(),
  ) => {
    const demand = buildDemandSchedule(demandRows, productByCode, demandOptions)
    for (const entry of demand) {
      if (boost.has(lotKey(entry))) entry.boost = true
      const shift = shifts.get(lotKey(entry))
      if (shift) entry.orderShift = shift
      const deadline = deadlineOf(entry.dueDate)
      entry.deadlineDate = deadline.date
      entry.deadlineNet = deadline.net
      entry.deadlineLabel = deadline.label
      // Lotun karşıladığı her ihtiyaç günü 08:00'de kontrol edilir.
      for (const cp of entry.checkpoints ?? []) {
        const d = deadlineOf(cp.date)
        cp.deadlineDate = d.date
        cp.deadlineNet = d.net
        cp.deadlineLabel = d.label
      }
    }
    const scheduled = schedule(
      demand,
      productByCode,
      presses,
      buckets,
      { shiftMinutes, overtimeShiftMinutes },
      { ...scheduleOptions, ...variant },
    )
    return { ...scheduled, demand }
  }
  const dayMs = 86_400_000
  // Gecikme (yaklaşık dakika): gereken payın hazır olduğu an − teslim anı.
  const lateMinutes = (j: ScheduledJob) =>
    j.readyDate && j.deadlineDate && j.readyMinute !== undefined && j.deadlineMinute !== undefined
      ? Math.max(
          0,
          ((Date.parse(j.readyDate) - Date.parse(j.deadlineDate)) / dayMs) * 1440 +
            (j.readyMinute - j.deadlineMinute),
        )
      : Math.max(0, ((Date.parse(j.date) - Date.parse(j.dueDate)) / dayMs) * 1440)
  // Müşteri önce: en az plansız, en az geç MALZEME (bir parçanın üç geç
  // lotu tek duruştur), en az geç saat, sonra en az geç lot. Saat tam saate
  // yuvarlanır ki doluluk ve setup gerçekten karar verebilsin.
  const lateHoursOf = (r: ReturnType<typeof schedule>) =>
    Math.round(r.jobs.filter((j) => j.late).reduce((a, j) => a + lateMinutes(j), 0) / 60)
  const lateMaterialsOf = (r: ReturnType<typeof schedule>) =>
    new Set(r.jobs.filter((j) => j.late).map((j) => j.material)).size
  const score = (r: ReturnType<typeof schedule>) => [
    r.unplanned.length,
    lateMaterialsOf(r),
    lateHoursOf(r),
    r.jobs.filter((j) => j.late).length,
  ]
  const better = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
    return false
  }

  // Bağlanan rulo sonuna kadar basılır: geç işi kurtarmak için bile lot
  // bobinin altına kırpılmaz (eskiden kırpılıyordu; yük altında neredeyse
  // bütün parçalar 3000'lik bobinden 450'lik işlere bölünüyordu). Onarım
  // yalnızca sırayla yapılır: geç lot öne alınır, bütün presleri yeniden
  // dener ve acil setup kuralından yararlanır.
  // Her tur bir öncekinin geç lotlarını da öne alır; iyileşmeyen bir tur
  // aramayı bitirmez (bir sonraki tur daha iyi olabilir), ama en iyi plan
  // saklanır. Öne alınan lot yalnızca kendi fazının (bakiye/acil/dolgu)
  // başına geçer.
  let best = { result: planOnce(new Set()), boost: new Set<string>() }
  let bestScore = score(best.result)
  const lateBefore = best.result.jobs.filter((j) => j.late).length
  let rounds = 0
  let current = best
  for (let round = 0; round < 6; round++) {
    const late = current.result.jobs.filter((j) => j.late)
    if (late.length === 0) break
    rounds += 1
    const boost = new Set(current.boost)
    for (const lj of late) boost.add(lotKey(lj))
    if (boost.size === current.boost.size) break
    current = { result: planOnce(boost), boost }
    const trialScore = score(current.result)
    if (better(trialScore, bestScore)) {
      best = current
      bestScore = trialScore
    }
  }

  // ---- Senaryo araması: doluluk hedefi ---------------------------------------
  // Aynı kurallarla farklı sıralama ve pres seçimi denenir; en iyi plan
  // seçilir. Önce müşteri (en az plansız, en az geç kalem, en az geç süre),
  // sonra doluluk (ilk 7 gün), sonra en az setup. Hedef doluluğa ulaşınca,
  // arka arkaya 25 denemede iyileşme olmayınca, deneme sınırında ya da süre
  // dolunca durulur — sonsuza kadar denenmez; ne kadar denendiği raporlanır.
  const utilisationTarget = Math.min(100, Math.max(1, s.utilisationTarget ?? SETTINGS_DEFAULTS.utilisationTarget))
  const maxScenarios = Math.max(1, Math.round(s.maxScenarios ?? SETTINGS_DEFAULTS.maxScenarios))
  const UTILISATION_WINDOW_DAYS = 7
  const NO_IMPROVEMENT_LIMIT = 25
  const TIME_BUDGET_MS = 120_000
  const windowEnd = isoDate(addDays(new Date(`${todayIso}T00:00:00`), UTILISATION_WINDOW_DAYS - 1))
  const inWindow = (date: string) => date >= todayIso && date <= windowEnd
  const windowCapacity = new Map<string, number>()
  for (const [press, list] of buckets) {
    for (const b of list) if (inWindow(b.date)) sum(windowCapacity, press, b.minutes)
  }
  // Bugünün geçmiş saatleri kapasitede zaten yok; aynı saatlerdeki iş ve
  // bakım da sayılmaz (yoksa doluluk şişer).
  const todayStart = new Map<string, number>()
  for (const [press, list] of buckets) {
    const today = list.find((b) => b.date === todayIso)
    if (today) todayStart.set(press, today.startMinute ?? 0)
  }
  const clipped = (press: string, seg: { date: string; start: number; end: number }) =>
    seg.date === todayIso
      ? Math.max(0, seg.end - Math.max(seg.start, todayStart.get(press) ?? 0))
      : seg.end - seg.start
  for (const m of maintenance) if (inWindow(m.date)) sum(windowCapacity, m.press, -clipped(m.press, m))
  const frozenBusy = new Map<string, number>()
  const frozenProductive = new Map<string, number>()
  for (const job of frozenJobs) {
    for (const seg of job.segments ?? []) {
      if (!inWindow(seg.date)) continue
      sum(frozenBusy, job.press, clipped(job.press, seg))
      if (seg.kind === 'run') sum(frozenProductive, job.press, clipped(job.press, seg))
    }
  }
  const utilisationOf = (r: ReturnType<typeof schedule>) => {
    const busy = new Map(frozenBusy)
    const productive = new Map(frozenProductive)
    for (const j of r.jobs) {
      for (const seg of j.segments) {
        if (!inWindow(seg.date)) continue
        const len = clipped(j.press, seg)
        sum(busy, j.press, len)
        if (seg.kind === 'run') sum(productive, j.press, len)
      }
    }
    let productiveUsed = 0
    let cap = 0
    let used = 0
    const perPress = presses.map((p) => {
      const c = Math.max(0, windowCapacity.get(p.name) ?? 0)
      const u = Math.min(c, busy.get(p.name) ?? 0)
      cap += c
      used += u
      productiveUsed += Math.min(c, productive.get(p.name) ?? 0)
      return { press: p.name, capacityHours: Math.round(c / 6) / 10, busyHours: Math.round(u / 6) / 10, utilisation: c > 0 ? Math.round((u / c) * 1000) / 10 : 0 }
    })
    return {
      overall: cap > 0 ? Math.round((used / cap) * 1000) / 10 : 0,
      // Yalnızca üretim (setup, onay, rulo değişimi hariç): skor bunu
      // kullanır, yoksa fazla setup "daha dolu pres" gibi görünürdü.
      productive: cap > 0 ? Math.round((productiveUsed / cap) * 1000) / 10 : 0,
      perPress,
    }
  }
  const setupsOf = (r: ReturnType<typeof schedule>) => r.jobs.filter((j) => j.setupMinutes > 0).length
  // Doluluk tam yüzdeye yuvarlanır: yarım puanlık fark setup sayısını
  // ezmesin.
  const optScore = (r: ReturnType<typeof schedule>, productive: number) => [
    ...score(r),
    -Math.round(productive),
    setupsOf(r),
  ]
  const summaryOf = (label: string, r: ReturnType<typeof schedule>, util: number) => {
    const late = r.jobs.filter((j) => j.late)
    return {
      label,
      late: late.length,
      lateHours: Math.round(late.reduce((a, j) => a + lateMinutes(j), 0) / 6) / 10,
      unplanned: r.unplanned.length,
      utilisation: util,
      setups: setupsOf(r),
    }
  }

  const variants: { label: string; variant: ScheduleVariant }[] = [
    { label: 'Short jobs first', variant: { orderStrategy: 'spt' } },
    { label: 'Fewest presses first', variant: { orderStrategy: 'fewestPresses' } },
    { label: 'Fill gaps first', variant: { pressRule: 'earliestStart' } },
    { label: 'Spread the load', variant: { pressRule: 'leastLoaded' } },
    { label: 'Long jobs first', variant: { orderStrategy: 'lpt' } },
    { label: 'Short jobs + fill gaps', variant: { orderStrategy: 'spt', pressRule: 'earliestStart' } },
    { label: 'Fewest presses + fill gaps', variant: { orderStrategy: 'fewestPresses', pressRule: 'earliestStart' } },
    { label: 'Short jobs + spread the load', variant: { orderStrategy: 'spt', pressRule: 'leastLoaded' } },
  ]
  const variantPressRules: ScheduleVariant['pressRule'][] = ['earliestFinish', 'earliestStart', 'leastLoaded']
  for (let seed = 1; variants.length < maxScenarios - 1; seed++) {
    variants.push({
      label: `Shuffled order #${seed}`,
      variant: { orderStrategy: 'shuffle', seed, pressRule: variantPressRules[seed % variantPressRules.length] },
    })
  }

  const searchStarted = Date.now()
  const standardUtil = utilisationOf(best.result)
  let chosen = {
    label: 'Standard',
    variant: {} as ScheduleVariant,
    boost: best.boost,
    shifts: new Map<string, number>(),
    result: best.result,
    util: standardUtil,
    score: optScore(best.result, standardUtil.productive),
  }
  const tried = [summaryOf('Standard', best.result, standardUtil.overall)]
  // Hedefte durmak için geç kalem de olmamalı: dolu ama müşteriyi
  // durduran plan hedefe ulaşmış sayılmaz.
  const reached = (r: ReturnType<typeof schedule>, util: number) =>
    util >= utilisationTarget && r.unplanned.length === 0 && !r.jobs.some((j) => j.late)
  let stoppedBecause: 'target' | 'noImprovement' | 'limit' | 'time' = reached(
    best.result,
    standardUtil.overall,
  )
    ? 'target'
    : 'limit'
  let sinceImprovement = 0
  if (stoppedBecause !== 'target') {
    for (const { label, variant } of variants) {
      if (tried.length >= maxScenarios) {
        stoppedBecause = 'limit'
        break
      }
      if (Date.now() - searchStarted > TIME_BUDGET_MS) {
        stoppedBecause = 'time'
        break
      }
      let r = planOnce(best.boost, variant)
      let rBoost = best.boost
      // Bu denemede geç kalanlar da bir kez öne alınır.
      const lateHere = r.jobs.filter((j) => j.late)
      if (lateHere.length > 0) {
        const boost = new Set(best.boost)
        for (const lj of lateHere) boost.add(lotKey(lj))
        const again = planOnce(boost, variant)
        if (better(score(again), score(r))) {
          r = again
          rBoost = boost
        }
      }
      const util = utilisationOf(r)
      const sc = optScore(r, util.productive)
      tried.push(summaryOf(label, r, util.overall))
      if (better(sc, chosen.score)) {
        chosen = { label, variant, boost: rBoost, shifts: new Map(), result: r, util, score: sc }
        sinceImprovement = 0
        if (reached(r, util.overall)) {
          stoppedBecause = 'target'
          break
        }
      } else if (++sinceImprovement >= NO_IMPROVEMENT_LIMIT) {
        stoppedBecause = 'noImprovement'
        break
      }
    }
  }
  // ---- Yerel arama: geç kalemlere hedefli hamleler ---------------------------
  // Varyantlar bütün sırayı değiştirir; burada tek tek geç lotlar ele alınır:
  //  - geç lotu kendi fazı içinde 1, 2 ya da 4 gün öne sırala,
  //  - öne alma (boost) işaretini aç/kapat,
  //  - aynı preste ondan önce çalışan, geç olmayan bir lotu 2 gün arkaya al.
  // Her hamle planı baştan kurar ve yalnızca skor iyileşirse kabul edilir.
  // Süre ve deneme sayısı sınırlıdır.
  const LOCAL_SEARCH_EVALUATIONS = 150
  const LOCAL_SEARCH_MS = 60_000
  const localStarted = Date.now()
  let localEvaluations = 0
  let localImprovements = 0
  const tryMove = (boost: Set<string>, shifts: Map<string, number>): boolean => {
    localEvaluations += 1
    const r = planOnce(boost, chosen.variant, shifts)
    const util = utilisationOf(r)
    const sc = optScore(r, util.productive)
    if (!better(sc, chosen.score)) return false
    chosen = {
      label: chosen.label.endsWith('+ local search') ? chosen.label : `${chosen.label} + local search`,
      variant: chosen.variant,
      boost,
      shifts,
      result: r,
      util,
      score: sc,
    }
    localImprovements += 1
    return true
  }
  const budgetLeft = () =>
    localEvaluations < LOCAL_SEARCH_EVALUATIONS && Date.now() - localStarted < LOCAL_SEARCH_MS
  const triedMoves = new Set<string>()
  for (let pass = 0; pass < 3 && budgetLeft(); pass++) {
    const lateJobs = chosen.result.jobs
      .filter((j) => j.late)
      .sort((a, b) => lateMinutes(b) - lateMinutes(a))
    if (lateJobs.length === 0) break
    let improved = false
    for (const lj of lateJobs) {
      if (!budgetLeft()) break
      const key = lotKey(lj)
      const moves: (() => { boost: Set<string>; shifts: Map<string, number> })[] = []
      for (const days of [-1, -2, -4]) {
        moves.push(() => {
          const shifts = new Map(chosen.shifts)
          shifts.set(key, (shifts.get(key) ?? 0) + days)
          return { boost: chosen.boost, shifts }
        })
      }
      moves.push(() => {
        const boost = new Set(chosen.boost)
        if (boost.has(key)) boost.delete(key)
        else boost.add(key)
        return { boost, shifts: chosen.shifts }
      })
      // Aynı preste bu işten önce başlayan, geç olmayan son iki lot.
      const before = chosen.result.jobs
        .filter(
          (j) =>
            j.press === lj.press &&
            !j.late &&
            j.material !== lj.material &&
            (j.date < lj.date || (j.date === lj.date && j.setupStartMinute < lj.setupStartMinute)),
        )
        .sort((a, b) => b.date.localeCompare(a.date) || b.setupStartMinute - a.setupStartMinute)
        .slice(0, 2)
      for (const other of before) {
        const otherKey = lotKey(other)
        moves.push(() => {
          const shifts = new Map(chosen.shifts)
          shifts.set(otherKey, (shifts.get(otherKey) ?? 0) + 2)
          return { boost: chosen.boost, shifts }
        })
      }
      for (const [index, make] of moves.entries()) {
        if (!budgetLeft()) break
        const id = `${pass}|${key}|${index}`
        if (triedMoves.has(id)) continue
        triedMoves.add(id)
        const move = make()
        if (tryMove(move.boost, move.shifts)) {
          improved = true
          break
        }
      }
    }
    if (!improved) break
  }
  if (localEvaluations > 0) {
    tried.push({
      ...summaryOf(chosen.label, chosen.result, chosen.util.overall),
      label: localImprovements > 0 ? chosen.label : `Local search (${localEvaluations} moves, none better)`,
    })
  }

  const optimisation = {
    target: utilisationTarget,
    achieved: chosen.util.overall,
    standard: standardUtil.overall,
    chosen: chosen.label,
    tried: tried.length,
    stoppedBecause,
    windowDays: UTILISATION_WINDOW_DAYS,
    searchMs: Date.now() - searchStarted,
    localSearch: { evaluations: localEvaluations, improvements: localImprovements },
    perPress: chosen.util.perPress,
    // Karşılaştırma tablosu: seçilen + en iyi birkaç deneme.
    scenarios: [...tried]
      .sort(
        (a, b) =>
          a.unplanned - b.unplanned ||
          a.late - b.late ||
          a.lateHours - b.lateHours ||
          b.utilisation - a.utilisation ||
          a.setups - b.setups,
      )
      .slice(0, 8),
  }
  const chosenPressRule = chosen.variant.pressRule ?? 'earliestFinish'
  const result = chosen.result

  // Kalıbı tutulduğu için plana alınamayan lotun sebebi "kullanıcı dışladı"
  // değil: kalıp hazır değil ya da ömür alarmı açık. Doğrusu yazılsın.
  const userExcluded = new Set(
    inputs.overrides.filter((o) => o.kind === 'exclude').map((o) => o.material),
  )
  for (const item of result.unplanned) {
    if (!item.reason.startsWith('Excluded from planning') || userExcluded.has(item.material)) continue
    if (!unavailableMolds.includes(item.material)) continue
    item.reason = alarmedMolds.includes(item.material)
      ? 'Mould held: shot-limit alarm open until it is closed'
      : 'Mould held: not ready and no ready date'
  }

  const lateRepair = {
    rounds,
    lateBefore,
    lateAfter: result.jobs.filter((j) => j.late).length,
    boosted: Array.from(new Set(Array.from(best.boost).map((k) => k.split('|')[0]))).sort(),
  }

  // Dondurulmuş işler motorun çıktısında yok ama sahada yapılacaklar.
  const approvedOn = snapshot ? isoDate(plantClock(snapshot.createdAt, timeZone)) : ''
  const jobs: PlanJob[] = [
    ...frozenJobs.map(
      (job): PlanJob => ({
        material: job.material,
        press: job.press,
        hall: job.hall,
        date: job.date,
        endDate: job.endDate ?? job.date,
        spansDays: (job.endDate ?? job.date) !== job.date,
        phase: job.phase as ScheduledJob['phase'],
        urgency: 0,
        dueDate: job.date,
        bucketLabel: 'Frozen',
        late: false,
        quantity: job.quantity,
        shots: job.shots,
        coilsNeeded: job.coilsNeeded,
        coilChanges: 0,
        segments: (job.segments ?? []) as ScheduledJob['segments'],
        pinned: false,
        coProductQuantity: 0,
        setupStartMinute: job.setupStartMinute,
        setupEndMinute: job.setupStartMinute,
        qualityEndMinute: job.setupStartMinute,
        endMinute: job.endMinute,
        runMinutes: 0,
        setupMinutes: 0,
        qualityApprovalMinutes: 0,
        reason: `Frozen — from the plan approved on ${approvedOn}`,
        frozen: true,
      }),
    ),
    ...result.jobs,
  ]

  // ---- Geç kalemler: saat olarak ve malzeme bazında --------------------------
  // Gecikme = gereken adedin hazır olduğu saat − teslim anı (ör. Sal 08:00).
  const shiftNetHours = fullDay.netMinutes / 3 / 60
  const clockTs = (date: string, clock: number) => Date.parse(`${date}T00:00:00Z`) + clock * 60_000
  for (const job of result.jobs) {
    if (!job.late || !job.readyDate || job.readyMinute === undefined || !job.deadlineDate || job.deadlineMinute === undefined) continue
    const shifts = shiftsByPressDate.get(`${job.press}|${job.readyDate}`) ?? 3
    const pressDay = buildDayTimeline(shiftStartMinute, shiftMinutes, Math.max(1, shifts), plannedStops)
    const ready = clockTs(job.readyDate, netToClock(job.readyMinute, pressDay))
    const deadline = clockTs(job.deadlineDate, netToClock(job.deadlineMinute, fullDay))
    job.lateHours = Math.max(0.1, Math.round(((ready - deadline) / 3_600_000) * 10) / 10)
  }
  const lateByMaterial = new Map<string, ScheduledJob[]>()
  for (const job of result.jobs) {
    if (!job.late) continue
    const list = lateByMaterial.get(job.material) ?? []
    list.push(job)
    lateByMaterial.set(job.material, list)
  }
  const lateItems = Array.from(lateByMaterial.entries())
    .map(([material, list]) => {
      const sorted = [...list].sort((a, b) => (a.deadlineDate ?? a.dueDate).localeCompare(b.deadlineDate ?? b.dueDate))
      const first = sorted[0]
      const maxLate = Math.max(...list.map((j) => j.lateHours ?? 0))
      const presses = Array.from(new Set(list.map((j) => j.press)))
      const shiftsNeeded = Math.max(1, Math.ceil(maxLate / Math.max(1, shiftNetHours)))
      const product = productByCode.get(material)
      const canFlex = !product?.flexiblePress && [product?.altMachine1, product?.altMachine2, product?.altMachine3, product?.altMachine4].some((m) => m && m.trim())
      return {
        material,
        presses,
        lots: list.length,
        deadline: first.deadlineLabel ?? first.dueDate,
        ready: first.readyDate ?? first.date,
        neededQuantity: list.reduce((a, j) => a + (j.neededQuantity ?? j.quantity), 0),
        lateHours: Math.round(maxLate * 10) / 10,
        suggestion:
          `≈${Math.round(maxLate * 10) / 10} h more on ${presses.join('/')} before ${first.deadlineLabel ?? first.dueDate}: ` +
          `${shiftsNeeded} overtime shift${shiftsNeeded > 1 ? 's' : ''} (${Math.round(shiftNetHours * 10) / 10} h net each)` +
          (canFlex ? ', or tick Flexible press so it may use its alternative presses' : ''),
      }
    })
    .sort((a, b) => b.lateHours - a.lateHours)

  const inTransitByRaw = new Map<string, { eta?: string; kg: number }[]>()
  for (const t of inputs.inTransit ?? []) {
    const raw = t.material.trim()
    inTransitByRaw.set(raw, [...(inTransitByRaw.get(raw) ?? []), { eta: t.eta, kg: t.quantityKg }])
  }
  const rawNeeds = buildRawMaterialPlan(result.jobs, productByCode, rawStockByMaterial, inTransitByRaw)
  const missingRawSpec = materialsMissingRawSpec(result.jobs, productByCode)

  // Bu haftadan gerçekte ne kaldığı.
  const weekEnd = isoDate(addDays(horizonMonday, 6))
  let full = 0
  let remaining = 0
  for (const press of presses) {
    for (const bucket of capModel.weekBuckets(press.name, horizonMonday)) {
      if (bucket.date > weekEnd) continue
      const adjusted =
        capacityFactor === 1 ? bucket.minutes : Math.floor(bucket.minutes * capacityFactor)
      full += adjusted
      remaining += remainingCapacityMinutes(
        bucket.date,
        todayIso,
        nowClockMinute,
        adjusted,
        buildDayTimeline(shiftStartMinute, shiftMinutes, bucket.shifts, plannedStops),
      )
    }
  }

  const eligible = new Set<string>()
  for (const product of productByCode.values()) {
    for (const m of eligiblePressesOf(product)) eligible.add(m)
  }

  const days: PlanDay[] = []
  for (const [press, list] of buckets) {
    for (const b of list) {
      if (b.shifts > 0 || b.minutes > 0) days.push({ press, date: b.date, shifts: b.shifts, minutes: b.minutes })
    }
  }

  const lateCount = result.jobs.filter((j) => j.late).length
  const lateMaterialCount = new Set(result.jobs.filter((j) => j.late).map((j) => j.material)).size
  // Acil hammadde: stoğun (ve yoldan gelenin) yetmediği ilk iş önümüzdeki
  // RAW_URGENT_DAYS İŞ GÜNÜ içinde başlıyor (bugün dahil). Diğer eksikler Raw
  // Material Coverage'da izlenir.
  let rawUrgentUntil = todayIso
  for (let n = isWorkingDate(todayIso) ? 1 : 0; n < RAW_URGENT_DAYS; n++) rawUrgentUntil = nextWorkingDate(rawUrgentUntil)
  const rawShortages = rawNeeds.filter((r) => !!r.shortFrom && r.shortFrom.date <= rawUrgentUntil).length
  const warnings = buildWarnings({
    inputs,
    holidayCount: holidays.size,
    rawShortages,
    lateCount,
    lateMaterialCount,
    missingRawSpec: missingRawSpec.length,
    alarmedMolds,
    unavailableMolds,
    maintenance,
    moldBlackouts,
    todayIso,
  })

  if (daily.unreadable.length > 0 && daily.byMaterial.size > 0) {
    warnings.push(
      `${daily.unreadable.length} ZPP_DAILY column(s) are not dates and were ignored: ` +
        `${daily.unreadable.slice(0, 4).join(', ')}${daily.unreadable.length > 4 ? '…' : ''}.`,
    )
  }
  if ((inputs.dailyDemand?.length ?? 0) > 0 && !daily.until) {
    warnings.push(
      'ZPP_DAILY is uploaded but none of its column headers could be read as dates — ' +
        'the plan uses the weekly ZPP only. Check the file on the SAP Data page.',
    )
  }
  // Lot kuralı eksik: ne minimum lot ne gerçek bir rulo ağırlığı var. Lot tam
  // ihtiyaç kadar kuruldu; ana veri düzeltilmeli.
  const noLotRule = Array.from(new Set(result.jobs.map((j) => j.material)))
    .filter((m) => lotRuleOf(productByCode.get(m)) === 'missing')
    .sort()
  if (noLotRule.length > 0) {
    warnings.push(
      `${noLotRule.length} part(s) have neither a Min. lot nor a real coil weight in master data: ` +
        `${noLotRule.slice(0, 8).join(', ')}${noLotRule.length > 8 ? '…' : ''}. ` +
        'They are planned at exactly the quantity needed. Enter Min. lot (pcs), or Coil Weight (kg) ' +
        'and Gross Weight (kg/piece), on the Master Data page.',
    )
  }
  // Tek işte yüzlerce rulo: neredeyse her zaman master data'da rulo ağırlığı
  // ya da parça brüt ağırlığı yanlış birimle girilmiştir.
  const coilHeavy = result.jobs.filter((j) => j.coilsNeeded > MANY_COILS)
  if (coilHeavy.length > 0) {
    warnings.push(
      `${coilHeavy.length} job(s) need more than ${MANY_COILS} coils in one run: ` +
        coilHeavy
          .slice(0, 5)
          .map((j) => `${j.material} (${j.coilsNeeded.toLocaleString('en-GB')} coils)`)
          .join(', ') +
        `${coilHeavy.length > 5 ? '…' : ''}. Check Coil Weight (kg) and Gross Weight (kg/piece) ` +
        'in master data — a value in tonnes or grams gives this.',
    )
  }
  if (producedSinceStock.jobs > 0) {
    warnings.push(
      `${producedSinceStock.jobs} approved job(s) (${Math.round(producedSinceStock.quantity).toLocaleString('en-GB')} pcs) ` +
        `ran after the last MB52 stock upload (${producedSinceStock.stockDay}). They are counted as stock ` +
        `until the next upload — upload MB52 to replace this assumption with real stock.`,
    )
  }

  const pinnedPress = new Map(
    inputs.overrides.filter((o) => o.kind === 'pin' && o.press).map((o) => [o.material, o.press!]),
  )
  const pressRules = new Map<string, { main: string; flexible: boolean; pinned?: string }>()
  for (const product of productByCode.values()) {
    pressRules.set(product.code, {
      main: product.mainMachine?.trim() ?? '',
      flexible: !!product.flexiblePress,
      pinned: pinnedPress.get(product.code),
    })
  }

  // ---- Alarmlar: hangi kalıp / makine müşteriyi bekletiyor? ---------------
  const dieUnavailable: DieUnavailability[] = []
  for (const r of inputs.readiness) {
    if (r.ready) continue
    if (!r.readyDate) dieUnavailable.push({ material: r.material, kind: 'no-date', reason: r.reason })
    else if (r.readyDate >= todayIso)
      dieUnavailable.push({
        material: r.material,
        kind: 'until',
        until: r.readyDate,
        untilMinute: r.readyMinute,
        reason: r.reason,
      })
  }
  for (const material of alarmedMolds) dieUnavailable.push({ material, kind: 'shot-limit' })
  for (const m of inputs.moldMaintenance) {
    const until = m.dateTo ?? m.date
    if (until < todayIso) continue
    dieUnavailable.push({ material: m.material, kind: 'maintenance', from: m.date, until, note: m.note })
  }
  const hhmm = (minute: number) =>
    `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
  const horizonEnd = horizonDates[horizonDates.length - 1] ?? todayIso
  const machineUnavailable: MachineUnavailability[] = []
  for (const b of inputs.machineProblems ?? []) {
    if (b.status !== 'open') continue
    machineUnavailable.push({
      press: b.press,
      kind: b.stopsPress ? 'breakdown' : 'fault-running',
      from: b.occurredAt,
      until: b.stopsPress ? b.expectedUpDate : undefined,
      untilMinute: b.stopsPress ? b.expectedUpMinute : undefined,
      label: b.stopsPress
        ? `Breakdown: ${b.problemType} — ${
            b.expectedUpDate
              ? `expected back ${b.expectedUpDate}${b.expectedUpMinute !== undefined ? ` ${hhmm(b.expectedUpMinute)}` : ''}`
              : 'down until solved (no expected time)'
          }`
        : `Fault: ${b.problemType} — press still running`,
    })
  }
  for (const m of inputs.pressMaintenance) {
    if (m.status !== 'planned' || m.date < todayIso || m.date > horizonEnd) continue
    machineUnavailable.push({
      press: m.press,
      kind: 'maintenance',
      from: m.date,
      until: m.date,
      label: `Maintenance ${m.date} ${hhmm(m.startMinute)}–${hhmm(m.endMinute)}: ${m.reason}`,
    })
  }
  const alarms = buildPlanAlarms({
    todayIso,
    lots: result.demand.map((e) => ({ material: e.material, qty: e.qty, dueDate: e.dueDate })),
    jobs,
    unplanned: result.unplanned,
    dies: dieUnavailable,
    machines: machineUnavailable,
    eligiblePresses: (material) => eligiblePressesOf(productByCode.get(material)),
  })

  const audit = auditPlan({
    pressRules,
    jobs,
    maintenance,
    moldBlackouts,
    todayIso,
    setupGapMinutes,
    coilSetupGapMinutes,
    concurrentSetupsPerHall,
    maxSetupsPlantWide,
    maxSetupsPlantWideNormal,
    pressRule: chosenPressRule,
    coilUnits: new Map(
      Array.from(productByCode.values())
        .map((p): [string, number] => [
          p.code,
          shotsPerCoil(p) * (p.moldCavities && p.moldCavities > 0 ? p.moldCavities : 1),
        ])
        .filter(([, unit]) => unit > 0),
    ),
  })
  if (!audit.ok) {
    const broken = audit.rules.filter((r) => r.violationCount > 0).length
    warnings.unshift(
      `The plan check found ${broken} broken rule(s) — see "Plan check" below. Do not approve this plan.`,
    )
  }

  // ---- Kapasite öngörüsü (Capacity Dashboard) ---------------------------
  // Plan ufkundan bağımsız: ZPP'de kaç hafta varsa. Kapasite takvimin saf
  // saatidir; ölçülen gerçekleşme oranı uygulanmaz (talep zaten performans
  // çarpanıyla büyütülüyor, ikisi birden uygulansa kayıp iki kez sayılırdı).
  const forecastWeeks = Math.min(
    52,
    Math.max(1, ...inputs.weeklyDemand.map((d) => d.periods.length)),
  )
  const holidayNames = new Map<string, string>()
  for (const h of inputs.workCalendar?.holidays ?? []) holidayNames.set(h, 'Holiday')
  for (const h of inputs.officialHolidays) holidayNames.set(h.date, h.name)
  const forecastWeekList = Array.from({ length: forecastWeeks }, (_, w) => {
    const start = addDays(horizonMonday, w * 7)
    const names: string[] = []
    for (let d = 0; d < 7; d++) {
      const name = holidayNames.get(isoDate(addDays(start, d)))
      if (name && !names.includes(name)) names.push(name)
    }
    return { start: isoDate(start), label: `W${isoWeek(start)}`, holidays: names }
  })
  const capacityMinutes = new Map<string, number[]>()
  for (const press of presses) {
    capacityMinutes.set(
      press.name,
      forecastWeekList.map((_, w) => {
        const start = addDays(horizonMonday, w * 7)
        let total = 0
        for (const b of capModel.weekBuckets(press.name, start)) {
          // Plandaki gibi: ölçülen gerçekleşme oranı, sonra bugünün geçmiş saatleri.
          const adjusted = capacityFactor === 1 ? b.minutes : Math.floor(b.minutes * capacityFactor)
          const timeline = buildDayTimeline(shiftStartMinute, shiftMinutes, b.shifts, plannedStops)
          total += remainingCapacityMinutes(b.date, todayIso, nowClockMinute, adjusted, timeline)
        }
        return total
      }),
    )
  }
  const capacity = buildCapacityForecast({
    products: inputs.products,
    weeklyDemand: inputs.weeklyDemand,
    stock: inputs.stock,
    presses: presses.map((p) => ({ name: p.name, category: p.category })),
    weeks: forecastWeekList,
    capacityMinutes,
    stockLocations: [...counted.finished],
  })
  capacity.unassigned = capacity.unassigned.slice(0, 100)

  // Hammadde MRP'si — plandan bağımsız: ZPP'nin son haftasına kadar talep,
  // mamul stoğu (Finished goods tikli depolar) FIFO düşülür, kalan brüt
  // ağırlıkla kg'a çevrilir; eldeki rulo ve yoldakiler arzdır.
  // Sipariş haftaları sayfada kullanıcının ayarıyla hesaplanır (src/lib/rawMrp.ts).
  const mrpWeekCount = Math.max(1, ...inputs.weeklyDemand.map((d) => d.periods.length))
  const mrpWeeks = Array.from({ length: Math.min(60, mrpWeekCount) }, (_, w) => {
    const monday = addDays(horizonMonday, w * 7)
    // Emniyet iş günüyle sayılır; tatilli haftanın iş günü azdır.
    const workingDays = Array.from({ length: 7 }, (_, d) => isoDate(addDays(monday, d))).filter(isWorkingDate).length
    return { start: isoDate(monday), label: isoWeekLabel(monday), workingDays }
  })
  const rawRequirements = buildRawRequirements({
    products: inputs.products,
    weeklyDemand: inputs.weeklyDemand,
    finishedStock: stockByMaterial,
    rawStock: rawStockByMaterial,
    inTransit: inputs.inTransit,
    weeks: mrpWeeks,
    workingDaysPerWeek,
  })

  const run: PlanRun = {
    rawRequirements,
    capacity,
    optimisation,
    lateItems,
    computedAt: nowMs,
    todayIso,
    nowClockMinute,
    horizonStart: isoDate(horizonMonday),
    timeZone,
    shiftMinutes,
    shiftStartMinute,
    horizonWeeks,
    capacityFactor,
    globalFrozenDays,
    safetyStockDays,
    producedSinceStock,
    dailyUntil: daily.until,
    lateRepair,
    alarms,
    presses: presses.map((p) => ({ name: p.name, hall: p.hall, category: p.category })),
    plannedStops: plannedStops.map((p) => ({
      shiftIndex: p.shiftIndex,
      name: p.name,
      kind: p.kind,
      startMinute: p.startMinute,
      durationMinutes: p.durationMinutes,
    })),
    days,
    jobs,
    unplanned: result.unplanned,
    maintenance,
    rawNeeds,
    rawUrgentUntil,
    warnings,
    truncatedInputs: inputs.truncatedInputs,
    frozenCount: frozenJobs.length,
    frozenFrom: frozenJobs.length > 0 && snapshot ? snapshot.createdAt : null,
    thisWeekCapacity: { full, remaining, elapsed: full - remaining },
    eligiblePresses: Array.from(eligible).sort(),
    alarmedMolds,
    unavailableMolds,
    audit,
  }
  // Bağımsız doğrulama: motorun kodunu kullanmadan stoğu yeniden yürütür,
  // kuralları yeniden sayar, gecikmelerin kaçınılmaz olup olmadığını sınar.
  // Hata verirse plan yine de çıkar.
  // Doğrulama, planlamacının müdahalesinden sonraki onaylı planı görür:
  // serbest bırakılan işler yok, kaydırılan işler yeni yerinde.
  const effectiveSnapshot = snapshot
    ? {
        ...snapshot,
        jobs: snapshot.jobs.filter((j) => !released.has(j)).map((j) => shiftedJobs.get(j) ?? j),
      }
    : snapshot
  run.validation = safeValidatePlan({ ...inputs, latestSnapshot: effectiveSnapshot }, run, nowMs)
  run.dataCoverage = dataCoverageOf(inputs)
  return run
}

const COVERAGE_LIST_CAP = 400

export function dataCoverageOf(inputs: PlanInputs): DataCoverage {
  const master = Array.from(new Set(inputs.products.map((p) => p.code.trim()).filter(Boolean))).sort()
  const sets = {
    weeklyDemand: new Set(inputs.weeklyDemand.map((r) => r.material.trim())),
    dailyDemand: new Set((inputs.dailyDemand ?? []).map((r) => r.material.trim())),
    stock: new Set(inputs.stock.map((r) => r.material.trim())),
  }
  const keys = ['weeklyDemand', 'dailyDemand', 'stock'] as const
  const files = {} as DataCoverage['files']
  for (const key of keys) {
    const uploaded = sets[key].size > 0
    const missing = uploaded ? master.filter((m) => !sets[key].has(m)) : []
    files[key] = { uploaded, missingCount: missing.length, missing: missing.slice(0, COVERAGE_LIST_CAP) }
  }
  // Master data'daki hammadde (rulo) kodları: MB52'de satırı var mı?
  const rawCodes = Array.from(
    new Set(inputs.products.map((p) => p.rawMaterialCode?.trim() ?? '').filter(Boolean)),
  ).sort()
  const rawMissing = sets.stock.size > 0 ? rawCodes.filter((c) => !sets.stock.has(c)) : []
  files.rawStock = {
    uploaded: sets.stock.size > 0,
    missingCount: rawMissing.length,
    missing: rawMissing.slice(0, COVERAGE_LIST_CAP),
  }
  const uploadedKeys = keys.filter((k) => files[k].uploaded)
  const everywhere =
    uploadedKeys.length === 0 ? [] : master.filter((m) => uploadedKeys.every((k) => !sets[k].has(m)))
  return {
    materials: master.length,
    files,
    missingEverywhereCount: everywhere.length,
    missingEverywhere: everywhere.slice(0, COVERAGE_LIST_CAP),
  }
}

/** Presin günleri, kesintisiz eksende (motorun ekseniyle aynı). */
function pressWindows(list: DayBucket[]) {
  const days: { date: string; offset: number; capacity: number; startNet: number }[] = []
  let offset = 0
  for (const b of list) {
    if (b.minutes <= 0) continue
    days.push({ date: b.date, offset, capacity: b.minutes, startNet: b.startMinute ?? 0 })
    offset += b.minutes
  }
  return days
}

type PressWindows = ReturnType<typeof pressWindows>

/** Gün içi parçalar → eksen; geçmişte ya da takvim dışında kalan kısım düşer. */
function toGlobalParts(windows: PressWindows, segments: { kind: string; date: string; start: number; end: number }[]) {
  const parts: { kind: string; start: number; end: number }[] = []
  for (const seg of segments) {
    const day = windows.find((d) => d.date === seg.date)
    if (!day) continue
    const start = day.offset + Math.max(0, seg.start - day.startNet)
    const end = day.offset + Math.min(day.capacity, seg.end - day.startNet)
    if (end > start) parts.push({ kind: seg.kind, start, end })
  }
  return parts
}

/** Eksen aralığı → gün içi parçalar (gün sınırında bölünür). */
function fromGlobal(windows: PressWindows, start: number, end: number, kind: string) {
  const out: { kind: string; date: string; start: number; end: number }[] = []
  for (const day of windows) {
    const s = Math.max(start, day.offset)
    const e = Math.min(end, day.offset + day.capacity)
    if (e > s) out.push({ kind, date: day.date, start: day.startNet + (s - day.offset), end: day.startNet + (e - day.offset) })
  }
  return out
}

function clockText(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

function listed(items: string[]): string {
  return `${items.slice(0, 6).join(', ')}${items.length > 6 ? '…' : ''}`
}

function buildWarnings(ctx: {
  inputs: PlanInputs
  holidayCount: number
  rawShortages: number
  lateCount: number
  lateMaterialCount: number
  missingRawSpec: number
  alarmedMolds: string[]
  unavailableMolds: string[]
  maintenance: MaintenanceBlock[]
  moldBlackouts: { material: string; date: string }[]
  todayIso: string
}): string[] {
  const { inputs, todayIso } = ctx
  const list: string[] = []
  if (inputs.presses.length === 0)
    list.push('No presses defined — add them on the Press Definitions page.')
  if (inputs.templates.length === 0)
    list.push('No work calendar defined for any press — defaulting to 1 shift.')
  if (inputs.weeklyDemand.length === 0) list.push('No ZPP weekly demand data uploaded.')
  if (inputs.stock.length === 0)
    list.push('No MB52 stock data uploaded — planning without deducting stock.')
  const missingMaxShots = inputs.products.filter((p) => !p.maxShots).length
  if (missingMaxShots > 0)
    list.push(`${missingMaxShots} materials have no max shot limit — the limit is not enforced.`)
  if (ctx.holidayCount === 0)
    list.push('No public holidays stored — open the Work Calendar page once so they are saved.')
  if (ctx.rawShortages > 0)
    list.push(
      `${ctx.rawShortages} raw material(s) run out within ${RAW_URGENT_DAYS} working days — coils must be sourced now (see Raw material — urgent).`,
    )
  if (ctx.lateCount > 0)
    list.push(
      `${ctx.lateMaterialCount} part(s) (${ctx.lateCount} lot(s)) are not ready by the delivery time — the customer would stop. ` +
        `The engine re-planned and could not avoid it; see "Late materials" above for what to change.`,
    )
  if (ctx.missingRawSpec > 0)
    list.push(
      `${ctx.missingRawSpec} materials have no raw material code or gross weight — the raw material check cannot run.`,
    )
  // Plana doğrudan giren bakım ve alarm kararları görünür olmalı — "iş neden
  // o güne konmadı" sorusunun cevabı bunlar.
  if (ctx.alarmedMolds.length > 0)
    list.push(
      `${ctx.alarmedMolds.length} mold(s) passed their periodic maintenance limit ` +
        `and are held out of the plan until the alarm is closed: ${listed(ctx.alarmedMolds)}.`,
    )
  const heldWithoutDate = ctx.unavailableMolds.filter((m) => !ctx.alarmedMolds.includes(m))
  if (heldWithoutDate.length > 0)
    list.push(
      `${heldWithoutDate.length} mold(s) are marked not ready with no date, ` +
        `so they are held out of the plan entirely: ${listed(heldWithoutDate)}.`,
    )
  const pressDown = Array.from(
    new Set(ctx.maintenance.filter((b) => b.date >= todayIso).map((b) => b.press)),
  )
  if (pressDown.length > 0)
    list.push(
      `${pressDown.length} press(es) have maintenance booked in the horizon and ` +
        `are unavailable for those hours: ${listed(pressDown)}.`,
    )
  const upcoming = ctx.moldBlackouts.filter((b) => b.date >= todayIso)
  if (upcoming.length > 0) {
    const moulds = Array.from(new Set(upcoming.map((b) => b.material)))
    list.push(
      `${moulds.length} mould${moulds.length > 1 ? 's are' : ' is'} in maintenance on ` +
        `${upcoming.length} day(s) and cannot run then: ${listed(moulds)}.`,
    )
  }
  return list
}

// ---- Ekran tarafı: haftalara bölme -----------------------------------------

export interface PlanWeek {
  weekStart: string
  dates: string[]
  jobs: PlanJob[]
  idlePresses: { name: string; reason: string }[]
}

/**
 * Planı takvim haftalarına böler ve iş almayan her pres için sebep yazar —
 * boş satır tek başına belirsizdir: talep yok, çalıştırabileceği iş yok ya
 * da kapasite yok üç ayrı sorundur.
 */
export function groupPlanWeeks(run: PlanRun): PlanWeek[] {
  const weekOf = (date: string) => isoDate(mondayOf(new Date(`${date}T00:00:00`)))
  const capacity = new Map<string, number>()
  const byWeek = new Map<string, { dates: Set<string>; jobs: PlanJob[] }>()
  const entryOf = (weekStart: string) => {
    let entry = byWeek.get(weekStart)
    if (!entry) {
      entry = { dates: new Set<string>(), jobs: [] }
      byWeek.set(weekStart, entry)
    }
    return entry
  }
  for (const day of run.days) {
    capacity.set(`${day.press}|${day.date}`, day.minutes)
    if (day.minutes > 0) entryOf(weekOf(day.date)).dates.add(day.date)
  }
  for (const job of run.jobs) {
    // Hafta kapanmadan bitmeyen iş sonraki haftaya taşar; parçalarının
    // düştüğü her haftada görünmeli.
    const jobDates = new Set<string>([job.date, ...job.segments.map((seg) => seg.date)])
    const touched = new Map<string, string[]>()
    for (const date of jobDates) {
      if (!date) continue
      const week = weekOf(date)
      touched.set(week, [...(touched.get(week) ?? []), date])
    }
    for (const [week, dates] of touched) {
      const entry = entryOf(week)
      for (const date of dates) entry.dates.add(date)
      entry.jobs.push(job)
    }
  }

  const eligible = new Set(run.eligiblePresses)
  return Array.from(byWeek.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, entry]) => {
      const dates = Array.from(entry.dates).sort()
      const busy = new Set(entry.jobs.map((j) => j.press))
      const idlePresses = run.presses
        .filter((p) => !busy.has(p.name))
        .map((p) => {
          const total = dates.reduce((acc, d) => acc + (capacity.get(`${p.name}|${d}`) ?? 0), 0)
          const reason =
            total <= 0
              ? 'no capacity'
              : !eligible.has(p.name)
                ? 'no material lists it'
                : 'no demand for its materials'
          return { name: p.name, reason }
        })
      return { weekStart, dates, jobs: entry.jobs, idlePresses }
    })
}
