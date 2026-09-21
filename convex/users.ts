import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

/**
 * Kullanıcı kayıtları.
 *
 * DİKKAT — bu bir kimlik DOĞRULAMA değildir. Parola yok, oturum yok;
 * tarayıcıda seçilen kişi kaydın üzerine yazılır. Amacı "kim ne değiştirdi"
 * sorusunu cevaplamaktır, yetkisiz erişimi engellemek değil. Rol alanı da
 * aynı şekilde: ekranı düzenler, veriyi korumaz.
 *
 * Gerçek giriş (parola/SSO) ayrı bir iştir ve bu tablonun üstüne kurulur.
 */
const ROLES = ['admin', 'planner', 'maintenance', 'viewer']

const rowValidator = v.object({
  _id: v.id('users'),
  _creationTime: v.number(),
  name: v.string(),
  email: v.optional(v.string()),
  role: v.string(),
  active: v.boolean(),
  createdAt: v.number(),
})

export const list = query({
  args: {},
  returns: v.array(rowValidator),
  handler: async (ctx) => ctx.db.query('users').collect(),
})

export const add = mutation({
  args: { name: v.string(), email: v.optional(v.string()), role: v.string() },
  returns: v.id('users'),
  handler: async (ctx, args) => {
    const name = args.name.trim()
    if (!name) throw new Error('A name is required')
    if (!ROLES.includes(args.role)) throw new Error(`Unknown role: ${args.role}`)

    const existing = await ctx.db
      .query('users')
      .withIndex('by_name', (q) => q.eq('name', name))
      .first()
    if (existing) throw new Error(`A user named ${name} already exists`)

    const id = await ctx.db.insert('users', {
      name,
      email: args.email?.trim() || undefined,
      role: args.role,
      active: true,
      createdAt: Date.now(),
    })
    await ctx.db.insert('changeLog', {
      title: `User added — ${name}`,
      detail: `Role: ${args.role}.`,
      category: 'system',
      createdAt: Date.now(),
    })
    return id
  },
})

export const update = mutation({
  args: {
    id: v.id('users'),
    name: v.string(),
    email: v.optional(v.string()),
    role: v.string(),
    active: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const name = args.name.trim()
    if (!name) throw new Error('A name is required')
    if (!ROLES.includes(args.role)) throw new Error(`Unknown role: ${args.role}`)

    const clash = await ctx.db
      .query('users')
      .withIndex('by_name', (q) => q.eq('name', name))
      .first()
    if (clash && clash._id !== args.id) throw new Error(`A user named ${name} already exists`)

    await ctx.db.patch(args.id, {
      name,
      email: args.email?.trim() || undefined,
      role: args.role,
      active: args.active,
    })

    // Pasife alınan kullanıcının oturumu hemen bitmeli. `me` zaten pasifi
    // tanımıyor, ama jetonu ortada bırakmanın bir sebebi yok.
    if (!args.active) {
      const sessions = await ctx.db
        .query('sessions')
        .withIndex('by_user', (q) => q.eq('userId', args.id))
        .collect()
      for (const session of sessions) await ctx.db.delete(session._id)
    }
    return null
  },
})

export const remove = mutation({
  args: { id: v.id('users') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)

    // Açık oturumları da kapat. Silinen kullanıcının jetonu süresi dolana
    // kadar çalışmaya devam etseydi, silmek hiçbir şey ifade etmezdi.
    const sessions = await ctx.db
      .query('sessions')
      .withIndex('by_user', (q) => q.eq('userId', id))
      .collect()
    for (const session of sessions) await ctx.db.delete(session._id)

    await ctx.db.delete(id)
    if (row) {
      await ctx.db.insert('changeLog', {
        title: `User removed — ${row.name}`,
        detail:
          'Their earlier entries keep their name; only the account is gone. ' +
          `${sessions.length} open session(s) were signed out.`,
        category: 'system',
        createdAt: Date.now(),
      })
    }
    return null
  },
})
