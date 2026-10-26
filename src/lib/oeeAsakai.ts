/**
 * Asakai sayfaları (planlamacı, 2026-10-26): Excel "Metal Stamping Daily
 * Follow Up" (haftalık) ve vardiya × makine ayrıntısının birebir kopyası.
 * Hesap yeni değil: OEE toplam süreden (oeeOf), kayıplar Losses Trend'inki
 * (lossBreakdown, % of Loading), vardiya kesiti Loss Bridge'inki (shiftSlice).
 * Grup = seçili alandaki masraf yeri (Excel'de PROGRESSIVE / TRANSFER).
 */
import {
  PLANT_AREA,
  addDaysIso,
  chartShare,
  costCenterName,
  inScope,
  lossBreakdown,
  lossForPeriod,
  monthlyTrend,
  oeeOf,
  shiftNumber,
  sumTimes,
  weeklyTrend,
  type DayRow,
  type DowntimeDay,
  type LossDay,
  type MonthlyRow,
  type OeeConfig,
  type OrderRow,
  type Scope,
  type SeriesPoint,
  type ShiftRow,
  type WeeklyRow,
} from './oee'
import { shiftSlice } from './oeeBridge'
import { fromStoredStops, stopDayOf } from './oeeReliability'
import { splitShortStops } from './oeeShortStops'

export const ASAKAI_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const ASAKAI_WEEKS = 10
/** Ayrıntı sayfasında hücre bu paydan büyükse kırmızı (% of Loading). */
export const ASAKAI_HIGHLIGHT = 0.1

/** Bir satırın kayıp payları: grafik sütunu → Loading'e oranı (0–1). */
export interface LossRow {
  label: string
  loadingMin: number
  oee: number | null
  shares: Record<string, number>
}

export interface WeeklyGroup {
  costCenter: string
  name: string
  /** Ocak–Aralık; seçili aydan sonrası boş (oee null). */
  monthly: SeriesPoint[]
  weekly: SeriesPoint[]
  /** Makine × gün OEE (Pzt–Paz) ve haftalık; son satır grubun toplamı. */
  daily: { workCenter: string; days: (number | null)[]; week: number | null }[]
  dailyTotal: { days: (number | null)[]; week: number | null }
  /** Günlerin yığılı sütunu: OEE + kayıplar (% of Loading). */
  stacked: LossRow[]
  losses: LossRow[]
  lossTotal: LossRow
}

const MONTHS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']

/** Kapsamdaki masraf yerleri (veride olan), adına göre (Excel: Progressive, Transfer). */
export function asakaiCostCenters(rows: { workCenter: string; costCenter: string }[], scope: Scope, c: OeeConfig): string[] {
  const ccs = [...new Set(rows.filter((r) => r.costCenter && inScope(r, scope, c)).map((r) => r.costCenter))]
  return ccs.sort((a, b) => costCenterName(a, c).localeCompare(costCenterName(b, c)))
}

function lossRow(label: string, b: ReturnType<typeof lossBreakdown>, columns: string[]): LossRow {
  return {
    label,
    loadingMin: b.loadingMin,
    oee: b.oee,
    shares: Object.fromEntries(columns.map((col) => [col, chartShare(b, col)])),
  }
}

/**
 * Haftalık sayfa: her masraf yeri için aylık ve son 10 hafta OEE, haftanın
 * günleri × makine OEE, günlerin yığılı kayıpları ve haftanın kayıp tablosu.
 */
export function asakaiWeekly(
  input: {
    days: DayRow[]
    weekly: WeeklyRow[]
    monthly: MonthlyRow[]
    lossDays: LossDay[]
  },
  scope: Scope,
  c: OeeConfig,
  date: string,
  monday: string,
  columns: string[],
): WeeklyGroup[] {
  const sunday = addDaysIso(monday, 6)
  const dates = ASAKAI_DAYS.map((_, i) => addDaysIso(monday, i))
  return asakaiCostCenters(input.days, scope, c).map((cc) => {
    const s: Scope = { area: PLANT_AREA, key: cc }
    const month = monthlyTrend(input.days, input.monthly, s, c, date).total
    const monthly = MONTHS.map((label, i) =>
      month[i]
        ? { ...month[i], label }
        : {
            key: `${date.slice(0, 4)}-${label}`,
            label,
            times: sumTimes([]),
            oee: null,
          },
    )
    const weekly = weeklyTrend(input.days, input.weekly, s, c, monday, ASAKAI_WEEKS).total.map((p) => ({ ...p, label: p.label.slice(1) }))
    const inWeek = input.days.filter((d) => d.costCenter === cc && d.date >= monday && d.date <= sunday)
    const machines = [...new Set(inWeek.filter((d) => d.loadingMin > 0).map((d) => d.workCenter))].sort()
    const oeeOn = (rows: DayRow[]) => (rows.some((r) => r.loadingMin > 0) ? oeeOf(sumTimes(rows)) : null)
    const daily = machines.map((wc) => {
      const mine = inWeek.filter((d) => d.workCenter === wc)
      return {
        workCenter: wc,
        days: dates.map((d) => oeeOn(mine.filter((r) => r.date === d))),
        week: oeeOn(mine),
      }
    })
    const dailyTotal = {
      days: dates.map((d) => oeeOn(inWeek.filter((r) => r.date === d))),
      week: oeeOn(inWeek),
    }
    const stacked = dates.map((d, i) => lossRow(ASAKAI_DAYS[i], lossForPeriod(input.days, input.lossDays, s, c, d, d), columns))
    const losses = machines.map((wc) => lossRow(wc, lossForPeriod(input.days, input.lossDays, s, c, monday, sunday, wc), columns))
    const lossTotal = lossRow(costCenterName(cc, c), lossForPeriod(input.days, input.lossDays, s, c, monday, sunday), columns)
    return {
      costCenter: cc,
      name: costCenterName(cc, c),
      monthly,
      weekly,
      daily,
      dailyTotal,
      stacked,
      losses,
      lossTotal,
    }
  })
}

/** Malzemenin vardiyadaki üretimi: iyi adet ve OEE (Excel: "12660 - %90"). */
export interface PartCell {
  good: number
  oee: number | null
}

export interface DetailMachine {
  workCenter: string
  total: LossRow
  shifts: LossRow[]
  /** Günün malzemeleri (siparişlerdeki sırayla). */
  parts: string[]
  /** shifts sırasıyla: malzeme → hücre. */
  partCells: Record<string, PartCell>[]
}

export interface DetailGroup {
  costCenter: string
  name: string
  machines: DetailMachine[]
}

/** Ayardaki vardiya numaraları; yoksa 1–3. */
export function asakaiShifts(c: OeeConfig): number[] {
  const n = [...new Set(c.shifts.map((s) => s.number))].sort((a, b) => a - b)
  return n.length ? n : [1, 2, 3]
}

/**
 * Ayrıntı sayfası (tek gün): masraf yeri → makine; makinenin gün toplamı ve
 * her vardiyası (OEE, Loading, kayıplar), yanında vardiyada basılan
 * malzemeler. Vardiya kesiti Loss Bridge'inki; kısa duruşlar ayrılır.
 */
export function asakaiDetail(
  input: { shifts: ShiftRow[]; events: DowntimeDay[]; orders: OrderRow[] },
  scope: Scope,
  c: OeeConfig,
  columns: string[],
): DetailGroup[] {
  const costCenterOf = new Map(input.shifts.map((r) => [r.workCenter, r.costCenter]))
  const shifts = input.shifts.filter((r) => inScope(r, scope, c))
  const slice = (n: number, wc: string) => {
    const s = shiftSlice(n, c, {
      shifts: shifts.filter((r) => r.workCenter === wc),
      events: input.events.filter((d) => d.workCenter === wc),
      orders: [],
    })
    const lossDays = splitShortStops(s.lossDays, fromStoredStops(s.events.map(stopDayOf)), c).lossDays
    return lossBreakdown(sumTimes(s.days), lossDays, c)
  }
  const numbers = asakaiShifts(c)
  return asakaiCostCenters(shifts, scope, c).map((cc) => {
    const wcs = [...new Set(shifts.filter((r) => r.costCenter === cc && r.loadingMin + r.scheduledMin > 0).map((r) => r.workCenter))].sort()
    const machines = wcs.map((wc): DetailMachine => {
      const orders = input.orders.filter((o) => o.workCenter === wc && (costCenterOf.get(o.workCenter) ?? cc) === cc)
      const parts = [...new Set(orders.map((o) => o.material).filter(Boolean))]
      const partCells = numbers.map((n) => {
        const out: Record<string, PartCell> = {}
        for (const p of parts) {
          const hit = orders.filter((o) => o.material === p && shiftNumber(o.shift, c) === n)
          if (hit.length)
            out[p] = {
              good: hit.reduce((a, o) => a + o.good, 0),
              oee: oeeOf(sumTimes(hit)),
            }
        }
        return out
      })
      return {
        workCenter: wc,
        total: lossRow(wc, slice(0, wc), columns),
        shifts: numbers.map((n) => lossRow(String(n), slice(n, wc), columns)),
        parts,
        partCells,
      }
    })
    return { costCenter: cc, name: costCenterName(cc, c), machines }
  })
}
