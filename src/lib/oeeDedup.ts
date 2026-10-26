// OEE tekrar satır kuralı (planlamacı, 2026-10-26) — saf hesap; sunucu
// (convex/oee.ts) yüklemede ve "Check duplicates" düğmesinde bunu kullanır.
//
//   Duruş     aynı makine + aynı başlangıç (StartDate + StartTime) + aynı bitiş
//             (EndDate + EndTime) = aynı duruş: tek satır kalır, yeni yüklenen
//             eskisinin yerine geçer. Sipariş anahtara girmez.
//   Vardiya   aynı gün + aynı vardiya (Shift Group) + aynı makine: tek kayıt.

import type { DowntimeEvent } from './oee'

/**
 * Bir duruşun kimliği (makine, kaydın kendisinden gelir). Başlangıç ya da bitiş
 * saati olmayan satırın kimliği yoktur: hiçbir zaman ayıklanmaz.
 */
export function downtimeKey(e: DowntimeEvent): string | null {
  if (!e.startTime || !e.endTime) return null
  return `${e.startDate}|${e.startTime}|${e.endDate}|${e.endTime}`
}

const byStart = (a: DowntimeEvent, b: DowntimeEvent) => `${a.startDate} ${a.startTime}`.localeCompare(`${b.startDate} ${b.startTime}`)

/**
 * Eski ve yeni duruşlar: aynı kimlikteki yeni satır eskisinin yerine geçer,
 * kimliksiz satırlar olduğu gibi kalır. Sıra: başlangıç anı.
 */
export function mergeDowntimes(existing: DowntimeEvent[], incoming: DowntimeEvent[]): DowntimeEvent[] {
  const map = new Map<string, DowntimeEvent>()
  const loose: DowntimeEvent[] = []
  for (const e of [...existing, ...incoming]) {
    const k = downtimeKey(e)
    if (k === null) loose.push(e)
    else {
      map.delete(k) // son gelen sırasını da alır
      map.set(k, e)
    }
  }
  return [...map.values(), ...loose].sort(byStart)
}

/** Bu kimliklerdeki duruşlar çıkar (komşu günde aynı duruş yeni dosyada geldiyse). */
export function dropKeys(events: DowntimeEvent[], keys: Set<string>): DowntimeEvent[] {
  return events.filter((e) => {
    const k = downtimeKey(e)
    return k === null || !keys.has(k)
  })
}

export interface DedupFinding {
  date: string
  workCenter: string
  /** Yalnızca vardiya satırlarında. */
  shiftGroup?: string
  /** Silinen tekrar satır. */
  rows: number
  /** Silinen satırların süresi (duruş: Stoppage Duration(Min); vardiya: Loading Time). */
  minutes: number
}

export interface DowntimeDoc<Id = string> {
  id: Id
  date: string
  workCenter: string
  events: DowntimeEvent[]
}

export interface DowntimeDedupPlan<Id = string> {
  /** Yeni duruş listesiyle yazılacak kayıtlar (liste boşsa kayıt silinir). */
  rewrite: { id: Id; date: string; workCenter: string; events: DowntimeEvent[] }[]
  /** Aynı gün × makinenin fazla kaydı: bütünüyle silinir. */
  remove: Id[]
  findings: DedupFinding[]
}

const minutesOf = (list: DowntimeEvent[]) => list.reduce((a, e) => a + (Number(e.minutes) || 0), 0)

/**
 * Saklı duruş kayıtlarında tekrarları bulur.
 *
 * 1. Aynı gün × makinenin birden çok kaydı varsa listedeki ilki kalır (yükleme
 *    hep onu yeniler); diğerleri eski sürümdür, silinir.
 * 2. Aynı makinenin kayıtlarında aynı kimlikli duruş birden çok kez varsa tek
 *    kopya kalır: aynı kayıtta sonraki satır, iki günde ise sonraki günün kaydı.
 *
 * `focus` verilirse yalnızca o günlere dokunan tekrarlar sayılır (sayfa sayfa
 * taramada önceki gün ayrıca yüklenir ama orada bir kez sayılır).
 */
export function planDowntimeDedup<Id>(docs: DowntimeDoc<Id>[], focus: (date: string) => boolean = () => true): DowntimeDedupPlan<Id> {
  const findings = new Map<string, DedupFinding>()
  const note = (date: string, workCenter: string, removed: DowntimeEvent[]) => {
    if (!removed.length) return
    const k = `${date}|${workCenter}`
    const f = findings.get(k) ?? { date, workCenter, rows: 0, minutes: 0 }
    f.rows += removed.length
    f.minutes += minutesOf(removed)
    findings.set(k, f)
  }

  // 1. gün × makine başına tek kayıt.
  const firstOf = new Map<string, DowntimeDoc<Id>>()
  const remove: Id[] = []
  for (const d of docs) {
    const k = `${d.date}|${d.workCenter}`
    if (!firstOf.has(k)) firstOf.set(k, d)
    else if (focus(d.date)) {
      remove.push(d.id)
      note(d.date, d.workCenter, d.events)
    }
  }

  // 2. makine başına duruş kimliği: kazanan = sonraki gün, aynı günde sonraki satır.
  const live = [...firstOf.values()].sort((a, b) => a.date.localeCompare(b.date))
  const copies = new Map<string, { doc: number; ev: number; date: string }[]>()
  live.forEach((d, di) =>
    d.events.forEach((e, ei) => {
      const k = downtimeKey(e)
      if (k === null) return
      const id = `${d.workCenter}|${k}`
      const list = copies.get(id) ?? []
      list.push({ doc: di, ev: ei, date: d.date })
      copies.set(id, list)
    }),
  )
  const drop = new Set<string>()
  for (const list of copies.values()) {
    if (list.length < 2 || !list.some((c) => focus(c.date))) continue
    for (const c of list.slice(0, -1)) drop.add(`${c.doc}|${c.ev}`)
  }
  const rewrite: DowntimeDedupPlan<Id>['rewrite'] = []
  live.forEach((d, di) => {
    const removed = d.events.filter((_, ei) => drop.has(`${di}|${ei}`))
    if (!removed.length) return
    note(d.date, d.workCenter, removed)
    rewrite.push({ id: d.id, date: d.date, workCenter: d.workCenter, events: d.events.filter((_, ei) => !drop.has(`${di}|${ei}`)) })
  })
  const sorted = [...findings.values()].sort((a, b) => a.date.localeCompare(b.date) || a.workCenter.localeCompare(b.workCenter))
  return { rewrite, remove, findings: sorted }
}

export interface ShiftDoc<Id = string> {
  id: Id
  date: string
  workCenter: string
  shiftGroup: string
  loadingMin: number
}

/**
 * Vardiya satırları: aynı gün + vardiya + makine için listedeki ilki kalır
 * (yükleme hep onu günceller, yani en son yüklenen odur); diğerleri silinir.
 */
export function planShiftDedup<Id>(rows: ShiftDoc<Id>[]): { remove: Id[]; findings: DedupFinding[] } {
  const seen = new Set<string>()
  const remove: Id[] = []
  const findings = new Map<string, DedupFinding>()
  for (const r of rows) {
    const k = `${r.date}|${r.workCenter}|${r.shiftGroup}`
    if (!seen.has(k)) {
      seen.add(k)
      continue
    }
    remove.push(r.id)
    const f = findings.get(k) ?? { date: r.date, workCenter: r.workCenter, shiftGroup: r.shiftGroup, rows: 0, minutes: 0 }
    f.rows++
    f.minutes += Number(r.loadingMin) || 0
    findings.set(k, f)
  }
  return { remove, findings: [...findings.values()] }
}

/** Ekrandaki özet: kaç satır, kaç dakika, kaç gün × makine. */
export function summarizeFindings(list: DedupFinding[]): { rows: number; minutes: number; places: number } {
  return {
    rows: list.reduce((a, f) => a + f.rows, 0),
    minutes: Math.round(list.reduce((a, f) => a + f.minutes, 0) * 100) / 100,
    places: new Set(list.map((f) => `${f.date}|${f.workCenter}`)).size,
  }
}
