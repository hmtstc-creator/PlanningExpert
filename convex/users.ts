import { ConvexError, v } from 'convex/values'

import { internalQuery } from './_generated/server'
import { userMutation, userQuery } from './guarded'
import { LEVELS, MODULES, canManageCompany, isPlatform } from '../src/lib/tenancy'

/**
 * Kullanıcılar ve kullanıcı grupları — şirket seviyesinde
 * (docs/plant-genisletme.md, v3).
 *
 * - Şirket creator'ı kendi şirketinin kullanıcılarını açar (geçici şifre
 *   `auth.setPasswordAsAdmin` ile), creator atar ve grupları tanımlar.
 * - General bütün şirketlerde aynısını yapar; şirket ve fabrika açar
 *   (platform.ts).
 * - General'i yalnızca site sahibi (owner) ekler ya da çıkarır.
 *
 * Parolalar `auth.ts` içinde karma olarak, oturumlar `sessions` tablosunda.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const levelValidator = v.union(...LEVELS.map((l) => v.literal(l)))
const permissionsValidator = v.object(Object.fromEntries(MODULES.map((m) => [m, v.optional(levelValidator)])) as Any)

/** Ekranda gösterilen rol adı (kayıttaki `role` alanı yalnızca bilgi). */
function roleLabel(u: { platformRole?: string; isCreator?: boolean }) {
  if (u.platformRole === 'owner') return 'owner'
  if (u.platformRole === 'general') return 'general'
  return u.isCreator ? 'creator' : 'member'
}

function row(u: Any) {
  return {
    _id: u._id,
    name: u.name,
    email: u.email,
    active: u.active,
    hasPassword: !!u.passwordHash,
    mustChangePassword: u.mustChangePassword === true,
    createdAt: u.createdAt,
    companyId: u.companyId ?? null,
    platformRole: u.platformRole ?? null,
    isCreator: u.isCreator === true,
    groupIds: u.groupIds ?? [],
    role: roleLabel(u),
  }
}

function requireManager(me: Any, companyId: string | null | undefined) {
  if (!companyId) {
    if (me.platformRole !== 'owner') throw new ConvexError('Only the site owner can manage generals')
    return
  }
  if (!canManageCompany(me, companyId)) throw new ConvexError('Only a creator of this company can manage its users')
}

async function nameFree(db: Any, name: string, except?: string) {
  const clash = await db
    .query('users')
    .withIndex('by_name', (q: Any) => q.eq('name', name))
    .first()
  if (clash && clash._id !== except) throw new ConvexError(`A user named ${name} already exists`)
}

async function checkGroups(db: Any, companyId: string, groupIds: string[]) {
  for (const id of groupIds) {
    const g = await db.get(id)
    if (!g || g.companyId !== companyId) throw new ConvexError('A group does not belong to this company')
  }
}

/**
 * Şirketin kullanıcıları; `companyId` boşsa platform kullanıcıları (owner,
 * generaller — yalnızca platform görür).
 */
export const list = userQuery({
  args: { companyId: v.optional(v.union(v.id('companies'), v.null())) },
  returns: v.any(),
  handler: async (ctx: Any, { companyId }: Any) => {
    const me = ctx.sessionUser
    const target = companyId === undefined ? me.companyId : companyId
    if (!target) {
      if (!isPlatform(me)) throw new ConvexError('Only the platform can see platform users')
      return (await ctx.db.query('users').collect()).filter((u: Any) => isPlatform(u)).map(row)
    }
    if (!canManageCompany(me, target)) throw new ConvexError('Only a creator of this company can see its users')
    const users = await ctx.db
      .query('users')
      .withIndex('by_company', (q: Any) => q.eq('companyId', target))
      .collect()
    return users.map(row)
  },
})

/**
 * Kullanıcı açar. `companyId` boşsa General (yalnızca owner). Parolayı
 * ardından `auth.setPasswordAsAdmin` verir (geçici; ilk girişte değişir).
 */
export const add = userMutation({
  args: {
    companyId: v.union(v.id('companies'), v.null()),
    name: v.string(),
    email: v.optional(v.string()),
    isCreator: v.optional(v.boolean()),
    groupIds: v.optional(v.array(v.id('userGroups'))),
  },
  returns: v.id('users'),
  handler: async (ctx: Any, args: Any) => {
    const me = ctx.sessionUser
    requireManager(me, args.companyId)
    const name = args.name.trim()
    if (!name) throw new ConvexError('A name is required')
    await nameFree(ctx.db, name)
    const groupIds = args.companyId ? (args.groupIds ?? []) : []
    if (args.companyId) await checkGroups(ctx.db, args.companyId, groupIds)
    const doc = args.companyId
      ? { companyId: args.companyId, isCreator: args.isCreator === true, groupIds }
      : { platformRole: 'general' }
    const id = await ctx.db.insert('users', {
      name,
      email: args.email?.trim() || undefined,
      active: true,
      createdAt: Date.now(),
      ...doc,
      role: roleLabel(doc),
    })
    return id
  },
})

export const update = userMutation({
  args: {
    id: v.id('users'),
    name: v.string(),
    email: v.optional(v.string()),
    active: v.boolean(),
    isCreator: v.optional(v.boolean()),
    groupIds: v.optional(v.array(v.id('userGroups'))),
  },
  returns: v.null(),
  handler: async (ctx: Any, args: Any) => {
    const me = ctx.sessionUser
    const user = await ctx.db.get(args.id)
    if (!user) throw new ConvexError('User not found')
    if (user.platformRole === 'owner' && me._id !== user._id) throw new ConvexError('The site owner can only be changed by themselves')
    requireManager(me, user.platformRole ? null : user.companyId)
    const name = args.name.trim()
    if (!name) throw new ConvexError('A name is required')
    await nameFree(ctx.db, name, args.id)
    if (args.id === me._id && !args.active) throw new ConvexError('You cannot deactivate yourself')
    const patch: Any = { name, email: args.email?.trim() || undefined, active: args.active }
    if (user.companyId && !user.platformRole) {
      if (args.id === me._id && user.isCreator && args.isCreator === false) throw new ConvexError('You cannot remove your own creator right')
      const groupIds = args.groupIds ?? user.groupIds ?? []
      await checkGroups(ctx.db, user.companyId, groupIds)
      patch.isCreator = args.isCreator ?? user.isCreator === true
      patch.groupIds = groupIds
      patch.role = roleLabel({ isCreator: patch.isCreator })
    }
    await ctx.db.patch(args.id, patch)
    // Pasife alınan kullanıcının oturumu hemen bitmeli.
    if (!args.active) await signOut(ctx.db, args.id)
    return null
  },
})

async function signOut(db: Any, userId: string) {
  const sessions = await db
    .query('sessions')
    .withIndex('by_user', (q: Any) => q.eq('userId', userId))
    .collect()
  for (const s of sessions) await db.delete(s._id)
  return sessions.length
}

export const remove = userMutation({
  args: { id: v.id('users') },
  returns: v.null(),
  handler: async (ctx: Any, { id }: Any) => {
    const me = ctx.sessionUser
    const user = await ctx.db.get(id)
    if (!user) return null
    if (user.platformRole === 'owner') throw new ConvexError('The site owner cannot be removed')
    if (id === me._id) throw new ConvexError('You cannot remove yourself')
    requireManager(me, user.platformRole ? null : user.companyId)
    // Açık oturumlar da kapanır; eski kayıtlarda adı kalır.
    await signOut(ctx.db, id)
    await ctx.db.delete(id)
    return null
  },
})

/** auth.setPasswordAsAdmin: oturum sahibi bu kullanıcının parolasını verebilir mi? */
export const canSetPassword = internalQuery({
  args: { token: v.string(), userId: v.id('users') },
  returns: v.object({ ok: v.boolean(), actor: v.string() }),
  handler: async (ctx: Any, { token, userId }: Any) => {
    const session = await ctx.db
      .query('sessions')
      .withIndex('by_token', (q: Any) => q.eq('token', token))
      .first()
    if (!session || session.expiresAt <= Date.now()) return { ok: false, actor: '' }
    const me = await ctx.db.get(session.userId)
    const user = await ctx.db.get(userId)
    if (!me?.active || !user) return { ok: false, actor: '' }
    if (user.platformRole === 'owner') return { ok: me._id === user._id, actor: me.name }
    const ok = user.platformRole ? me.platformRole === 'owner' : !!user.companyId && canManageCompany(me, user.companyId)
    return { ok, actor: me.name }
  },
})

// ---- Gruplar --------------------------------------------------------------------

export const listGroups = userQuery({
  args: { companyId: v.optional(v.id('companies')) },
  returns: v.any(),
  handler: async (ctx: Any, { companyId }: Any) => {
    const me = ctx.sessionUser
    const target = companyId ?? me.companyId
    if (!target || !canManageCompany(me, target)) throw new ConvexError('Only a creator of this company can see its groups')
    return ctx.db
      .query('userGroups')
      .withIndex('by_company', (q: Any) => q.eq('companyId', target))
      .collect()
  },
})

export const saveGroup = userMutation({
  args: {
    id: v.optional(v.id('userGroups')),
    companyId: v.id('companies'),
    name: v.string(),
    allPlants: v.boolean(),
    plantIds: v.array(v.id('plants')),
    permissions: permissionsValidator,
  },
  returns: v.id('userGroups'),
  handler: async (ctx: Any, args: Any) => {
    requireManager(ctx.sessionUser, args.companyId)
    const name = args.name.trim()
    if (!name) throw new ConvexError('A group name is required')
    for (const p of args.plantIds) {
      const plant = await ctx.db.get(p)
      if (!plant || plant.companyId !== args.companyId) throw new ConvexError('A plant does not belong to this company')
    }
    const doc = { companyId: args.companyId, name, allPlants: args.allPlants, plantIds: args.allPlants ? [] : args.plantIds, permissions: args.permissions }
    if (args.id) {
      const old = await ctx.db.get(args.id)
      if (!old || old.companyId !== args.companyId) throw new ConvexError('Group not found')
      await ctx.db.patch(args.id, doc)
      return args.id
    }
    return ctx.db.insert('userGroups', { ...doc, createdAt: Date.now() })
  },
})

export const removeGroup = userMutation({
  args: { id: v.id('userGroups') },
  returns: v.null(),
  handler: async (ctx: Any, { id }: Any) => {
    const g = await ctx.db.get(id)
    if (!g) return null
    requireManager(ctx.sessionUser, g.companyId)
    const members = await ctx.db
      .query('users')
      .withIndex('by_company', (q: Any) => q.eq('companyId', g.companyId))
      .collect()
    for (const u of members) {
      if ((u.groupIds ?? []).includes(id)) await ctx.db.patch(u._id, { groupIds: u.groupIds.filter((x: string) => x !== id) })
    }
    await ctx.db.delete(id)
    return null
  },
})
