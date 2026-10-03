import { ConvexError, v } from 'convex/values'

import { KPI, guardedMutation, guardedQuery, userQuery, visiblePlants } from './guarded'
import { slotKey, slotOf, trendSlots, type KpiSlot } from '../src/lib/kpi'

/**
 * KPI (docs/kpi.md): masraf yeri × dönem (ay ya da ISO hafta) için plan ve
 * gerçekleşen. Masraf yerleri fabrikanınkiler (Company → Plant → Cost
 * center); gerçekleşen OEE ve (girilmezse) üretim adedi / saati OEE
 * modülünün kök verisinden (oeeDays).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const periodV = v.union(v.literal('month'), v.literal('week'))
const valuesV = v.object({
  operators: v.optional(v.number()),
  volume: v.optional(v.number()),
  productionHours: v.optional(v.number()),
  presenceHours: v.optional(v.number()),
  overtimeHours: v.optional(v.number()),
  absenteeism: v.optional(v.number()),
  productivity: v.optional(v.number()),
  oee: v.optional(v.number()),
})

function checkSlot(period: string, year: number, num: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new ConvexError('Choose a year')
  const max = period === 'month' ? 12 : 53
  if (!Number.isInteger(num) || num < 1 || num > max) throw new ConvexError(period === 'month' ? 'Choose a month' : 'Choose a week')
}

export const entryOut = (e: Any) => ({
  period: e.period,
  year: e.year,
  num: e.num,
  costCenter: e.costCenter,
  line: e.line ?? 0,
  operatorType: e.operatorType,
  plan: e.plan ?? {},
  actual: e.actual ?? {},
  updatedAt: e.updatedAt,
  updatedBy: e.updatedBy,
})

/** Bir dönemin OEE kök verisi, masraf yeri bazında (kilitli db: kendi fabrikası). */
export async function oeeSums(db: Any, slot: KpiSlot, plantId?: string) {
  const q = plantId
    ? db.query('oeeDays').withIndex('by_date', (r: Any) => r.eq('plantId', plantId).gte('date', slot.from).lte('date', slot.to))
    : db.query('oeeDays').withIndex('by_date', (r: Any) => r.gte('date', slot.from).lte('date', slot.to))
  const days: Any[] = await q.collect()
  const by = new Map<string, Any>()
  for (const d of days) {
    const cur = by.get(d.costCenter) ?? { costCenter: d.costCenter, good: 0, operatingMin: 0, productionMin: 0, loadingMin: 0 }
    cur.good += d.good
    cur.operatingMin += d.operatingMin
    cur.productionMin += d.productionMin
    cur.loadingMin += d.loadingMin
    by.set(d.costCenter, cur)
  }
  return [...by.values()]
}

/** Giriş sayfası: seçili fabrikanın bir dönemdeki kayıtları ve OEE kök verisi. */
export const entries = guardedQuery({
  modules: KPI,
  args: { period: periodV, year: v.number(), num: v.number() },
  returns: v.any(),
  handler: async (ctx, { period, year, num }) => {
    checkSlot(period, year, num)
    const rows: Any[] = await ctx.db
      .query('kpiEntries')
      .withIndex('by_period', (q: Any) => q.eq('period', period).eq('year', year).eq('num', num))
      .collect()
    return { entries: rows.map(entryOut), oee: await oeeSums(ctx.db, slotOf(period, year, num)) }
  },
})

/**
 * Bir dönemin girişleri: ekrandaki bütün satırlar birlikte kaydedilir (bir
 * masraf yerinin birden çok satırı olabilir — ör. Direct ve Indirect);
 * ekrandan kaldırılan satır silinir.
 */
export const save = guardedMutation({
  modules: KPI,
  affectsPlan: false,
  args: {
    period: periodV,
    year: v.number(),
    num: v.number(),
    rows: v.array(
      v.object({
        costCenter: v.string(),
        operatorType: v.union(v.literal('direct'), v.literal('indirect')),
        plan: valuesV,
        actual: valuesV,
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { period, year, num, rows }) => {
    checkSlot(period, year, num)
    const codes = new Set((ctx.plant?.costCenters ?? []).map((c: Any) => c.code))
    const existing: Any[] = await ctx.db
      .query('kpiEntries')
      .withIndex('by_period', (q: Any) => q.eq('period', period).eq('year', year).eq('num', num))
      .collect()
    // Productivity sayısal değerdir; yalnızca bunlar yüzde (kesir).
    const PCT = new Set(['absenteeism', 'oee'])
    const lines = new Map<string, number>()
    const docs: Any[] = []
    for (const r of rows) {
      if (!codes.has(r.costCenter)) throw new ConvexError(`Cost center ${r.costCenter} is not a cost center of ${ctx.plant?.name ?? 'this plant'}`)
      for (const side of [r.plan, r.actual]) {
        for (const [k, val] of Object.entries(side)) {
          if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) throw new ConvexError(`${k} must be a number ≥ 0`)
          if (PCT.has(k) && val > 2) throw new ConvexError(`${k} is a percentage (e.g. 85)`)
        }
      }
      if (r.actual.oee !== undefined) throw new ConvexError('Actual OEE comes from the OEE data')
      const line = lines.get(r.costCenter) ?? 0
      lines.set(r.costCenter, line + 1)
      docs.push({ period, year, num, costCenter: r.costCenter, line, operatorType: r.operatorType, plan: r.plan, actual: r.actual, updatedAt: Date.now(), updatedBy: ctx.sessionUser?.name })
    }
    // Satırlar sırayla eşleşir: aynı masraf yerinin n. satırı günceller, fazlası silinir.
    const key = (e: Any) => `${e.costCenter}|${e.line ?? 0}`
    const old = new Map(existing.map((e) => [key(e), e]))
    for (const d of docs) {
      const prev = old.get(key(d))
      if (prev) {
        await ctx.db.replace(prev._id, d)
        old.delete(key(d))
      } else await ctx.db.insert('kpiEntries', d)
    }
    for (const e of old.values()) await ctx.db.delete(e._id)
    return null
  },
})

/**
 * Dashboard: seçilen fabrikalar (kullanıcının KPI'yi görebildikleri) ×
 * trend dilimleri (aylıkta 12 ay, haftalıkta 13 hafta). Her fabrika kendi
 * plantId'siyle okunur; yetkisiz fabrika istenirse atlanmaz, hata verir.
 */
export const dashboard = userQuery({
  args: { period: periodV, year: v.number(), num: v.number(), plantIds: v.array(v.id('plants')) },
  returns: v.any(),
  handler: async (ctx, { period, year, num, plantIds }) => {
    checkSlot(period, year, num)
    const slots = trendSlots(period, year, num)
    const visible = (await visiblePlants(ctx.db, ctx.sessionUser)).filter((p) => p.access.kpi !== 'none')
    const plants: Any[] = []
    for (const id of plantIds) {
      const p = visible.find((x) => x.plant._id === id)
      if (!p) throw new ConvexError('You have no KPI access to one of the selected plants')
      const entries: Any[] = []
      const oee: Any[] = []
      for (const s of slots) {
        const rows: Any[] = await ctx.db
          .query('kpiEntries')
          .withIndex('by_period', (q: Any) => q.eq('plantId', id).eq('period', period).eq('year', s.year).eq('num', s.num))
          .collect()
        entries.push(...rows.map(entryOut))
        for (const o of await oeeSums(ctx.db, s, id)) oee.push({ ...o, slot: slotKey(s) })
      }
      plants.push({
        plantId: id,
        plantName: p.plant.name,
        companyName: p.company.name,
        costCenters: p.plant.costCenters ?? [],
        entries,
        oee,
      })
    }
    return { slots, plants }
  },
})

/** Dashboard'da seçilebilecek fabrikalar (KPI izni olan). */
export const plants = userQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) =>
    (await visiblePlants(ctx.db, ctx.sessionUser))
      .filter((p) => p.access.kpi !== 'none')
      .map((p) => ({ plantId: p.plant._id, plantName: p.plant.name, companyName: p.company.name, costCenters: p.plant.costCenters ?? [] })),
})
