import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'

const groupValidator = v.object({
  _id: v.id('craneGroups'),
  _creationTime: v.number(),
  groupName: v.string(),
  machines: v.array(v.string()),
})

export const list = guardedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(groupValidator),
  handler: async (ctx, args) =>
    ctx.db.query('craneGroups').order('desc').paginate(args.paginationOpts),
})

export const create = guardedMutation({
  args: { groupName: v.string(), machines: v.array(v.string()) },
  returns: v.id('craneGroups'),
  handler: async (ctx, args) => {
    const groupName = args.groupName.trim()
    const machines = args.machines.map((m) => m.trim()).filter(Boolean)
    if (!groupName) throw new Error('Group name is required')
    if (machines.length < 2) throw new Error('At least 2 machines are required')
    return ctx.db.insert('craneGroups', { groupName, machines })
  },
})

export const remove = guardedMutation({
  args: { id: v.id('craneGroups') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  },
})
