import { ConvexError, v } from 'convex/values'

import { internalMutation, internalQuery, query } from './_generated/server'
import { SESSION_TTL_MS, afterFailedLogin } from '../src/lib/authRules'
import { audit } from './audit'
import { findSession, sessionMatches, tokenKey } from './sessionStore'

/**
 * Girişin veritabanı tarafı.
 *
 * Parola karması Node çalışma ortamı gerektirdiği için `auth.ts` içindeki
 * action'larda üretiliyor; burası o action'ların çağırdığı iç işlevler ve
 * tarayıcının okuduğu tek genel sorgu.
 */

export const findUser = internalQuery({
  args: { name: v.string() },
  returns: v.any(),
  handler: async (ctx, { name }) => {
    const exact = await ctx.db
      .query('users')
      .withIndex('by_name', (q) => q.eq('name', name))
      .first()
    if (exact) return exact
    // Kullanıcı adı büyük/küçük harf ayırmaz: telefon klavyesi ilk harfi
    // büyük yazar ("Admin") ve giriş sebebi görünmeden reddediliyordu.
    // Kullanıcı tablosu küçük; tek tek bakmak sorun değil.
    const wanted = name.toLocaleLowerCase('en')
    const all = await ctx.db.query('users').take(1000)
    return all.find((u) => u.name.toLocaleLowerCase('en') === wanted) ?? null
  },
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
    passwordIterations: v.optional(v.number()),
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
      passwordIterations: args.passwordIterations,
      mustChangePassword: args.mustChangePassword,
      createdAt: Date.now(),
    })
    await ctx.db.insert('changeLog', {
      title: `User created — ${args.name}`,
      detail: `Role: ${args.role}.`,
      category: 'system',
      createdAt: Date.now(),
    })
    await audit(ctx.db, { actor: 'system (first setup)', action: 'user.add', target: args.name, detail: `role: ${args.role}` })
    return id
  },
})

export const storePassword = internalMutation({
  args: {
    id: v.id('users'),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    passwordIterations: v.optional(v.number()),
    mustChangePassword: v.boolean(),
    /** Parola değişince o kullanıcının diğer oturumları kapatılır. */
    keepToken: v.optional(v.string()),
    actor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.id)
    if (!user) throw new ConvexError('User not found')

    await ctx.db.patch(args.id, {
      passwordHash: args.passwordHash,
      passwordSalt: args.passwordSalt,
      // Yeni karma eski tekrar sayısıyla okunmasın (yoksa 120 000 sayılır).
      passwordIterations: args.passwordIterations,
      mustChangePassword: args.mustChangePassword,
      // Yeni parola kilidi ve sayacı kaldırır (creator kilitli hesabı böyle açar).
      failedLogins: undefined,
      lockedUntil: undefined,
    })

    // Parola değiştiyse eski oturumlar geçersizdir; çalınmış bir jetonun
    // parola değişince de çalışması kabul edilemez.
    const sessions = await ctx.db
      .query('sessions')
      .withIndex('by_user', (q) => q.eq('userId', args.id))
      .collect()
    for (const session of sessions) {
      if (args.keepToken && sessionMatches(session.token, args.keepToken)) continue
      await ctx.db.delete(session._id)
    }

    await ctx.db.insert('changeLog', {
      title: `Password changed — ${user.name}`,
      detail: 'Other sessions for this user were signed out.',
      category: 'system',
      author: args.actor,
      createdAt: Date.now(),
    })
    await audit(ctx.db, {
      actor: args.actor,
      action: args.actor === user.name ? 'password.change' : 'password.set',
      target: user.name,
      detail: args.mustChangePassword ? 'temporary password; must change at next sign-in' : undefined,
      companyId: user.companyId,
      holdingId: user.holdingId,
    })
    return null
  },
})

/** Hatalı parola: sayaç artar, sınırda hesap kilitlenir ve kayda yazılır. */
/** Girişte eski karmayı güncel ayarla değiştirir (oturumlara dokunmaz). */
export const upgradeHash = internalMutation({
  args: { id: v.id('users'), passwordHash: v.string(), passwordSalt: v.string(), passwordIterations: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, ...hash }) => {
    await ctx.db.patch(id, hash)
    return null
  },
})

export const recordLoginFailure = internalMutation({
  args: { id: v.id('users') },
  returns: v.object({ locked: v.boolean() }),
  handler: async (ctx, { id }) => {
    const user = await ctx.db.get(id)
    if (!user) return { locked: false }
    const next = afterFailedLogin(user, Date.now())
    await ctx.db.patch(id, { failedLogins: next.failedLogins, lockedUntil: next.lockedUntil ?? user.lockedUntil })
    if (next.locked) {
      await ctx.db.insert('changeLog', {
        title: `Sign-in locked — ${user.name}`,
        detail: 'Too many wrong passwords in a row; locked for 15 minutes.',
        category: 'system',
        createdAt: Date.now(),
      })
      await audit(ctx.db, { action: 'signin.locked', target: user.name, detail: 'too many wrong passwords; 15 minutes', companyId: user.companyId, holdingId: user.holdingId })
    }
    return { locked: next.locked }
  },
})

export const createSession = internalMutation({
  args: { userId: v.id('users'), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now()
    // Başarılı giriş sayacı sıfırlar.
    const user = await ctx.db.get(args.userId)
    await ctx.db.patch(args.userId, { failedLogins: undefined, lockedUntil: undefined, lastLoginAt: now })
    await ctx.db.insert('sessions', {
      // Jeton açık yazılmaz: yalnızca karması (sessionStore.ts).
      token: tokenKey(args.token),
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
    const session = await findSession(ctx.db, token)
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
    const session = await findSession(ctx.db, token)
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
