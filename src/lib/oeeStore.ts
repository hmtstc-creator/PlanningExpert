// OEE verisinin sunucudaki biçimi ile hesap tipleri arasındaki çeviri ve
// yükleme sırası. Duruşlar gün × iş merkezi kaydında dizi olarak durur
// (convex/oeeValidators.ts).

import {
  dateRange,
  lossDayOf,
  type DowntimeDay,
  type DowntimeEvent,
  type LossDay,
  type ParsedOee,
} from './oee'

type Cell = string | number

export function eventToTuple(e: DowntimeEvent): Cell[] {
  return [
    e.order,
    e.material,
    e.mold,
    e.shiftGroup,
    e.shiftDefinition,
    e.rc1,
    e.rc2,
    e.rc3,
    e.rc4,
    e.rc5,
    e.textEn,
    e.textTr,
    e.seconds,
    e.minutes,
    e.startDate,
    e.startTime,
    e.endDate,
    e.endTime,
  ]
}

const s = (c: Cell | undefined) => (c === undefined ? '' : String(c))
const n = (c: Cell | undefined) => (typeof c === 'number' ? c : Number(c) || 0)

export function tupleToEvent(t: Cell[]): DowntimeEvent {
  return {
    order: s(t[0]),
    material: s(t[1]),
    mold: s(t[2]),
    shiftGroup: s(t[3]),
    shiftDefinition: s(t[4]),
    rc1: s(t[5]),
    rc2: s(t[6]),
    rc3: s(t[7]),
    rc4: s(t[8]),
    rc5: s(t[9]),
    textEn: s(t[10]),
    textTr: s(t[11]),
    seconds: n(t[12]),
    minutes: n(t[13]),
    startDate: s(t[14]),
    startTime: s(t[15]),
    endDate: s(t[16]),
    endTime: s(t[17]),
  }
}

export interface StoredDowntimeDay {
  date: string
  plant: string
  plantKey: string
  costCenter: string
  workCenter: string
  events: Cell[][]
}

export const toStoredDay = (d: DowntimeDay): StoredDowntimeDay => ({ ...d, events: d.events.map(eventToTuple) })
export const fromStoredDay = (d: StoredDowntimeDay): DowntimeDay => ({ ...d, events: d.events.map(tupleToEvent) })

export interface StoredLossDay {
  date: string
  costCenter: string
  workCenter: string
  groups: Cell[][]
  reasons: Cell[][]
}

export function toStoredLoss(l: LossDay): StoredLossDay {
  return {
    date: l.date,
    costCenter: l.costCenter,
    workCenter: l.workCenter,
    groups: Object.keys(l.minutes).map((g) => [g, l.minutes[g], l.counts[g] ?? 0]),
    reasons: Object.entries(l.reasons).map(([text, [min, count, group]]) => [text, min, count, group]),
  }
}

export function fromStoredLoss(l: StoredLossDay): LossDay {
  const minutes: Record<string, number> = {}
  const counts: Record<string, number> = {}
  for (const [g, m, c] of l.groups) {
    minutes[s(g)] = n(m)
    counts[s(g)] = n(c)
  }
  const reasons: Record<string, [number, number, string]> = {}
  for (const [text, m, c, g] of l.reasons) reasons[s(text)] = [n(m), n(c), s(g)]
  return { date: l.date, costCenter: l.costCenter, workCenter: l.workCenter, minutes, counts, reasons }
}

// ---- yükleme -------------------------------------------------------------------

export interface OeeApi {
  clearRange: (args: {
    kind: 'shifts' | 'orders' | 'downtimes' | 'losses' | 'weekly' | 'monthly'
    from?: string
    to?: string
    weeks?: { year: number; week: number }[]
  }) => Promise<{ deleted: number; more: boolean }>
  insertShifts: (args: { rows: unknown[] }) => Promise<number>
  insertOrders: (args: { rows: unknown[] }) => Promise<number>
  insertWeekly: (args: { rows: unknown[] }) => Promise<number>
  insertMonthly: (args: { rows: unknown[] }) => Promise<number>
  insertDowntimeDays: (args: { days: unknown[] }) => Promise<number>
  insertLossDays: (args: { days: unknown[] }) => Promise<number>
  finishImport: (args: { fileName: string; sheets: Cell[][]; ranges: string[][] }) => Promise<null>
}

/** Bir çağrıda gönderilen en çok veri (bayt) — işlem sınırının altında. */
const CHUNK_BYTES = 600_000

/** Diziyi JSON boyutuna göre parçalar. */
export function chunkBySize<T>(items: T[], maxBytes = CHUNK_BYTES, maxItems = 400): T[][] {
  const out: T[][] = []
  let cur: T[] = []
  let size = 0
  for (const it of items) {
    const len = JSON.stringify(it).length
    if (cur.length && (size + len > maxBytes || cur.length >= maxItems)) {
      out.push(cur)
      cur = []
      size = 0
    }
    cur.push(it)
    size += len
  }
  if (cur.length) out.push(cur)
  return out
}

async function clearAll(api: OeeApi, args: Parameters<OeeApi['clearRange']>[0]) {
  for (let i = 0; i < 10_000; i++) {
    const { more } = await api.clearRange(args)
    if (!more) return
  }
}

/**
 * Yükleme sırası: her tür için önce dosyanın kapsadığı aralık silinir, sonra
 * yenisi yazılır. Daha eski tarihler kalır (geçmiş birikir). Aylık komple
 * yenilenir. İlerleme `onStep` ile bildirilir.
 */
export async function importOee(
  parsed: ParsedOee,
  fileName: string,
  api: OeeApi,
  onStep: (text: string) => void = () => {},
): Promise<{ ranges: string[][] }> {
  const ranges: string[][] = []

  const shiftRange = dateRange(parsed.shifts.map((r) => r.date))
  if (shiftRange) {
    onStep(`Shiftly KPI: ${shiftRange.from} – ${shiftRange.to}`)
    await clearAll(api, { kind: 'shifts', ...shiftRange })
    for (const rows of chunkBySize(parsed.shifts)) await api.insertShifts({ rows })
    ranges.push(['shifts', shiftRange.from, shiftRange.to])
  }

  const orderRange = dateRange(parsed.orders.map((r) => r.date))
  if (orderRange) {
    onStep(`Order Based KPI: ${orderRange.from} – ${orderRange.to}`)
    await clearAll(api, { kind: 'orders', ...orderRange })
    for (const rows of chunkBySize(parsed.orders)) await api.insertOrders({ rows })
    ranges.push(['orders', orderRange.from, orderRange.to])
  }

  const downRange = dateRange(parsed.downtimes.map((d) => d.date))
  if (downRange) {
    onStep(`Downtimes: ${downRange.from} – ${downRange.to}`)
    await clearAll(api, { kind: 'downtimes', ...downRange })
    await clearAll(api, { kind: 'losses', ...downRange })
    for (const days of chunkBySize(parsed.downtimes.map(toStoredDay), CHUNK_BYTES, 60)) await api.insertDowntimeDays({ days })
    for (const days of chunkBySize(parsed.downtimes.map((d) => toStoredLoss(lossDayOf(d))))) await api.insertLossDays({ days })
    ranges.push(['downtimes', downRange.from, downRange.to])
  }

  if (parsed.weekly.length) {
    const weeks = [...new Map(parsed.weekly.map((w) => [`${w.year}-${w.week}`, { year: w.year, week: w.week }])).values()]
    onStep(`Weekly KPI: ${weeks.length} week(s)`)
    for (const part of chunkBySize(weeks, CHUNK_BYTES, 20)) await clearAll(api, { kind: 'weekly', weeks: part })
    for (const rows of chunkBySize(parsed.weekly)) await api.insertWeekly({ rows })
    const keys = weeks.map((w) => `${w.year}-W${String(w.week).padStart(2, '0')}`).sort()
    ranges.push(['weekly', keys[0], keys[keys.length - 1]])
  }

  if (parsed.monthly.length) {
    onStep('Monthly KPI')
    await clearAll(api, { kind: 'monthly' })
    for (const rows of chunkBySize(parsed.monthly)) await api.insertMonthly({ rows })
    const keys = [...new Set(parsed.monthly.map((m) => m.monthKey))].sort()
    ranges.push(['monthly', keys[0], keys[keys.length - 1]])
  }

  await api.finishImport({
    fileName,
    sheets: parsed.read.map((r) => [r.sheet, r.kind, r.rows]),
    ranges,
  })
  return { ranges }
}
