// OEE verisinin sunucudaki biçimi ile hesap tipleri arasındaki çeviri ve
// yükleme sırası. Duruşlar gün × iş merkezi kaydında dizi olarak durur
// (convex/oeeValidators.ts).

import {
  dateRange,
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

/**
 * Kayıp özeti sunucuda diziyle durur: alan adında serbest metin olmaz.
 * `codes`: [rc1, rc2, dakika, adet]; `reasonList`: [rc1, rc2, metin, dakika, adet].
 * Eski biçimdeki (groups/reasons) kayıtlar okunmaz; o günler yeniden
 * yüklenince yeni biçimle yazılır.
 */
export interface StoredLossDay {
  date: string
  costCenter: string
  workCenter: string
  codes?: Cell[][]
  reasonList?: Cell[][]
}

export function toStoredLoss(l: LossDay): StoredLossDay {
  return {
    date: l.date,
    costCenter: l.costCenter,
    workCenter: l.workCenter,
    codes: Object.entries(l.codes).map(([k, [m, c]]) => {
      const [rc1, rc2] = k.split('|')
      return [rc1, rc2, m, c]
    }),
    reasonList: Object.entries(l.reasons).map(([k, [m, c]]) => {
      const [rc1, rc2, ...text] = k.split('|')
      return [rc1, rc2, text.join('|'), m, c]
    }),
  }
}

export function fromStoredLoss(l: StoredLossDay): LossDay | null {
  if (!l.codes) return null
  const codes: Record<string, [number, number]> = {}
  for (const [rc1, rc2, m, c] of l.codes) codes[`${s(rc1)}|${s(rc2)}`] = [n(m), n(c)]
  const reasons: Record<string, [number, number]> = {}
  for (const [rc1, rc2, text, m, c] of l.reasonList ?? []) reasons[`${s(rc1)}|${s(rc2)}|${s(text)}`] = [n(m), n(c)]
  return { date: l.date, costCenter: l.costCenter, workCenter: l.workCenter, codes, reasons }
}

/** Okunabilen (yeni biçimdeki) kayıp özetleri. */
export const fromStoredLosses = (list: StoredLossDay[]): LossDay[] => list.map(fromStoredLoss).filter((x): x is LossDay => x !== null)

/** Bir duruşun kimliği: aynı iş merkezinde aynı başlangıç anı ve sipariş aynı duruştur. */
export const eventKey = (e: DowntimeEvent) => `${e.startDate}|${e.startTime}|${e.order}`

/**
 * Aynı gün × iş merkezinin eski ve yeni duruşları: yeni dosyadaki satır aynı
 * duruşsa (eventKey) eskisinin yerine geçer (ör. nedeni sonradan
 * düzeltilmiş), değilse eklenir. Eski satır silinmez. Sıra: başlangıç anı.
 */
export function mergeEvents(existing: DowntimeEvent[], incoming: DowntimeEvent[]): DowntimeEvent[] {
  const map = new Map(existing.map((e) => [eventKey(e), e]))
  for (const e of incoming) map.set(eventKey(e), e)
  return [...map.values()].sort((a, b) => `${a.startDate} ${a.startTime}`.localeCompare(`${b.startDate} ${b.startTime}`))
}

// ---- yükleme -------------------------------------------------------------------

/**
 * Yükleme API'si — hepsi "ekle ya da güncelle": hiçbir çağrı geçmişi silmez.
 * Aynı satır (anahtar) tekrar gelirse güncellenir, yeni satır eklenir.
 */
export interface OeeApi {
  upsertShifts: (args: { rows: unknown[] }) => Promise<unknown>
  upsertDaily: (args: { rows: unknown[] }) => Promise<unknown>
  upsertOrders: (args: { rows: unknown[] }) => Promise<unknown>
  upsertWeekly: (args: { rows: unknown[] }) => Promise<unknown>
  upsertMonthly: (args: { rows: unknown[] }) => Promise<unknown>
  upsertDowntimeDays: (args: { days: unknown[] }) => Promise<unknown>
  finishImport: (args: { fileName: string; sheets: Cell[][]; ranges: string[][] }) => Promise<unknown>
}

/** Bir çağrıda gönderilen en çok veri (bayt) — işlem sınırının altında. */
const CHUNK_BYTES = 600_000

/** Diziyi JSON boyutuna göre parçalar. */
export function chunkBySize<T>(items: T[], maxBytes = CHUNK_BYTES, maxItems = 200): T[][] {
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

/**
 * Yükleme: dosyadaki her sayfa kendi anahtarıyla eklenir ya da güncellenir.
 * Geçmiş hiçbir zaman silinmez; son iki haftayı tekrar tekrar yüklemek
 * mükerrer kayıt yapmaz. İlerleme `onStep` ile bildirilir.
 */
export async function importOee(
  parsed: ParsedOee,
  fileName: string,
  api: OeeApi,
  onStep: (text: string) => void = () => {},
): Promise<{ ranges: string[][] }> {
  const ranges: string[][] = []
  const range = (label: string, dates: string[]) => {
    const r = dateRange(dates)
    if (r) ranges.push([label, r.from, r.to])
    return r
  }

  if (range('shifts', parsed.shifts.map((r) => r.date))) {
    onStep(`Shiftly KPI: ${parsed.shifts.length} rows`)
    for (const rows of chunkBySize(parsed.shifts)) await api.upsertShifts({ rows })
  }
  if (range('daily', parsed.daily.map((r) => r.date))) {
    onStep(`Daily KPI: ${parsed.daily.length} rows`)
    for (const rows of chunkBySize(parsed.daily)) await api.upsertDaily({ rows })
  }
  if (range('orders', parsed.orders.map((r) => r.date))) {
    onStep(`Order Based KPI: ${parsed.orders.length} rows`)
    for (const rows of chunkBySize(parsed.orders)) await api.upsertOrders({ rows })
  }
  if (range('downtimes', parsed.downtimes.map((d) => d.date))) {
    const total = parsed.downtimes.reduce((a, d) => a + d.events.length, 0)
    onStep(`Downtimes: ${total} rows`)
    for (const days of chunkBySize(parsed.downtimes.map(toStoredDay), 400_000, 15)) await api.upsertDowntimeDays({ days })
  }
  if (parsed.weekly.length) {
    onStep(`Weekly KPI: ${parsed.weekly.length} rows`)
    for (const rows of chunkBySize(parsed.weekly)) await api.upsertWeekly({ rows })
    const keys = parsed.weekly.map((w) => `${w.year}-W${String(w.week).padStart(2, '0')}`).sort()
    ranges.push(['weekly', keys[0], keys[keys.length - 1]])
  }
  if (parsed.monthly.length) {
    onStep(`Monthly KPI: ${parsed.monthly.length} rows`)
    for (const rows of chunkBySize(parsed.monthly)) await api.upsertMonthly({ rows })
    const keys = parsed.monthly.map((m) => `${m.year}-${m.monthKey}`).sort()
    ranges.push(['monthly', keys[0], keys[keys.length - 1]])
  }

  await api.finishImport({
    fileName,
    sheets: parsed.read.map((r) => [r.sheet, r.kind, r.rows]),
    ranges,
  })
  return { ranges }
}

/** Sistemin eklediği alanlar: karşılaştırmada sayılmaz. */
const SYSTEM_FIELDS = new Set(['_id', '_creationTime', 'plantId'])

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => sameValue(x, b[i]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
    const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
    if (ka.length !== kb.length) return false
    return ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  }
  return false
}

/**
 * Saklı kayıt yeni satırla aynı mı (sistem alanları hariç)? Aynıysa yeniden
 * yazılmaz: aynı dosyayı tekrar yüklemek Convex'in yazma kotasını boşa
 * harcamasın (planlamacı, 2026-10-07).
 */
export function sameStored(existing: Record<string, unknown>, doc: Record<string, unknown>): boolean {
  const own = Object.fromEntries(Object.entries(existing).filter(([k]) => !SYSTEM_FIELDS.has(k)))
  return sameValue(own, doc)
}

