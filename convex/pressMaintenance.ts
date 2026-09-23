import { v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'

const rowValidator = v.object({
  _id: v.id('pressMaintenance'),
  _creationTime: v.number(),
  press: v.string(),
  date: v.string(),
  startMinute: v.number(),
  endMinute: v.number(),
  reason: v.string(),
  note: v.optional(v.string()),
  status: v.string(),
  actualDate: v.optional(v.string()),
  actualStartMinute: v.optional(v.number()),
  actualEndMinute: v.optional(v.number()),
  createdBy: v.optional(v.string()),
  completedBy: v.optional(v.string()),
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
})

export const list = guardedQuery({
  args: {},
  returns: v.array(rowValidator),
  handler: async (ctx) => ctx.db.query('pressMaintenance').collect(),
})

function clockMinute(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`${field} must be a number`)
  const rounded = Math.round(value)
  if (rounded < 0 || rounded > 24 * 60) {
    throw new Error(`${field} must be between 00:00 and 24:00`)
  }
  return rounded
}

function requireDate(date: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`${field} must be in YYYY-MM-DD format`)
  }
  return date
}

export const add = guardedMutation({
  args: {
    press: v.string(),
    date: v.string(),
    startMinute: v.number(),
    endMinute: v.number(),
    reason: v.string(),
    note: v.optional(v.string()),
    createdBy: v.optional(v.string()),
  },
  returns: v.id('pressMaintenance'),
  handler: async (ctx, args) => {
    const press = args.press.trim()
    if (!press) throw new Error('Press is required')
    const reason = args.reason.trim()
    if (!reason) throw new Error('A reason is required')
    const date = requireDate(args.date, 'Date')
    const start = clockMinute(args.startMinute, 'Start time')
    const end = clockMinute(args.endMinute, 'End time')
    if (end <= start) throw new Error('The end time must be after the start time')

    const id = await ctx.db.insert('pressMaintenance', {
      press,
      date,
      startMinute: start,
      endMinute: end,
      reason,
      note: args.note?.trim() || undefined,
      status: 'planned',
      createdBy: args.createdBy,
      createdAt: Date.now(),
    })
    await ctx.db.insert('changeLog', {
      title: `Press maintenance planned — ${press}`,
      detail: `${date}, ${reason}. The plan keeps that press free for the window.`,
      category: 'maintenance',
      author: args.createdBy,
      createdAt: Date.now(),
    })
    return id
  },
})

export const update = guardedMutation({
  args: {
    id: v.id('pressMaintenance'),
    date: v.string(),
    startMinute: v.number(),
    endMinute: v.number(),
    reason: v.string(),
    note: v.optional(v.string()),
    status: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!['planned', 'done', 'cancelled'].includes(args.status)) {
      throw new Error(`Unknown status: ${args.status}`)
    }
    const start = clockMinute(args.startMinute, 'Start time')
    const end = clockMinute(args.endMinute, 'End time')
    if (end <= start) throw new Error('The end time must be after the start time')
    const reason = args.reason.trim()
    if (!reason) throw new Error('A reason is required')

    await ctx.db.patch(args.id, {
      date: requireDate(args.date, 'Date'),
      startMinute: start,
      endMinute: end,
      reason,
      note: args.note?.trim() || undefined,
      status: args.status,
    })
    return null
  },
})

/**
 * Bakım bittiğinde gerçekleşen saatleri yazar.
 *
 * Planlananla gerçekleşen arasındaki fark bakım performansıdır; kayıt
 * geçmişe dönük saklandığı için silinmez, üzerine yazılır.
 */
export const complete = guardedMutation({
  args: {
    id: v.id('pressMaintenance'),
    actualDate: v.string(),
    actualStartMinute: v.number(),
    actualEndMinute: v.number(),
    completedBy: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (!row) throw new Error('Maintenance record not found')
    const start = clockMinute(args.actualStartMinute, 'Actual start')
    const end = clockMinute(args.actualEndMinute, 'Actual end')
    if (end <= start) throw new Error('The actual end must be after the actual start')

    await ctx.db.patch(args.id, {
      status: 'done',
      actualDate: requireDate(args.actualDate, 'Actual date'),
      actualStartMinute: start,
      actualEndMinute: end,
      completedBy: args.completedBy,
      completedAt: Date.now(),
      note: args.note?.trim() || row.note,
    })

    const planned = row.endMinute - row.startMinute
    const actual = end - start
    await ctx.db.insert('changeLog', {
      title: `Press maintenance completed — ${row.press}`,
      detail:
        `${row.reason} on ${args.actualDate}. ` +
        `Planned ${planned} min, took ${actual} min ` +
        `(${actual > planned ? `${actual - planned} min over` : `${planned - actual} min under`}).`,
      category: 'maintenance',
      author: args.completedBy,
      createdAt: Date.now(),
    })
    return null
  },
})

export const remove = guardedMutation({
  args: { id: v.id('pressMaintenance') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  },
})
