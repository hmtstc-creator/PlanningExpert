import { v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'

/**
 * Makine (pres) arızaları.
 *
 * Kalıp problemleriyle aynı akış: bildir → çöz (ne yapıldığı yazılmadan
 * kapanmaz) → raporla. "Pres duruyor" işaretli açık bir arıza plana girer:
 * pres, beklenen devreye giriş anına kadar — tarih yoksa arıza çözülene
 * kadar — kullanılmaz. Bu yüzden yalnızca o alanları değiştiren işlemler
 * planı yeniden hesaplatır.
 */

const rowValidator = v.object({
  _id: v.id('machineProblems'),
  _creationTime: v.number(),
  press: v.string(),
  problemType: v.string(),
  description: v.optional(v.string()),
  occurredAt: v.string(),
  occurredMinute: v.optional(v.number()),
  stopsPress: v.boolean(),
  expectedUpDate: v.optional(v.string()),
  expectedUpMinute: v.optional(v.number()),
  reportedBy: v.optional(v.string()),
  reportedAt: v.number(),
  status: v.string(),
  solution: v.optional(v.string()),
  solvedBy: v.optional(v.string()),
  solvedAt: v.optional(v.number()),
  downtimeMinutes: v.optional(v.number()),
  photos: v.optional(v.array(v.id('_storage'))),
})

const DATE = /^\d{4}-\d{2}-\d{2}$/

function checkMinute(value: number | undefined, field: string) {
  if (value === undefined) return
  if (!Number.isFinite(value) || value < 0 || value >= 24 * 60) {
    throw new Error(`${field} must be between 00:00 and 23:59`)
  }
}

export const list = guardedQuery({
  args: {},
  returns: v.array(
    v.object({
      ...rowValidator.fields,
      photoUrls: v.array(v.union(v.string(), v.null())),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query('machineProblems').collect()
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        photoUrls: await Promise.all((row.photos ?? []).map((id) => ctx.storage.getUrl(id))),
      })),
    )
  },
})

export const generateUploadUrl = guardedMutation({
  affectsPlan: false,
  args: {},
  returns: v.string(),
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
})

export const report = guardedMutation({
  args: {
    press: v.string(),
    problemType: v.string(),
    description: v.optional(v.string()),
    occurredAt: v.string(),
    occurredMinute: v.optional(v.number()),
    stopsPress: v.boolean(),
    expectedUpDate: v.optional(v.string()),
    expectedUpMinute: v.optional(v.number()),
    downtimeMinutes: v.optional(v.number()),
    photos: v.optional(v.array(v.id('_storage'))),
    reportedBy: v.optional(v.string()),
  },
  returns: v.id('machineProblems'),
  handler: async (ctx, args) => {
    const press = args.press.trim()
    if (!press) throw new Error('A press is required')
    const problemType = args.problemType.trim()
    if (!problemType) throw new Error('A problem type is required')
    if (!DATE.test(args.occurredAt)) throw new Error('The date must be in YYYY-MM-DD format')
    if (args.expectedUpDate && !DATE.test(args.expectedUpDate)) {
      throw new Error('The expected date must be in YYYY-MM-DD format')
    }
    if (args.expectedUpDate && args.expectedUpDate < args.occurredAt) {
      throw new Error('The press cannot be back before the breakdown happened')
    }
    checkMinute(args.occurredMinute, 'The time')
    checkMinute(args.expectedUpMinute, 'The expected time')
    if (args.downtimeMinutes !== undefined && args.downtimeMinutes < 0) {
      throw new Error('Downtime cannot be negative')
    }

    const id = await ctx.db.insert('machineProblems', {
      press,
      problemType,
      description: args.description?.trim() || undefined,
      occurredAt: args.occurredAt,
      occurredMinute: args.occurredMinute,
      stopsPress: args.stopsPress,
      expectedUpDate: args.stopsPress ? args.expectedUpDate || undefined : undefined,
      expectedUpMinute:
        args.stopsPress && args.expectedUpDate ? args.expectedUpMinute : undefined,
      reportedBy: args.reportedBy,
      reportedAt: Date.now(),
      status: 'open',
      downtimeMinutes: args.downtimeMinutes,
      photos: args.photos,
    })
    await ctx.db.insert('changeLog', {
      title: `Machine breakdown — ${press}`,
      detail:
        `${problemType} on ${args.occurredAt}.` +
        (args.stopsPress
          ? ` Press stopped${args.expectedUpDate ? `, expected back ${args.expectedUpDate}` : ' until solved'}.`
          : ' Press keeps running.') +
        (args.description ? ` ${args.description}` : ''),
      category: 'maintenance',
      author: args.reportedBy,
      createdAt: Date.now(),
    })
    return id
  },
})

/** Beklenen devreye giriş zamanını günceller — plan buna göre yeniden kurulur. */
export const setExpectedUp = guardedMutation({
  args: {
    id: v.id('machineProblems'),
    expectedUpDate: v.optional(v.string()),
    expectedUpMinute: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (!row) throw new Error('Breakdown record not found')
    if (args.expectedUpDate && !DATE.test(args.expectedUpDate)) {
      throw new Error('The expected date must be in YYYY-MM-DD format')
    }
    checkMinute(args.expectedUpMinute, 'The expected time')
    await ctx.db.patch(args.id, {
      expectedUpDate: args.expectedUpDate || undefined,
      expectedUpMinute: args.expectedUpDate ? args.expectedUpMinute : undefined,
    })
    return null
  },
})

export const solve = guardedMutation({
  args: {
    id: v.id('machineProblems'),
    solution: v.string(),
    downtimeMinutes: v.optional(v.number()),
    solvedBy: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (!row) throw new Error('Breakdown record not found')
    const solution = args.solution.trim()
    if (!solution) throw new Error('Describe what was done')
    if (args.downtimeMinutes !== undefined && args.downtimeMinutes < 0) {
      throw new Error('Downtime cannot be negative')
    }
    await ctx.db.patch(args.id, {
      status: 'solved',
      solution,
      solvedBy: args.solvedBy,
      solvedAt: Date.now(),
      ...(args.downtimeMinutes !== undefined ? { downtimeMinutes: args.downtimeMinutes } : {}),
    })
    await ctx.db.insert('changeLog', {
      title: `Machine breakdown solved — ${row.press}`,
      detail: `${row.problemType}: ${solution}`,
      category: 'maintenance',
      author: args.solvedBy,
      createdAt: Date.now(),
    })
    return null
  },
})

export const reopen = guardedMutation({
  args: { id: v.id('machineProblems') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { status: 'open', solvedAt: undefined, solvedBy: undefined })
    return null
  },
})

export const remove = guardedMutation({
  args: { id: v.id('machineProblems') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    for (const photo of row?.photos ?? []) await ctx.storage.delete(photo)
    await ctx.db.delete(id)
    return null
  },
})
