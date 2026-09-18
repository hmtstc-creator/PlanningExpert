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
  /**
   * Rulodan beslenir mi? Progresif hatlar ruloyla çalışır, transfer presler
   * blank (kesilmiş parça) ile — orada rulo değişimi diye bir şey yoktur, tek
   * setup vardır. Belirtilmezse rulo beslemeli kabul edilir.
   */
  feedsCoil?: boolean
}

/**
 * Kullanıcının otomatik plana elle müdahalesi.
 * - `exclude`: bu malzeme hiç planlanmaz (ör. kalıp bakımda).
 * - `pin`: bu malzeme yalnızca verilen preste (ve verilmişse o günde) planlanır.
 * - `priority`: bu malzeme sıranın en başına alınır.
 */
export interface PlanOverride {
  material: string
  kind: 'exclude' | 'pin' | 'priority'
  press?: string
  date?: string
}

export interface SchedulerOptions {
  /** Ardışık setuplar arasında bırakılacak minimum dakika (vinç kısıtı). */
  setupGapMinutes: number
  /** Aynı holde iki rulo değişimi arasındaki en az süre. */
  coilSetupGapMinutes?: number
  /**
   * Bir vardiyanın net üretim dakikası. Verilirse setup vardiya sınırını
   * aşamaz: bitişe yetmeyen setup sonraki vardiyaya atılır, çünkü sahada
   * bitiremeyeceği setup'ı başlatan ekip yoktur.
   */
  netShiftMinutes?: number
  /** Aynı holde aynı anda yapılabilecek setup sayısı. */
  concurrentSetupsPerHall: number
  /** Kullanıcının elle müdahaleleri. */
  overrides?: PlanOverride[]
}

/** Bir işin gün içindeki parçaları; grafiğin çizdiği şey budur. */
export interface JobSegment {
  kind: 'setup' | 'quality' | 'run' | 'coil'
  /** Gün içi net üretim dakikası. */
  start: number
  end: number
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
  /** Ana setup sonrası bağlanan rulo sayısı; transfer preste her zaman 0. */
  coilChanges: number
  /** Setup → onay → üretim → rulo değişimi → üretim … sırası. */
  segments: JobSegment[]
  /** Bu iş bir kullanıcı müdahalesiyle mi konumlandı? */
  pinned: boolean
  coProduct?: string
  coProductQuantity: number
  setupStartMinute: number
  setupEndMinute: number
  /** Kalite onayının bittiği, üretimin başladığı dakika. */
  qualityEndMinute: number
  endMinute: number
  runMinutes: number
  setupMinutes: number
  qualityApprovalMinutes: number
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

interface SetupInterval {
  start: number
  end: number
}

/**
 * Bir holde o gün yapılan kalıp ve rulo setupları, ayrı ayrı.
 *
 * İkisinin kuralı farklıdır: kalıp setupları arasında en az `setupGapMinutes`,
 * rulo setupları arasında en az `coilSetupGapMinutes` olmalıdır. Kalıp setup
 * ile rulo setup ise hiç kesişemez — ama araya süre koymak gerekmez, biri
 * bitince diğeri hemen başlayabilir.
 */
interface HallResources {
  mold: SetupInterval[]
  coil: SetupInterval[]
}
type HallSetupLog = Map<string, HallResources>

/** Kalıbın o gün hangi preste hangi dakika aralığında meşgul olduğu. */
interface MoldInterval {
  press: string
  start: number
  end: number
}

/** malzeme → tarih → aralıklar */
type MoldUsage = Map<string, Map<string, MoldInterval[]>>

/**
 * Bir setup'ın başlayabileceği en erken dakikayı bulur.
 *
 * İki kural birlikte uygulanır:
 * - Aynı türden setuplar (`same`) arasında `gap` kadar boşluk olmalıdır ve
 *   en fazla `concurrent` tanesi çakışabilir.
 * - Diğer türden setuplarla (`others`) hiç çakışılamaz, ama araya süre
 *   koymak gerekmez — kalıp setup biter bitmez rulo bağlanabilir.
 */
function earliestFreeStart(
  same: SetupInterval[],
  gap: number,
  others: SetupInterval[],
  earliest: number,
  duration: number,
  concurrent: number,
): number {
  if (duration <= 0) return earliest
  let candidate = earliest

  for (let guard = 0; guard < same.length + others.length + 1; guard++) {
    const sameBlocking = same.filter(
      (iv) => candidate < iv.end + gap && iv.start < candidate + duration + gap,
    )
    const otherBlocking = others.filter(
      (iv) => candidate < iv.end && iv.start < candidate + duration,
    )
    if (sameBlocking.length < concurrent && otherBlocking.length === 0) return candidate

    candidate = Math.max(
      ...sameBlocking.map((iv) => iv.end + gap),
      ...otherBlocking.map((iv) => iv.end),
      candidate,
    )
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

  const overrides = options.overrides ?? []
  const excluded = new Set(
    overrides.filter((o) => o.kind === 'exclude').map((o) => o.material),
  )
  const pinned = new Map(
    overrides.filter((o) => o.kind === 'pin').map((o) => [o.material, o]),
  )
  const prioritised = new Set(
    overrides.filter((o) => o.kind === 'priority').map((o) => o.material),
  )

  // Öne alınan malzemeler faz sırasından bağımsız olarak en başa geçer.
  const ordered =
    prioritised.size === 0
      ? demand
      : [
          ...demand.filter((e) => prioritised.has(e.material)),
          ...demand.filter((e) => !prioritised.has(e.material)),
        ]

  if (presses.length === 0) {
    return {
      jobs,
      unplanned: ordered.map((entry) => ({
        material: entry.material,
        quantity: entry.qty,
        phase: entry.phase,
        dueDate: entry.dueDate,
        reason: 'No presses defined',
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

  for (const entry of ordered) {
    if (excluded.has(entry.material)) {
      unplanned.push({
        material: entry.material,
        quantity: entry.qty,
        phase: entry.phase,
        dueDate: entry.dueDate,
        reason: 'Excluded from planning by the user',
      })
      continue
    }

    const product = products.get(entry.material)
    if (!product) {
      unplanned.push({
        material: entry.material,
        quantity: entry.qty,
        phase: entry.phase,
        dueDate: entry.dueDate,
        reason: 'No master data record found',
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
        reason: 'No eligible press (main and alternative machines are undefined)',
      })
      continue
    }

    // Kullanıcı bu malzemeyi belirli bir prese (ve güne) sabitlediyse
    // yalnızca orası denenir.
    const pin = pinned.get(entry.material)
    const allowedPresses =
      pin?.press && pressByName.has(pin.press) ? [pin.press] : candidates
    if (pin?.press && !pressByName.has(pin.press)) {
      unplanned.push({
        material: entry.material,
        quantity: entry.qty,
        phase: entry.phase,
        dueDate: entry.dueDate,
        reason: `Pinned press is not defined: ${pin.press}`,
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
        allowedPresses,
        pressByName,
        state,
        hallSetups,
        pin?.date ? dates.filter((d) => d === pin.date) : dates,
        moldUsage,
        options,
        !!pin,
      )
      if (placed) {
        jobs.push(placed)
      } else {
        unplanned.push({
          material: entry.material,
          quantity: run.quantity,
          phase: entry.phase,
          dueDate: entry.dueDate,
          reason: pin
            ? 'Not enough free capacity on the pinned press/day'
            : 'Not enough free capacity in the visible calendar',
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
  qualityEnd: number
  end: number
  segments: JobSegment[]
  coilIntervals: SetupInterval[]
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
  feedsCoil: boolean,
): Placement | null {
  const sameMaterial = dayState.lastMaterial === entry.material
  const setupMinutes = sameMaterial ? 0 : run.setupMinutes
  // Transfer preste rulo değişimi yoktur; setup tektir.
  const coilChangeMinutes = feedsCoil ? run.coilChangeMinutes : 0
  const moldIntervals = moldIntervalsFor(moldUsage, entry.material, date)
  const resources = hallLog.get(hall) ?? { mold: [], coil: [] }
  const coilGap = options.coilSetupGapMinutes ?? 30
  const concurrent = Math.max(1, options.concurrentSetupsPerHall)

  let start = dayState.cursor
  for (let guard = 0; guard < moldIntervals.length + 4; guard++) {
    const segments: JobSegment[] = []

    // 1) Kalıp setup'ı: kendi türüyle arası açık, rulo setuplarıyla kesişmez.
    let setupStart = earliestFreeStart(
      resources.mold,
      options.setupGapMinutes,
      resources.coil,
      start,
      setupMinutes,
      concurrent,
    )

    // Bitiremeyeceği setup'ı başlatan ekip yoktur: vardiya sınırını aşamaz.
    const perShift = options.netShiftMinutes
    if (perShift && perShift > 0 && setupMinutes > 0) {
      const shiftEnd = (Math.floor(setupStart / perShift) + 1) * perShift
      if (setupStart + setupMinutes > shiftEnd) {
        setupStart = earliestFreeStart(
          resources.mold,
          options.setupGapMinutes,
          resources.coil,
          shiftEnd,
          setupMinutes,
          concurrent,
        )
      }
    }

    let cursor = setupStart
    if (setupMinutes > 0) {
      segments.push({ kind: 'setup', start: cursor, end: cursor + setupMinutes })
      cursor += setupMinutes
    }
    const setupEnd = cursor

    // 2) Kalite onayı.
    if (run.qualityApprovalMinutes > 0) {
      segments.push({ kind: 'quality', start: cursor, end: cursor + run.qualityApprovalMinutes })
      cursor += run.qualityApprovalMinutes
    }
    const qualityEnd = cursor

    // 3) Üretim, rulo başına parçalar hâlinde. Rulo değişimleri parçaların
    //    ARASINA girer: hangi saatte hangi rulonun bağlanacağı sahada
    //    önemlidir, hepsini başa toplamak yanlış tablo verirdi.
    const coilStarts: SetupInterval[] = []
    run.coilRunMinutes.forEach((minutes, index) => {
      if (index > 0 && coilChangeMinutes > 0) {
        const changeStart = earliestFreeStart(
          [...resources.coil, ...coilStarts],
          coilGap,
          resources.mold,
          cursor,
          coilChangeMinutes,
          1,
        )
        segments.push({ kind: 'coil', start: changeStart, end: changeStart + coilChangeMinutes })
        coilStarts.push({ start: changeStart, end: changeStart + coilChangeMinutes })
        cursor = changeStart + coilChangeMinutes
      }
      if (minutes > 0) {
        segments.push({ kind: 'run', start: cursor, end: cursor + minutes })
        cursor += minutes
      }
    })

    const end = cursor

    // Kalıp çakışması: aynı kalıp başka bir preste bu aralıkta meşgulse
    // işi o işin bitişine ötele.
    const conflicts = moldIntervals.filter(
      (iv) => iv.press !== pressName && iv.start < end && setupStart < iv.end,
    )
    if (conflicts.length === 0) {
      if (end > dayState.capacity) return null
      return {
        press: pressName,
        date,
        setupStart,
        setupEnd,
        qualityEnd,
        end,
        segments,
        coilIntervals: coilStarts,
      }
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
  pinned = false,
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
        press.feedsCoil !== false,
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

  const hallLog = hallSetups.get(best.date)!
  const resources = hallLog.get(press.hall) ?? { mold: [], coil: [] }
  if (!sameMaterial && run.setupMinutes > 0) {
    resources.mold.push({ start: best.setupStart, end: best.setupEnd })
  }
  resources.coil.push(...best.coilIntervals)
  hallLog.set(press.hall, resources)

  recordMoldInterval(moldUsage, entry.material, best.date, {
    press: best.press,
    start: best.setupStart,
    end: best.end,
  })

  const late = best.date > entry.dueDate

  const reasonParts = [
    entry.phase === 'backlog'
      ? `Backlog ${Math.round(entry.qty)} pcs`
      : entry.phase === 'urgent'
        ? `Stock covers ${entry.daysOfCover === Number.POSITIVE_INFINITY ? '∞' : entry.daysOfCover.toFixed(1)} days`
        : `${entry.bucketLabel} requirement`,
    run.coilsNeeded === 1 ? '1 full coil' : `${run.coilsNeeded} full coils`,
    ...(press.feedsCoil !== false && run.coilChanges > 0
      ? [`${run.coilChanges} coil change${run.coilChanges > 1 ? 's' : ''}`]
      : []),
    sameMaterial ? 'setup not repeated' : `setup ${run.setupMinutes} min`,
  ]
  if (run.qualityApprovalMinutes > 0) {
    reasonParts.push(`approval ${run.qualityApprovalMinutes} min`)
  }
  if (run.clampedToTheoretical) {
    reasonParts.push('⚠ window too short for setup + approval')
  }
  if (late) reasonParts.push(`⚠ later than required week ${entry.dueDate}`)
  if (pinned) reasonParts.push('pinned by user')

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
    pinned,
    coProduct: product.coProduct,
    coProductQuantity: run.coProductQuantity,
    setupStartMinute: best.setupStart,
    setupEndMinute: best.setupEnd,
    qualityEndMinute: best.qualityEnd,
    endMinute: best.end,
    runMinutes: run.runMinutes,
    setupMinutes: sameMaterial ? 0 : run.setupMinutes,
    qualityApprovalMinutes: run.qualityApprovalMinutes,
    coilChanges: press.feedsCoil === false ? 0 : run.coilChanges,
    segments: best.segments,
    reason: reasonParts.join(' · '),
  }
}
