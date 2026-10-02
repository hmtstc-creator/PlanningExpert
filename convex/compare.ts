import { v } from 'convex/values'

import { userQuery, visiblePlants } from './guarded'
import { addDaysIso, isoWeek, mondayOfIso, ratios, sumTimes } from '../src/lib/oee'

/**
 * Fabrika karşılaştırma (docs/plant-genisletme.md, aşama 7 — ilk sürüm):
 * kullanıcının OEE'yi görebildiği her fabrikanın son haftalardaki OEE'si,
 * Availability ve Performance'ı yan yana. Hesap her fabrikada aynı:
 * süreler toplanır, sonra bölünür. Yalnızca yetkili fabrikalar okunur
 * (visiblePlants); her fabrika kendi plantId'siyle sorgulanır.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

export const oeeWeeks = userQuery({
  args: { endDate: v.string(), weeks: v.number() },
  returns: v.any(),
  handler: async (ctx: Any, { endDate, weeks }: Any) => {
    const n = Math.max(1, Math.min(26, Math.floor(weeks)))
    const lastMonday = mondayOfIso(endDate)
    const from = addDaysIso(lastMonday, -7 * (n - 1))
    const to = addDaysIso(lastMonday, 6)
    const keys = Array.from({ length: n }, (_, i) => {
      const w = isoWeek(addDaysIso(from, 7 * i))
      return { key: `${w.year}-W${w.week}`, label: `W${w.week}` }
    })
    const plants = (await visiblePlants(ctx.db, ctx.sessionUser)).filter((p) => p.access.oee !== 'none')
    const out: Any[] = []
    for (const p of plants) {
      const days: Any[] = await ctx.db
        .query('oeeDays')
        .withIndex('by_date', (q: Any) => q.eq('plantId', p.plant._id).gte('date', from).lte('date', to))
        .collect()
      const byWeek = new Map<string, Any[]>()
      for (const d of days) {
        const w = isoWeek(d.date)
        const k = `${w.year}-W${w.week}`
        byWeek.set(k, [...(byWeek.get(k) ?? []), d])
      }
      const all = sumTimes(days)
      out.push({
        plantId: p.plant._id,
        plantName: p.plant.name,
        companyName: p.company.name,
        total: { ...ratios(all), loadingMin: all.loadingMin },
        weeks: keys.map(({ key, label }) => {
          const t = sumTimes(byWeek.get(key) ?? [])
          return { key, label, loadingMin: t.loadingMin, ...ratios(t) }
        }),
      })
    }
    return { weeks: keys, plants: out }
  },
})
