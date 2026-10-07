import { ConvexError, v } from 'convex/values'

import type { GenericDatabaseReader, GenericDatabaseWriter, Scheduler, StorageReader, StorageWriter } from 'convex/server'
import type { ObjectType, PropertyValidators } from 'convex/values'

import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import type { DataModel } from './_generated/dataModel'
import type { Doc, LockedDb } from './lockedDbTypes'
import { requireSession } from './authGuard'
import { stampAuthor } from '../src/lib/authorFields'
import { plantDb } from './plantDb'
import { markPlanChanged } from './planQueue'
import schema from './schema'
import {
  NO_ACCESS,
  allows,
  allowsAreas,
  areaAccessFor,
  areaInfo,
  canManageCompany,
  canSeePlant,
  isPlatform,
  moduleAccessOf,
  MODULE_LABELS,
  type Access,
  type AreaAccess,
  type AreaKey,
  type Module,
} from '../src/lib/tenancy'

/**
 * Oturum ve fabrika denetimi yapan `query` / `mutation` sarmalayıcıları.
 *
 * Yüz küsur işlevin her birinin gövdesine elle denetim eklemek yerine
 * tanımın kendisi sarmalanıyor: çağrı `query(...)` yerine
 * `guardedQuery(...)` oluyor, gerisi aynı kalıyor. Böylece hiçbir handler
 * kesilip biçilmiyor ve bir işlevin korumasız kaldığı tek yerden görülüyor
 * — dosyada `query(` kalmışsa korumasızdır.
 *
 * Her istekte: kullanıcı → oturumdaki fabrika (yoksa ilk yetkili fabrika)
 * → kullanıcının o fabrikadaki modül izni (docs/plant-genisletme.md).
 * Handler'a yalnızca o fabrikaya kilitli veritabanı gider (plantDb.ts);
 * ayrıca `ctx.plantId`, `ctx.sessionUser`, `ctx.access`.
 *
 * `modules`: işlevin ait olduğu modüller; biri yeterli (okumada "görür",
 * yazmada "düzenler"). Varsayılan PlanningExpert.
 *
 * Denetimden muaf olması GEREKEN işlevler (giriş, ilk kurulum, çıkış ve
 * jetonun sahibini söyleyen sorgu) bilerek sarmalanmıyor; onlar `auth.ts`
 * ve `authInternal.ts` içinde ve orada gerekçesi yazıyor.
 */

// Convex'in üretilen tipleri bu ortamda yok; sarmalayıcı gevşek tiplenmiş.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

export const TABLES: readonly string[] = Object.keys((schema as Any).tables)

export const ALL_MODULES: readonly Module[] = ['planning', 'oee', 'die', 'machine', 'kpi']
export const KPI: readonly Module[] = ['kpi']
export const DIE_OR_PLANNING: readonly Module[] = ['die', 'planning']
export const MACHINE_OR_PLANNING: readonly Module[] = ['machine', 'planning']
export const OEE: readonly Module[] = ['oee']

function withSessionArg(args: Any): Any {
  return { ...(args ?? {}), token: v.optional(v.string()) }
}

/**
 * Jeton yalnızca denetim içindir; handler'a gitmez. Gitseydi `args`'ı olduğu
 * gibi kayda yazan işlevler (ör. `ctx.db.patch(id, args)`) şemada olmayan
 * bir `token` alanı yazmaya kalkar ve hata verirdi.
 */
function withoutToken(args: Any): Any {
  const { token: _token, ...rest } = args ?? {}
  return rest
}

export interface PlantContext {
  plant: Doc<'plants'>
  company: Doc<'companies'>
  access: Access
  /** Alan izinleri (AREAS); `access` bunların modül özeti. */
  areas: AreaAccess
}

/** Fabrikadaki izinler: alanlar ve modül özeti. */
function permissionsIn(user: Any, plant: Any, company: Any, g: Any[]): { access: Access; areas: AreaAccess } {
  const areas = areaAccessFor(user, plant, company, g)
  return { areas, access: moduleAccessOf(areas) }
}

/** Şirketin grupları (kullanıcı grubu izinleri için). */
async function groupsOf(db: Any, companyId: string): Promise<Any[]> {
  return db
    .query('userGroups')
    .withIndex('by_company', (q: Any) => q.eq('companyId', companyId))
    .collect()
}

/** Kullanıcının görebildiği fabrikalar, izinleriyle. Ham (kilitsiz) veritabanı. */
export async function visiblePlants(db: Any, user: Any): Promise<PlantContext[]> {
  const holdingCompanies: Any[] =
    !isPlatform(user) && user.holdingId && !user.companyId
      ? await db
          .query('companies')
          .withIndex('by_holding', (q: Any) => q.eq('holdingId', user.holdingId))
          .collect()
      : []
  const byCompany = async (companyId: string) =>
    db
      .query('plants')
      .withIndex('by_company', (q: Any) => q.eq('companyId', companyId))
      .collect()
  const plants: Any[] = isPlatform(user)
    ? await db.query('plants').collect()
    : holdingCompanies.length
      ? (await Promise.all(holdingCompanies.map((c) => byCompany(c._id)))).flat()
      : user.companyId
      ? await db
          .query('plants')
          .withIndex('by_company', (q: Any) => q.eq('companyId', user.companyId))
          .collect()
      : []
  const companies = new Map<string, Any>()
  const groups = new Map<string, Any[]>()
  const out: PlantContext[] = []
  for (const plant of plants) {
    if (!companies.has(plant.companyId)) companies.set(plant.companyId, await db.get(plant.companyId))
    const company = companies.get(plant.companyId)
    if (!company) continue
    if (!groups.has(plant.companyId)) groups.set(plant.companyId, await groupsOf(db, plant.companyId))
    const g = groups.get(plant.companyId)!
    if (!canSeePlant(user, plant, company, g)) continue
    out.push({ plant, company, ...permissionsIn(user, plant, company, g) })
  }
  return out
}

/** Oturumdaki fabrika; yoksa ya da yetki kalktıysa ilk yetkili fabrika. */
export async function activePlant(db: Any, user: Any, session: Any): Promise<PlantContext | null> {
  if (session.plantId) {
    const plant = await db.get(session.plantId)
    if (plant) {
      const company = await db.get(plant.companyId)
      if (company) {
        const g = await groupsOf(db, plant.companyId)
        if (canSeePlant(user, plant, company, g)) return { plant, company, ...permissionsIn(user, plant, company, g) }
      }
    }
  }
  return (await visiblePlants(db, user))[0] ?? null
}

async function migrationPending(db: Any): Promise<boolean> {
  const state = await db
    .query('platformState')
    .withIndex('by_key', (q: Any) => q.eq('key', 'plantMigration'))
    .first()
  return !state?.value?.done
}

async function plantContext(ctx: Any, token: string | undefined) {
  const { user, session } = await requireSession(ctx, token)
  if (await migrationPending(ctx.db)) {
    throw new ConvexError('The data is being prepared for multiple plants — please wait a moment')
  }
  const active = await activePlant(ctx.db, user, session)
  if (!active) throw new ConvexError('Your account has no plant yet — ask your company creator')
  return { user, ...active }
}

function needModules(spec: Any): readonly Module[] {
  return spec.modules ?? ['planning']
}

function denied(modules: readonly Module[], need: string, access: Access): never {
  const names = modules.join(' or ')
  const have = modules.map((m) => `${m}: ${access[m] ?? 'none'}`).join(', ')
  throw new ConvexError(`This needs ${need} permission on ${names} — you have ${have}`)
}

function deniedArea(keys: readonly AreaKey[], areas: AreaAccess): never {
  const names = keys.map((k) => `${areaInfo(k)!.label} (${MODULE_LABELS[areaInfo(k)!.module]})`).join(' or ')
  const have = keys.map((k) => `${areaInfo(k)!.label}: ${areas[k] ?? 'none'}`).join(', ')
  throw new ConvexError(`This needs edit permission on ${names} — you have ${have}`)
}

function scopedCtx(ctx: Any, c: { user: Any; plant: Any; company: Any; access: Access; areas: AreaAccess }): Any {
  return {
    ...ctx,
    db: plantDb(ctx.db, c.plant._id, TABLES),
    plantId: c.plant._id,
    plant: c.plant,
    company: c.company,
    access: c.access,
    areas: c.areas,
    sessionUser: c.user,
  }
}

/**
 * Korumalı işlevin bağlamı: fabrikaya kilitli tipli veritabanı, seçili
 * fabrika, şirket, izinler ve oturumdaki kullanıcı.
 */
export interface GuardedQueryCtx {
  db: LockedDb
  plantId: Doc<'plants'>['_id']
  plant: Doc<'plants'>
  company: Doc<'companies'>
  access: Access
  /** Alan izinleri (src/lib/tenancy.ts → AREAS). */
  areas: AreaAccess
  sessionUser: Doc<'users'>
  storage: StorageReader
}

export interface GuardedMutationCtx extends Omit<GuardedQueryCtx, 'storage'> {
  storage: StorageWriter
  scheduler: Scheduler
}

interface GuardedSpec<A extends PropertyValidators, C> {
  modules?: readonly Module[]
  /**
   * Yazma işlevinin yetki alanları (biri yeterli). Verilirse izin alandan
   * denetlenir; verilmezse modülden (herhangi bir alanı düzenleyen yazar).
   */
  areas?: readonly AreaKey[]
  args: A
  returns?: Any
  handler: (ctx: C, args: ObjectType<A>) => Any
}

/** Fabrika verisini okuyan sorgu: modüllerden birinde en az "görür". */
export function guardedQuery<A extends PropertyValidators>(spec: GuardedSpec<A, GuardedQueryCtx>): Any {
  const { modules: _m, areas: _a, ...definition } = spec
  const modules = needModules(spec)
  return query({
    ...definition,
    args: withSessionArg(definition.args),
    handler: async (ctx: Any, args: Any) => {
      const c = await plantContext(ctx, args.token)
      if (!allows(c.access, modules, 'view')) denied(modules, 'view', c.access)
      return definition.handler(scopedCtx(ctx, c), withoutToken(args))
    },
  })
}

/**
 * Yazma işlemi: modüllerden birinde "düzenler". Askıdaki şirkette kimse
 * düzenleyemez (izinler "görür"e iner).
 */
export function guardedMutation<A extends PropertyValidators>(
  spec: GuardedSpec<A, GuardedMutationCtx> & { affectsPlan?: boolean },
  opts: { companyAdmin?: boolean } = {},
): Any {
  // `affectsPlan: false` — planın okumadığı veriyi yazan işlevler (kullanıcılar,
  // kalıp problemleri, sözlükler…) planı yeniden hesaplatmaz.
  const { affectsPlan = true, modules: _m, areas, ...definition } = spec
  const modules = needModules(spec)
  return mutation({
    ...definition,
    args: withSessionArg(definition.args),
    handler: async (ctx: Any, args: Any) => {
      const c = await plantContext(ctx, args.token)
      if (areas?.length) {
        if (!allowsAreas(c.areas, areas, 'edit')) deniedArea(areas, c.areas)
      } else if (!allows(c.access, modules, 'edit')) denied(modules, 'edit', c.access)
      if (opts.companyAdmin && !canManageCompany(c.user, c.plant.companyId)) {
        throw new ConvexError('Only a company creator can do this')
      }
      const scoped = scopedCtx(ctx, c)
      // Yazanın kim olduğu handler'a `ctx.sessionUser` olarak gider (ör.
      // "bu dosyayı kim yükledi"); jetonun kendisi gitmez.
      // "Kim yaptı" alanları oturumdan (src/lib/authorFields.ts): tarayıcıdan gelen ad yok sayılır.
      const result = await definition.handler(scoped, stampAuthor(definition.args, withoutToken(args), c.user.name))
      // Plan elle hesaplanır (Planning → Calculate plan): girdisi değişince
      // yalnızca "güncel değil" işareti konur, hesap kurulmaz.
      if (affectsPlan) await markPlanChanged(scoped)
      return result
    },
  })
}

/** Yalnızca şirket creator'ının (ya da platformun) yapabileceği fabrika işleri. */
export function adminMutation(spec: Any): Any {
  return guardedMutation(spec, { companyAdmin: true })
}

/**
 * Fabrikadan bağımsız (platform / şirket yönetimi) işlevler: yalnızca oturum
 * denetlenir, veritabanı kilitsizdir. Yetkiyi handler kendisi denetler
 * (`ctx.sessionUser`, src/lib/tenancy.ts). Yalnızca convex/tenancy.ts.
 */
/** Platform işlevinin bağlamı: kilitsiz (ham) veritabanı ve oturumdaki kullanıcı. */
export interface UserQueryCtx {
  db: GenericDatabaseReader<DataModel>
  sessionUser: Doc<'users'>
  session: Doc<'sessions'>
  storage: StorageReader
}

export interface UserMutationCtx extends Omit<UserQueryCtx, 'db' | 'storage'> {
  db: GenericDatabaseWriter<DataModel>
  storage: StorageWriter
  scheduler: Scheduler
}

/** Sunucu içi fabrika işlevinin bağlamı (plan motoru, zamanlayıcı). */
export interface PlantInternalQueryCtx {
  db: LockedDb
  plantId: Doc<'plants'>['_id']
  storage: StorageReader
}

export interface PlantInternalMutationCtx extends Omit<PlantInternalQueryCtx, 'storage'> {
  storage: StorageWriter
  scheduler: Scheduler
}

interface PlainSpec<A extends PropertyValidators, C> {
  args: A
  returns?: Any
  handler: (ctx: C, args: ObjectType<A>) => Any
}

export function userQuery<A extends PropertyValidators>(spec: PlainSpec<A, UserQueryCtx>): Any {
  return query({
    ...spec,
    args: withSessionArg(spec.args),
    handler: async (ctx: Any, args: Any) => {
      const { user, session } = await requireSession(ctx, args.token)
      return spec.handler({ ...ctx, sessionUser: user, session }, withoutToken(args))
    },
  })
}

export function userMutation<A extends PropertyValidators>(spec: PlainSpec<A, UserMutationCtx>): Any {
  return mutation({
    ...spec,
    args: withSessionArg(spec.args),
    handler: async (ctx: Any, args: Any) => {
      const { user, session } = await requireSession(ctx, args.token)
      return spec.handler({ ...ctx, sessionUser: user, session }, withoutToken(args))
    },
  })
}

/**
 * Sunucu içi (plan motoru, zamanlayıcı) fabrika işlevleri: `plantId`
 * argümanı zorunlu, veritabanı o fabrikaya kilitli.
 */
export function plantInternalQuery<A extends PropertyValidators>(spec: PlainSpec<A, PlantInternalQueryCtx>): Any {
  return internalQuery({
    ...spec,
    args: { ...(spec.args ?? {}), plantId: v.id('plants') },
    handler: async (ctx: Any, { plantId, ...args }: Any) =>
      spec.handler({ ...ctx, db: plantDb(ctx.db, plantId, TABLES), plantId }, args),
  })
}

export function plantInternalMutation<A extends PropertyValidators>(spec: PlainSpec<A, PlantInternalMutationCtx>): Any {
  return internalMutation({
    ...spec,
    args: { ...(spec.args ?? {}), plantId: v.id('plants') },
    handler: async (ctx: Any, { plantId, ...args }: Any) =>
      spec.handler({ ...ctx, db: plantDb(ctx.db, plantId, TABLES), plantId }, args),
  })
}

export { NO_ACCESS }
