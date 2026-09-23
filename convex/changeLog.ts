import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'

const logValidator = v.object({
  _id: v.id('changeLog'),
  _creationTime: v.number(),
  title: v.string(),
  detail: v.optional(v.string()),
  category: v.string(),
  author: v.optional(v.string()),
  createdAt: v.number(),
})

export const list = guardedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(logValidator),
  handler: async (ctx, args) =>
    ctx.db.query('changeLog').order('desc').paginate(args.paginationOpts),
})

/**
 * En son kayıtlar, yeniden eskiye.
 *
 * Denetim izi için: "kim neyi ne zaman değiştirdi" sorusu son olaylarla
 * ilgilidir, sayfalamayla değil.
 */
export const recent = guardedQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(logValidator),
  handler: async (ctx, { limit }) =>
    ctx.db
      .query('changeLog')
      .withIndex('by_created')
      .order('desc')
      .take(Math.min(200, Math.max(1, limit ?? 50))),
})

export const create = guardedMutation({
  args: {
    title: v.string(),
    detail: v.optional(v.string()),
    category: v.string(),
    author: v.optional(v.string()),
  },
  returns: v.id('changeLog'),
  handler: async (ctx, args) => {
    const title = args.title.trim()
    if (!title) throw new Error('Title is required')
    return ctx.db.insert('changeLog', { ...args, title, createdAt: Date.now() })
  },
})

export const remove = guardedMutation({
  args: { id: v.id('changeLog') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  },
})
