import { v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'

const holidayValidator = v.object({
  _id: v.id('officialHolidays'),
  _creationTime: v.number(),
  country: v.string(),
  year: v.number(),
  date: v.string(),
  name: v.string(),
})

export const listByCountry = guardedQuery({
  args: { country: v.string() },
  returns: v.array(holidayValidator),
  handler: async (ctx, { country }) =>
    ctx.db
      .query('officialHolidays')
      .withIndex('by_country', (q) => q.eq('country', country))
      .collect(),
})

/**
 * Bir ülke/yıl için resmi tatilleri tamamen değiştirir. Takvim ekranı
 * Nager.Date'ten çektiği listeyi buraya yazar; böylece tatiller planlama
 * motoruna da ulaşır ve o günün kapasitesi sıfırlanır.
 */
export const replaceYear = guardedMutation({
  args: {
    country: v.string(),
    year: v.number(),
    days: v.array(v.object({ date: v.string(), name: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, { country, year, days }) => {
    const existing = await ctx.db
      .query('officialHolidays')
      .withIndex('by_country_year', (q) => q.eq('country', country).eq('year', year))
      .collect()

    // Aynı içerikse boşuna yazma — takvim ekranı her açılışta çağırıyor.
    const before = existing
      .map((h) => `${h.date}|${h.name}`)
      .sort()
      .join(',')
    const after = days
      .map((h) => `${h.date}|${h.name}`)
      .sort()
      .join(',')
    if (before === after) return null

    await Promise.all(existing.map((h) => ctx.db.delete(h._id)))
    await Promise.all(
      days.map((d) =>
        ctx.db.insert('officialHolidays', {
          country,
          year,
          date: d.date,
          name: d.name,
        }),
      ),
    )
    return null
  },
})
