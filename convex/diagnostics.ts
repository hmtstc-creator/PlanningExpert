// Teşhis sorguları: "telefondan girdiğim veri bilgisayarda yok" tipi
// sorunların kaynağını göstermek için. Asıl soru şudur: tarayıcı hangi
// Convex deployment'ına bağlı? Aynı veriyi görmeyen iki cihaz genellikle
// iki farklı deployment'a bakıyordur (ör. preview vs production).

import { v } from 'convex/values'

import { query } from './_generated/server'
import type { QueryCtx } from './_generated/server'

/** Sayım üst sınırı — büyük tablolarda bant genişliğini korur. */
const COUNT_LIMIT = 5000

const TABLES = [
  'presses',
  'products',
  'pressTemplates',
  'pressWeekOverrides',
  'globalShiftSettings',
  'workCalendar',
  'storageLocations',
  'demandWeekly',
  'demandDaily',
  'stock',
  'actualProduction',
  'planSnapshots',
  'changeLog',
] as const

type TableName = (typeof TABLES)[number]

async function tableStats(ctx: QueryCtx, table: TableName) {
  const rows = await ctx.db.query(table).take(COUNT_LIMIT + 1)
  const capped = rows.length > COUNT_LIMIT
  const lastWrite = rows.reduce<number | null>(
    (acc, r) => (acc === null || r._creationTime > acc ? r._creationTime : acc),
    null,
  )
  return {
    name: table,
    count: capped ? COUNT_LIMIT : rows.length,
    capped,
    lastWrite,
  }
}

/**
 * Tablo bazında kayıt sayısı ve son yazma zamanı. Telefon ile bilgisayarda
 * aynı sayıları görüyorsan aynı veritabanındasın demektir.
 */
export const summary = query({
  args: {},
  returns: v.object({
    serverTime: v.number(),
    tables: v.array(
      v.object({
        name: v.string(),
        count: v.number(),
        capped: v.boolean(),
        lastWrite: v.union(v.number(), v.null()),
      }),
    ),
  }),
  handler: async (ctx) => ({
    serverTime: Date.now(),
    tables: await Promise.all(TABLES.map((t) => tableStats(ctx, t))),
  }),
})

/**
 * Tekil olması gereken alanlarda oluşmuş çift kayıtlar. Bunlar sessiz
 * kayıt hatalarına yol açar (eski kod `.unique()` kullandığı için çift
 * kayıt varsa mutation hata fırlatıyordu).
 */
export const duplicates = query({
  args: {},
  returns: v.array(
    v.object({ table: v.string(), key: v.string(), count: v.number() }),
  ),
  handler: async (ctx) => {
    const out: { table: string; key: string; count: number }[] = []

    const check = (table: string, keys: string[]) => {
      const seen = new Map<string, number>()
      for (const k of keys) seen.set(k, (seen.get(k) ?? 0) + 1)
      for (const [key, count] of seen) {
        if (count > 1) out.push({ table, key, count })
      }
    }

    check(
      'presses',
      (await ctx.db.query('presses').take(COUNT_LIMIT)).map((p) => p.name),
    )
    check(
      'pressTemplates',
      (await ctx.db.query('pressTemplates').take(COUNT_LIMIT)).map((t) => t.press),
    )
    check(
      'pressWeekOverrides',
      (await ctx.db.query('pressWeekOverrides').take(COUNT_LIMIT)).map(
        (o) => `${o.press} · ${o.weekStart}`,
      ),
    )
    check(
      'storageLocations',
      (await ctx.db.query('storageLocations').take(COUNT_LIMIT)).map((s) => s.code),
    )
    check(
      'globalShiftSettings',
      (await ctx.db.query('globalShiftSettings').take(COUNT_LIMIT)).map((g) => g.key),
    )
    check(
      'workCalendar',
      (await ctx.db.query('workCalendar').take(COUNT_LIMIT)).map((w) => w.key),
    )

    return out
  },
})
