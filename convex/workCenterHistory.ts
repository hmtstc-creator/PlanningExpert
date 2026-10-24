import { v } from 'convex/values'

import { internal } from './_generated/api'
import { plantInternalMutation } from './guarded'
import { nextAliases, renameTopicKey, resolveCode } from '../src/lib/workCenterAlias'

/**
 * Work center kodu değişince OEE geçmişi de yeni koda taşınır (K5, 2026-10-24).
 *
 * Geçmiş büyük olabilir: taşıma arka planda, tablo tablo ve sayfa sayfa çalışır
 * (her adım kendini yeniden zamanlar). Aynı anahtarda yeni kodla bir satır
 * zaten varsa (ör. yeni kodla yüklenmiş dosya) eski satır silinir: yeni kodlu
 * satır daha yenidir ve aynı gün iki kez sayılmaz. Eşleme tablosu yüklemede
 * eski kodu yeni koda çevirir (`mapAliases`). Plan bu veriyi okumaz.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** Taşınan tablolar: sayfalama indeksi ve aynı satırın (yeni kodla) anahtarı. */
const TABLES: { table: string; index: string; size: number; same: (db: Any, r: Any, wc: string) => Promise<Any | null> }[] = [
  { table: 'oeeShifts', index: 'by_date', size: 300, same: (db, r, wc) => keyed(db, 'oeeShifts', (q) => q.eq('date', r.date).eq('workCenter', wc).eq('shiftGroup', r.shiftGroup)) },
  { table: 'oeeDays', index: 'by_date', size: 300, same: (db, r, wc) => keyed(db, 'oeeDays', (q) => q.eq('date', r.date).eq('workCenter', wc)) },
  {
    table: 'oeeOrders',
    index: 'by_date',
    size: 300,
    same: (db, r, wc) => keyed(db, 'oeeOrders', (q) => q.eq('date', r.date).eq('workCenter', wc).eq('shift', r.shift).eq('order', r.order).eq('equipment', r.equipment)),
  },
  { table: 'oeeWeekly', index: 'by_week', size: 300, same: (db, r, wc) => keyed(db, 'oeeWeekly', (q) => q.eq('year', r.year).eq('week', r.week).eq('workCenter', wc)) },
  {
    table: 'oeeMonthly',
    index: 'by_plant',
    size: 300,
    same: async (db, r, wc) => {
      const rows: Any[] = await db.query('oeeMonthly').withIndex('by_key', (q: Any) => q.eq('workCenter', wc).eq('monthKey', r.monthKey)).collect()
      return rows.find((m) => m.year === r.year) ?? null
    },
  },
  // Duruş kayıtları büyük: küçük sayfa.
  { table: 'oeeDowntimeDays', index: 'by_date', size: 40, same: (db, r, wc) => keyed(db, 'oeeDowntimeDays', (q) => q.eq('date', r.date).eq('workCenter', wc)) },
  { table: 'oeeLossDays', index: 'by_date', size: 200, same: (db, r, wc) => keyed(db, 'oeeLossDays', (q) => q.eq('date', r.date).eq('workCenter', wc)) },
  { table: 'oeeStopDays', index: 'by_date', size: 200, same: (db, r, wc) => keyed(db, 'oeeStopDays', (q) => q.eq('date', r.date).eq('workCenter', wc)) },
]

function keyed(db: Any, table: string, range: (q: Any) => Any): Promise<Any | null> {
  return db.query(table).withIndex('by_key', range).first()
}

/** Kod değişikliğini eşlemeye yazar (convex/presses.ts → rename). */
export async function recordAlias(db: Any, from: string, to: string) {
  const existing: Any[] = await db.query('workCenterAliases').withIndex('by_plant').collect()
  const next = nextAliases(existing, from, to)
  const same = (a: Any, b: Any) => a.from === b.from && a.to === b.to
  for (const a of existing) if (!next.some((n) => same(n, a))) await db.delete(a._id)
  for (const n of next) if (!existing.some((e) => same(e, n))) await db.insert('workCenterAliases', { ...n, createdAt: Date.now() })
}

async function aliasMap(db: Any): Promise<Map<string, string>> {
  const list: Any[] = await db.query('workCenterAliases').withIndex('by_plant').collect()
  return new Map(list.map((a) => [a.from, a.to]))
}

/** Yüklenen satırlardaki eski kodları yeni koda çevirir (OEE yüklemesi). */
export async function mapAliases<T extends { workCenter: string }>(db: Any, rows: T[]): Promise<T[]> {
  const map = await aliasMap(db)
  if (!map.size) return rows
  return rows.map((r) => {
    const wc = resolveCode(map, r.workCenter)
    return wc === r.workCenter ? r : { ...r, workCenter: wc }
  })
}

/** Bir sayfa taşır; bitmediyse kendini (aynı ya da sonraki tablo için) yeniden zamanlar. */
export const move = plantInternalMutation({
  args: { from: v.string(), to: v.string(), step: v.number(), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx: Any, { from, to: asked, step, cursor }: Any) => {
    // Taşıma sürerken kod yeniden değiştiyse (A → B → C) satır en güncel koda gider.
    const to = resolveCode(await aliasMap(ctx.db), asked)
    if (step >= TABLES.length) {
      // Son adım: açık konular (anahtar iş yeri kodunu içerir).
      for (const t of (await ctx.db.query('oeeTopics').withIndex('by_plant').collect()) as Any[]) {
        if (t.workCenter === from) await ctx.db.patch(t._id, { workCenter: to, key: renameTopicKey(t.key, from, to) })
      }
      return null
    }
    const t = TABLES[step]
    const page = await ctx.db.query(t.table).withIndex(t.index).paginate({ cursor, numItems: t.size })
    for (const r of page.page as Any[]) {
      if (r.workCenter !== from) continue
      if (await t.same(ctx.db, r, to)) await ctx.db.delete(r._id)
      else await ctx.db.patch(r._id, { workCenter: to })
    }
    const next = page.isDone ? { step: step + 1, cursor: null } : { step, cursor: page.continueCursor }
    await ctx.scheduler.runAfter(0, internal.workCenterHistory.move, { plantId: ctx.plantId, from, to, ...next })
    return null
  },
})
