// Yerleştirme (scheduling) katmanı: talep havuzunu pres/gün kovalarına
// kısıtları gözeterek yerleştirir. Saf fonksiyon — Convex/React bağımsız.

import {
  type DayBucket,
  type DemandPoolItem,
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
  phase: DemandPoolItem['phase']
  urgency: number
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
  phase: DemandPoolItem['phase']
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

/**
 * Talep havuzunu faz sırasıyla (bakiye → acil → dolgu) preslere yerleştirir.
 * Her kalem, uygun presler arasında en erken biten presi seçer; aynı malzeme
 * ardışık gelirse kalıp setup'ı tekrarlanmaz.
 */
export function schedule(
  pool: DemandPoolItem[],
  products: Map<string, ProductSpec>,
  presses: PressSpec[],
  buckets: Map<string, DayBucket[]>,
  settings: ShiftSettings,
  options: SchedulerOptions,
): ScheduleResult {
  const jobs: ScheduledJob[] = []
  const unplanned: UnplannedItem[] = []

  if (presses.length === 0) {
    return {
      jobs,
      unplanned: pool.map((item) => ({
        material: item.material,
        quantity: item.netNeed,
        phase: item.phase,
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
  // Aynı kalıp (malzeme) aynı anda iki preste olamaz: malzeme → tarih seti.
  const materialDayUsage = new Map<string, Set<string>>()

  for (const item of pool) {
    const product = products.get(item.material)
    if (!product) {
      unplanned.push({
        material: item.material,
        quantity: item.netNeed,
        phase: item.phase,
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
        material: item.material,
        quantity: item.netNeed,
        phase: item.phase,
        reason: 'Uygun/tanımlı pres yok (ana ve alternatif makineler tanımsız)',
      })
      continue
    }

    // Kalıp limitine göre partilere böl.
    const runs = splitByMoldLimit(product, item.netNeed)
    for (const run of runs) {
      const placed = placeRun(
        item,
        product,
        run,
        candidates,
        pressByName,
        state,
        hallSetups,
        dates,
        materialDayUsage,
        options,
      )
      if (placed) {
        jobs.push(placed)
      } else {
        unplanned.push({
          material: item.material,
          quantity: run.quantity,
          phase: item.phase,
          reason: 'Görünen takvimde yeterli boş kapasite yok',
        })
      }
    }
  }

  return { jobs, unplanned }
}

function placeRun(
  item: DemandPoolItem,
  product: ProductSpec & {
    mainMachine?: string
    altMachine1?: string
    altMachine2?: string
    altMachine3?: string
    altMachine4?: string
  },
  run: RunPlan,
  candidates: string[],
  pressByName: Map<string, PressSpec>,
  state: Map<string, Map<string, PressDayState>>,
  hallSetups: Map<string, HallSetupLog>,
  dates: string[],
  materialDayUsage: Map<string, Set<string>>,
  options: SchedulerOptions,
): ScheduledJob | null {
  let best: { press: string; date: string; end: number; setupStart: number; setupEnd: number } | null =
    null

  for (const date of dates) {
    const usedDays = materialDayUsage.get(item.material)
    // Kalıp tekilliği: aynı malzeme aynı gün başka bir preste çalışıyorsa
    // bu gün bu malzeme için kullanılamaz.
    if (usedDays?.has(date)) continue

    for (const pressName of candidates) {
      const press = pressByName.get(pressName)!
      const dayState = state.get(pressName)?.get(date)
      if (!dayState || dayState.capacity <= 0) continue

      const sameMaterial = dayState.lastMaterial === item.material
      const setupMinutes = sameMaterial ? 0 : run.setupMinutes
      const coilSetup = run.coilSetupMinutes

      const hallLog = hallSetups.get(date)!
      const setupStart =
        setupMinutes > 0
          ? earliestSetupStart(hallLog, press.hall, dayState.cursor, options)
          : dayState.cursor
      const setupEnd = setupStart + setupMinutes + coilSetup
      const end = setupEnd + run.runMinutes

      if (end > dayState.capacity) continue

      if (!best || end < best.end) {
        best = { press: pressName, date, end, setupStart, setupEnd }
      }
    }

    // İlk uygun günde yerleştir — ileriye taşımak aciliyeti bozar.
    if (best) break
  }

  if (!best) return null

  const press = pressByName.get(best.press)!
  const dayState = state.get(best.press)!.get(best.date)!
  const sameMaterial = dayState.lastMaterial === item.material

  dayState.cursor = best.end
  dayState.lastMaterial = item.material

  if (!sameMaterial && run.setupMinutes > 0) {
    const hallLog = hallSetups.get(best.date)!
    const starts = hallLog.get(press.hall) ?? []
    starts.push(best.setupStart)
    hallLog.set(press.hall, starts)
  }

  const usage = materialDayUsage.get(item.material) ?? new Set<string>()
  usage.add(best.date)
  materialDayUsage.set(item.material, usage)

  const reasonParts = [
    item.phase === 'backlog'
      ? `Bakiye ${Math.round(item.overdue)} adet`
      : item.phase === 'urgent'
        ? `Stok ${item.daysOfCover === Number.POSITIVE_INFINITY ? '∞' : item.daysOfCover.toFixed(1)} gün yetiyor`
        : 'Kalan kapasite dolgusu',
    `${run.coilsNeeded} rulo`,
    sameMaterial ? 'setup tekrarlanmadı' : `setup ${run.setupMinutes} dk`,
  ]

  return {
    material: item.material,
    press: best.press,
    hall: press.hall,
    date: best.date,
    phase: item.phase,
    urgency: item.urgency,
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
