import { ConvexError, v } from 'convex/values'

import type { Id } from './_generated/dataModel'
import { internalQuery } from './_generated/server'
import { audit, diff } from './audit'
import { findSession } from './sessionStore'
import { userMutation, userQuery } from './guarded'
import { LEVELS, MODULES, areaInfo, canManageCompany, isPlatform } from '../src/lib/tenancy'

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
function roleLabel(u: { platformRole?: string; isCreator?: boolean; holdingId?: string; companyId?: string }) {
  if (u.platformRole === 'owner') return 'owner'
  if (u.platformRole === 'general') return 'general'
  if (u.holdingId && !u.companyId) return 'holding board'
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
    lastLoginAt: u.lastLoginAt ?? null,
    // Hatalı parola kilidi hâlâ sürüyor mu (creator yeni parola verince kalkar).
    locked: !!u.lockedUntil && u.lockedUntil > Date.now(),
    createdAt: u.createdAt,
    companyId: u.companyId ?? null,
    platformRole: u.platformRole ?? null,
    isCreator: u.isCreator === true,
    groupIds: u.groupIds ?? [],
    holdingId: u.holdingId ?? null,
    role: roleLabel(u),
  }
}

/**
 * Kullanıcının bütün açık oturumlarını kapatır (kayıp telefon, şüpheli giriş,
 * işten ayrılma): her cihazda yeniden giriş ister. Parola değişmez.
 */
export const signOutEverywhere = userMutation({
  args: { id: v.id('users') },
  returns: v.number(),
  handler: async (ctx, { id }) => {
    const me = ctx.sessionUser
    const user = await ctx.db.get(id)
    if (!user) throw new ConvexError('User not found')
    if (id !== me._id) {
      if (user.platformRole === 'owner') throw new ConvexError('Only the site owner can do this')
      if (isHoldingUser(user)) requirePlatformUser(me)
      else requireManager(me, user.platformRole ? null : user.companyId)
    }
    const n = await signOut(ctx.db, id)
    await audit(ctx.db, { actor: me.name, action: 'user.signout', target: user.name, detail: `${n} open session(s) closed`, companyId: user.companyId, holdingId: user.holdingId })
    return n
  },
})

/** My account: bu cihaz dışındaki bütün oturumlarımı kapat. */
export const signOutOtherDevices = userMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let n = 0
    for (const s of await ctx.db
      .query('sessions')
      .withIndex('by_user', (q: Any) => q.eq('userId', ctx.sessionUser._id))
      .collect()) {
      if (s._id === ctx.session._id) continue
      await ctx.db.delete(s._id)
      n++
    }
    if (n) await audit(ctx.db, { actor: ctx.sessionUser.name, action: 'user.signout', target: ctx.sessionUser.name, detail: `${n} other session(s) closed by the user`, companyId: ctx.sessionUser.companyId, holdingId: ctx.sessionUser.holdingId })
    return n
  },
})

/** My account: kaç cihazda açık oturumum var (bu dahil). */
export const mySessions = userQuery({
  args: {},
  returns: v.object({ open: v.number(), lastLoginAt: v.union(v.number(), v.null()) }),
  handler: async (ctx) => {
    const all = await ctx.db
      .query('sessions')
      .withIndex('by_user', (q: Any) => q.eq('userId', ctx.sessionUser._id))
      .collect()
    return { open: all.filter((s: Any) => s.expiresAt > Date.now()).length, lastLoginAt: ctx.sessionUser.lastLoginAt ?? null }
  },
})

/** Holding board üyesi (şirketsiz): yalnızca General yönetir. */
const isHoldingUser = (u: Any) => !!u.holdingId && !u.companyId && !u.platformRole

function requirePlatformUser(me: Any) {
  if (!isPlatform(me)) throw new ConvexError('Only a General can manage holding board members')
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
  args: { companyId: v.optional(v.union(v.id('companies'), v.null())), holdingId: v.optional(v.id('holdings')) },
  returns: v.any(),
  handler: async (ctx, { companyId, holdingId }) => {
    const me = ctx.sessionUser
    if (holdingId) {
      requirePlatformUser(me)
      const users: Any[] = await ctx.db
        .query('users')
        .withIndex('by_holding', (q: Any) => q.eq('holdingId', holdingId))
        .collect()
      return users.filter(isHoldingUser).map(row)
    }
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
    /** Holding board üyesi açılır (companyId null). */
    holdingId: v.optional(v.id('holdings')),
  },
  returns: v.id('users'),
  handler: async (ctx, args) => {
    const me = ctx.sessionUser
    if (args.holdingId) {
      requirePlatformUser(me)
      if (args.companyId) throw new ConvexError('A holding board member belongs to the holding, not to a company')
      if (!(await ctx.db.get(args.holdingId))) throw new ConvexError('Holding not found')
      const name = args.name.trim()
      if (!name) throw new ConvexError('A name is required')
      await nameFree(ctx.db, name)
      const hid = await ctx.db.insert('users', { name, email: args.email?.trim() || undefined, active: true, createdAt: Date.now(), holdingId: args.holdingId, role: 'holding board' })
      await audit(ctx.db, { actor: me.name, action: 'user.add', target: name, detail: 'holding board member', holdingId: args.holdingId })
      return hid
    }
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
    await audit(ctx.db, {
      actor: me.name,
      action: 'user.add',
      target: name,
      detail: args.companyId ? `${roleLabel(doc)}; groups: ${(await groupNames(ctx.db, groupIds)) || '—'}` : 'general',
      companyId: args.companyId ?? undefined,
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
  handler: async (ctx, args) => {
    const me = ctx.sessionUser
    const user = await ctx.db.get(args.id)
    if (!user) throw new ConvexError('User not found')
    if (user.platformRole === 'owner' && me._id !== user._id) throw new ConvexError('The site owner can only be changed by themselves')
    if (isHoldingUser(user)) requirePlatformUser(me)
    else requireManager(me, user.platformRole ? null : user.companyId)
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
    const detail = diff(
      { name: user.name, email: user.email, active: user.active, creator: user.isCreator === true, groups: await groupNames(ctx.db, user.groupIds ?? []) },
      { name, email: patch.email, active: args.active, ...(patch.groupIds ? { creator: patch.isCreator, groups: await groupNames(ctx.db, patch.groupIds) } : {}) },
    )
    if (detail) await audit(ctx.db, { actor: me.name, action: 'user.update', target: name, detail, companyId: user.companyId, holdingId: user.holdingId })
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
  handler: async (ctx, { id }) => {
    const me = ctx.sessionUser
    const user = await ctx.db.get(id)
    if (!user) return null
    if (user.platformRole === 'owner') throw new ConvexError('The site owner cannot be removed')
    if (id === me._id) throw new ConvexError('You cannot remove yourself')
    if (isHoldingUser(user)) requirePlatformUser(me)
    else requireManager(me, user.platformRole ? null : user.companyId)
    // Açık oturumlar da kapanır; eski kayıtlarda adı kalır.
    await signOut(ctx.db, id)
    await ctx.db.delete(id)
    await audit(ctx.db, { actor: me.name, action: 'user.remove', target: user.name, companyId: user.companyId, holdingId: user.holdingId })
    return null
  },
})

async function groupNames(db: Any, ids: string[]): Promise<string> {
  const names: string[] = []
  for (const id of ids) names.push((await db.get(id))?.name ?? '?')
  return names.sort().join(', ')
}

/** auth.setPasswordAsAdmin: oturum sahibi bu kullanıcının parolasını verebilir mi? */
export const canSetPassword = internalQuery({
  args: { token: v.string(), userId: v.id('users') },
  returns: v.object({ ok: v.boolean(), actor: v.string() }),
  handler: async (ctx, { token, userId }) => {
    const session = await findSession(ctx.db, token)
    if (!session || session.expiresAt <= Date.now()) return { ok: false, actor: '' }
    const me = await ctx.db.get(session.userId)
    const user = await ctx.db.get(userId)
    if (!me?.active || !user) return { ok: false, actor: '' }
    if (user.platformRole === 'owner') return { ok: me._id === user._id, actor: me.name }
    const ok = isHoldingUser(user)
      ? isPlatform(me)
      : user.platformRole
        ? me.platformRole === 'owner'
        : !!user.companyId && canManageCompany(me, user.companyId)
    return { ok, actor: me.name }
  },
})

// ---- Gruplar --------------------------------------------------------------------

export const listGroups = userQuery({
  args: { companyId: v.optional(v.id('companies')) },
  returns: v.any(),
  handler: async (ctx, { companyId }) => {
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
    /** Alan bazında seviye (AREAS); yazılmayan alan modülün seviyesini alır. */
    areas: v.optional(v.record(v.string(), levelValidator)),
    /** Board grubu: üyeleri özet görünümde (Board Dashboard, KPI / OEE dashboard'ları). */
    board: v.optional(v.boolean()),
  },
  returns: v.id('userGroups'),
  handler: async (ctx, args) => {
    requireManager(ctx.sessionUser, args.companyId)
    const name = args.name.trim()
    if (!name) throw new ConvexError('A group name is required')
    for (const p of args.plantIds) {
      const plant = await ctx.db.get(p)
      if (!plant || plant.companyId !== args.companyId) throw new ConvexError('A plant does not belong to this company')
    }
    // Yalnızca bilinen alanlar; modülün seviyesiyle aynı olan alan yazılmaz
    // (fazlalık: modül değişince alan da onunla değişsin).
    // Alanları göndermeyen eski ekran (Administration) grubun alanlarını silmez.
    const kept = args.areas === undefined && args.id ? ((await ctx.db.get(args.id))?.areas ?? {}) : (args.areas ?? {})
    const areas: Record<string, string> = {}
    for (const [key, level] of Object.entries(kept)) {
      const info = areaInfo(key)
      if (!info) throw new ConvexError(`Unknown permission area: ${key}`)
      if (level !== (args.permissions[info.module] ?? 'none')) areas[key] = level
    }
    const doc = {
      companyId: args.companyId,
      name,
      allPlants: args.allPlants,
      plantIds: args.allPlants ? [] : args.plantIds,
      permissions: args.permissions,
      areas,
      board: args.board === true,
    }
    const plantNames = async (g: Any) => (g.allPlants ? 'all' : (await Promise.all(g.plantIds.map(async (p: Id<'plants'>) => (await ctx.db.get(p))?.name ?? '?'))).sort().join(', '))
    const summary = async (g: Any) => ({
      name: g.name,
      plants: await plantNames(g),
      board: g.board === true,
      ...Object.fromEntries(MODULES.map((m) => [m, g.permissions?.[m] ?? 'none'])),
      ...Object.fromEntries(Object.entries(g.areas ?? {}).map(([k, l]) => [areaInfo(k)?.label ?? k, l])),
    })
    const actor = ctx.sessionUser.name
    if (args.id) {
      const old = await ctx.db.get(args.id)
      if (!old || old.companyId !== args.companyId) throw new ConvexError('Group not found')
      await ctx.db.patch(args.id, doc)
      const detail = diff(await summary(old), await summary(doc))
      if (detail) await audit(ctx.db, { actor, action: 'group.update', target: name, detail, companyId: args.companyId })
      return args.id
    }
    const gid = await ctx.db.insert('userGroups', { ...doc, createdAt: Date.now() })
    await audit(ctx.db, { actor, action: 'group.add', target: name, detail: diff({}, await summary(doc)), companyId: args.companyId })
    return gid
  },
})

export const removeGroup = userMutation({
  args: { id: v.id('userGroups') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const g = await ctx.db.get(id)
    if (!g) return null
    requireManager(ctx.sessionUser, g.companyId)
    const members = await ctx.db
      .query('users')
      .withIndex('by_company', (q: Any) => q.eq('companyId', g.companyId))
      .collect()
    for (const u of members) {
      if ((u.groupIds ?? []).includes(id)) await ctx.db.patch(u._id, { groupIds: (u.groupIds ?? []).filter((x) => x !== id) })
    }
    await ctx.db.delete(id)
    await audit(ctx.db, { actor: ctx.sessionUser.name, action: 'group.remove', target: g.name, companyId: g.companyId })
    return null
  },
})
