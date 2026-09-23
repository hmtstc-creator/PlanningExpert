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

import { addDays, DEFAULT_PLANT_TIME_ZONE, isoDate, mondayOf, plantClock } from './dates'
import {
  buildDemandSchedule,
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
import {
  schedule,
  type PlanOverride,
  type ScheduledJob,
  type UnplannedItem,
} from './scheduler'

const COUNTED_STOCK = new Set(['finished_goods', 'production_area'])
const RAW_STOCK = new Set(['raw_material'])
export const DEFAULT_HORIZON_WEEKS = 4
/** Emniyet stoğu varsayılanı (iş günü). Work Calendar sayfasından değişir. */
export const DEFAULT_SAFETY_STOCK_DAYS = 2

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
  country?: string
  timeZone?: string
}

/** Planın okuduğu her şey, veritabanındaki hâliyle. */
export interface PlanInputs {
  products: (ProductSpec & { maxShots?: number })[]
  weeklyDemand: { material: string; overdue?: number; periods: DemandInput['periods'] }[]
  stock: {
    material: string
    storageLocation?: string
    unrestricted?: number
    /** MB52 yükleme zamanı (ms). */
    uploadedAt?: number
  }[]
  locations: { code: string; category: string }[]
  presses: PlanPress[]
  templates: { press: string; workingDays: number; shiftsPerDay: number; overtimeShifts: number }[]
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
  /** Eksik okunan tablolar ('master data', 'demand', 'stock'). */
  truncatedInputs: string[]
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
  warnings: string[]
  truncatedInputs: string[]
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
}

function sum<K>(map: Map<K, number>, key: K, add: number) {
  map.set(key, (map.get(key) ?? 0) + add)
}

export function computePlan(inputs: PlanInputs, nowMs: number): PlanRun {
  const s = inputs.settings ?? {}
  const timeZone = s.timeZone || DEFAULT_PLANT_TIME_ZONE
  const shiftMinutes = s.shiftMinutes ?? 480
  const overtimeShiftMinutes = s.overtimeShiftMinutes ?? 480
  const setupGapMinutes = s.setupGapMinutes ?? 60
  const concurrentSetupsPerHall = s.concurrentSetupsPerHall ?? 1
  const coilSetupGapMinutes = s.coilSetupGapMinutes ?? 30
  const shiftStartMinute = s.shiftStartMinute ?? 420 // 07:00
  const breakMinutesPerShift = s.breakMinutesPerShift ?? 0
  const capacityFactor = s.capacityFactor ?? 1
  const horizonWeeks = Math.min(30, Math.max(1, s.planningHorizonWeeks ?? DEFAULT_HORIZON_WEEKS))
  const globalFrozenDays = Math.max(0, s.frozenDays ?? 0)
  const safetyStockDays = Math.max(0, s.safetyStockDays ?? DEFAULT_SAFETY_STOCK_DAYS)
  const { presses, templates, plannedStops } = inputs

  // Vardiya planlı duruşları: devir, çay, yemek her vardiyada farklı.
  const stopMinutesByShift = [0, 0, 0]
  for (const stop of plannedStops) {
    const i = stop.shiftIndex - 1
    if (i >= 0 && i < 3) stopMinutesByShift[i] += stop.durationMinutes
  }

  const locCategory = new Map(inputs.locations.map((l) => [l.code, l.category]))
  const stockByMaterial = new Map<string, number>()
  const rawStockByMaterial = new Map<string, number>()
  for (const row of inputs.stock) {
    const cat = row.storageLocation ? locCategory.get(row.storageLocation) : undefined
    if (COUNTED_STOCK.has(cat ?? 'finished_goods')) {
      sum(stockByMaterial, row.material, row.unrestricted ?? 0)
    }
    if (cat && RAW_STOCK.has(cat)) sum(rawStockByMaterial, row.material, row.unrestricted ?? 0)
  }

  const productByCode = new Map<string, ProductSpec>()
  for (const p of inputs.products) productByCode.set(p.code, p)

  const workingDayKeys = inputs.workCalendar?.workingDays ?? ['MO', 'TU', 'WE', 'TH', 'FR']
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
  const frozenJobs =
    !snapshot || snapshot.truncated || frozenUntilByPress.size === 0
      ? []
      : snapshot.jobs.filter((job) => {
          const until = frozenUntilByPress.get(job.press)
          if (!until || job.date < todayIso) return false
          return job.date <= until && (job.segments?.length ?? 0) > 0
        })

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
      if (job.date >= todayIso) continue
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

  const demand = buildDemandSchedule(
    inputs.weeklyDemand.map((d) => ({
      material: d.material,
      overdue: d.overdue ?? 0,
      periods: d.periods,
      stock: (stockByMaterial.get(d.material) ?? 0) + (committedByMaterial.get(d.material) ?? 0),
    })),
    productByCode,
    {
      baseMonday: horizonMonday,
      horizonWeeks,
      workingDaysPerWeek,
      workingDayKeys,
      today: todayIso,
      safetyStockDays,
    },
  )

  // ---- Kapasite kovaları ---------------------------------------------------
  const templateByPress = new Map(templates.map((t) => [t.press, t]))
  const patternOf = (press: string) =>
    templateByPress.get(press) ?? { workingDays: workingDaysPerWeek, shiftsPerDay: 1, overtimeShifts: 0 }

  const buckets = new Map<string, DayBucket[]>()
  for (const press of presses) {
    const all: DayBucket[] = []
    for (let w = 0; w < horizonWeeks; w++) {
      all.push(
        ...buildWeekBuckets(
          addDays(horizonMonday, w * 7),
          patternOf(press.name),
          { shiftMinutes, overtimeShiftMinutes, breakMinutesPerShift, stopMinutesByShift },
          holidays,
          workingDayKeys,
        ),
      )
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
  const { blackouts: moldBlackouts, unavailable: unavailableMolds } = buildMoldBlackouts(
    inputs.moldMaintenance,
    inputs.readiness,
    horizonDates,
    alarmedMolds,
  )

  // Pres bakımı dolu bir aralıktır: gün kısalmaz, günün bir saati kapanır.
  const maintenance: MaintenanceBlock[] = []
  for (const row of inputs.pressMaintenance) {
    const shifts = shiftsByPressDate.get(`${row.press}|${row.date}`) ?? 0
    if (shifts <= 0) continue
    const block = pressMaintenanceBlock(
      row,
      buildDayTimeline(shiftStartMinute, shiftMinutes, shifts, plannedStops),
    )
    if (block) maintenance.push(block)
  }

  const overrides: PlanOverride[] = inputs.overrides.map((o) => ({
    material: o.material,
    kind: o.kind as PlanOverride['kind'],
    press: o.press,
    date: o.date,
  }))

  const result = schedule(demand, productByCode, presses, buckets, { shiftMinutes, overtimeShiftMinutes }, {
    setupGapMinutes,
    coilSetupGapMinutes,
    concurrentSetupsPerHall,
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
  })

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

  const rawNeeds = buildRawMaterialPlan(result.jobs, productByCode, rawStockByMaterial)
  const missingRawSpec = materialsMissingRawSpec(result.jobs, productByCode)

  // Bu haftadan gerçekte ne kaldığı.
  const weekEnd = isoDate(addDays(horizonMonday, 6))
  let full = 0
  let remaining = 0
  for (const press of presses) {
    for (const bucket of buildWeekBuckets(
      horizonMonday,
      patternOf(press.name),
      { shiftMinutes, overtimeShiftMinutes, breakMinutesPerShift },
      holidays,
      workingDayKeys,
    )) {
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
    for (const m of [
      product.mainMachine,
      product.altMachine1,
      product.altMachine2,
      product.altMachine3,
      product.altMachine4,
    ]) {
      if (m && m.trim()) eligible.add(m.trim())
    }
  }

  const days: PlanDay[] = []
  for (const [press, list] of buckets) {
    for (const b of list) {
      if (b.shifts > 0 || b.minutes > 0) days.push({ press, date: b.date, shifts: b.shifts, minutes: b.minutes })
    }
  }

  const lateCount = result.jobs.filter((j) => j.late).length
  const rawShortages = rawNeeds.filter((r) => r.shortageKg > 0).length
  const warnings = buildWarnings({
    inputs,
    holidayCount: holidays.size,
    rawShortages,
    lateCount,
    missingRawSpec: missingRawSpec.length,
    alarmedMolds,
    unavailableMolds,
    maintenance,
    moldBlackouts,
    todayIso,
  })

  if (producedSinceStock.jobs > 0) {
    warnings.push(
      `${producedSinceStock.jobs} approved job(s) (${Math.round(producedSinceStock.quantity).toLocaleString('en-GB')} pcs) ` +
        `ran after the last MB52 stock upload (${producedSinceStock.stockDay}). They are counted as stock ` +
        `until the next upload — upload MB52 to replace this assumption with real stock.`,
    )
  }

  const audit = auditPlan({
    jobs,
    maintenance,
    moldBlackouts,
    todayIso,
    setupGapMinutes,
    coilSetupGapMinutes,
    concurrentSetupsPerHall,
  })
  if (!audit.ok) {
    const broken = audit.rules.filter((r) => r.violationCount > 0).length
    warnings.unshift(
      `The plan check found ${broken} broken rule(s) — see "Plan check" below. Do not approve this plan.`,
    )
  }

  return {
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
}

function listed(items: string[]): string {
  return `${items.slice(0, 6).join(', ')}${items.length > 6 ? '…' : ''}`
}

function buildWarnings(ctx: {
  inputs: PlanInputs
  holidayCount: number
  rawShortages: number
  lateCount: number
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
      `${ctx.rawShortages} raw materials are short — coils must be sourced for the planned jobs.`,
    )
  if (ctx.lateCount > 0)
    list.push(
      `${ctx.lateCount} jobs are scheduled after the week they are needed — capacity is short.`,
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
