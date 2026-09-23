import { v } from 'convex/values'

import { internalMutation, internalQuery, query } from './_generated/server'
import { guardedQuery } from './guarded'

/**
 * Girişin veritabanı tarafı.
 *
 * Parola karması Node çalışma ortamı gerektirdiği için `auth.ts` içindeki
 * action'larda üretiliyor; burası o action'ların çağırdığı iç işlevler ve
 * tarayıcının okuduğu tek genel sorgu.
 */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

export const findUser = internalQuery({
  args: { name: v.string() },
  returns: v.any(),
  handler: async (ctx, { name }) =>
    ctx.db
      .query('users')
      .withIndex('by_name', (q) => q.eq('name', name))
      .first(),
})

export const countUsers = internalQuery({
  args: {},
  returns: v.number(),
  handler: async (ctx) => (await ctx.db.query('users').take(1)).length,
})

export const getUser = internalQuery({
  args: { id: v.id('users') },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
})

export const createUserWithPassword = internalMutation({
  args: {
    name: v.string(),
    role: v.string(),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    mustChangePassword: v.boolean(),
  },
  returns: v.id('users'),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('users', {
      name: args.name,
      role: args.role,
      active: true,
      passwordHash: args.passwordHash,
      passwordSalt: args.passwordSalt,
      mustChangePassword: args.mustChangePassword,
      createdAt: Date.now(),
    })
    await ctx.db.insert('changeLog', {
      title: `User created — ${args.name}`,
      detail: `Role: ${args.role}.`,
      category: 'system',
      createdAt: Date.now(),
    })
    return id
  },
})

export const storePassword = internalMutation({
  args: {
    id: v.id('users'),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    mustChangePassword: v.boolean(),
    /** Parola değişince o kullanıcının diğer oturumları kapatılır. */
    keepToken: v.optional(v.string()),
    actor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.id)
    if (!user) throw new Error('User not found')

    await ctx.db.patch(args.id, {
      passwordHash: args.passwordHash,
      passwordSalt: args.passwordSalt,
      mustChangePassword: args.mustChangePassword,
    })

    // Parola değiştiyse eski oturumlar geçersizdir; çalınmış bir jetonun
    // parola değişince de çalışması kabul edilemez.
    const sessions = await ctx.db
      .query('sessions')
      .withIndex('by_user', (q) => q.eq('userId', args.id))
      .collect()
    for (const session of sessions) {
      if (args.keepToken && session.token === args.keepToken) continue
      await ctx.db.delete(session._id)
    }

    await ctx.db.insert('changeLog', {
      title: `Password changed — ${user.name}`,
      detail: 'Other sessions for this user were signed out.',
      category: 'system',
      author: args.actor,
      createdAt: Date.now(),
    })
    return null
  },
})

export const createSession = internalMutation({
  args: { userId: v.id('users'), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now()
    await ctx.db.insert('sessions', {
      token: args.token,
      userId: args.userId,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    })
    return null
  },
})

export const deleteSession = internalMutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, { token }) => {
    const session = await ctx.db
      .query('sessions')
      .withIndex('by_token', (q) => q.eq('token', token))
      .first()
    if (session) await ctx.db.delete(session._id)
    return null
  },
})

/**
 * Jetonun sahibi. Tarayıcı açılışta bunu sorar.
 *
 * Karma ve tuz ASLA dönülmez — tarayıcıya gitmelerinin hiçbir sebebi yok.
 */
export const me = query({
  args: { token: v.optional(v.string()) },
  returns: v.union(
    v.object({
      name: v.string(),
      role: v.string(),
      mustChangePassword: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, { token }) => {
    if (!token) return null
    const session = await ctx.db
      .query('sessions')
      .withIndex('by_token', (q) => q.eq('token', token))
      .first()
    if (!session || session.expiresAt <= Date.now()) return null
    const user = await ctx.db.get(session.userId)
    if (!user || !user.active) return null
    return {
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword === true,
    }
  },
})

/** Yöneticinin kullanıcı listesinde parolanın durumu görünsün. */
export const listWithPasswordState = guardedQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('users'),
      name: v.string(),
      email: v.optional(v.string()),
      role: v.string(),
      active: v.boolean(),
      hasPassword: v.boolean(),
      mustChangePassword: v.boolean(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const users = await ctx.db.query('users').collect()
    return users.map((user) => ({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
      hasPassword: !!user.passwordHash,
      mustChangePassword: user.mustChangePassword === true,
      createdAt: user.createdAt,
    }))
  },
})
