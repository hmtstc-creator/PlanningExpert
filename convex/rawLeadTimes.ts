import { ConvexError, v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'

/** Varsayılan satırın kodu: tedarik süresi girilmemiş her sac için. */
export const DEFAULT_RAW = '*'
const MAX_DAYS = 365

const rowValidator = v.object({
  _id: v.id('rawLeadTimes'),
  _creationTime: v.number(),
  plantId: v.optional(v.id('plants')),
  rawMaterialCode: v.string(),
  leadTimeDays: v.number(),
  supplier: v.optional(v.string()),
  note: v.optional(v.string()),
  updatedBy: v.optional(v.string()),
  updatedAt: v.number(),
})

export const list = guardedQuery({
  args: {},
  returns: v.array(rowValidator),
  handler: async (ctx) => ctx.db.query('rawLeadTimes').collect(),
})

/**
 * Raw Material Coverage → Lead times tablosundan değişen satırlar. Süre boş
 * bırakılan satır silinir (sac varsayılana döner). Süre takvim günüdür.
 * Plandan bağımsızdır: plan yeniden hesaplanmaz.
 */
export const save = guardedMutation({
  areas: ['planning.calendar'],
  args: {
    rows: v.array(
      v.object({
        rawMaterialCode: v.string(),
        leadTimeDays: v.union(v.number(), v.null()),
        supplier: v.optional(v.string()),
        note: v.optional(v.string()),
      }),
    ),
    createdBy: v.optional(v.string()),
  },
  returns: v.null(),
  affectsPlan: false,
  handler: async (ctx, { rows, createdBy }) => {
    if (rows.length > 2000) throw new ConvexError('Too many rows in one save')
    const now = Date.now()
    let changed = 0
    for (const row of rows) {
      const code = row.rawMaterialCode.trim()
      if (!code) continue
      const days = row.leadTimeDays
      if (days !== null && (!Number.isInteger(days) || days < 0 || days > MAX_DAYS)) {
        throw new ConvexError(`Lead time for ${code === DEFAULT_RAW ? 'the default' : code} must be a whole number of days, 0–${MAX_DAYS}`)
      }
      const existing = await ctx.db
        .query('rawLeadTimes')
        .withIndex('by_raw', (q) => q.eq('rawMaterialCode', code))
        .collect()
      await Promise.all(existing.map((e) => ctx.db.delete(e._id)))
      if (days !== null) {
        const supplier = row.supplier?.trim().slice(0, 120)
        const note = row.note?.trim().slice(0, 300)
        await ctx.db.insert('rawLeadTimes', {
          rawMaterialCode: code,
          leadTimeDays: days,
          ...(supplier ? { supplier } : {}),
          ...(note ? { note } : {}),
          updatedBy: createdBy,
          updatedAt: now,
        })
      }
      changed++
    }
    if (changed > 0) {
      await ctx.db.insert('changeLog', {
        title: 'Raw material lead times updated',
        detail: `${changed} row(s) on Raw Material Coverage`,
        category: 'master-data',
        author: createdBy,
        createdAt: now,
      })
    }
    return null
  },
})
