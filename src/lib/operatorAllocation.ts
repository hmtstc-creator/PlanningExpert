// Operatör planı: cost center bazında ikinci planlama modeli (APR, punta,
// somun kaynağı hatları). Ayrı bir motor değildir — plan motorunun ÖNÜNDE
// çalışan saf bir aşamadır: sahadaki adam sayısını hatlara dağıtır ve sonucu
// gün kaydı (pressDayShifts) biçiminde verir. Motor bunu takvimin bir parçası
// olarak okur; sıralama, setup ve geç iş kuralları değişmez.
//
// Kural (her üretim günü × vardiya, sırayla):
//   1. O cost center için o gün × vardiyaya adam sayısı girilmemişse dokunulmaz
//      (mevcut takvim geçerli).
//   2. Elle girilmiş gün kaydı (Production Plan → Work calendar) her zaman
//      önce gelir: o hattın o günü değişmez; o vardiyada çalışıyorsa ekibi
//      adam sayısından önce düşülür.
//   3. Kalan hatlar, o ana kadar kalan bakiyesi olanlar arasından, en erken
//      vadeye (eşitlikte kalan dakika büyük olan önce) göre sıralanır ve
//      ekibi (crewSize, yok = 1) sığdıkça açılır.
//   4. Bakiyesi bitmiş ya da yalnız sonraki haftaların işi kalmış hat operatör
//      almaz (bakiye = vadesi o günün haftasının Pazar'ına kadar olan iş).
//   5. Açılan (ve takvimden çalışan) her vardiyanın net dakikası hattın
//      bakiyesinden, en erken vadeli işten başlayarak düşülür.

import { weekdayIndex, type DayShifts } from './pressCalendar'

export type PlanningModel = 'shift' | 'operator'

export interface OperatorLine {
  press: string
  /** Hattın bir vardiyada çalışması için gereken adam (yok = 1). */
  crewSize?: number
}

export interface OperatorCostCenter {
  code: string
  lines: OperatorLine[]
}

export interface OperatorHeadcountRow {
  costCenter: string
  /** Üretim günü (ISO). */
  date: string
  /** Vardiya numarası (1'den). */
  shift: number
  operators: number
}

/** Hattın bir iş kalemi: net talep adet × dakika/adet, vadesi. */
export interface LineWorkItem {
  press: string
  minutes: number
  dueDate: string
}

export interface OperatorAllocationInput {
  costCenters: OperatorCostCenter[]
  headcount: OperatorHeadcountRow[]
  workload: LineWorkItem[]
  /** Dağıtılacak üretim günleri (sıralı; geçmiş günler verilmez). */
  dates: string[]
  /** Takvimin (elle kayıt dahil) o pres × günde çalıştırdığı vardiyalar. */
  calendarShifts: (press: string, date: string) => number[]
  /** Elle girilmiş gün kayıtları: bunlara hiç dokunulmaz. */
  manualDayShifts: DayShifts[]
  /** Bir vardiyanın net kapasite dakikası (planlı duruşlar düşülmüş). */
  shiftNetMinutes: (shift: number) => number
  /** Dağıtım yapılmayan gün (ör. tatil): takvim geçerli kalır. */
  skipDate?: (date: string) => boolean
}

export interface OperatorAllocation {
  /** Motorun okuyacağı gün kayıtları (yalnız takvimden farklı olanlar). */
  dayShifts: DayShifts[]
  /** Gün × vardiya başına kararın özeti (ekran ve test için). */
  decisions: { costCenter: string; date: string; shift: number; operators: number; open: string[]; idle: number }[]
}

const crewOf = (l: OperatorLine) => Math.max(1, Math.round(l.crewSize ?? 1))

/** O günün haftasının Pazar'ı (ISO): bu tarihe kadar vadeli iş "bu haftanın" bakiyesidir. */
export function weekEndOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + (6 - weekdayIndex(iso)))
  return d.toISOString().slice(0, 10)
}

export function allocateOperators(input: OperatorAllocationInput): OperatorAllocation {
  const manual = new Set(input.manualDayShifts.map((d) => `${d.press}|${d.date}`))
  const headBy = new Map<string, number>()
  for (const h of input.headcount) headBy.set(`${h.costCenter}|${h.date}|${h.shift}`, Math.max(0, h.operators))

  // Hat → kalan iş kalemleri (vadeye göre sıralı, kalan dakika değişir).
  const items = new Map<string, { minutes: number; dueDate: string }[]>()
  for (const w of input.workload) {
    if (!(w.minutes > 0)) continue
    const list = items.get(w.press) ?? []
    list.push({ minutes: w.minutes, dueDate: w.dueDate })
    items.set(w.press, list)
  }
  for (const list of items.values()) list.sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  /** Hattın bu haftaya kadar kalan bakiyesi: en erken vade ve toplam dakika. */
  const balanceOf = (press: string, weekEnd: string) => {
    let minutes = 0
    let due = ''
    for (const it of items.get(press) ?? []) {
      if (it.dueDate > weekEnd) break
      if (it.minutes <= 0) continue
      if (!due) due = it.dueDate
      minutes += it.minutes
    }
    return { minutes, due }
  }
  const consume = (press: string, minutes: number) => {
    let left = minutes
    for (const it of items.get(press) ?? []) {
      if (left <= 0) break
      const take = Math.min(it.minutes, left)
      it.minutes -= take
      left -= take
    }
  }

  const dayShifts: DayShifts[] = []
  const decisions: OperatorAllocation['decisions'] = []
  for (const date of input.dates) {
    if (input.skipDate?.(date)) continue
    const weekEnd = weekEndOf(date)
    for (const cc of input.costCenters) {
      const calendar = new Map(cc.lines.map((l) => [l.press, new Set(input.calendarShifts(l.press, date))]))
      const counted = new Set<number>()
      for (const h of input.headcount) if (h.costCenter === cc.code && h.date === date) counted.add(h.shift)
      // Bu cost center'a bu gün hiç adam sayısı girilmediyse takvim aynen kalır
      // (yine de çalışan vardiyalar bakiyeyi düşer).
      const shiftNumbers = new Set<number>(counted)
      for (const set of calendar.values()) for (const n of set) shiftNumbers.add(n)
      const result = new Map(cc.lines.map((l) => [l.press, new Set<number>()]))
      for (const shift of Array.from(shiftNumbers).sort((a, b) => a - b)) {
        const net = input.shiftNetMinutes(shift)
        if (!counted.has(shift)) {
          // Adam sayısı yok: takvim geçerli.
          for (const l of cc.lines) {
            if (!calendar.get(l.press)!.has(shift)) continue
            result.get(l.press)!.add(shift)
            consume(l.press, net)
          }
          continue
        }
        let left = headBy.get(`${cc.code}|${date}|${shift}`) ?? 0
        const open: string[] = []
        // Elle kayıtlı hat önce gelir: çalışıyorsa ekibi düşülür.
        const free: OperatorLine[] = []
        for (const l of cc.lines) {
          if (!manual.has(`${l.press}|${date}`)) {
            free.push(l)
            continue
          }
          if (!calendar.get(l.press)!.has(shift)) continue
          result.get(l.press)!.add(shift)
          left -= crewOf(l)
          open.push(l.press)
          consume(l.press, net)
        }
        const ranked = free
          .map((l) => ({ l, ...balanceOf(l.press, weekEnd) }))
          .filter((x) => x.minutes > 0)
          .sort((a, b) => a.due.localeCompare(b.due) || b.minutes - a.minutes || a.l.press.localeCompare(b.l.press))
        for (const x of ranked) {
          const crew = crewOf(x.l)
          if (crew > left) continue
          left -= crew
          result.get(x.l.press)!.add(shift)
          open.push(x.l.press)
          consume(x.l.press, net)
        }
        decisions.push({ costCenter: cc.code, date, shift, operators: headBy.get(`${cc.code}|${date}|${shift}`) ?? 0, open, idle: Math.max(0, left) })
      }
      if (counted.size === 0) continue
      for (const l of cc.lines) {
        if (manual.has(`${l.press}|${date}`)) continue
        const shifts = Array.from(result.get(l.press)!).sort((a, b) => a - b)
        const before = Array.from(calendar.get(l.press)!).sort((a, b) => a - b)
        if (shifts.join(',') !== before.join(',')) dayShifts.push({ press: l.press, date, shifts })
      }
    }
  }
  return { dayShifts, decisions }
}

/**
 * Planning Logic sayfasındaki ve testteki örnek (aynı sayılar): 3 operatör,
 * ekibi 1 kişilik 5 hat; L5'in bakiyesi yok. En acil üç hat (L1, L2, L3)
 * açılır; L4 adam kalmadığı için, L5 bakiyesiz olduğu için kapalı kalır.
 */
export const OPERATOR_EXAMPLE: OperatorAllocationInput = {
  costCenters: [
    { code: 'CC-WELD', lines: ['L1', 'L2', 'L3', 'L4', 'L5'].map((press) => ({ press, crewSize: 1 })) },
  ],
  headcount: [{ costCenter: 'CC-WELD', date: '2026-11-02', shift: 1, operators: 3 }],
  workload: [
    { press: 'L1', minutes: 300, dueDate: '2026-11-03' },
    { press: 'L2', minutes: 600, dueDate: '2026-11-04' },
    { press: 'L3', minutes: 900, dueDate: '2026-11-04' },
    { press: 'L4', minutes: 200, dueDate: '2026-11-06' },
  ],
  dates: ['2026-11-02'],
  calendarShifts: () => [1],
  manualDayShifts: [],
  shiftNetMinutes: () => 450,
}
