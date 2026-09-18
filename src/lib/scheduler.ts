// Yerleştirme (scheduling) katmanı: hafta bazlı talep kalemlerini pres/gün
// kovalarına kısıtları gözeterek yerleştirir. Saf fonksiyon — Convex/React
// bağımsız, bu yüzden birim testi yazılabilir.

import {
  type DayBucket,
  type DemandEntry,
  type ProductSpec,
  type RunPlan,
  type ShiftSettings,
  splitByMoldLimit,
} from './planning'

export interface PressSpec {
  name: string
  hall: string
}

export interface SchedulerOptions {
  /** Ardışık setuplar arasında bırakılacak minimum dakika (vinç kısıtı). */
  setupGapMinutes: number
  /** Aynı holde aynı anda yapılabilecek setup sayısı. */
  concurrentSetupsPerHall: number
}

export interface ScheduledJob {
  material: string
  press: string
  hall: string
  date: string
  phase: DemandEntry['phase']
  urgency: number
  /** Bu ihtiyacın ait olduğu hafta (ISO) — gecikme bundan hesaplanır. */
  dueDate: string
  /** ZPP kova etiketi ('Bakiye' veya hafta etiketi). */
  bucketLabel: string
  /** Planlanan gün, ihtiyaç haftasından sonraysa true. */
  late: boolean
  quantity: number
  shots: number
  coilsNeeded: number
  coProduct?: string
  coProductQuantity: number
  setupStartMinute: number
  setupEndMinute: number
  endMinute: number
  runMinutes: number
  setupMinutes: number
  reason: string
}

export interface UnplannedItem {
  material: string
  quantity: number
  phase: DemandEntry['phase']
  dueDate: string
  reason: string
}

export interface ScheduleResult {
  jobs: ScheduledJob[]
  unplanned: UnplannedItem[]
}

interface PressDayState {
  /** Preste dolmuş dakika (gün içi imleç). */
  cursor: number
  capacity: number
  lastMaterial: string | null
}

/** Bir holde o gün yapılmış setupların başlangıç dakikaları. */
type HallSetupLog = Map<string, number[]>

/** Kalıbın o gün hangi preste hangi dakika aralığında meşgul olduğu. */
interface MoldInterval {
  press: string
  start: number
  end: number
}

/** malzeme → tarih → aralıklar */
type MoldUsage = Map<string, Map<string, MoldInterval[]>>

/**
 * Bir setup'ın başlayabileceği en erken dakikayı bulur:
 * aynı holde eşzamanlı setup limiti ve setuplar arası minimum ara gözetilir.
 */
function earliestSetupStart(
  hallLog: HallSetupLog,
  hall: string,
  earliest: number,
  options: SchedulerOptions,
): number {
  const starts = hallLog.get(hall) ?? []
  if (starts.length === 0) return earliest

  let candidate = earliest
  // Aynı anda başlayan setup sayısı limiti aşmamalı ve ardışık setuplar
  // arasında en az setupGapMinutes olmalı.
  for (let guard = 0; guard < starts.length + 1; guard++) {
    const concurrent = starts.filter(
      (s) => Math.abs(s - candidate) < options.setupGapMinutes,
    )
    if (concurrent.length < options.concurrentSetupsPerHall) return candidate
    const blocking = Math.max(...concurrent)
    candidate = blocking + options.setupGapMinutes
  }
  return candidate
}

function moldIntervalsFor(usage: MoldUsage, material: string, date: string): MoldInterval[] {
  return usage.get(material)?.get(date) ?? []
}

function recordMoldInterval(
  usage: MoldUsage,
  material: string,
  date: string,
  interval: MoldInterval,
): void {
  const byDate = usage.get(material) ?? new Map<string, MoldInterval[]>()
  const list = byDate.get(date) ?? []
  list.push(interval)
  byDate.set(date, list)
  usage.set(material, byDate)
}

/**
 * Talep kalemlerini faz sırasıyla (bakiye → acil → dolgu) preslere yerleştirir.
 * Her kalem, uygun presler arasında en erken biten presi seçer; aynı malzeme
 * ardışık gelirse kalıp setup'ı tekrarlanmaz.
 */
export function schedule(
  demand: DemandEntry[],
  products: Map<string, ProductSpec>,
  presses: PressSpec[],
  buckets: Map<string, DayBucket[]>,
  _settings: ShiftSettings,
  options: SchedulerOptions,
): ScheduleResult {
  const jobs: ScheduledJob[] = []
  const unplanned: UnplannedItem[] = []

  if (presses.length === 0) {
    return {
      jobs,
      unplanned: demand.map((entry) => ({
        material: entry.material,
        quantity: entry.qty,
        phase: entry.phase,
        dueDate: entry.dueDate,
        reason: 'Tanımlı pres yok',
      })),
    }
  }

  // Gün listesi: tüm preslerin ortak takvim günleri, sırayla.
  const dates = Array.from(
    new Set(
      presses.flatMap((p) => (buckets.get(p.name) ?? []).map((b) => b.date)),
    ),
  ).sort()

  // pres → tarih → durum
  const state = new Map<string, Map<string, PressDayState>>()
  for (const press of presses) {
    const perDay = new Map<string, PressDayState>()
    for (const bucket of buckets.get(press.name) ?? []) {
      perDay.set(bucket.date, {
        cursor: 0,
        capacity: bucket.minutes,
        lastMaterial: null,
      })
    }
    state.set(press.name, perDay)
  }

  // hol → tarih → setup başlangıçları
  const hallSetups = new Map<string, HallSetupLog>()
  for (const date of dates) hallSetups.set(date, new Map())

  const pressByName = new Map(presses.map((p) => [p.name, p]))
  // Aynı kalıp aynı anda iki preste olamaz — gün bazında değil, dakika
  // aralığı bazında kontrol edilir; böylece aynı kalıp aynı gün içinde
  // farklı preslerde ardışık olarak çalışabilir.
  const moldUsage: MoldUsage = new Map()

  for (const entry of demand) {
    const product = products.get(entry.material)
    if (!product) {
      unplanned.push({
        material: entry.material,
        quantity: entry.qty,
        phase: entry.phase,
        dueDate: entry.dueDate,
        reason: 'Referans kartı bulunamadı',
      })
      continue
    }

    const candidates = [
      product.mainMachine,
      product.altMachine1,
      product.altMachine2,
      product.altMachine3,
      product.altMachine4,
    ]
      .filter((m): m is string => !!m && m.trim() !== '')
      .map((m) => m.trim())
      .filter((m) => pressByName.has(m))

    if (candidates.length === 0) {
      unplanned.push({
        material: entry.material,
        quantity: entry.qty,
        phase: entry.phase,
        dueDate: entry.dueDate,
        reason: 'Uygun/tanımlı pres yok (ana ve alternatif makineler tanımsız)',
      })
      continue
    }

    // Kalıp limitine göre partilere böl.
    const runs = splitByMoldLimit(product, entry.qty)
    for (const run of runs) {
      const placed = placeRun(
        entry,
        product,
        run,
        candidates,
        pressByName,
        state,
        hallSetups,
        dates,
        moldUsage,
        options,
      )
      if (placed) {
        jobs.push(placed)
      } else {
        unplanned.push({
          material: entry.material,
          quantity: run.quantity,
          phase: entry.phase,
          dueDate: entry.dueDate,
          reason: 'Görünen takvimde yeterli boş kapasite yok',
        })
      }
    }
  }

  return { jobs, unplanned }
}

interface Placement {
  press: string
  date: string
  setupStart: number
  setupEnd: number
  end: number
}

/**
 * Bir pres/gün ikilisinde işin sığıp sığmadığını, hol setup kısıtı ve kalıp
 * çakışması gözetilerek hesaplar. Sığmıyorsa null döner.
 */
function tryPlaceOnPress(
  entry: DemandEntry,
  run: RunPlan,
  pressName: string,
  hall: string,
  date: string,
  dayState: PressDayState,
  hallLog: HallSetupLog,
  moldUsage: MoldUsage,
  options: SchedulerOptions,
): Placement | null {
  const sameMaterial = dayState.lastMaterial === entry.material
  const setupMinutes = sameMaterial ? 0 : run.setupMinutes
  const coilSetup = run.coilSetupMinutes
  const intervals = moldIntervalsFor(moldUsage, entry.material, date)

  let start = dayState.cursor
  for (let guard = 0; guard < intervals.length + 2; guard++) {
    const setupStart =
      setupMinutes > 0 ? earliestSetupStart(hallLog, hall, start, options) : start
    const setupEnd = setupStart + setupMinutes + coilSetup
    const end = setupEnd + run.runMinutes

    // Kalıp çakışması: aynı kalıp başka bir preste bu aralıkta meşgulse
    // işi o işin bitişine ötele.
    const conflicts = intervals.filter(
      (iv) => iv.press !== pressName && iv.start < end && setupStart < iv.end,
    )
    if (conflicts.length === 0) {
      if (end > dayState.capacity) return null
      return { press: pressName, date, setupStart, setupEnd, end }
    }
    start = Math.max(...conflicts.map((c) => c.end))
    if (start >= dayState.capacity) return null
  }
  return null
}

function placeRun(
  entry: DemandEntry,
  product: ProductSpec,
  run: RunPlan,
  candidates: string[],
  pressByName: Map<string, PressSpec>,
  state: Map<string, Map<string, PressDayState>>,
  hallSetups: Map<string, HallSetupLog>,
  dates: string[],
  moldUsage: MoldUsage,
  options: SchedulerOptions,
): ScheduledJob | null {
  let best: Placement | null = null

  for (const date of dates) {
    // Dolgu işleri kendi haftasından önce üretilmez; bakiye/acil işler
    // planın ilk gününden itibaren serbesttir.
    if (date < entry.earliestDate) continue

    for (const pressName of candidates) {
      const press = pressByName.get(pressName)!
      const dayState = state.get(pressName)?.get(date)
      if (!dayState || dayState.capacity <= 0) continue

      const placement = tryPlaceOnPress(
        entry,
        run,
        pressName,
        press.hall,
        date,
        dayState,
        hallSetups.get(date)!,
        moldUsage,
        options,
      )
      if (!placement) continue

      if (!best || placement.end < best.end) best = placement
    }

    // İlk uygun günde yerleştir — ileriye taşımak aciliyeti bozar.
    if (best) break
  }

  if (!best) return null

  const press = pressByName.get(best.press)!
  const dayState = state.get(best.press)!.get(best.date)!
  const sameMaterial = dayState.lastMaterial === entry.material

  dayState.cursor = best.end
  dayState.lastMaterial = entry.material

  if (!sameMaterial && run.setupMinutes > 0) {
    const hallLog = hallSetups.get(best.date)!
    const starts = hallLog.get(press.hall) ?? []
    starts.push(best.setupStart)
    hallLog.set(press.hall, starts)
  }

  recordMoldInterval(moldUsage, entry.material, best.date, {
    press: best.press,
    start: best.setupStart,
    end: best.end,
  })

  const late = best.date > entry.dueDate

  const reasonParts = [
    entry.phase === 'backlog'
      ? `Bakiye ${Math.round(entry.qty)} adet`
      : entry.phase === 'urgent'
        ? `Stok ${entry.daysOfCover === Number.POSITIVE_INFINITY ? '∞' : entry.daysOfCover.toFixed(1)} gün yetiyor`
        : `${entry.bucketLabel} ihtiyacı`,
    `${run.coilsNeeded} rulo`,
    sameMaterial ? 'setup tekrarlanmadı' : `setup ${run.setupMinutes} dk`,
  ]
  if (late) reasonParts.push(`⚠ ${entry.dueDate} haftasından geç`)

  return {
    material: entry.material,
    press: best.press,
    hall: press.hall,
    date: best.date,
    phase: entry.phase,
    urgency: entry.urgency,
    dueDate: entry.dueDate,
    bucketLabel: entry.bucketLabel,
    late,
    quantity: run.quantity,
    shots: run.shots,
    coilsNeeded: run.coilsNeeded,
    coProduct: product.coProduct,
    coProductQuantity: run.coProductQuantity,
    setupStartMinute: best.setupStart,
    setupEndMinute: best.setupEnd,
    endMinute: best.end,
    runMinutes: run.runMinutes,
    setupMinutes: sameMaterial ? 0 : run.setupMinutes,
    reason: reasonParts.join(' · '),
  }
}
