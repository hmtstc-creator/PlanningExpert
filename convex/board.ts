import { ConvexError, v } from 'convex/values'

import { userQuery, visiblePlants } from './guarded'
import { entryOut, oeeSums } from './kpi'
import { slotKey, trendSlots } from '../src/lib/kpi'

/**
 * Board Dashboard (docs/board.md): kullanıcının görebildiği bütün
 * plantlerin özet verisi — holding → şirket → plant → masraf yeri. Her
 * plant kendi plantId'siyle okunur; KPI kayıtları yalnızca KPI izni,
 * OEE kök verisi yalnızca OEE izni olan plantlerde.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

export const overview = userQuery({
  args: { period: v.union(v.literal('month'), v.literal('week')), year: v.number(), num: v.number() },
  returns: v.any(),
  handler: async (ctx, { period, year, num }) => {
    const max = period === 'month' ? 12 : 53
    if (!Number.isInteger(year) || !Number.isInteger(num) || num < 1 || num > max) throw new ConvexError('Choose a period')
    const slots = trendSlots(period, year, num)
    const visible = (await visiblePlants(ctx.db, ctx.sessionUser)).filter((p) => p.access.kpi !== 'none' || p.access.oee !== 'none')
    const holdingIds = [...new Set(visible.map((p) => p.company.holdingId).filter((h): h is NonNullable<typeof h> => !!h))]
    const holdings = new Map<string, string>()
    for (const id of holdingIds) holdings.set(id, (await ctx.db.get(id))?.name ?? '')
    const plants: Any[] = []
    for (const p of visible) {
      const id = p.plant._id
      const entries: Any[] = []
      const oee: Any[] = []
      for (const s of slots) {
        if (p.access.kpi !== 'none') {
          const rows: Any[] = await ctx.db
            .query('kpiEntries')
            .withIndex('by_period', (q: Any) => q.eq('plantId', id).eq('period', period).eq('year', s.year).eq('num', s.num))
            .collect()
          entries.push(...rows.map(entryOut))
        }
        if (p.access.oee !== 'none') for (const o of await oeeSums(ctx.db, s, id)) oee.push({ ...o, slot: slotKey(s) })
      }
      plants.push({
        plantId: id,
        plantName: p.plant.name,
        companyId: p.company._id,
        companyName: p.company.name,
        holdingId: p.company.holdingId ?? null,
        holdingName: p.company.holdingId ? holdings.get(p.company.holdingId) : null,
        costCenters: p.plant.costCenters ?? [],
        access: { kpi: p.access.kpi, oee: p.access.oee },
        entries,
        oee,
      })
    }
    return { slots, plants }
  },
})
