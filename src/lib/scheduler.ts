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
   * Gün içindeki vardiyaların net üretim dakikaları, SIRAYLA.
   *
   * Verilirse setup vardiya sınırını aşamaz: bitişe yetmeyen setup sonraki
   * vardiyaya atılır, çünkü sahada bitiremeyeceği setup'ı başlatan ekip
   * yoktur. Dizi olmasının sebebi vardiyaların eşit olmamasıdır — devir
   * toplantısı, çay ve yemek her vardiyada farklı dakika götürür, bu yüzden
   * tek bir "vardiya uzunluğu" sınırları yanlış yere koyar.
   */
  shiftNetMinutes?: number[]
  /** Aynı holde aynı anda yapılabilecek setup sayısı. */
  concurrentSetupsPerHall: number
  /** Kullanıcının elle müdahaleleri. */
  overrides?: PlanOverride[]
  /**
   * Kalıbın bakımda olduğu günler: malzeme → o kalıbın çalışamayacağı
   * tarihler.
   *
   * Bakım bir günlük bir olaydır; malzemeyi ufkun tamamından çıkarmak
   * (`exclude`) yanlış olurdu — kalıp ertesi gün yine çalışır. Bu yüzden
   * yasak gün bazındadır: işin HİÇBİR parçası o güne düşemez.
   */
  moldBlackouts?: { material: string; date: string }[]
  /**
   * Zaten taahhüt edilmiş işler: dondurulmuş ufuktaki onaylı plan.
   *
   * Bunlar yeniden hesaplanmaz — presin ekseninde yer kaplarlar, vinç ve
   * kalıp kaydına işlenirler, yeni iş üstlerine konamaz. Amaç sahadaki
   * ekibin hazırlığını bozmamaktır: ertesi sabah kurulacak kalıp, planın
   * yeniden hesaplanması yüzünden başka bir prese kaymamalı.
   */
  fixedJobs?: FixedJob[]
}

/** Dondurulmuş ufuktan gelen, yeniden planlanmayacak iş. */
export interface FixedJob {
  material: string
  press: string
  date: string
  segments: { kind: string; date: string; start: number; end: number }[]
}

/**
 * Bir işin parçaları; grafiğin çizdiği şey budur.
 *
 * Her parça kendi gününü taşır, çünkü bir iş gün (ve hafta) sınırını aşabilir:
 * vardiya kapanışında yarım kalan iş ertesi gün kaldığı yerden sürer.
 */
export interface JobSegment {
  kind: 'setup' | 'quality' | 'run' | 'coil'
  date: string
  /** O gün içindeki net üretim dakikası. */
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
  /** Stoğun bittiği gün (ISO) — iş bundan sonra başlarsa geç sayılır. */
  dueDate: string
  /** Üretimin başlayabileceği en erken gün: stok bitişi − emniyet günleri. */
  earliestDate?: string
  /** ZPP kova etiketi ('Bakiye' veya hafta etiketi). */
  bucketLabel: string
  /** İşin bittiği gün — gün/hafta sınırını aşmışsa `date`'ten farklıdır. */
  endDate: string
  /** İş gün sınırını aşıyor mu? */
  spansDays: boolean
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
  /** Neden bu pres: sıra numarası ve adayların karşılaştırması. */
  decision?: PlacementDecision
}

export interface UnplannedItem {
  material: string
  quantity: number
  phase: DemandEntry['phase']
  dueDate: string
  reason: string
  /** Hangi presler denendi ve neden olmadı — varsa. */
  decision?: PlacementDecision
}

/**
 * Bir pres adayının karar anındaki sonucu: iş o preste ne zaman biterdi,
 * ya da neden hiç konamadı.
 */
export interface CandidateOutcome {
  press: string
  /** İşin o preste biteceği gün ve gün içi net dakika. */
  endDate?: string
  endMinute?: number
  /** Konamadıysa sebebi. */
  note?: string
}

/**
 * Motorun bu iş için verdiği kararın izi. Planı sayılarla tek tek
 * doğrulamak yerine her işin kararı yerinde okunabilsin diye tutulur:
 * iş kaçıncı sırada yerleştirildi ve o an her aday pres ne verirdi.
 */
export interface PlacementDecision {
  /** Yerleştirme sırası — 1 ilk yerleştirilen iş. */
  step: number
  candidates: CandidateOutcome[]
}

export interface ScheduleResult {
  jobs: ScheduledJob[]
  unplanned: UnplannedItem[]
}

/** Bir presin bir günü, sürekli eksen üzerindeki yeriyle. */
interface DayWindow {
  date: string
  /** Presin ekseninde bu günün başladığı dakika. */
  offset: number
  /** Günün net üretim dakikası. */
  capacity: number
  /**
   * Kapasitenin gün İÇİNDE başladığı net dakika — bugün için geçmiş saatler
   * kadar, diğer günler için 0. Gün içi dakikalar buna eklenerek yazılır,
   * yoksa bugünün işi sabaha, yani geçmişe düşer.
   */
  startNet: number
}

/** Presin ekseninde dolu bir aralık ve o sırada takılı olan kalıp. */
interface Booking {
  start: number
  end: number
  material: string
}

/**
 * Bir presin tüm ufku tek bir sürekli zaman ekseni olarak.
 *
 * Önceden her gün ayrı bir kovaydı ve iş tek güne sığmak zorundaydı: sığmayan
 * iş tümden ertesi güne atılıyor, günün sonu boş kalıyordu. Oysa sahada
 * vardiya kapanışında yarım kalan iş ertesi gün kaldığı yerden sürer.
 *
 * Eksen tek yönlü bir imleçle de tutulmuyor. İmleç geriye bakamaz: bir iş
 * kalıp bakımı, kalıp çakışması ya da vinç yüzünden ertelendiğinde imleç de
 * onunla birlikte ileri kayar ve geride kalan saatler bir daha kullanılamaz.
 * Sahada o presi boş bırakmazlar, sıradaki işi çekerler. Bu yüzden dolu
 * aralıklar tutuluyor ve yeni iş aradaki boşluğa da yerleşebiliyor.
 */
interface PressTimeline {
  days: DayWindow[]
  total: number
  bookings: Booking[]
}

function buildTimeline(buckets: DayBucket[]): PressTimeline {
  const days: DayWindow[] = []
  let offset = 0
  for (const bucket of buckets) {
    if (bucket.minutes <= 0) continue
    days.push({
      date: bucket.date,
      offset,
      capacity: bucket.minutes,
      startNet: bucket.startMinute ?? 0,
    })
    offset += bucket.minutes
  }
  return { days, total: offset, bookings: [] }
}

/**
 * Dolu aralıklar `start`'a göre sıralı tutulur.
 *
 * Bir preste iki iş aynı anda olamaz, yani aralıklar çakışmaz; çakışmayan
 * ve başlangıca göre sıralı bir dizi aynı zamanda bitişe göre de sıralıdır.
 * Aramaların ikili arama yapabilmesi buna dayanıyor — liste uzadıkça her
 * yerleştirmenin tüm listeyi taraması, iş sayısıyla birlikte süreyi karesel
 * büyütüyordu.
 */
function insertBooking(timeline: PressTimeline, booking: Booking): void {
  let low = 0
  let high = timeline.bookings.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (timeline.bookings[mid].start < booking.start) low = mid + 1
    else high = mid
  }
  timeline.bookings.splice(low, 0, booking)
}

/** `end` değeri `value`'dan büyük olan ilk aralığın indeksi. */
function firstEndAfter(bookings: Booking[], value: number): number {
  let low = 0
  let high = bookings.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (bookings[mid].end <= value) low = mid + 1
    else high = mid
  }
  return low
}

/** `[start, end)` aralığıyla çakışan, en erken biten dolu aralık. */
function firstOverlap(timeline: PressTimeline, start: number, end: number): Booking | null {
  const bookings = timeline.bookings
  for (let i = firstEndAfter(bookings, start); i < bookings.length; i++) {
    if (bookings[i].start >= end) return null
    if (bookings[i].end > start) return bookings[i]
  }
  return null
}

/**
 * `from` dakikasından itibaren presin boş olduğu ilk an.
 *
 * Yerleştirmeye doğrudan buradan başlamak önemli: dolu bir aralığın
 * içinden başlayıp çakışma çıkınca ileri atlamak, "önceki iş" bilgisini
 * yanlış okumaya yol açar — aynı kalıbın ikinci partisi için setup
 * gereksiz yere tekrarlanır.
 */
function firstFreePoint(timeline: PressTimeline, from: number): number {
  const bookings = timeline.bookings
  let point = Math.max(0, from)
  // Aralıklar sıralı ve çakışmıyor: noktayı içeren aralığın sonuna atlamak
  // en fazla bitişik aralıklar boyunca ilerler.
  for (let i = firstEndAfter(bookings, point); i < bookings.length; i++) {
    if (bookings[i].start > point) break
    point = bookings[i].end
  }
  return point
}

/**
 * `at` dakikasından önce bu preste en son çalışan malzeme.
 *
 * Setup'ın tekrarlanıp tekrarlanmayacağını bu belirler: kalıp hâlâ
 * takılıysa yeniden bağlanmaz. Araya boşluk girmesi kalıbı sökmez, bu
 * yüzden bitişiklik değil sıra aranır.
 */
function materialBefore(timeline: PressTimeline, at: number): string | null {
  const index = firstEndAfter(timeline.bookings, at) - 1
  return index >= 0 ? timeline.bookings[index].material : null
}

/**
 * Eksendeki dakikayı içeren (ya da ondan sonraki ilk) günün indeksi.
 *
 * Günler eksende ardışık ve sıralı, bu yüzden ikili arama yapılabilir.
 * Baştan taramak, plan doldukça her yerleştirmenin ufkun başından itibaren
 * yürümesi demekti — iş sayısıyla birlikte süre karesele yaklaşıyordu.
 */
function dayIndexAt(timeline: PressTimeline, minute: number): number {
  let low = 0
  let high = timeline.days.length
  while (low < high) {
    const mid = (low + high) >> 1
    const day = timeline.days[mid]
    if (minute >= day.offset + day.capacity) low = mid + 1
    else high = mid
  }
  return low
}

/** Eksendeki dakikayı içeren gün. */
function dayAt(timeline: PressTimeline, minute: number): DayWindow | null {
  return timeline.days[dayIndexAt(timeline, minute)] ?? null
}

/** Eksendeki dakikanın takvim karşılığı: hangi gün, o günün kaçıncı dakikası. */
function locate(timeline: PressTimeline, minute: number): { date: string; minute: number } {
  const day = dayAt(timeline, Math.max(0, minute - 1)) ?? timeline.days[timeline.days.length - 1]
  if (!day) return { date: '', minute: 0 }
  const within = Math.max(0, Math.min(day.capacity, minute - day.offset))
  return { date: day.date, minute: day.startNet + within }
}

/** Verilen tarihin (veya ondan sonraki ilk günün) eksendeki başlangıcı. */
function offsetOfDate(timeline: PressTimeline, date: string): number {
  // Günler tarihe göre de sıralı.
  let low = 0
  let high = timeline.days.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (timeline.days[mid].date < date) low = mid + 1
    else high = mid
  }
  return timeline.days[low]?.offset ?? timeline.total
}

/**
 * Eksendeki bir aralığı günlere böler. Gün sınırını aşan üretim iki parça
 * olarak çizilir — sahada tek iştir, takvimde iki gündür.
 */
function toDatedSegments(
  timeline: PressTimeline,
  kind: JobSegment['kind'],
  start: number,
  end: number,
): JobSegment[] {
  const out: JobSegment[] = []
  // Parçanın başladığı günden başla; ufkun başından taramanın anlamı yok.
  for (let i = dayIndexAt(timeline, start); i < timeline.days.length; i++) {
    const day = timeline.days[i]
    if (day.offset >= end) break
    const from = Math.max(start, day.offset)
    const to = Math.min(end, day.offset + day.capacity)
    if (to <= from) continue
    out.push({
      kind,
      date: day.date,
      start: day.startNet + (from - day.offset),
      end: day.startNet + (to - day.offset),
    })
    if (to >= end) break
  }
  return out
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

  // Kaç pres bu malzemeyi yapabilir? Sabitlenmişse tek pres.
  const pressNames = new Set(presses.map((p) => p.name))
  const eligibleCount = new Map<string, number>()
  const countFor = (material: string): number => {
    const known = eligibleCount.get(material)
    if (known !== undefined) return known
    const product = products.get(material)
    const count = pinned.get(material)?.press
      ? 1
      : new Set(
          [
            product?.mainMachine,
            product?.altMachine1,
            product?.altMachine2,
            product?.altMachine3,
            product?.altMachine4,
          ]
            .map((m) => m?.trim())
            .filter((m): m is string => !!m && pressNames.has(m)),
        ).size
    eligibleCount.set(material, count)
    return count
  }

  // Sıra: öne alınanlar → bakiye → acil → dolgu; aynı grupta stoğu önce
  // biten önce. Öncelik tamamen eşitse ALTERNATİFİ AZ OLAN önce: tek preste
  // yapılabilen parça yerini önce alır, esnek parçalar kalan boşluklara
  // dağılır. Tersi olursa esnek parça, tek presli parçanın ihtiyaç duyduğu
  // yeri kapabilirdi.
  const ordered = [...demand].sort(
    (a, b) =>
      Number(!prioritised.has(a.material)) - Number(!prioritised.has(b.material)) ||
      Number(!a.boost) - Number(!b.boost) ||
      phaseOrder(a.phase) - phaseOrder(b.phase) ||
      a.dueDate.localeCompare(b.dueDate) ||
      b.urgency - a.urgency ||
      countFor(a.material) - countFor(b.material),
  )

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

  // pres → sürekli zaman ekseni. Her pres kendi ufkunu tek bir şerit olarak
  // görür; iş gün sınırında kesilmez, ertesi gün kaldığı yerden sürer.
  const timelines = new Map<string, PressTimeline>()
  for (const press of presses) {
    timelines.set(press.name, buildTimeline(buckets.get(press.name) ?? []))
  }

  // hol → tarih → setup başlangıçları
  const hallSetups = new Map<string, HallSetupLog>()
  for (const date of dates) hallSetups.set(date, new Map())

  const pressByName = new Map(presses.map((p) => [p.name, p]))
  // Aynı kalıp aynı anda iki preste olamaz — gün bazında değil, dakika
  // aralığı bazında kontrol edilir; böylece aynı kalıp aynı gün içinde
  // farklı preslerde ardışık olarak çalışabilir.
  const moldUsage: MoldUsage = new Map()

  // Dondurulmuş ufuk: taahhüt edilmiş işler önce yerleşir, sonra motor
  // kalan boşluğu planlar.
  applyFixedJobs(
    options.fixedJobs ?? [],
    timelines,
    pressByName,
    hallSetups,
    moldUsage,
  )

  // malzeme → bakım günleri
  const blackoutsByMaterial = new Map<string, Set<string>>()
  for (const b of options.moldBlackouts ?? []) {
    const set = blackoutsByMaterial.get(b.material) ?? new Set<string>()
    set.add(b.date)
    blackoutsByMaterial.set(b.material, set)
  }

  // Kaçıncı karar olduğu — plan sırayla kurulduğu için doğrulamada önemli.
  let step = 0

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
      step += 1
      const decision: PlacementDecision = { step, candidates: [] }
      const placed = placeRun(
        entry,
        product,
        run,
        allowedPresses,
        pressByName,
        timelines,
        hallSetups,
        pin?.date,
        moldUsage,
        options,
        blackoutsByMaterial.get(entry.material),
        !!pin,
        decision,
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
          decision,
        })
      }
    }
  }

  return { jobs, unplanned }
}

function phaseOrder(phase: DemandEntry['phase']): number {
  return phase === 'backlog' ? 0 : phase === 'urgent' ? 1 : 2
}

/**
 * Taahhüt edilmiş işleri preslerin eksenine ve ortak kaynaklara işler.
 *
 * Parçalar gün bazında gelir (onaylı plandan); eksendeki karşılıkları
 * bulunup tek bir dolu aralık olarak kaydedilir. Vinç kaydına yalnızca
 * setup ve rulo değişimi girer — üretim vinç kullanmaz.
 */
function applyFixedJobs(
  fixedJobs: FixedJob[],
  timelines: Map<string, PressTimeline>,
  pressByName: Map<string, PressSpec>,
  hallSetups: Map<string, HallSetupLog>,
  moldUsage: MoldUsage,
): void {
  for (const job of fixedJobs) {
    const timeline = timelines.get(job.press)
    const press = pressByName.get(job.press)
    if (!timeline || !press || job.segments.length === 0) continue

    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    const perDate = new Map<string, { start: number; end: number }>()

    for (const segment of job.segments) {
      const day = timeline.days.find((d) => d.date === segment.date)
      if (!day) continue
      // Gün içi dakikadan eksene: pencerenin başlangıcı çıkarılır.
      const start = day.offset + Math.max(0, segment.start - day.startNet)
      const end = day.offset + Math.min(day.capacity, segment.end - day.startNet)
      if (end <= start) continue
      min = Math.min(min, start)
      max = Math.max(max, end)

      const span = perDate.get(segment.date)
      perDate.set(segment.date, {
        start: span ? Math.min(span.start, segment.start) : segment.start,
        end: span ? Math.max(span.end, segment.end) : segment.end,
      })

      if (segment.kind === 'setup' || segment.kind === 'coil') {
        const hallLog = hallSetups.get(segment.date) ?? new Map<string, HallResources>()
        const resources = hallLog.get(press.hall) ?? { mold: [], coil: [] }
        resources[segment.kind === 'setup' ? 'mold' : 'coil'].push({
          start: segment.start,
          end: segment.end,
        })
        hallLog.set(press.hall, resources)
        hallSetups.set(segment.date, hallLog)
      }
    }

    if (min === Number.POSITIVE_INFINITY) continue
    insertBooking(timeline, { start: min, end: max, material: job.material })
    for (const [date, span] of perDate) {
      recordMoldInterval(moldUsage, job.material, date, {
        press: job.press,
        start: span.start,
        end: span.end,
      })
    }
  }
}

interface Placement {
  press: string
  /** İşin başladığı gün. */
  date: string
  /** İşin bittiği gün — gün sınırını aşmışsa farklıdır. */
  endDate: string
  /** Başlangıç gününün içindeki setup dakikası. */
  setupStart: number
  /** Eksendeki başlangıç ve bitiş; presin imleci bitişe taşınır. */
  startGlobal: number
  endGlobal: number
  /** Kalite onayının bittiği, üretimin başladığı eksen dakikası. */
  qualityEndGlobal: number
  /** Kalıp zaten takılıydı, setup tekrarlanmadı. */
  sameMaterial: boolean
  /** Bitiş gününün içindeki bitiş dakikası. */
  endMinute: number
  segments: JobSegment[]
  /** Hol kaydına yazılacak kalıp setupı, gününe göre. */
  moldReservation: { date: string; start: number; end: number } | null
  coilReservations: { date: string; start: number; end: number }[]
}

/**
 * `within` dakikasını içeren vardiyanın gün içindeki bitişi.
 *
 * Vardiyalar eşit uzunlukta değildir: devir toplantısı, çay ve yemek her
 * vardiyadan farklı dakika götürür. Tek bir vardiya uzunluğuyla bölmek
 * ikinci ve üçüncü vardiyanın sınırını kaydırır ve setup'ı yanlış yere
 * koyar, bu yüzden dizinin üzerinde yürünür.
 */
export function shiftEndAfter(
  within: number,
  shiftNetMinutes: number[] | undefined,
  dayCapacity: number,
): number {
  if (!shiftNetMinutes || shiftNetMinutes.length === 0) return dayCapacity
  let start = 0
  for (const length of shiftNetMinutes) {
    if (length <= 0) continue
    const end = start + length
    if (within < end) return Math.min(end, dayCapacity)
    start = end
  }
  // Tanımlı vardiyaların dışında kalan süre (ör. fazla mesai) gün sonuna
  // kadar tek parça sayılır.
  return dayCapacity
}

/**
 * Bir setup ya da rulo değişimi için eksende en erken uygun yeri bulur.
 *
 * Bu bloklar gün ve vardiya sınırını aşamaz — bitiremeyeceği setup'ı
 * başlatan ekip yoktur — ve ait oldukları günün hol kaydına uymalıdır.
 */
function reserveSlot(
  timeline: PressTimeline,
  from: number,
  duration: number,
  hallSetups: Map<string, HallSetupLog>,
  hall: string,
  type: 'mold' | 'coil',
  gap: number,
  concurrent: number,
  shiftNetMinutes: number[] | undefined,
  /**
   * Bu yerleştirmenin henüz hol defterine yazılmamış kendi rezervasyonları.
   * Aynı işin ardışık rulo değişimleri de vinç kısıtına tabidir — kısa üretim
   * parçaları arka arkaya rulo bağlamayı 30 dakikanın altına düşürebilir.
   */
  pending: { date: string; start: number; end: number; type: 'mold' | 'coil' }[] = [],
): { global: number; date: string; start: number } | null {
  if (duration <= 0) {
    const day = dayAt(timeline, from)
    if (!day) return null
    return {
      global: from,
      date: day.date,
      start: day.startNet + Math.max(0, from - day.offset),
    }
  }

  let cursor = from
  for (let guard = 0; guard < timeline.days.length * 4 + 8; guard++) {
    const day = timeline.days[dayIndexAt(timeline, cursor)]
    if (!day) return null
    if (cursor < day.offset) cursor = day.offset

    // Gün içi dakika: hol defteri ve vardiya sınırı bu eksende konuşur, bu
    // yüzden pencerenin gün içindeki gerçek yeri (startNet) eklenir.
    const within = day.startNet + (cursor - day.offset)
    const dayEnd = day.startNet + day.capacity
    // Vardiya sınırı: gün içinde vardiya sonuna sığmıyorsa sonrakine geç.
    const shiftEnd = shiftEndAfter(within, shiftNetMinutes, dayEnd)

    const resources = hallSetups.get(day.date)?.get(hall) ?? { mold: [], coil: [] }
    const own = pending.filter((r) => r.date === day.date)
    const same = [
      ...(type === 'mold' ? resources.mold : resources.coil),
      ...own.filter((r) => r.type === type),
    ]
    const others = [
      ...(type === 'mold' ? resources.coil : resources.mold),
      ...own.filter((r) => r.type !== type),
    ]
    const candidate = earliestFreeStart(same, gap, others, within, duration, concurrent)

    if (candidate + duration <= shiftEnd) {
      return {
        global: day.offset + (candidate - day.startNet),
        date: day.date,
        start: candidate,
      }
    }
    cursor = day.offset + (shiftEnd - day.startNet)
    if (cursor >= day.offset + day.capacity) {
      const next = timeline.days[dayIndexAt(timeline, day.offset + day.capacity)]
      if (!next) return null
      cursor = Math.max(cursor, next.offset)
    }
  }
  return null
}

/**
 * İşi presin sürekli ekseninde yerleştirir. Üretim gün sınırını aşabilir;
 * setup ve rulo değişimi aşamaz.
 */
function tryPlaceOnPress(
  entry: DemandEntry,
  run: RunPlan,
  pressName: string,
  hall: string,
  timeline: PressTimeline,
  earliestGlobal: number,
  hallSetups: Map<string, HallSetupLog>,
  moldUsage: MoldUsage,
  options: SchedulerOptions,
  feedsCoil: boolean,
  blackoutDates: Set<string> | undefined,
): Placement | null {
  const coilChangeMinutes = feedsCoil ? run.coilChangeMinutes : 0
  const coilGap = options.coilSetupGapMinutes ?? 30
  const concurrent = Math.max(1, options.concurrentSetupsPerHall)

  let start = firstFreePoint(timeline, earliestGlobal)

  for (let guard = 0; guard < timeline.days.length * 2 + 24; guard++) {
    // Kalıp o an takılıysa setup tekrarlanmaz. Boşluğa geri dönük yerleşen
    // bir iş için de "önceki iş" doğru olsun diye sıraya bakılır.
    const sameMaterial = materialBefore(timeline, start) === entry.material
    const setupMinutes = sameMaterial ? 0 : run.setupMinutes
    const segments: JobSegment[] = []
    let moldReservation: Placement['moldReservation'] = null
    const coilReservations: Placement['coilReservations'] = []

    // 1) Kalıp setup'ı.
    const setupSlot = reserveSlot(
      timeline,
      start,
      setupMinutes,
      hallSetups,
      hall,
      'mold',
      options.setupGapMinutes,
      concurrent,
      options.shiftNetMinutes,
    )
    if (!setupSlot) return null

    let cursor = setupSlot.global
    const setupGlobalStart = cursor
    if (setupMinutes > 0) {
      segments.push(...toDatedSegments(timeline, 'setup', cursor, cursor + setupMinutes))
      moldReservation = {
        date: setupSlot.date,
        start: setupSlot.start,
        end: setupSlot.start + setupMinutes,
      }
      cursor += setupMinutes
    }

    // 2) Kalite onayı.
    if (run.qualityApprovalMinutes > 0) {
      segments.push(
        ...toDatedSegments(timeline, 'quality', cursor, cursor + run.qualityApprovalMinutes),
      )
      cursor += run.qualityApprovalMinutes
    }
    const qualityEndGlobal = cursor

    // 3) Üretim, rulo başına parçalar hâlinde; aralarına rulo değişimi girer.
    //    Üretim gün sınırını aşabilir — yarım kalan iş ertesi gün sürer.
    let failed = false
    run.coilRunMinutes.forEach((minutes, index) => {
      if (failed) return
      if (index > 0 && coilChangeMinutes > 0) {
        const slot = reserveSlot(
          timeline,
          cursor,
          coilChangeMinutes,
          hallSetups,
          hall,
          'coil',
          coilGap,
          1,
          options.shiftNetMinutes,
          [
            ...(moldReservation ? [{ ...moldReservation, type: 'mold' as const }] : []),
            ...coilReservations.map((r) => ({ ...r, type: 'coil' as const })),
          ],
        )
        if (!slot) {
          failed = true
          return
        }
        segments.push(
          ...toDatedSegments(timeline, 'coil', slot.global, slot.global + coilChangeMinutes),
        )
        coilReservations.push({
          date: slot.date,
          start: slot.start,
          end: slot.start + coilChangeMinutes,
        })
        cursor = slot.global + coilChangeMinutes
      }
      if (minutes > 0) {
        segments.push(...toDatedSegments(timeline, 'run', cursor, cursor + minutes))
        cursor += minutes
      }
    })
    if (failed) return null

    const end = cursor
    if (end > timeline.total) return null

    // Pres o sırada başka bir iş yapıyorsa o işin bitişinden sonra dene.
    const busy = firstOverlap(timeline, setupGlobalStart, end)
    if (busy) {
      start = firstFreePoint(timeline, Math.max(start + 1, busy.end))
      if (start >= timeline.total) return null
      continue
    }

    // Kalıp bakımda: işin hiçbir parçası o güne düşemez. İş uzun olduğu
    // için bakım gününü "atlayamaz" — bakımdan sonra yeniden başlar.
    const blackout = blackoutDates && segments.find((seg) => blackoutDates.has(seg.date))
    if (blackout) {
      const resumeDay = timeline.days.find((d) => d.date > blackout.date)
      if (!resumeDay) return null
      start = firstFreePoint(timeline, Math.max(start + 1, resumeDay.offset))
      if (start >= timeline.total) return null
      continue
    }

    // Kalıp çakışması: aynı kalıp başka bir preste bu aralıkta meşgulse
    // işi o işin bitişine ötele. Kontrol gün bazında yapılır.
    const conflict = findMoldConflict(moldUsage, entry.material, pressName, segments)
    if (!conflict) {
      const first = segments[0]
      const last = segments[segments.length - 1]
      return {
        press: pressName,
        date: first?.date ?? timeline.days[0]?.date ?? '',
        endDate: last?.date ?? first?.date ?? '',
        setupStart: first?.start ?? 0,
        startGlobal: setupGlobalStart,
        endGlobal: end,
        qualityEndGlobal,
        sameMaterial,
        endMinute: last?.end ?? 0,
        segments,
        moldReservation,
        coilReservations,
      }
    }

    // Çakışan işin bitişinden sonra yeniden dene.
    const nextDay = timeline.days.find((d) => d.date === conflict.date)
    start = firstFreePoint(
      timeline,
      Math.max(start + 1, (nextDay?.offset ?? 0) + conflict.end),
    )
    if (start >= timeline.total) return null
  }
  return null
}

/** Aynı kalıbın başka bir preste çakıştığı ilk aralık. */
function findMoldConflict(
  moldUsage: MoldUsage,
  material: string,
  pressName: string,
  segments: JobSegment[],
): { date: string; end: number } | null {
  for (const segment of segments) {
    for (const iv of moldIntervalsFor(moldUsage, material, segment.date)) {
      if (iv.press === pressName) continue
      if (iv.start < segment.end && segment.start < iv.end) {
        return { date: segment.date, end: iv.end }
      }
    }
  }
  return null
}


function placeRun(
  entry: DemandEntry,
  product: ProductSpec,
  run: RunPlan,
  candidates: string[],
  pressByName: Map<string, PressSpec>,
  timelines: Map<string, PressTimeline>,
  hallSetups: Map<string, HallSetupLog>,
  pinDate: string | undefined,
  moldUsage: MoldUsage,
  options: SchedulerOptions,
  blackoutDates: Set<string> | undefined,
  pinned = false,
  decision?: PlacementDecision,
): ScheduledJob | null {
  let best: Placement | null = null
  const note = (press: string, text: string) => decision?.candidates.push({ press, note: text })

  for (const pressName of candidates) {
    const press = pressByName.get(pressName)
    const timeline = timelines.get(pressName)
    if (!press || !timeline || timeline.days.length === 0) {
      note(pressName, 'no working time in the horizon')
      continue
    }

    // Dolgu işleri kendi haftasından önce üretilmez; bakiye/acil işler
    // planın ilk gününden itibaren serbesttir.
    let earliest = offsetOfDate(timeline, entry.earliestDate)
    // Kullanıcı günü de sabitlediyse iş o günün penceresinde kalmalıdır.
    let limit: number | null = null
    if (pinDate) {
      const day = timeline.days.find((d) => d.date === pinDate)
      if (!day) {
        note(pressName, 'pinned day is not a working day')
        continue
      }
      earliest = Math.max(earliest, day.offset)
      limit = day.offset + day.capacity
    }
    // Presin ufku doluysa hiç denemeye girme: tıkanmış bir tesiste her
    // kalem için tüm ufku yeniden taramak, aramanın en pahalı hâli.
    if (firstFreePoint(timeline, earliest) >= timeline.total) {
      note(pressName, 'full until the end of the horizon')
      continue
    }

    const placement = tryPlaceOnPress(
      entry,
      run,
      pressName,
      press.hall,
      timeline,
      earliest,
      hallSetups,
      moldUsage,
      options,
      press.feedsCoil !== false,
      blackoutDates,
    )
    if (!placement) {
      note(pressName, 'no slot (mould, crane or maintenance)')
      continue
    }
    if (limit !== null && placement.endGlobal > limit) {
      note(pressName, 'does not fit in the pinned day')
      continue
    }
    decision?.candidates.push({
      press: pressName,
      endDate: placement.endDate,
      endMinute: placement.endMinute,
    })

    // Takvimde en erken biten pres kazanır. Eksen dakikaları preslere göre
    // farklı ölçekte olduğu için karşılaştırma takvim üzerinden yapılır.
    if (
      !best ||
      placement.endDate < best.endDate ||
      (placement.endDate === best.endDate && placement.endMinute < best.endMinute)
    ) {
      best = placement
    }
  }

  if (!best) return null

  const press = pressByName.get(best.press)!
  const timeline = timelines.get(best.press)!
  const sameMaterial = best.sameMaterial

  insertBooking(timeline, {
    start: best.startGlobal,
    end: best.endGlobal,
    material: entry.material,
  })

  // Vinç kaydı: kalıp ve rulo setupları ait oldukları günün defterine yazılır.
  const reserve = (date: string, type: 'mold' | 'coil', interval: SetupInterval) => {
    const hallLog = hallSetups.get(date) ?? new Map<string, HallResources>()
    const resources = hallLog.get(press.hall) ?? { mold: [], coil: [] }
    resources[type].push(interval)
    hallLog.set(press.hall, resources)
    hallSetups.set(date, hallLog)
  }
  if (best.moldReservation) {
    reserve(best.moldReservation.date, 'mold', {
      start: best.moldReservation.start,
      end: best.moldReservation.end,
    })
  }
  for (const coil of best.coilReservations) {
    reserve(coil.date, 'coil', { start: coil.start, end: coil.end })
  }

  // Kalıp meşguliyeti gün gün işlenir: iş gün sınırını aştıysa kalıp ertesi
  // gün de o preste kilitlidir.
  const perDate = new Map<string, { start: number; end: number }>()
  for (const segment of best.segments) {
    const current = perDate.get(segment.date)
    perDate.set(segment.date, {
      start: current ? Math.min(current.start, segment.start) : segment.start,
      end: current ? Math.max(current.end, segment.end) : segment.end,
    })
  }
  for (const [date, span] of perDate) {
    recordMoldInterval(moldUsage, entry.material, date, {
      press: best.press,
      start: span.start,
      end: span.end,
    })
  }

  const late = best.date > entry.dueDate
  const spansDays = best.endDate !== best.date

  const reasonParts = [
    entry.phase === 'backlog'
      ? `Backlog ${Math.round(entry.qty)} pcs`
      : entry.phase === 'urgent'
        ? `Stock runs out ${entry.dueDate} — below safety stock now`
        : `${entry.bucketLabel}: stock runs out ${entry.dueDate}, may start ${entry.earliestDate}`,
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
  if (spansDays) reasonParts.push(`continues until ${best.endDate}`)
  if (late) reasonParts.push(`⚠ starts after the stock runs out (${entry.dueDate})`)
  if (pinned) reasonParts.push('pinned by user')
  if (entry.boost) reasonParts.push('moved forward so it is not late')
  if (entry.exactLot) reasonParts.push('exact quantity — coil not run out, so another job is not late')

  const setupEnd = locate(timeline, best.startGlobal + (sameMaterial ? 0 : run.setupMinutes))
  const qualityEnd = locate(timeline, best.qualityEndGlobal)

  return {
    material: entry.material,
    press: best.press,
    hall: press.hall,
    date: best.date,
    endDate: best.endDate,
    spansDays,
    phase: entry.phase,
    urgency: entry.urgency,
    dueDate: entry.dueDate,
    earliestDate: entry.earliestDate,
    bucketLabel: entry.bucketLabel,
    late,
    quantity: run.quantity,
    shots: run.shots,
    coilsNeeded: run.coilsNeeded,
    pinned,
    coProduct: product.coProduct,
    coProductQuantity: run.coProductQuantity,
    setupStartMinute: best.setupStart,
    setupEndMinute: setupEnd.minute,
    qualityEndMinute: qualityEnd.minute,
    endMinute: best.endMinute,
    runMinutes: run.runMinutes,
    setupMinutes: sameMaterial ? 0 : run.setupMinutes,
    qualityApprovalMinutes: run.qualityApprovalMinutes,
    coilChanges: press.feedsCoil === false ? 0 : run.coilChanges,
    segments: best.segments,
    reason: reasonParts.join(' · '),
    decision,
  }
}
