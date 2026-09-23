import { v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'

const rowValidator = v.object({
  _id: v.id('moldProblems'),
  _creationTime: v.number(),
  material: v.string(),
  operation: v.string(),
  problemType: v.string(),
  description: v.optional(v.string()),
  occurredAt: v.string(),
  reportedBy: v.optional(v.string()),
  reportedAt: v.number(),
  status: v.string(),
  solution: v.optional(v.string()),
  solvedBy: v.optional(v.string()),
  solvedAt: v.optional(v.number()),
  downtimeMinutes: v.optional(v.number()),
  photos: v.optional(v.array(v.id('_storage'))),
})

export const list = guardedQuery({
  args: {},
  returns: v.array(
    v.object({
      ...rowValidator.fields,
      /** Fotoğrafların geçici indirme adresleri. */
      photoUrls: v.array(v.union(v.string(), v.null())),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query('moldProblems').collect()
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        photoUrls: await Promise.all(
          (row.photos ?? []).map((id) => ctx.storage.getUrl(id)),
        ),
      })),
    )
  },
})

/** Fotoğrafın doğrudan tarayıcıdan yükleneceği tek kullanımlık adres. */
export const generateUploadUrl = guardedMutation({
  affectsPlan: false,
  args: {},
  returns: v.string(),
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
})

export const report = guardedMutation({
  affectsPlan: false,
  args: {
    material: v.string(),
    operation: v.string(),
    problemType: v.string(),
    description: v.optional(v.string()),
    occurredAt: v.string(),
    downtimeMinutes: v.optional(v.number()),
    photos: v.optional(v.array(v.id('_storage'))),
    reportedBy: v.optional(v.string()),
  },
  returns: v.id('moldProblems'),
  handler: async (ctx, args) => {
    const material = args.material.trim()
    if (!material) throw new Error('Material code is required')
    const operation = args.operation.trim()
    if (!operation) throw new Error('An operation is required')
    const problemType = args.problemType.trim()
    if (!problemType) throw new Error('A problem type is required')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.occurredAt)) {
      throw new Error('The date must be in YYYY-MM-DD format')
    }
    if (args.downtimeMinutes !== undefined && args.downtimeMinutes < 0) {
      throw new Error('Downtime cannot be negative')
    }

    const id = await ctx.db.insert('moldProblems', {
      material,
      operation,
      problemType,
      description: args.description?.trim() || undefined,
      occurredAt: args.occurredAt,
      reportedBy: args.reportedBy,
      reportedAt: Date.now(),
      status: 'open',
      downtimeMinutes: args.downtimeMinutes,
      photos: args.photos,
    })
    await ctx.db.insert('changeLog', {
      title: `Mold problem — ${material} ${operation}`,
      detail: `${problemType} on ${args.occurredAt}.${args.description ? ` ${args.description}` : ''}`,
      category: 'maintenance',
      author: args.reportedBy,
      createdAt: Date.now(),
    })
    return id
  },
})

export const solve = guardedMutation({
  affectsPlan: false,
  args: {
    id: v.id('moldProblems'),
    solution: v.string(),
    solvedBy: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (!row) throw new Error('Problem record not found')
    const solution = args.solution.trim()
    if (!solution) throw new Error('Describe what was done')

    await ctx.db.patch(args.id, {
      status: 'solved',
      solution,
      solvedBy: args.solvedBy,
      solvedAt: Date.now(),
    })
    await ctx.db.insert('changeLog', {
      title: `Mold problem solved — ${row.material} ${row.operation}`,
      detail: `${row.problemType}: ${solution}`,
      category: 'maintenance',
      author: args.solvedBy,
      createdAt: Date.now(),
    })
    return null
  },
})

export const reopen = guardedMutation({
  affectsPlan: false,
  args: { id: v.id('moldProblems') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, {
      status: 'open',
      solvedAt: undefined,
      solvedBy: undefined,
    })
    return null
  },
})

export const remove = guardedMutation({
  affectsPlan: false,
  args: { id: v.id('moldProblems') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    // Kaydın fotoğrafları da gitmeli; aksi halde depoda sahipsiz dosya kalır.
    for (const photo of row?.photos ?? []) {
      await ctx.storage.delete(photo)
    }
    await ctx.db.delete(id)
    return null
  },
})
