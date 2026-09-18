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
        bucketLabel: 'Bakiye',
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

  // Eş ürün düşümü: A üretilirken aynı vuruştan B de çıkar, B'nin talebinden
  // düşülmelidir.
  for (const [material, list] of entriesByMaterial) {
    const product = products.get(material)
    const coProduct = product?.coProduct?.trim()
    if (!coProduct) continue
    const coList = entriesByMaterial.get(coProduct)
    if (!coList) continue

    let byproduct = list.reduce((s, e) => s + e.qty, 0)
    for (const entry of coList) {
      if (byproduct <= 0) break
      const used = Math.min(byproduct, entry.qty)
      entry.qty -= used
      byproduct -= used
    }
  }

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

function phaseRank(phase: DemandEntry['phase']): number {
  return phase === 'backlog' ? 0 : phase === 'urgent' ? 1 : 2
}

// ---- 2) Rulo / parti hesabı ----------------------------------------------

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
  runMinutes: number
  setupMinutes: number
  coilSetupMinutes: number
  totalMinutes: number
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
  const runMinutes = spm > 0 ? shots / spm : 0

  const grossWeight = product.grossWeight ?? 0
  const coilWeight = product.coilWeight ?? 0
  const kgNeeded = shots * grossWeight
  const shotsPerCoil = grossWeight > 0 && coilWeight > 0 ? Math.floor(coilWeight / grossWeight) : 0
  const coilsNeeded = shotsPerCoil > 0 ? Math.ceil(shots / shotsPerCoil) : 0

  const setupMinutes = product.setupMinutes ?? 0
  const coilSetupMinutes = (product.coilSetupMinutes ?? 0) * coilsNeeded

  return {
    quantity,
    shots,
    coProductQuantity: product.coProduct ? shots * cavities : 0,
    kgNeeded,
    shotsPerCoil,
    coilsNeeded,
    runMinutes,
    setupMinutes,
    coilSetupMinutes,
    totalMinutes: setupMinutes + coilSetupMinutes + runMinutes,
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

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

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
        minutes: pattern.shiftsPerDay * settings.shiftMinutes,
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
        minutes: shifts * settings.overtimeShiftMinutes,
      })
    } else {
      buckets.push({ date: dateStr, dayKey, shifts: 0, isOvertime: false, isHoliday: false, minutes: 0 })
    }
  }

  return buckets
}

export function weekTotalMinutes(pattern: WeekPattern, settings: ShiftSettings): number {
  return (
    pattern.workingDays * pattern.shiftsPerDay * settings.shiftMinutes +
    pattern.overtimeShifts * settings.overtimeShiftMinutes
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
  jobs: { material: string; shots: number }[],
  products: Map<string, ProductSpec>,
  rawStockKg: Map<string, number>,
): RawMaterialNeed[] {
  const byRaw = new Map<string, { kg: number; materials: Set<string> }>()

  for (const job of jobs) {
    const product = products.get(job.material)
    const raw = product?.rawMaterialCode?.trim()
    const grossWeight = product?.grossWeight ?? 0
    if (!raw || grossWeight <= 0) continue

    const entry = byRaw.get(raw) ?? { kg: 0, materials: new Set<string>() }
    entry.kg += job.shots * grossWeight
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
  const missing = new Set<string>()
  for (const job of jobs) {
    const product = products.get(job.material)
    if (!product?.rawMaterialCode?.trim() || !(product.grossWeight ?? 0)) {
      missing.add(job.material)
    }
  }
  return Array.from(missing).sort()
}
