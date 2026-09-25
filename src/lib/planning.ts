import { addDays, isoDate } from './dates'
import { splitWeek } from './dailyDemand'

// Planlama motorunun saf hesaplama katmanı.
// Buradaki fonksiyonlar Convex'ten veya React'ten bağımsızdır; girdi olarak
// düz veri alır, çıktı olarak düz veri verir — böylece test edilebilir ve
// motor mantığı UI'dan ayrı kalır.

export interface WeekPattern {
  workingDays: number
  shiftsPerDay: number
  overtimeShifts: number
}

export interface ShiftSettings {
  shiftMinutes: number
  overtimeShiftMinutes: number
  /**
   * @deprecated stopMinutesByShift bunun yerini aldı. Duruş tanımı yoksa
   * geriye dönük olarak her vardiyadan bu kadar dakika düşülür.
   */
  breakMinutesPerShift?: number
  /**
   * Vardiya bazında planlı duruş dakikası; index 0 = birinci vardiya.
   * Vardiya devri, çay ve yemek her vardiyada farklı olabilir.
   */
  stopMinutesByShift?: number[]
}

/** Bir vardiyanın planlı duruşlardan arındırılmış net süresi. */
function netShiftMinutes(
  shiftLength: number,
  settings: ShiftSettings,
  shiftIndex: number,
): number {
  const stops =
    settings.stopMinutesByShift?.[shiftIndex] ?? settings.breakMinutesPerShift ?? 0
  return Math.max(0, shiftLength - stops)
}

/** Bir günün net kapasitesi: her vardiyanın kendi duruşları düşülerek. */
function dayMinutes(
  shifts: number,
  shiftLength: number,
  settings: ShiftSettings,
  firstShiftIndex = 0,
): number {
  let total = 0
  for (let i = 0; i < shifts; i++) {
    total += netShiftMinutes(shiftLength, settings, firstShiftIndex + i)
  }
  return total
}

// ---- 1) Talep havuzu ve aciliyet -----------------------------------------

export interface DemandInput {
  material: string
  /** ZPP'deki gecikmiş (bakiye) miktar — işaretten bağımsız, mutlak alınır. */
  overdue: number
  /** ZPP haftalık kovaları, en yakın hafta başta. */
  periods: { label: string; qty: number }[]
  /** Planlamaya dahil depolardaki (Mamul + Üretim Alanı) mevcut stok. */
  stock: number
  /**
   * ZPP_DAILY'den satış günleri (ISO tarih, mutlak adet). Varsa kapsadığı
   * günlerde haftalık rakamın yerine geçer.
   */
  daily?: { date: string; qty: number }[]
}

/**
 * Talep havuzundaki tek bir kalem: bir malzemenin belirli bir haftaya ait
 * net ihtiyacı. ZPP kovaları takvim haftalarına bağlandığı için her kalem
 * "ne zaman gerekiyor" bilgisini taşır.
 */
export interface DemandEntry {
  material: string
  qty: number
  /**
   * Stoğun bittiği gün (ISO): bu lot o güne kadar gelmezse müşteri
   * beklemeye başlar. Bu günden sonra başlayan iş "geç" sayılır.
   */
  dueDate: string
  /**
   * Bu lotun üretimine başlanabilecek en erken gün (ISO): stoğun emniyet
   * seviyesine indiği gün — stok bitişinden emniyet stoğu günü kadar önce.
   */
  earliestDate: string
  /** ZPP'deki kova etiketi (bakiye için 'Bakiye'). */
  bucketLabel: string
  phase: 'backlog' | 'urgent' | 'fill'
  urgency: number
  daysOfCover: number
  /** Eş ürün bu lotla aynı vuruşta çıkar: eşin karşılanan miktarı. */
  coProductQty?: number
  /**
   * Lotun teslim anına kadar hazır olması gereken payı (0–1): stoğun bittiği
   * gün eksik kalan adet ÷ lot. Tam rulo lotunun geri kalanı sonraki
   * haftaların fazlasıdır, onun geç bitmesi gecikme değildir.
   */
  needFraction?: number
  /** Ufukta stok hiç bitmiyor: bu lot müşteriyi bekletmez, geç sayılmaz. */
  noStockout?: boolean
  /**
   * Teslim kontrol noktaları: lotun karşıladığı HER ihtiyaç günü ve o güne
   * kadar lottan hazır olması gereken pay (0–1, birikimli). Yalnızca ilk
   * günü kontrol etmek, lotun kapsadığı sonraki günlerdeki eksikleri
   * gizliyordu. Teslim anı (08:00) planPipeline'da yazılır.
   */
  checkpoints?: DeliveryCheckpoint[]
  /** Teslim anı: üretim günü ve o günün net dakikası (08:00 → net). */
  deadlineDate?: string
  deadlineNet?: number
  /** Teslim anı, okunur biçimde ("Tue 29 Sep 08:00"). */
  deadlineLabel?: string
  /** Geç kalmasın diye öne alındı (geç iş onarımı). */
  boost?: boolean
  /**
   * Yerel arama: lot kendi fazı içinde bu kadar gün öne (eksi) ya da
   * arkaya (artı) sıralanır. Teslim anı değişmez, yalnızca sıra.
   */
  orderShift?: number
}

export interface DeliveryCheckpoint {
  /** İhtiyaç günü (stoğun o gün eksiye düştüğü gün). */
  date: string
  /** O güne kadar lottan hazır olması gereken pay (0–1, birikimli). */
  fraction: number
  deadlineDate?: string
  deadlineNet?: number
  deadlineLabel?: string
}

export interface DemandScheduleOptions {
  /** Planın başlangıç haftası (Pazartesi). */
  baseMonday: Date
  /** Kaç haftalık kovayı plana al (varsayılan 4). */
  horizonWeeks?: number
  /** Aciliyet hesabında haftada kaç gün çalışıldığı (varsayılan 5). */
  workingDaysPerWeek?: number
  /** Bu gün sayısından fazla stoğu olan malzeme acil sayılmaz (varsayılan 14). */
  urgentCoverDays?: number
  /**
   * Emniyet stoğu, iş günü cinsinden. Bir sonraki lot, stok bitmeden bu
   * kadar iş günü önce üretilebilir hâle gelir (varsayılan 0).
   */
  safetyStockDays?: number
  /** Bugün (ISO). Bu haftanın talebi bugünden itibaren kalan günlere yayılır. */
  today?: string
  /** Talebin tüketildiği günler (varsayılan Pazartesi–Cuma). */
  workingDayKeys?: string[]
  /** ZPP_DAILY'nin kapsadığı son gün (ISO); yoksa günlük veri kullanılmaz. */
  dailyUntil?: string | null
}

/** Talep takvimi: bugün ve ufuktaki her haftanın açık (talep alan) günleri. */
interface DemandCalendar {
  today: string
  weeks: { start: string; end: string; openDays: string[] }[]
  workingDays: Set<string>
}

function demandCalendar(options: DemandScheduleOptions): DemandCalendar {
  const horizonWeeks = options.horizonWeeks ?? 4
  const workingKeys = new Set(options.workingDayKeys ?? ['MO', 'TU', 'WE', 'TH', 'FR'])
  const baseIso = isoDate(options.baseMonday)
  const today = options.today && options.today > baseIso ? options.today : baseIso
  const weeks: DemandCalendar['weeks'] = []
  const workingDays = new Set<string>()
  for (let w = 0; w < horizonWeeks; w++) {
    const openDays: string[] = []
    for (let d = 0; d < 7; d++) {
      const date = addDays(options.baseMonday, w * 7 + d)
      if (!workingKeys.has(DAY_KEYS[(date.getDay() + 6) % 7])) continue
      const iso = isoDate(date)
      workingDays.add(iso)
      if (iso >= today) openDays.push(iso)
    }
    weeks.push({
      start: isoDate(addDays(options.baseMonday, w * 7)),
      end: isoDate(addDays(options.baseMonday, w * 7 + 6)),
      openDays,
    })
  }
  return { today, weeks, workingDays }
}

/**
 * ZPP kovalarını takvim haftalarına bağlayarak hafta bazlı talep havuzu üretir.
 *
 * - Kova sırası takvim haftasına karşılık gelir: 0. kova içinde bulunulan
 *   hafta, 1. kova sonraki hafta, ...
 * - Mevcut stok en erken ihtiyaçtan başlayarak tüketilir (FIFO).
 * - Bakiye ve acil kalemler "en erken" üretilebilir; dolgu kalemleri kendi
 *   haftasından önce üretilmez (erken üretim stok şişirir).
 * - Eş ürün (aynı vuruşta çıkan parça) üretilecek miktar kadar, eş ürünün
 *   talebinden düşülür — aksi halde aynı parça iki kez planlanır.
 */
export function buildDemandSchedule(
  rows: DemandInput[],
  products: Map<string, ProductSpec>,
  options: DemandScheduleOptions,
): DemandEntry[] {
  const horizonWeeks = options.horizonWeeks ?? 4
  const workingDaysPerWeek = options.workingDaysPerWeek ?? 5
  const urgentCoverDays = options.urgentCoverDays ?? 14
  const baseMonday = options.baseMonday
  const baseIso = isoDate(baseMonday)

  // malzeme → hafta indeksi → kalem
  const entriesByMaterial = new Map<string, DemandEntry[]>()
  const calendar = demandCalendar(options)
  // malzeme → gün → talep (stok projeksiyonu için)
  const dayDemand = new Map<string, Map<string, number>>()

  for (const row of rows) {
    const weeklyPeriods = row.periods.map((p) => ({ label: p.label, qty: Math.abs(p.qty) }))
    // Haftalık rakam, ZPP_DAILY'nin kapsadığı günlerde günlük dosyayla
    // değiştirilir: satış günü orada yazan gündür.
    const perDay = new Map<string, number>()
    if (Math.abs(row.overdue) > 0) perDay.set(calendar.today, Math.abs(row.overdue))
    const periods = calendar.weeks.map((week, w) => {
      const split = splitWeek({
        weekStart: week.start,
        weekEnd: week.end,
        weeklyQty: weeklyPeriods[w]?.qty ?? 0,
        today: calendar.today,
        openDays: week.openDays,
        daily: row.daily,
        dailyUntil: options.dailyUntil ?? null,
      })
      for (const [date, qty] of split.perDay) perDay.set(date, (perDay.get(date) ?? 0) + qty)
      return { label: weeklyPeriods[w]?.label ?? `+${w}w`, qty: split.total }
    })
    dayDemand.set(row.material, perDay)
    const weeklyAvg =
      periods.length > 0 ? periods.reduce((s, p) => s + p.qty, 0) / periods.length : 0
    const dailyRate = weeklyAvg > 0 ? weeklyAvg / workingDaysPerWeek : 0
    const daysOfCover =
      dailyRate > 0 ? row.stock / dailyRate : row.stock > 0 ? Number.POSITIVE_INFINITY : 0
    const isUrgent = daysOfCover < urgentCoverDays

    const list: DemandEntry[] = []
    const overdue = Math.abs(row.overdue)
    if (overdue > 0) {
      list.push({
        material: row.material,
        qty: overdue,
        // Bakiye kendi grubudur: haftanın ilk gününden de önce sıralanır.
        // Aynı günü paylaşsaydı rulo yuvarlaması bu haftanın talebini de
        // bakiye lotuna katıyor, stok bakiyeyi karşılasa bile lot "Backlog"
        // etiketi ve önceliği alıyordu; zamanlama anahtarı da çakışıyordu.
        // Gerçek tarihini stok projeksiyonu verir.
        dueDate: isoDate(addDays(baseMonday, -1)),
        earliestDate: baseIso,
        bucketLabel: 'Backlog',
        phase: 'backlog',
        urgency: 100,
        daysOfCover,
      })
    }

    periods.slice(0, horizonWeeks).forEach((period, index) => {
      if (period.qty <= 0) return
      const due = isoDate(addDays(baseMonday, index * 7))
      const phase: DemandEntry['phase'] = isUrgent ? 'urgent' : 'fill'
      list.push({
        material: row.material,
        qty: period.qty,
        dueDate: due,
        // Acil kalemler öne çekilebilir, dolgu kalemleri kendi haftasından
        // önce üretilmez.
        earliestDate: phase === 'urgent' ? baseIso : due,
        bucketLabel: period.label,
        phase,
        urgency: isUrgent
          ? Math.round(
              Math.max(0, Math.min(99, ((urgentCoverDays - daysOfCover) / urgentCoverDays) * 99)),
            )
          : 0,
        daysOfCover,
      })
    })

    // Stok en erken ihtiyaçtan başlayarak düşülür.
    let stockLeft = row.stock
    for (const entry of list) {
      if (stockLeft <= 0) break
      const used = Math.min(stockLeft, entry.qty)
      entry.qty -= used
      stockLeft -= used
    }

    entriesByMaterial.set(row.material, list)
  }

  // Eş ürün: A ve B aynı kalıptan aynı vuruşta çıkar, tek tek üretilemez.
  // Bu yüzden ihtiyaç DÜŞÜLMEZ, İKİSİNİN MAKSİMUMU alınır.
  //
  // Örnek: A siparişi 1000, stok 700 → net 300. B siparişi 1500, stok 300 →
  // net 1200. B için 1200 gerektiğinden A'dan da zorunlu 1200 üretilir
  // (900'ü fazla stok olur). Eskiden A'nın 300'ü B'den düşülüyor, B'ye ayrıca
  // 900 planlanıyordu — hem miktar hem setup sayısı yanlıştı.
  const pairedWith = new Map<string, string>()
  for (const [material] of entriesByMaterial) {
    const co = products.get(material)?.coProduct?.trim()
    if (!co || co === material) continue
    pairedWith.set(material, co)
    if (!pairedWith.has(co)) pairedWith.set(co, material)
  }

  const levelled = new Set<string>()
  for (const [material, partner] of pairedWith) {
    if (levelled.has(material)) continue
    const own = entriesByMaterial.get(material) ?? []
    const other = entriesByMaterial.get(partner) ?? []
    levelled.add(material)
    levelled.add(partner)

    // Hafta bazında eşitle: her iki ürünün o haftaki ihtiyacının büyüğü
    // ikisi için de üretilecek miktardır.
    const weeks = new Set<string>([...own, ...other].map((e) => e.dueDate))
    for (const week of weeks) {
      const ownWeek = own.filter((e) => e.dueDate === week)
      const otherWeek = other.filter((e) => e.dueDate === week)
      const ownQty = ownWeek.reduce((sum, e) => sum + e.qty, 0)
      const otherQty = otherWeek.reduce((sum, e) => sum + e.qty, 0)
      const required = Math.max(ownQty, otherQty)
      if (required <= 0) continue

      levelToRequired(entriesByMaterial, material, week, ownWeek, ownQty, required, baseIso)
      levelToRequired(entriesByMaterial, partner, week, otherWeek, otherQty, required, baseIso)
    }
  }


  // Rulo lotu: bağlanan rulo sonuna kadar basılır, bu yüzden ihtiyaç tam
  // ruloya yuvarlanır ve fazlası EN ERKEN kaleme eklenir — rulo tek seferde
  // bitirilir, haftaya bölünmez.
  roundMaterialsToCoilLot(entriesByMaterial, products, pairedWith)

  // Lotların ZAMANI: haftanın başı değil, öngörülen stoğun bittiği gün.
  timeLotsByProjectedStock(entriesByMaterial, rows, options, pairedWith, calendar, dayDemand)

  // Eş ürün çifti TEK iştir: aynı vuruş ikisini birden verir. Eşin lotu,
  // eşi tanımlayan ana ürünün aynı zamanlı lotuna katılır; ayrı planlansaydı
  // pres süresi ve setup iki kez sayılırdı.
  mergeCoProductLots(entriesByMaterial, products, pairedWith)

  return Array.from(entriesByMaterial.values())
    .flat()
    .filter((entry) => entry.qty > 0)
    .sort(
      (a, b) =>
        phaseRank(a.phase) - phaseRank(b.phase) ||
        a.dueDate.localeCompare(b.dueDate) ||
        b.urgency - a.urgency,
    )
}

/**
 * Eş ürün lotlarını ana ürünün lotuna katar.
 *
 * Rulo yuvarlaması ve zamanlama çift için ortak yapıldığından her haftada
 * iki ürünün lotu aynı güne düşer. Ana ürünün lotu kalır (aciliyeti ikisinin
 * en acili olur), eşinki kaldırılır ve miktarı `coProductQty` olarak taşınır.
 */
function mergeCoProductLots(
  entriesByMaterial: Map<string, DemandEntry[]>,
  products: Map<string, ProductSpec>,
  pairedWith: Map<string, string>,
): void {
  const done = new Set<string>()
  for (const [material, partner] of pairedWith) {
    if (done.has(material)) continue
    done.add(material)
    done.add(partner)
    const primary = primaryOfPair(material, partner, products)
    if (!primary) continue
    const carrier = primary.code === partner ? partner : material
    const other = carrier === material ? partner : material
    const carrierLots = (entriesByMaterial.get(carrier) ?? []).filter((e) => e.qty > 0)
    const otherLots = entriesByMaterial.get(other) ?? []
    for (const lot of otherLots) {
      if (lot.qty <= 0) continue
      const match =
        carrierLots.find((c) => c.dueDate === lot.dueDate && c.earliestDate === lot.earliestDate) ??
        carrierLots.find((c) => c.dueDate === lot.dueDate)
      if (!match) continue
      match.coProductQty = (match.coProductQty ?? 0) + lot.qty
      match.needFraction = Math.max(match.needFraction ?? 0, lot.needFraction ?? 0)
      if (lot.checkpoints?.length) {
        match.checkpoints = [...(match.checkpoints ?? []), ...lot.checkpoints].sort(
          (a, b) => a.date.localeCompare(b.date) || a.fraction - b.fraction,
        )
      }
      match.noStockout = !!match.noStockout && !!lot.noStockout
      if (phaseRank(lot.phase) < phaseRank(match.phase)) match.phase = lot.phase
      match.urgency = Math.max(match.urgency, lot.urgency)
      if (lot.earliestDate < match.earliestDate) match.earliestDate = lot.earliestDate
      if (lot.dueDate < match.dueDate) match.dueDate = lot.dueDate
      lot.qty = 0
    }
  }
}

/**
 * Her lotun ne zaman gerektiğini öngörülen stoktan bulur.
 *
 * Miktarlar zaten doğru: rulo lotunun artanı sonraki haftaları karşılıyor.
 * Ama lotun ZAMANI hafta başına ya da (acil malzemede) bugüne bağlıydı —
 * 1000 bakiye + 2000/hafta talep ve 6000'lik ruloda, iki hafta sonra
 * gereken ikinci rulo "acil" sayılıp ilkinin hemen ardından basılabiliyordu.
 *
 * Şimdi gün gün yürünür: haftalık talep o haftanın iş günlerine eşit
 * dağıtılır (bu hafta için bugünden sonraki günlere), bakiye bugün
 * tüketilir. Her lot için, ondan önceki stok + önceki lotlar tükendiği gün
 * STOK BİTİŞİ'dir (dueDate). Üretim, bundan emniyet stoğu günü kadar iş
 * günü önce başlayabilir (earliestDate). Daha erken değil — erken üretim
 * stok şişirir ve presi başka bir parçadan alır.
 */
function timeLotsByProjectedStock(
  entriesByMaterial: Map<string, DemandEntry[]>,
  rows: DemandInput[],
  options: DemandScheduleOptions,
  pairedWith: Map<string, string>,
  calendar: DemandCalendar,
  dayDemand: Map<string, Map<string, number>>,
): void {
  const safetyDays = Math.max(0, Math.round(options.safetyStockDays ?? 0))
  const today = calendar.today

  // Talebin tüketildiği günler: bugün + ufuktaki iş günleri + ZPP_DAILY'de
  // satış olan her gün (Cumartesi sevkiyat da olabilir).
  const daySet = new Set<string>([today])
  for (const week of calendar.weeks) for (const d of week.openDays) daySet.add(d)
  for (const perDay of dayDemand.values()) {
    for (const d of perDay.keys()) if (d >= today) daySet.add(d)
  }
  const days = Array.from(daySet).sort()
  const dayIndex = new Map(days.map((d, i) => [d, i]))
  // Emniyet günleri iş günü sayılır; bugün her zaman sayılır.
  const counts = days.map((d, i) => i === 0 || calendar.workingDays.has(d))
  const backBy = (from: number, n: number) => {
    let i = from
    let left = n
    while (left > 0 && i > 0) {
      i -= 1
      if (counts[i]) left -= 1
    }
    return i
  }

  const rowByMaterial = new Map(rows.map((r) => [r.material, r]))

  // Önce her lotun zamanı hesaplanır (malzeme + lotun haftası anahtarıyla),
  // sonra uygulanır — eş ürünler aynı vuruştan çıktığı için ikisinin
  // lotu aynı güne, ikisinden hangisi önce bitecekse ONA göre konmalı.
  const timing = new Map<
    string,
    { due: number; start: number; need: number; none: boolean; checkpoints: DeliveryCheckpoint[] }
  >()
  const key = (material: string, week: string) => `${material}|${week}`

  for (const [material, entries] of entriesByMaterial) {
    const lots = entries.filter((e) => e.qty > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    if (lots.length === 0) continue
    const row = rowByMaterial.get(material)

    // Günlük brüt talep.
    const demand = new Array<number>(days.length).fill(0)
    for (const [date, qty] of dayDemand.get(material) ?? []) {
      demand[dayIndex.get(date < today ? today : date) ?? 0] += qty
    }

    let supply = row?.stock ?? 0
    for (const lot of lots) {
      // Bu lot gelmeden stok hangi gün eksiye düşer?
      let consumed = 0
      let stockout = -1
      for (let i = 0; i < days.length; i++) {
        consumed += demand[i]
        if (supply - consumed < -1e-6) {
          stockout = i
          break
        }
      }
      // O gün eksik kalan adet: lotun teslim anına kadar hazır olması gereken kısmı.
      const need = stockout >= 0 ? Math.max(0, consumed - supply) : 0
      // Lotun karşıladığı sonraki günler de birer teslim noktasıdır.
      const checkpoints: DeliveryCheckpoint[] = []
      if (stockout >= 0 && lot.qty > 0) {
        let cumulative = consumed
        for (let i = stockout; i < days.length && checkpoints.length < 40; i++) {
          if (i > stockout) cumulative += demand[i]
          const short = Math.min(lot.qty, cumulative - supply)
          const last = checkpoints[checkpoints.length - 1]
          if (short > (last ? last.fraction * lot.qty : 0) + 1e-6) {
            checkpoints.push({ date: days[i], fraction: Math.min(1, short / lot.qty) })
          }
          if (short >= lot.qty - 1e-6) break
        }
      }
      supply += lot.qty
      // Ufukta hiç bitmiyorsa (ör. eş ürünün kendi talebi yok) lotun
      // haftasına bağlı kalır, ama emniyet günü yine uygulanır.
      const due =
        stockout >= 0 ? stockout : (dayIndex.get(lot.dueDate) ?? nextIndex(days, lot.dueDate))
      timing.set(key(material, lot.dueDate), {
        due,
        start: backBy(due, safetyDays),
        need: lot.qty > 0 ? Math.min(1, need / lot.qty) : 0,
        none: stockout < 0,
        checkpoints,
      })
    }
  }

  for (const [material, entries] of entriesByMaterial) {
    const partner = pairedWith.get(material)
    for (const lot of entries) {
      if (lot.qty <= 0) continue
      const own = timing.get(key(material, lot.dueDate))
      if (!own) continue
      const found = partner ? timing.get(key(partner, lot.dueDate)) : undefined
      // Stoğu ufukta hiç bitmeyen eş, çiftin zamanını hafta başına çekmesin:
      // gerçek ihtiyaç diğer tarafınkidir.
      const other = found && !(found.none && !own.none) ? found : undefined
      const useOther = !!other && !(own.none && !other.none)
      const due = other ? (useOther ? Math.min(own.due, other.due) : other.due) : own.due
      const start = other ? (useOther ? Math.min(own.start, other.start) : other.start) : own.start
      lot.needFraction = other ? Math.max(own.need, other.need) : own.need
      lot.noStockout = other ? own.none && other.none : own.none
      // Pay vuruş oranıdır; eş ürünün noktaları aynı ölçekte eklenebilir.
      lot.checkpoints = [...own.checkpoints, ...(other?.checkpoints ?? [])].sort(
        (a, b) => a.date.localeCompare(b.date) || a.fraction - b.fraction,
      )
      lot.dueDate = days[due] ?? lot.dueDate
      lot.earliestDate = days[start] ?? lot.earliestDate
      lot.daysOfCover = due
      if (lot.phase !== 'backlog') {
        lot.phase = start === 0 ? 'urgent' : 'fill'
        lot.urgency = lot.phase === 'urgent' ? Math.max(1, 99 - due) : 0
      }
    }
  }
}

function nextIndex(days: string[], date: string): number {
  const i = days.findIndex((d) => d >= date)
  return i >= 0 ? i : days.length - 1
}

/**
 * Bir eş ürünün belirli haftadaki miktarını gereken seviyeye çıkarır.
 * Kalem yoksa (o hafta hiç ihtiyacı yoksa ama eşi üretiliyorsa) yeni bir
 * kalem açılır — zorunlu birlikte üretim budur.
 */
function levelToRequired(
  entriesByMaterial: Map<string, DemandEntry[]>,
  material: string,
  week: string,
  weekEntries: DemandEntry[],
  currentQty: number,
  required: number,
  baseIso: string,
): void {
  if (currentQty >= required) return
  const extra = required - currentQty

  if (weekEntries.length > 0) {
    // Mevcut kalemin üzerine ekle; faz ve aciliyet korunur.
    weekEntries[0].qty += extra
    return
  }

  const list = entriesByMaterial.get(material) ?? []
  list.push({
    material,
    qty: extra,
    dueDate: week,
    earliestDate: week < baseIso ? baseIso : week,
    bucketLabel: 'Co-product',
    phase: 'fill',
    urgency: 0,
    daysOfCover: Number.POSITIVE_INFINITY,
  })
  entriesByMaterial.set(material, list)
}

/**
 * İhtiyacı rulo lotlarına çevirir.
 *
 * Bağlanan rulo yarıda sökülmez: bir rulo bağlandıysa sonuna kadar basılır.
 * Kısıt VURUŞ üzerindedir — rulo vuruşla tükenir — ve üretilen parça adedi
 * her ürünün kendi göz sayısından çıkar. Eş ürünlerde göz sayıları farklı
 * olabileceği için bu ayrım şarttır: 3000 vuruşluk rulo, 2 gözlü A'dan 6000,
 * 1 gözlü B'den 3000 parça verir.
 *
 * Fazla üretilen parça sonraki haftalara taşınır; o haftalar artandan
 * karşılanıyorsa yeni rulo bağlanmaz. Kullanıcının örneği: 200 bakiye +
 * gelecek hafta 2000 sipariş, rulodan 3000 adet. Bakiye için rulo bağlanır
 * ve 3000 basılır; 2800 artar, gelecek haftanın 2000'i bundan karşılanır.
 * Sonuç tek iş, tek setup. Hafta hafta yuvarlansaydı iki rulo çıkardı.
 */
function roundMaterialsToCoilLot(
  entriesByMaterial: Map<string, DemandEntry[]>,
  products: Map<string, ProductSpec>,
  pairedWith: Map<string, string>,
): void {
  const done = new Set<string>()

  for (const [material] of entriesByMaterial) {
    if (done.has(material)) continue
    const partner = pairedWith.get(material)
    done.add(material)
    if (partner) done.add(partner)


    const own = entriesByMaterial.get(material) ?? []
    const other = partner ? (entriesByMaterial.get(partner) ?? []) : []
    const product = products.get(material)
    const partnerProduct = partner ? products.get(partner) : undefined

    // Rulo tüketimi yalnızca asıl ürünün gramajından hesaplanır; eş ürün
    // aynı gramajın içinden bedavaya çıkar.
    const primary = primaryOfPair(material, partner, products)
    const lotShots = primary ? shotsPerCoil(primary) : 0
    // Minimum lot, vuruş cinsinden (asıl ürünün göz sayısıyla).
    const minShots =
      primary && (primary.minLotQty ?? 0) > 0 ? Math.ceil((primary.minLotQty ?? 0) / cavitiesOf(primary)) : 0
    if (lotShots <= 0 && minShots <= 0) continue

    const ownCavities = cavitiesOf(product)
    const partnerCavities = cavitiesOf(partnerProduct)
    void product
    void partnerProduct

    const weeks = Array.from(new Set([...own, ...other].map((e) => e.dueDate))).sort()
    // Artan, üretilmiş PARÇA cinsindendir ve ürün başına ayrı tutulur —
    // göz sayıları farklıysa artanlar da farklı olur.
    let carry = 0
    let partnerCarry = 0

    for (const week of weeks) {
      const ownWeek = own.filter((e) => e.dueDate === week)
      const otherWeek = other.filter((e) => e.dueDate === week)
      const ownQty = ownWeek.reduce((sum, e) => sum + e.qty, 0)
      const otherQty = otherWeek.reduce((sum, e) => sum + e.qty, 0)

      const ownNeed = Math.max(0, ownQty - carry)
      const otherNeed = Math.max(0, otherQty - partnerCarry)

      // Her ürünün ihtiyacı kendi göz sayısıyla vuruşa çevrilir; rulo
      // ikisini birden beslediği için büyük olan belirler.
      const requiredShots = Math.max(
        Math.ceil(ownNeed / ownCavities),
        Math.ceil(otherNeed / partnerCavities),
      )
      // Rulo: tam rulo katı. Minimum lot: en az o kadar, üstü ihtiyaç kadar.
      const produceShots =
        requiredShots <= 0
          ? 0
          : lotShots > 0
            ? Math.ceil(requiredShots / lotShots) * lotShots
            : Math.max(requiredShots, minShots)

      const producedOwn = produceShots * ownCavities
      const producedPartner = produceShots * partnerCavities
      carry += producedOwn - ownQty
      partnerCarry += producedPartner - otherQty

      setWeekQuantity(ownWeek, producedOwn)
      setWeekQuantity(otherWeek, producedPartner)
    }
  }
}

/**
 * Bir haftanın toplamını verilen miktara getirir. Rulo lotu tek işte
 * basıldığı için miktar ilk kaleme yazılır, diğerleri sıfırlanır — aksi
 * halde aynı rulo için birden fazla setup planlanırdı.
 */
function setWeekQuantity(weekEntries: DemandEntry[], quantity: number): void {
  if (weekEntries.length === 0) return
  weekEntries[0].qty = quantity
  for (let i = 1; i < weekEntries.length; i++) weekEntries[i].qty = 0
}

function phaseRank(phase: DemandEntry['phase']): number {
  return phase === 'backlog' ? 0 : phase === 'urgent' ? 1 : 2
}

/**
 * Bir rulodan çıkan PARÇA adedi.
 *
 * Brüt ağırlık parça başına tüketilen kilodur, bu yüzden rulo ağırlığını ona
 * bölmek doğrudan adedi verir. Göz sayısı bu adedi değiştirmez — göz sayısı
 * o adedin kaç vuruşta basılacağını belirler.
 */
export function piecesPerCoil(product: ProductSpec): number {
  // Minimum lot tanımlıysa rulo hesabı hiç yapılmaz (ör. transfer preste
  // rulo miktarı esnek; rulo ağırlığı orada yalnızca temsili bir sayıdır).
  if ((product.minLotQty ?? 0) > 0) return 0
  const grossWeight = product.grossWeight ?? 0
  const coilWeight = product.coilWeight ?? 0
  // 1 kg ve altı gerçek bir rulo değildir, yer tutucudur.
  if (grossWeight <= 0 || coilWeight <= PLACEHOLDER_COIL_KG) return 0
  return Math.floor(coilWeight / grossWeight)
}

/** Bu ağırlık ve altındaki rulo ağırlığı "girilmemiş" sayılır. */
export const PLACEHOLDER_COIL_KG = 1

/**
 * Lot kuralı: minimum lot tanımlıysa o, değilse tam rulo. İkisi de yoksa
 * ana veri eksiktir; lot tam ihtiyaç kadar kurulur ve plan uyarır.
 */
export function lotRuleOf(product: ProductSpec | undefined): 'minLot' | 'coil' | 'missing' {
  if (!product) return 'missing'
  if ((product.minLotQty ?? 0) > 0) return 'minLot'
  return piecesPerCoil(product) > 0 ? 'coil' : 'missing'
}

function cavitiesOf(product: ProductSpec | undefined): number {
  return product?.moldCavities && product.moldCavities > 0 ? product.moldCavities : 1
}

/**
 * Bir rulodan çıkan VURUŞ sayısı: adet ÷ göz sayısı.
 * 4 gözlü kalıpta aynı rulo dörtte bir vuruşta biter.
 */
export function shotsPerCoil(product: ProductSpec): number {
  const pieces = piecesPerCoil(product)
  if (pieces <= 0) return 0
  return Math.floor(pieces / cavitiesOf(product))
}

/**
 * Eş ürün çiftinde rulo tüketimini belirleyen ürün.
 *
 * Eş ürün aynı gramajın içinden çıkar — ayrıca malzeme yemez, bedavaya
 * gelir. Bu yüzden rulo hesabı yalnızca asıl ürünün brüt ağırlığından
 * yapılır; eş ürünün ağırlığı hiç kullanılmaz.
 */
function primaryOfPair(
  material: string,
  partner: string | undefined,
  products: Map<string, ProductSpec>,
): ProductSpec | undefined {
  const own = products.get(material)
  if (!partner) return own
  const other = products.get(partner)
  // Eş ürünü tanımlayan taraf asıldır; tanımsızsa geçerli spesi olan kullanılır.
  if (own?.coProduct?.trim() === partner) return own
  if (other?.coProduct?.trim() === material) return other
  return piecesPerCoil(own ?? { code: material }) > 0 ? own : other
}

// ---- 2) Rulo / parti hesabı ----------------------------------------------// ---- 2) Rulo / parti hesabı ----------------------------------------------

export interface ProductSpec {
  code: string
  coProduct?: string
  moldCavities?: number
  spm?: number
  /** Kg / shot (bir vuruşta tüketilen brüt ağırlık). */
  grossWeight?: number
  /** Ortalama rulo ağırlığı (kg). */
  coilWeight?: number
  /**
   * Minimum lot (adet). Tanımlıysa lot bundan küçük olamaz ve rulo hesabı
   * yapılmaz; tanımlı değilse lot tam rulodur.
   */
  minLotQty?: number
  /** Hammadde (sac rulo) malzeme kodu. */
  rawMaterialCode?: string
  setupMinutes?: number
  coilSetupMinutes?: number
  /** Kalıbın bakım öncesi maksimum baskı sayısı. */
  maxShots?: number
  /** Setup sonrası ilk parça / kalite onayı süresi (dk). */
  qualityApprovalMinutes?: number
  /**
   * Kalıp bazlı OEE çarpanı (0–1). Kalite %100 kabul edildiği için
   * kullanılabilirlik × performans demektir. 0.5 girilirse işin toplam
   * penceresi teorik sürenin iki katı olur.
   */
  performanceFactor?: number
  mainMachine?: string
  altMachine1?: string
  altMachine2?: string
  altMachine3?: string
  altMachine4?: string
  /**
   * İşaretliyse alternatif preslerde de planlanabilir. İşaretsizse kalite
   * gereği yalnızca ana preste çalışır.
   */
  flexiblePress?: boolean
}

/**
 * Parçanın planlanabileceği presler: ana pres, ve yalnızca "esnek" işaretliyse
 * alternatifler. Kalite onayı bir prese bağlı parçalar, alternatifi tanımlı
 * olsa bile başka prese kaydırılmaz.
 */
export function eligiblePressesOf(product: ProductSpec | undefined): string[] {
  if (!product) return []
  const list = [product.mainMachine]
  if (product.flexiblePress) {
    list.push(product.altMachine1, product.altMachine2, product.altMachine3, product.altMachine4)
  }
  return Array.from(
    new Set(list.map((m) => m?.trim()).filter((m): m is string => !!m)),
  )
}

export interface RunPlan {
  /** Planlanan adet (eş üründen de aynı adet çıkar). */
  quantity: number
  shots: number
  coProductQuantity: number
  kgNeeded: number
  shotsPerCoil: number
  coilsNeeded: number
  /** Ana setup'tan sonra bağlanan rulo sayısı (ilk rulo setup'a dahildir). */
  coilChanges: number
  /** Tek bir rulo değişiminin süresi (dk). */
  coilChangeMinutes: number
  /**
   * Her rulonun üretim süresi (dk), sırayla. Rulo değişimleri bu parçaların
   * ARASINA girer — hepsi başta değil, rulo bittikçe. Hangi saatte hangi
   * rulonun bağlanacağı sahada önemlidir.
   */
  coilRunMinutes: number[]
  /** İdeal hızda üretim süresi (dk) — çarpan uygulanmamış. */
  theoreticalRunMinutes: number
  /** Gantt'ta çizilecek üretim süresi (dk) — çarpan uygulanmış. */
  runMinutes: number
  setupMinutes: number
  coilSetupMinutes: number
  /** Setup sonrası kalite onayı (dk). */
  qualityApprovalMinutes: number
  /** İşin toplam penceresi: setup + rulo setup + kalite onayı + üretim. */
  totalMinutes: number
  /**
   * Toplam pencere, çarpanın öngördüğünden uzun oldu: setup ve onay
   * süreleri pencereye sığmadığı için üretim teorik süreye çekildi.
   */
  clampedToTheoretical: boolean
  /** Kalıp limiti aşılıyorsa true — üretim bölünmeli veya bakım gerekir. */
  exceedsMoldLimit: boolean
}

/**
 * Bir üretim kalemi için vuruş, rulo ve süre hesabı.
 * Eş ürün (coProduct) aynı vuruşta çıktığı için aynı adet kadar üretilmiş
 * sayılır ve onun talebinden de düşülmelidir.
 */
export function computeRunPlan(product: ProductSpec, quantity: number): RunPlan {
  const cavities = product.moldCavities && product.moldCavities > 0 ? product.moldCavities : 1
  const shots = Math.ceil(quantity / cavities)
  const spm = product.spm && product.spm > 0 ? product.spm : 0
  const theoreticalRunMinutes = spm > 0 ? shots / spm : 0

  const grossWeight = product.grossWeight ?? 0
  const coilWeight = product.coilWeight ?? 0
  // Brüt ağırlık parça başına olduğu için tüketim adetten hesaplanır.
  const kgNeeded = quantity * grossWeight
  void coilWeight
  const piecesInCoil = piecesPerCoil(product)
  const shotsPerCoil = piecesInCoil > 0 ? Math.floor(piecesInCoil / cavities) : 0
  const coilsNeeded = piecesInCoil > 0 ? Math.ceil(quantity / piecesInCoil) : 0

  const setupMinutes = product.setupMinutes ?? 0
  // İlk rulo ana setup'ın içinde bağlanır; kayıp yalnızca sonraki rulolarda
  // yaşanır. Rulo beslemeyen presler (transfer) bunu hiç ödemez — orada
  // setup tektir.
  const coilChanges = Math.max(0, coilsNeeded - 1)
  const coilChangeMinutes = product.coilSetupMinutes ?? 0
  const coilSetupMinutes = coilChangeMinutes * coilChanges
  const qualityApprovalMinutes = product.qualityApprovalMinutes ?? 0
  const nonProductive = setupMinutes + coilSetupMinutes + qualityApprovalMinutes

  // Kalıp bazlı OEE çarpanı işin TOPLAM penceresini belirler; setup, rulo
  // setup ve kalite onayı bu pencerenin içinden düşülür. Örnek: 2000 parça
  // için teorik 60 dk, çarpan %50 → pencere 120 dk; 30 dk setup + 10 dk
  // onay düşülünce üretim 80 dk kalır.
  const factor =
    product.performanceFactor && product.performanceFactor > 0
      ? Math.min(1, product.performanceFactor)
      : 1
  const window = factor < 1 ? theoreticalRunMinutes / factor : theoreticalRunMinutes + nonProductive

  // Pencere setup+onayı karşılamıyorsa üretim negatife düşemez; makine
  // teorik süreden hızlı da olamaz, bu yüzden teorik süreye çekilir.
  const runFromWindow = window - nonProductive
  const clampedToTheoretical = runFromWindow < theoreticalRunMinutes
  const runMinutes = clampedToTheoretical ? theoreticalRunMinutes : runFromWindow

  // Üretimi rulo başına parçalara böl: her rulo kendi süresi kadar çalışır,
  // aralarına rulo değişimi girer.
  const coilRunMinutes: number[] = []
  if (piecesInCoil > 0 && quantity > 0) {
    let left = quantity
    while (left > 0) {
      const chunk = Math.min(left, piecesInCoil)
      coilRunMinutes.push((runMinutes * chunk) / quantity)
      left -= chunk
    }
  } else {
    coilRunMinutes.push(runMinutes)
  }

  return {
    quantity,
    shots,
    coProductQuantity: product.coProduct ? shots * cavities : 0,
    kgNeeded,
    shotsPerCoil,
    coilsNeeded,
    coilChanges,
    coilChangeMinutes,
    coilRunMinutes,
    theoreticalRunMinutes,
    runMinutes,
    setupMinutes,
    coilSetupMinutes,
    qualityApprovalMinutes,
    totalMinutes: nonProductive + runMinutes,
    clampedToTheoretical,
    exceedsMoldLimit: !!product.maxShots && product.maxShots > 0 && shots > product.maxShots,
  }
}

/**
 * Kalıp limiti aşılıyorsa üretimi limite sığan partilere böler.
 * Her parti kendi setup'ını taşır (kalıp bakımı arada yapılır).
 */
export function splitByMoldLimit(product: ProductSpec, quantity: number): RunPlan[] {
  const cavities = product.moldCavities && product.moldCavities > 0 ? product.moldCavities : 1
  const maxShots = product.maxShots ?? 0
  if (maxShots <= 0) return [computeRunPlan(product, quantity)]

  const maxQtyPerRun = maxShots * cavities
  if (quantity <= maxQtyPerRun) return [computeRunPlan(product, quantity)]

  // Partiler tam rulo sınırında bölünür: bağlanan rulo yarıda bırakılmaz.
  // Tek rulo limitten büyükse parti bir rulodur (limit aşımı işte uyarılır).
  const coilUnit = shotsPerCoil(product) * cavities
  const chunkSize =
    coilUnit > 0 ? Math.max(coilUnit, Math.floor(maxQtyPerRun / coilUnit) * coilUnit) : maxQtyPerRun

  const runs: RunPlan[] = []
  let remaining = quantity
  while (remaining > 0) {
    const chunk = Math.min(remaining, chunkSize)
    runs.push(computeRunPlan(product, chunk))
    remaining -= chunk
  }
  return runs
}

// ---- 3) Kapasite kovaları -------------------------------------------------

export interface DayBucket {
  /** ISO tarih (YYYY-MM-DD). */
  date: string
  dayKey: string
  shifts: number
  isOvertime: boolean
  isHoliday: boolean
  /** Bu günde kullanılabilir net üretim dakikası. */
  minutes: number
  /**
   * Kapasitenin gün içinde BAŞLADIĞI net dakika. Neredeyse her gün 0'dır;
   * bugün için geçip gitmiş saatler kadardır.
   *
   * Geçen süreyi günü kısaltarak ifade etmek yetmiyor: motor günü [0, süre)
   * kabul ettiği için işi sabahın ilk dakikasına, yani geçmişe koyuyordu.
   * Pencerenin nerede başladığı da taşınmalı.
   */
  startMinute?: number
}

export const DAY_KEYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const


/**
 * Bir haftanın gün bazlı kapasitesini çıkarır.
 * Normal vardiyalar haftanın ilk `workingDays` gününe dağıtılır (tatiller
 * atlanır), fazla mesai vardiyaları bunların ardındaki günlere eklenir.
 */
export function buildWeekBuckets(
  weekStart: Date,
  pattern: WeekPattern,
  settings: ShiftSettings,
  holidays: Set<string> = new Set(),
  /**
   * Normal vardiyaların yerleşebileceği hafta günleri (MO..SU). Şirket
   * Salı–Cumartesi çalışıyorsa normal vardiyalar Pazartesi'ye konmamalı.
   * Verilmezse tüm günler uygundur (eski davranış).
   */
  workingDayKeys?: readonly string[],
): DayBucket[] {
  const buckets: DayBucket[] = []
  let normalDaysLeft = pattern.workingDays
  let overtimeShiftsLeft = pattern.overtimeShifts
  const allowed =
    workingDayKeys && workingDayKeys.length > 0
      ? new Set(workingDayKeys)
      : new Set<string>(DAY_KEYS)

  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i)
    const dateStr = isoDate(date)
    const isHoliday = holidays.has(dateStr)
    const dayKey = DAY_KEYS[i]

    if (isHoliday) {
      buckets.push({ date: dateStr, dayKey, shifts: 0, isOvertime: false, isHoliday, minutes: 0 })
      continue
    }

    if (allowed.has(dayKey) && normalDaysLeft > 0) {
      normalDaysLeft--
      buckets.push({
        date: dateStr,
        dayKey,
        shifts: pattern.shiftsPerDay,
        isOvertime: false,
        isHoliday: false,
        minutes: dayMinutes(pattern.shiftsPerDay, settings.shiftMinutes, settings),
      })
    } else if (overtimeShiftsLeft > 0) {
      const shifts = Math.min(overtimeShiftsLeft, 3)
      overtimeShiftsLeft -= shifts
      buckets.push({
        date: dateStr,
        dayKey,
        shifts,
        isOvertime: true,
        isHoliday: false,
        minutes: dayMinutes(shifts, settings.overtimeShiftMinutes, settings),
      })
    } else {
      buckets.push({ date: dateStr, dayKey, shifts: 0, isOvertime: false, isHoliday: false, minutes: 0 })
    }
  }

  return buckets
}

export function weekTotalMinutes(pattern: WeekPattern, settings: ShiftSettings): number {
  return (
    pattern.workingDays * dayMinutes(pattern.shiftsPerDay, settings.shiftMinutes, settings) +
    dayMinutes(pattern.overtimeShifts, settings.overtimeShiftMinutes, settings)
  )
}

export function weekTotalShifts(pattern: WeekPattern): number {
  return pattern.workingDays * pattern.shiftsPerDay + pattern.overtimeShifts
}

// ---- 4) Hammadde (rulo) ihtiyacı ------------------------------------------

export interface RawMaterialNeed {
  rawMaterial: string
  /** Bu hammaddeden üretilen mamuller. */
  materials: string[]
  requiredKg: number
  availableKg: number
  /** Eksik kilo — 0 ise hammadde yeterli. */
  shortageKg: number
}

/**
 * Planlanan işlerin hammadde (sac rulo) ihtiyacını çıkarır ve eldeki
 * hammadde stoğuyla karşılaştırır. Vuruş başına brüt ağırlık üzerinden
 * hesaplanır; referans kartında hammadde kodu tanımlı olmayan mamuller
 * atlanır (uyarı olarak ayrıca listelenir).
 */
export function buildRawMaterialPlan(
  jobs: { material: string; quantity: number }[],
  products: Map<string, ProductSpec>,
  rawStockKg: Map<string, number>,
): RawMaterialNeed[] {
  const byRaw = new Map<string, { kg: number; materials: Set<string> }>()

  // Eş ürün aynı gramajın içinden çıkar: asıl ürünün tükettiği sacın içinde
  // zaten sayılmıştır. İkinci kez saymak hammadde ihtiyacını şişirirdi.
  const secondary = new Set<string>()
  for (const product of products.values()) {
    const co = product.coProduct?.trim()
    if (co && co !== product.code) secondary.add(co)
  }

  for (const job of jobs) {
    if (secondary.has(job.material)) continue
    const product = products.get(job.material)
    const raw = product?.rawMaterialCode?.trim()
    const grossWeight = product?.grossWeight ?? 0
    if (!raw || grossWeight <= 0) continue

    const entry = byRaw.get(raw) ?? { kg: 0, materials: new Set<string>() }
    // Brüt ağırlık parça başına.
    entry.kg += job.quantity * grossWeight
    entry.materials.add(job.material)
    byRaw.set(raw, entry)
  }

  return Array.from(byRaw.entries())
    .map(([rawMaterial, entry]) => {
      const availableKg = rawStockKg.get(rawMaterial) ?? 0
      return {
        rawMaterial,
        materials: Array.from(entry.materials).sort(),
        requiredKg: entry.kg,
        availableKg,
        shortageKg: Math.max(0, entry.kg - availableKg),
      }
    })
    .sort((a, b) => b.shortageKg - a.shortageKg || a.rawMaterial.localeCompare(b.rawMaterial))
}

/** Referans kartında hammadde kodu ya da brüt ağırlık eksik olan mamuller. */
export function materialsMissingRawSpec(
  jobs: { material: string }[],
  products: Map<string, ProductSpec>,
): string[] {
  const secondary = new Set<string>()
  for (const product of products.values()) {
    const co = product.coProduct?.trim()
    if (co && co !== product.code) secondary.add(co)
  }

  const missing = new Set<string>()
  for (const job of jobs) {
    if (secondary.has(job.material)) continue
    const product = products.get(job.material)
    if (!product?.rawMaterialCode?.trim() || !(product.grossWeight ?? 0)) {
      missing.add(job.material)
    }
  }
  return Array.from(missing).sort()
}
