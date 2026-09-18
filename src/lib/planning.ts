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

export interface DemandPoolItem {
  material: string
  overdue: number
  horizonNeed: number
  grossNeed: number
  netNeed: number
  weeklyAvg: number
  dailyRate: number
  daysOfCover: number
  urgency: number
  phase: 'backlog' | 'urgent' | 'fill'
}

export interface DemandPoolOptions {
  /** Kaç haftalık kovayı ihtiyaç olarak al (varsayılan 2). */
  horizonWeeks?: number
  /** Aciliyet hesabında haftada kaç gün çalışıldığı (varsayılan 5). */
  workingDaysPerWeek?: number
  /** Bu gün sayısından fazla stoğu olan malzeme acil sayılmaz (varsayılan 14). */
  urgentCoverDays?: number
}

/**
 * Teslim tarihi verisi olmadığı için aciliyet, ZPP kovalarının ortalamasından
 * türetilen günlük tüketim hızına göre hesaplanır: stok kaç gün yetiyor?
 * Bakiyesi olan malzeme her zaman ilk fazdadır.
 */
export function buildDemandPool(
  rows: DemandInput[],
  options: DemandPoolOptions = {},
): DemandPoolItem[] {
  const horizonWeeks = options.horizonWeeks ?? 2
  const workingDaysPerWeek = options.workingDaysPerWeek ?? 5
  const urgentCoverDays = options.urgentCoverDays ?? 14

  return rows
    .map((row) => {
      const periods = row.periods.map((p) => Math.abs(p.qty))
      const weeklyAvg =
        periods.length > 0 ? periods.reduce((s, q) => s + q, 0) / periods.length : 0
      const horizonNeed = periods.slice(0, horizonWeeks).reduce((s, q) => s + q, 0)
      const overdue = Math.abs(row.overdue)
      const grossNeed = overdue + horizonNeed
      const netNeed = Math.max(0, grossNeed - row.stock)

      const dailyRate = weeklyAvg > 0 ? weeklyAvg / workingDaysPerWeek : 0
      const daysOfCover =
        dailyRate > 0 ? row.stock / dailyRate : row.stock > 0 ? Number.POSITIVE_INFINITY : 0

      let phase: DemandPoolItem['phase']
      let urgency: number
      if (overdue > 0) {
        phase = 'backlog'
        urgency = 100
      } else if (daysOfCover < urgentCoverDays) {
        phase = 'urgent'
        urgency = Math.round(
          Math.max(0, Math.min(99, ((urgentCoverDays - daysOfCover) / urgentCoverDays) * 99)),
        )
      } else {
        phase = 'fill'
        urgency = 0
      }

      return {
        material: row.material,
        overdue,
        horizonNeed,
        grossNeed,
        netNeed,
        weeklyAvg,
        dailyRate,
        daysOfCover,
        urgency,
        phase,
      }
    })
    .filter((item) => item.netNeed > 0)
    .sort((a, b) => b.urgency - a.urgency || a.daysOfCover - b.daysOfCover)
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
): DayBucket[] {
  const buckets: DayBucket[] = []
  let normalDaysLeft = pattern.workingDays
  let overtimeShiftsLeft = pattern.overtimeShifts

  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i)
    const dateStr = isoDate(date)
    const isHoliday = holidays.has(dateStr)
    const dayKey = DAY_KEYS[i]

    if (isHoliday) {
      buckets.push({ date: dateStr, dayKey, shifts: 0, isOvertime: false, isHoliday, minutes: 0 })
      continue
    }

    if (normalDaysLeft > 0) {
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
