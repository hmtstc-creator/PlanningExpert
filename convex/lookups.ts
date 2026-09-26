import { ConvexError, v } from 'convex/values'

import { adminMutation, guardedQuery } from './guarded'

/**
 * Kullanıcı tanımlı seçim listeleri.
 *
 * Operasyon adları (OP10, OP20 …) ve problem tipleri (çapak, yırtık, zımba
 * kırılması …) atölyeden atölyeye değişir; koda gömülmemeleri gerekir.
 */
const KINDS = ['operation', 'problemType', 'maintenanceReason', 'machineProblemType']

const rowValidator = v.object({
  _id: v.id('lookups'),
  _creationTime: v.number(),
  kind: v.string(),
  value: v.string(),
  sortOrder: v.optional(v.number()),
  createdAt: v.number(),
})

export const list = guardedQuery({
  args: {},
  returns: v.array(rowValidator),
  handler: async (ctx) => ctx.db.query('lookups').collect(),
})

export const add = adminMutation({
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
  affectsPlan: false,
  args: { id: v.id('lookups') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  },
})

/**
 * Listeler boşsa atölyede yaygın olan başlangıç değerlerini yazar.
 *
 * Bu bir "varsayılan", kalıcı bir kural değil: admin silebilir, ekleyebilir.
 * Boş bir seçim listesiyle problem bildirilemeyeceği için bir kere çalışır.
 */
export const seedDefaults = adminMutation({
  affectsPlan: false,
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const defaults: Record<string, string[]> = {
      operation: ['OP10', 'OP20', 'OP30', 'OP40', 'OP50'],
      problemType: [
        'Burr',
        'Tear',
        'Punch breakage',
        'Die wear',
        'Spring failure',
        'Misfeed',
        'Scratch',
        'Dimensional deviation',
      ],
      machineProblemType: [
        'Hydraulic',
        'Electrical',
        'Mechanical',
        'Feeder / coil line',
        'Die clamping',
        'Safety device',
        'Lubrication',
        'Control / PLC',
      ],
      maintenanceReason: [
        'Periodic maintenance',
        'Breakdown',
        'Hydraulic service',
        'Electrical fault',
        'Overhaul',
      ],
    }
    let added = 0
    for (const [kind, values] of Object.entries(defaults)) {
      const existing = await ctx.db
        .query('lookups')
        .withIndex('by_kind', (q) => q.eq('kind', kind))
        .collect()
      if (existing.length > 0) continue
      for (const [index, value] of values.entries()) {
        await ctx.db.insert('lookups', { kind, value, sortOrder: index, createdAt: Date.now() })
        added++
      }
    }
    return added
  },
})
