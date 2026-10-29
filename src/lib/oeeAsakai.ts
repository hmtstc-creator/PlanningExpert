/**
 * Asakai sayfaları (planlamacı, 2026-10-26): Excel "Metal Stamping Daily
 * Follow Up" (haftalık) ve vardiya × makine ayrıntısının birebir kopyası.
 * Hesap yeni değil: OEE toplam süreden (oeeOf), kayıplar Losses Trend'inki
 * (lossBreakdown, % of Loading), vardiya kesiti Loss Bridge'inki (shiftSlice).
 * Grup = seçili alandaki masraf yeri (Excel'de PROGRESSIVE / TRANSFER).
 */
import {
  PLANT_AREA,
  SHORT_STOPS,
  SPEED,
  UNASSIGNED,
  addDaysIso,
  chartGroups,
  chartShare,
  costCenterName,
  inScope,
  isoWeek,
  lossBreakdown,
  lossForPeriod,
  monthKeyOf,
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
/** Ayrıntı sayfasında her iş yerinin gününde en büyük bu kadar duruş kırmızı (planlamacı, 2026-10-28). */
export const ASAKAI_TOP = 2
/** Asakai'de sütunu olmayan kayıp grupları (planlamacı, 2026-10-26: UTS planlı mola, çay / yemek). */
export const ASAKAI_DROP = ['UTS']

/** İş yeri → masraf yeri (verideki ya da tanımdaki satır). */
type WcRow = { workCenter: string; costCenter: string }

/**
 * Bugün — sistemin çalışma günü — Asakai sayfalarında gizlidir (kullanıcı,
 * 2026-10-29): gün bitmediği için o gün yüklenen yarım veri OEE'yi ve kayıp
 * paylarını yanlış gösterir. Sayfa en son dünü gösterir.
 */
export const asakaiDay = (date: string, today: string): string => (date < today ? date : addDaysIso(today, -1))

/** Bugün ve sonrası gizli: gün, kayıp, duruş, vardiya ve sipariş satırları süzülür. */
export const asakaiBefore = <T extends { date: string }>(rows: T[], today: string): T[] => rows.filter((r) => r.date < today)

/**
 * Bugünü kapsayan (ve sonraki) yüklenmiş hafta satırı kullanılmaz: o haftanın
 * OEE'si günlerin toplamından gelir, böylece bugün hesaba girmez.
 */
export function asakaiWeeks(rows: WeeklyRow[], today: string): WeeklyRow[] {
  const { year, week } = isoWeek(today)
  return rows.filter((w) => w.year < year || (w.year === year && w.week < week))
}

/** Bugünün ayını (ve sonrasını) kapsayan yüklenmiş ay satırı kullanılmaz. */
export function asakaiMonths(rows: MonthlyRow[], today: string): MonthlyRow[] {
  return rows.filter((m) => monthKeyOf(m.year, m.monthKey) < today.slice(0, 7))
}

/** Work Center Definitions (Makineler) → iş yeri / masraf yeri satırları. */
export function definedWorkCenters(presses: { name: string; costCenter?: string }[]): WcRow[] {
  return presses.filter((p) => p.costCenter).map((p) => ({ workCenter: p.name, costCenter: p.costCenter as string }))
}

/**
 * Masraf yerinin iş yerleri: Work Center Definitions'ta o masraf yerine bağlı
 * bütün iş yerleri ile verideki iş yerleri birlikte (kullanıcı, 2026-10-29:
 * "bir departman seçtiğimde altındaki bütün iş yerleri gelmeli"). Seçili
 * günde / haftada verisi olmayan makine de satır olur: değerleri boş görünür.
 */
export function asakaiWorkCenters(cc: string, rows: WcRow[], defined: WcRow[]): string[] {
  const out = new Set(defined.filter((d) => d.costCenter === cc).map((d) => d.workCenter))
  for (const r of rows) if (r.costCenter === cc) out.add(r.workCenter)
  return [...out].sort()
}

/**
 * Asakai tablolarının kayıp sütunları: grafik sütunları (chartGroups sırası: ayardaki
 * gruplar, Speed, en sonda Unassigned), "grafikte gizli" olanlar dahil. Tanımsızlar
 * (RC1 / RC2 "#") Unassigned sütunundadır (2026-10-26; ayardaki "#" grubu kullanılmaz).
 * Bütün grupları ASAKAI_DROP'ta olan sütun yok. Kısa duruşlar (< eşik) sütun
 * değil, SPEED_LOSS'un içinde (planlamacı, 2026-10-26; Loss Bridge'deki gibi, #81).
 * `lossDays` kısa duruşları ayrılmış özet olmalı: kısalar kendi kodunda sayılmaz.
 */
export function asakaiColumns(c: OeeConfig, lossDays: LossDay[]): string[] {
  return chartGroups(c, lossDays).filter((col) => {
    if (col === SHORT_STOPS) return false
    const groups = c.lossGroups.filter((g) => g.chart === col)
    return !groups.length || groups.some((g) => !ASAKAI_DROP.includes(g.code))
  })
}

/** Unassigned (tanımsız duruş ya da ayarda olmayan kod) yalnız sayfada süresi varsa sütun olur. */
export function dropEmptyUnassigned(columns: string[], rows: LossRow[]): string[] {
  return columns.filter((col) => col !== UNASSIGNED || rows.some((r) => (r.shares[col] ?? 0) > 0))
}

/**
 * Kırmızı hücreler: satırın en büyük `ASAKAI_TOP` duruş sütunu (süresi olanlar).
 * Speed duruş değil, Unassigned öncelik değil (planlamacı, 2026-10-28): sayılmaz.
 */
export function asakaiTopStops(row: LossRow, columns: string[], n = ASAKAI_TOP): Set<string> {
  if (!(row.loadingMin > 0)) return new Set()
  const stops = columns.filter((col) => col !== SPEED && col !== UNASSIGNED && col !== SHORT_STOPS && (row.shares[col] ?? 0) > 0)
  return new Set(stops.sort((a, b) => row.shares[b] - row.shares[a]).slice(0, n))
}

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

/** Kapsamdaki masraf yerleri (veride ya da tanımda olan), adına göre (Excel: Progressive, Transfer). */
export function asakaiCostCenters(rows: WcRow[], scope: Scope, c: OeeConfig, defined: WcRow[] = []): string[] {
  const ccs = [...new Set([...rows, ...defined].filter((r) => r.costCenter && inScope(r, scope, c)).map((r) => r.costCenter))]
  return ccs.sort((a, b) => costCenterName(a, c).localeCompare(costCenterName(b, c)))
}

/** Satırın payları; hız kaybı = MES'in Production − Operation farkı (kısa duruşlar dahil). */
function lossRow(label: string, b: ReturnType<typeof lossBreakdown>, columns: string[]): LossRow {
  const share = (col: string) => (col === SPEED ? chartShare(b, SPEED) + chartShare(b, SHORT_STOPS) : chartShare(b, col))
  return {
    label,
    loadingMin: b.loadingMin,
    oee: b.oee,
    shares: Object.fromEntries(columns.map((col) => [col, share(col)])),
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
    /** Work Center Definitions: masraf yerinin bütün iş yerleri (verisi olmasa da satır olur). */
    defined?: WcRow[]
  },
  scope: Scope,
  c: OeeConfig,
  date: string,
  monday: string,
  columns: string[],
): WeeklyGroup[] {
  const sunday = addDaysIso(monday, 6)
  const dates = ASAKAI_DAYS.map((_, i) => addDaysIso(monday, i))
  const defined = (input.defined ?? []).filter((r) => r.costCenter && inScope(r, scope, c))
  return asakaiCostCenters(input.days, scope, c, defined).map((cc) => {
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
    const machines = asakaiWorkCenters(cc, inWeek.filter((d) => d.loadingMin > 0), defined)
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
  input: {
    shifts: ShiftRow[]
    events: DowntimeDay[]
    orders: OrderRow[]
    /** Work Center Definitions: masraf yerinin bütün iş yerleri (o gün verisi olmasa da satır olur). */
    defined?: WcRow[]
  },
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
  const defined = (input.defined ?? []).filter((r) => r.costCenter && inScope(r, scope, c))
  return asakaiCostCenters(shifts, scope, c, defined).map((cc) => {
    const wcs = asakaiWorkCenters(
      cc,
      shifts.filter((r) => r.loadingMin + r.scheduledMin > 0),
      defined,
    )
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
