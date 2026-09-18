import { addDays, isoDate } from './dates'

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
}

/**
 * Talep havuzundaki tek bir kalem: bir malzemenin belirli bir haftaya ait
 * net ihtiyacı. ZPP kovaları takvim haftalarına bağlandığı için her kalem
 * "ne zaman gerekiyor" bilgisini taşır.
 */
export interface DemandEntry {
  material: string
  qty: number
  /** Bu ihtiyacın ait olduğu haftanın başlangıcı (ISO). */
  dueDate: string
  /** Bu işin üretilebileceği en erken gün (ISO). */
  earliestDate: string
  /** ZPP'deki kova etiketi (bakiye için 'Bakiye'). */
  bucketLabel: string
  phase: 'backlog' | 'urgent' | 'fill'
  urgency: number
  daysOfCover: number
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

  for (const row of rows) {
    const periods = row.periods.map((p) => ({ label: p.label, qty: Math.abs(p.qty) }))
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
        dueDate: baseIso,
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
    if (lotShots <= 0) continue

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
      const produceShots =
        requiredShots > 0 ? Math.ceil(requiredShots / lotShots) * lotShots : 0

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
  const grossWeight = product.grossWeight ?? 0
  const coilWeight = product.coilWeight ?? 0
  if (grossWeight <= 0 || coilWeight <= 0) return 0
  return Math.floor(coilWeight / grossWeight)
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
}

export interface RunPlan {
  /** Planlanan adet (eş üründen de aynı adet çıkar). */
  quantity: number
  shots: number
  coProductQuantity: number
  kgNeeded: number
  shotsPerCoil: number
  coilsNeeded: number
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
  const piecesInCoil = grossWeight > 0 && coilWeight > 0 ? Math.floor(coilWeight / grossWeight) : 0
  const shotsPerCoil = piecesInCoil > 0 ? Math.floor(piecesInCoil / cavities) : 0
  const coilsNeeded = piecesInCoil > 0 ? Math.ceil(quantity / piecesInCoil) : 0

  const setupMinutes = product.setupMinutes ?? 0
  const coilSetupMinutes = (product.coilSetupMinutes ?? 0) * coilsNeeded
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

  return {
    quantity,
    shots,
    coProductQuantity: product.coProduct ? shots * cavities : 0,
    kgNeeded,
    shotsPerCoil,
    coilsNeeded,
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

  const runs: RunPlan[] = []
  let remaining = quantity
  while (remaining > 0) {
    const chunk = Math.min(remaining, maxQtyPerRun)
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
  minutes: number
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
