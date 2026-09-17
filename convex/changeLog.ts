import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const logValidator = v.object({
  _id: v.id('changeLog'),
  _creationTime: v.number(),
  title: v.string(),
  detail: v.optional(v.string()),
  category: v.string(),
  author: v.optional(v.string()),
  createdAt: v.number(),
})

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(logValidator),
  handler: async (ctx, args) =>
    ctx.db.query('changeLog').order('desc').paginate(args.paginationOpts),
})

export const create = mutation({
  args: {
    title: v.string(),
    detail: v.optional(v.string()),
    category: v.string(),
    author: v.optional(v.string()),
  },
  returns: v.id('changeLog'),
  handler: async (ctx, args) => {
    const title = args.title.trim()
    if (!title) throw new Error('Başlık zorunludur')
    return ctx.db.insert('changeLog', { ...args, title, createdAt: Date.now() })
  },
})

export const remove = mutation({
  args: { id: v.id('changeLog') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  },
})
