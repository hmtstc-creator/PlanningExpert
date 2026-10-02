import { ConvexError, v } from 'convex/values'

import { userMutation, userQuery } from './guarded'
import { MODULES, canManageCompany, isPlatform } from '../src/lib/tenancy'

/**
 * Platform ve şirket yapısı (docs/plant-genisletme.md, v3):
 * - General: şirket açar, askıya alır, modül (kiralama paketi) açar/kapar,
 *   bütün şirketleri görür.
 * - Creator: kendi şirketine fabrika ekler ve fabrikayı düzenler.
 * - Fabrikada modül kapatmak (disabledModules) General'in işidir.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** Askıya alınan şirketin verisi bu kadar gün sonra kalıcı silinebilir. */
export const DELETE_AFTER_DAYS = 90

const moduleList = v.array(v.union(...MODULES.map((m) => v.literal(m))))

function requirePlatform(me: Any) {
  if (!isPlatform(me)) throw new ConvexError('Only a General can do this')
}

/** General: bütün şirketler; creator: kendi şirketi. Fabrikaları ve kullanıcı sayısıyla. */
export const companies = userQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx: Any) => {
    const me = ctx.sessionUser
    const all: Any[] = isPlatform(me)
      ? await ctx.db.query('companies').collect()
      : me.isCreator && me.companyId
        ? [await ctx.db.get(me.companyId)].filter(Boolean)
        : []
    const out: Any[] = []
    for (const c of all) {
      const plants = await ctx.db
        .query('plants')
        .withIndex('by_company', (q: Any) => q.eq('companyId', c._id))
        .collect()
      const users = await ctx.db
        .query('users')
        .withIndex('by_company', (q: Any) => q.eq('companyId', c._id))
        .collect()
      out.push({
        ...c,
        plants,
        userCount: users.length,
        creators: users.filter((u: Any) => u.isCreator).map((u: Any) => u.name),
      })
    }
    return out
  },
})

export const createCompany = userMutation({
  args: { name: v.string(), modules: moduleList },
  returns: v.id('companies'),
  handler: async (ctx: Any, { name, modules }: Any) => {
    requirePlatform(ctx.sessionUser)
    if (!name.trim()) throw new ConvexError('A company name is required')
    return ctx.db.insert('companies', { name: name.trim(), status: 'active', modules, createdAt: Date.now() })
  },
})

/**
 * Ad, modüller, durum. Askıya alınca herkes salt okunur görür; silme tarihi
 * 90 gün sonrası. Yeniden açılınca silme tarihi kalkar.
 */
export const updateCompany = userMutation({
  args: { id: v.id('companies'), name: v.string(), modules: moduleList, status: v.union(v.literal('active'), v.literal('suspended')) },
  returns: v.null(),
  handler: async (ctx: Any, args: Any) => {
    requirePlatform(ctx.sessionUser)
    const c = await ctx.db.get(args.id)
    if (!c) throw new ConvexError('Company not found')
    if (!args.name.trim()) throw new ConvexError('A company name is required')
    const now = Date.now()
    const status =
      args.status === c.status
        ? {}
        : args.status === 'suspended'
          ? { suspendedAt: now, deleteAfter: now + DELETE_AFTER_DAYS * 86_400_000 }
          : { suspendedAt: undefined, deleteAfter: undefined }
    await ctx.db.patch(args.id, { name: args.name.trim(), modules: args.modules, status: args.status, ...status })
    return null
  },
})

/** Fabrika ekler: General ya da şirketin creator'ı. Boş başlar (veri ve ayar yok). */
export const createPlant = userMutation({
  args: {
    companyId: v.id('companies'),
    name: v.string(),
    code: v.optional(v.string()),
    country: v.optional(v.string()),
    timeZone: v.optional(v.string()),
  },
  returns: v.id('plants'),
  handler: async (ctx: Any, args: Any) => {
    if (!canManageCompany(ctx.sessionUser, args.companyId)) throw new ConvexError('Only a creator of this company can add a plant')
    const company = await ctx.db.get(args.companyId)
    if (!company) throw new ConvexError('Company not found')
    if (company.status !== 'active') throw new ConvexError('The company is suspended')
    if (!args.name.trim()) throw new ConvexError('A plant name is required')
    return ctx.db.insert('plants', {
      companyId: args.companyId,
      name: args.name.trim(),
      code: args.code?.trim() || undefined,
      country: args.country?.trim() || undefined,
      timeZone: args.timeZone?.trim() || undefined,
      createdAt: Date.now(),
    })
  },
})

export const updatePlant = userMutation({
  args: {
    id: v.id('plants'),
    name: v.string(),
    code: v.optional(v.string()),
    country: v.optional(v.string()),
    timeZone: v.optional(v.string()),
    /** Yalnızca General değiştirebilir. */
    disabledModules: v.optional(moduleList),
  },
  returns: v.null(),
  handler: async (ctx: Any, args: Any) => {
    const me = ctx.sessionUser
    const plant = await ctx.db.get(args.id)
    if (!plant) throw new ConvexError('Plant not found')
    if (!canManageCompany(me, plant.companyId)) throw new ConvexError('Only a creator of this company can change the plant')
    if (!args.name.trim()) throw new ConvexError('A plant name is required')
    const patch: Any = {
      name: args.name.trim(),
      code: args.code?.trim() || undefined,
      country: args.country?.trim() || undefined,
      timeZone: args.timeZone?.trim() || undefined,
    }
    if (args.disabledModules !== undefined) {
      const same = JSON.stringify([...args.disabledModules].sort()) === JSON.stringify([...(plant.disabledModules ?? [])].sort())
      if (!same) {
        requirePlatform(me)
        patch.disabledModules = args.disabledModules
      }
    }
    await ctx.db.patch(args.id, patch)
    return null
  },
})
