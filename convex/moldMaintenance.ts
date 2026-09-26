import { ConvexError, v } from 'convex/values'

import { runSync } from './moldAlarms'
import { guardedMutation, guardedQuery } from './guarded'

const recordValidator = v.object({
  _id: v.id('moldMaintenance'),
  _creationTime: v.number(),
  material: v.string(),
  date: v.string(),
  dateTo: v.optional(v.string()),
  kind: v.optional(v.string()),
  note: v.optional(v.string()),
  createdBy: v.optional(v.string()),
  createdAt: v.number(),
})

export const list = guardedQuery({
  args: {},
  returns: v.array(recordValidator),
  handler: async (ctx) => ctx.db.query('moldMaintenance').collect(),
})

export const add = guardedMutation({
  args: {
    material: v.string(),
    date: v.string(),
    // Çok günlü bakım için son gün. Verilmezse tek günlük sayılır.
    dateTo: v.optional(v.string()),
    // 'periodic' (ağır bakım — shot sayacını sıfırlar) | 'repair'.
    kind: v.optional(v.string()),
    note: v.optional(v.string()),
    createdBy: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const material = args.material.trim()
    if (!material) throw new ConvexError('Material code is required')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new ConvexError('Maintenance date must be in YYYY-MM-DD format')
    }
    if (args.dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(args.dateTo)) {
      throw new ConvexError('The end date must be in YYYY-MM-DD format')
    }
    if (args.dateTo && args.dateTo < args.date) {
      throw new ConvexError('The end date cannot be before the start date')
    }
    const kind = args.kind === 'repair' ? 'repair' : 'periodic'
    await ctx.db.insert('moldMaintenance', {
      material,
      date: args.date,
      dateTo: args.dateTo && args.dateTo > args.date ? args.dateTo : undefined,
      kind,
      note: args.note?.trim() || undefined,
      createdBy: args.createdBy,
      createdAt: Date.now(),
    })
    await ctx.db.insert('changeLog', {
      title: `Mold maintenance — ${material}`,
      detail:
        `${kind === 'periodic' ? 'Periodic maintenance' : 'Repair'} on ${args.date}` +
        `${args.dateTo && args.dateTo > args.date ? ` to ${args.dateTo}` : ''}. ` +
        `The mold cannot run on those days` +
        `${kind === 'periodic' ? ' and the shot counter restarts from the start date.' : '.'}`,
      category: 'maintenance',
      author: args.createdBy,
      createdAt: Date.now(),
    })

    // Periyodik bakım vuruş sayacını sıfırlar; açık bir ömür alarmı varsa
    // kendiliğinden düşmeli, elle kapatılmayı beklememeli.
    if (kind === 'periodic') await runSync(ctx)

    return null
  },
})

export const remove = guardedMutation({
  args: { id: v.id('moldMaintenance') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  },
})
