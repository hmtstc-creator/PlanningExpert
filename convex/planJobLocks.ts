import { ConvexError, v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'

const segmentValidator = v.object({ kind: v.string(), date: v.string(), start: v.number(), end: v.number() })

const jobFields = {
  material: v.string(),
  press: v.string(),
  hall: v.string(),
  date: v.string(),
  phase: v.string(),
  quantity: v.number(),
  shots: v.number(),
  coilsNeeded: v.number(),
  setupStartMinute: v.number(),
  endMinute: v.number(),
  endDate: v.optional(v.string()),
  segments: v.array(segmentValidator),
  reason: v.string(),
}

const lockValidator = v.object({
  _id: v.id('planJobLocks'),
  _creationTime: v.number(),
  ...jobFields,
  approvedBy: v.optional(v.string()),
  createdAt: v.number(),
})

export const list = guardedQuery({
  args: {},
  returns: v.array(lockValidator),
  handler: async (ctx) => ctx.db.query('planJobLocks').collect(),
})

/**
 * Planlamacı tek bir işi onaylar (Plan grafiğinde işe tıklayıp). İş olduğu
 * gibi kilitlenir: yeniden hesapta aynı pres, aynı saat; motor etrafına
 * planlar. Tam plan onayından ("Approve plan") bağımsızdır.
 */
export const approve = guardedMutation({
  areas: ['planning.plan'],
  args: { ...jobFields, createdBy: v.optional(v.string()) },
  returns: v.id('planJobLocks'),
  handler: async (ctx, { createdBy, ...job }) => {
    if (job.segments.length === 0) throw new ConvexError('This job has no time slots to lock')
    // Aynı iş iki kez kilitlenmez.
    const same = (await ctx.db
      .query('planJobLocks')
      .withIndex('by_material', (q) => q.eq('material', job.material))
      .collect()).filter(
      (l) => l.press === job.press && l.date === job.date && Math.round(l.setupStartMinute) === Math.round(job.setupStartMinute),
    )
    await Promise.all(same.map((l) => ctx.db.delete(l._id)))
    const id = await ctx.db.insert('planJobLocks', { ...job, approvedBy: createdBy, createdAt: Date.now() })
    await ctx.db.insert('changeLog', {
      title: `Job approved — ${job.material}`,
      detail: `${job.press} · ${job.date} · ${Math.round(job.quantity).toLocaleString('en-GB')} pcs — locked in the plan`,
      category: 'decision',
      author: createdBy,
      createdAt: Date.now(),
    })
    return id
  },
})

/**
 * Gantt'ta taşınan (sürükle-bırak ya da "Move") ya da elle eklenen (`added`) iş: pres + saatte
 * kilitlenir. İş zaten kilitliyse eski kilit aynı işlemde kalkar. Aynı preste
 * başka bir kilitli işle çakışırsa yazılmaz. Segmentleri istemci
 * `src/lib/jobMove.ts` ile hesaplar.
 */
export const move = guardedMutation({
  areas: ['planning.plan'],
  args: { ...jobFields, fromLockId: v.optional(v.id('planJobLocks')), from: v.optional(v.string()), added: v.optional(v.boolean()), createdBy: v.optional(v.string()) },
  returns: v.id('planJobLocks'),
  handler: async (ctx, { fromLockId, from, added, createdBy, ...job }) => {
    if (job.segments.length === 0) throw new ConvexError('This job has no time slots to lock')
    if (fromLockId) {
      const old = await ctx.db.get(fromLockId)
      if (old) await ctx.db.delete(fromLockId)
    }
    const others = await ctx.db.query('planJobLocks').collect()
    const clash = others.find(
      (l) =>
        l.press === job.press &&
        l.segments.some((x) => job.segments.some((y) => x.date === y.date && x.start < y.end && y.start < x.end)),
    )
    if (clash) throw new ConvexError(`Overlaps the approved job ${clash.material} on ${clash.press} (${clash.date}) — pick another time`)
    const id = await ctx.db.insert('planJobLocks', { ...job, approvedBy: createdBy, createdAt: Date.now() })
    await ctx.db.insert('changeLog', {
      title: `${added ? 'Job added by hand' : 'Job moved'} — ${job.material}`,
      detail: `${from ? `${from} → ` : ''}${job.press} · ${job.date} · ${Math.round(job.quantity).toLocaleString('en-GB')} pcs — locked in the plan`,
      category: 'decision',
      author: createdBy,
      createdAt: Date.now(),
    })
    return id
  },
})

/** Kilidi kaldırır: iş bir sonraki hesapta yeniden motora döner. */
export const unlock = guardedMutation({
  areas: ['planning.plan'],
  args: { id: v.id('planJobLocks'), updatedBy: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { id, updatedBy }) => {
    const row = await ctx.db.get(id)
    if (!row) return null
    await ctx.db.delete(id)
    await ctx.db.insert('changeLog', {
      title: `Job approval removed — ${row.material}`,
      detail: `${row.press} · ${row.date} — back to the engine`,
      category: 'decision',
      author: updatedBy,
      createdAt: Date.now(),
    })
    return null
  },
})
