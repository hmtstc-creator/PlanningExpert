import { ConvexError, v } from 'convex/values'

import { ALL_MODULES, adminMutation, guardedQuery } from './guarded'

/**
 * Kullanıcı tanımlı seçim listeleri.
 *
 * Operasyon adları (OP10, OP20 …), problem tipleri, bakım nedenleri ve
 * frekansiyel duruşlar (rulo setup'ı, fikstür setup'ı …) atölyeden atölyeye
 * değişir: koda gömülmez, başlangıç değeri de yoktur — listeleri kullanıcı
 * tanımlar. (Work center kategorileri de bu tabloda, kind
 * 'workCenterCategory'; Work Center Definitions sayfasında yönetilir.)
 */
const KINDS = ['operation', 'problemType', 'maintenanceReason', 'machineProblemType', 'frequencyStop']

const rowValidator = v.object({
  _id: v.id('lookups'),
  _creationTime: v.number(),
  kind: v.string(),
  value: v.string(),
  sortOrder: v.optional(v.number()),
  createdAt: v.number(),
})

export const list = guardedQuery({
  modules: ALL_MODULES,
  args: {},
  returns: v.array(rowValidator),
  handler: async (ctx) => ctx.db.query('lookups').collect(),
})

export const add = adminMutation({
  modules: ALL_MODULES,
  affectsPlan: false,
  args: { kind: v.string(), value: v.string(), sortOrder: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!KINDS.includes(args.kind)) throw new ConvexError(`Unknown list: ${args.kind}`)
    const value = args.value.trim()
    if (!value) throw new ConvexError('A value is required')

    const existing = await ctx.db
      .query('lookups')
      .withIndex('by_kind', (q) => q.eq('kind', args.kind))
      .collect()
    // Aynı değeri iki kere eklemek seçim listesini kirletir.
    if (existing.some((row) => row.value.toLowerCase() === value.toLowerCase())) return null

    await ctx.db.insert('lookups', {
      kind: args.kind,
      value,
      sortOrder: args.sortOrder ?? existing.length,
      createdAt: Date.now(),
    })
    return null
  },
})

export const remove = adminMutation({
  modules: ALL_MODULES,
  affectsPlan: false,
  args: { id: v.id('lookups') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (!row) return null
    // Work center'da kullanılan frekansiyel duruş silinmez (tanım sahipsiz kalır).
    if (row.kind === 'frequencyStop') {
      const users = (await ctx.db.query('presses').collect()).filter((p) => p.frequencyStop === row.value)
      if (users.length) {
        throw new ConvexError(`${row.value} is the frequency stop of ${users.map((p) => p.name).join(', ')} — change those on Work Center Definitions first`)
      }
    }
    await ctx.db.delete(id)
    return null
  },
})
