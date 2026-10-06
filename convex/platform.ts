import { ConvexError, v } from 'convex/values'

import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalMutation } from './_generated/server'
import { audit, diff } from './audit'
import { TABLES, userMutation, userQuery } from './guarded'
import { isPlantTable } from './plantDb'
import { MODULES, canManageCompany, isPlatform } from '../src/lib/tenancy'
import { securityOverview as buildSecurityOverview, type SecurityUser } from '../src/lib/securityOverview'
import { SIGNIN_BUCKET_MS } from '../src/lib/signinGuard'
import { effectiveShifts, normalizeShifts, shiftLabel, shiftProblems, type ShiftDef } from '../src/lib/shifts'

/**
 * Platform ve şirket yapısı (docs/plant-genisletme.md, v3; ağaç: docs/board.md):
 * Holding → Company → Plant → Department → Cost center, tepeden aşağı kurulur.
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
const costCenterList = v.array(v.object({ code: v.string(), name: v.string(), department: v.optional(v.string()) }))

type CostCenter = { code: string; name: string; department?: string }

/** Bölümler: ad zorunlu ve fabrikada tek (büyük/küçük harf fark etmez). */
function checkDepartments(list: string[]) {
  const out: string[] = []
  for (const raw of list) {
    const name = raw.trim()
    if (!name) throw new ConvexError('A department needs a name')
    if (out.some((x) => x.toLowerCase() === name.toLowerCase())) throw new ConvexError(`Department ${name} is listed twice`)
    out.push(name)
  }
  return out
}

/**
 * Masraf yerleri: kod zorunlu ve fabrikada tek; ad boşsa kod. Bölüm verilirse
 * fabrikanın bölümlerinden biri olmalı; yeni eklenen masraf yeri (önceki
 * listede olmayan kod) bölümsüz kaydedilmez — her masraf yeri bir bölüme
 * aittir. Eski bölümsüz kayıtlar bir bölüme taşınana kadar kalabilir.
 */
function checkCostCenters(list: CostCenter[], departments: string[], before: CostCenter[]) {
  const known = new Set(before.map((c) => c.code))
  const out: CostCenter[] = []
  for (const cc of list) {
    const code = cc.code.trim()
    if (!code) throw new ConvexError('A cost center needs a code')
    if (out.some((x) => x.code === code)) throw new ConvexError(`Cost center ${code} is listed twice`)
    const department = cc.department?.trim() || undefined
    if (department && !departments.includes(department)) throw new ConvexError(`Cost center ${code}: department ${department} is not a department of this plant`)
    if (!department && !known.has(code)) throw new ConvexError(`Cost center ${code}: choose its department`)
    out.push({ code, name: cc.name.trim() || code, ...(department ? { department } : {}) })
  }
  return out
}

/**
 * Ülke (ISO kodu, resmi tatiller için) ve saat dilimi (IANA) fabrikanın tek
 * kaynağıdır; kodda fabrikaya özel varsayılan yok — açılışta istenir.
 */
function checkLocale(country: string, timeZone: string) {
  const c = country.trim().toUpperCase()
  const tz = timeZone.trim()
  if (!/^[A-Z]{2}$/.test(c)) throw new ConvexError('Country: a two-letter code, e.g. RO, TR, DE')
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
  } catch {
    throw new ConvexError('Time zone: an IANA name, e.g. Europe/Bucharest, Europe/Istanbul')
  }
  if (!tz) throw new ConvexError('Time zone is required')
  return { country: c, timeZone: tz }
}

/** Şirket adı platformda, fabrika adı şirket içinde tektir (seçicide tekrar olmasın). */
async function companyNameFree(db: Any, name: string, except?: string) {
  const all: Any[] = await db.query('companies').collect()
  if (all.some((c) => c._id !== except && c.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new ConvexError(`A company named ${name} already exists`)
  }
}

async function plantNameFree(db: Any, companyId: string, name: string, except?: string) {
  const plants: Any[] = await db
    .query('plants')
    .withIndex('by_company', (q: Any) => q.eq('companyId', companyId))
    .collect()
  if (plants.some((p) => p._id !== except && p.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new ConvexError(`${name} already exists in this company — add its cost centers to that plant instead of a second plant`)
  }
}

/** Fabrikanın work center'ları (ad + masraf yeri), ada göre. */
async function workCentersOf(db: Any, plantId: string): Promise<{ name: string; costCenter?: string }[]> {
  const rows: Any[] = await db
    .query('presses')
    .withIndex('by_name', (q: Any) => q.eq('plantId', plantId))
    .collect()
  return rows.map((r) => ({ name: r.name, ...(r.costCenter ? { costCenter: r.costCenter } : {}) }))
}

/** Denetim kaydı için plant'in okunur özeti (eski → yeni karşılaştırılır). */
function plantSummary(p: Any) {
  return {
    name: p.name,
    country: p.country,
    timeZone: p.timeZone,
    modulesOff: [...(p.disabledModules ?? [])].sort(),
    departments: p.departments ?? [],
    costCenters: (p.costCenters ?? []).map((c: CostCenter) => `${c.code} ${c.name}${c.department ? ` (${c.department})` : ''}`),
  }
}

function requirePlatform(me: Any) {
  if (!isPlatform(me)) throw new ConvexError('Only a General can do this')
}

/** General: bütün şirketler; creator: kendi şirketi. Fabrikaları ve kullanıcı sayısıyla. */
export const companies = userQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const me = ctx.sessionUser
    const all: Any[] = isPlatform(me)
      ? await ctx.db.query('companies').collect()
      : me.isCreator && me.companyId
        ? [await ctx.db.get(me.companyId)].filter(Boolean)
        : []
    const out: Any[] = []
    for (const c of all) {
      const plantDocs: Any[] = await ctx.db
        .query('plants')
        .withIndex('by_company', (q: Any) => q.eq('companyId', c._id))
        .collect()
      // Work center'lar ağacın en alt seviyesi: masraf yerine bağlı (organizasyon teyidi).
      const plants: Any[] = []
      for (const p of plantDocs) plants.push({ ...p, workCenters: await workCentersOf(ctx.db, p._id) })
      const users = await ctx.db
        .query('users')
        .withIndex('by_company', (q: Any) => q.eq('companyId', c._id))
        .collect()
      const holding = c.holdingId ? await ctx.db.get(c.holdingId as Id<'holdings'>) : null
      out.push({
        ...c,
        holdingName: holding?.name ?? null,
        plants,
        userCount: users.length,
        creators: users.filter((u: Any) => u.isCreator).map((u: Any) => u.name),
      })
    }
    return out
  },
})

/** Şirket bir holding'in altında açılır: önce holding tanımlanır. */
export const createCompany = userMutation({
  args: { name: v.string(), modules: moduleList, holdingId: v.id('holdings') },
  returns: v.id('companies'),
  handler: async (ctx, { name, modules, holdingId }) => {
    requirePlatform(ctx.sessionUser)
    if (!(await ctx.db.get(holdingId))) throw new ConvexError('Holding not found — add the holding first')
    if (!name.trim()) throw new ConvexError('A company name is required')
    await companyNameFree(ctx.db, name.trim())
    const id = await ctx.db.insert('companies', { name: name.trim(), status: 'active', modules, holdingId, createdAt: Date.now() })
    await audit(ctx.db, { actor: ctx.sessionUser.name, action: 'company.add', target: name.trim(), detail: `modules: ${modules.join(', ') || '—'}`, companyId: id, holdingId })
    return id
  },
})

/**
 * Ad, modüller, durum. Askıya alınca herkes salt okunur görür; silme tarihi
 * 90 gün sonrası. Yeniden açılınca silme tarihi kalkar.
 */
export const updateCompany = userMutation({
  args: { id: v.id('companies'), name: v.string(), modules: moduleList, status: v.union(v.literal('active'), v.literal('suspended')) },
  returns: v.null(),
  handler: async (ctx, args) => {
    requirePlatform(ctx.sessionUser)
    const c = await ctx.db.get(args.id)
    if (!c) throw new ConvexError('Company not found')
    if (!args.name.trim()) throw new ConvexError('A company name is required')
    await companyNameFree(ctx.db, args.name.trim(), args.id)
    const now = Date.now()
    const status =
      args.status === c.status
        ? {}
        : args.status === 'suspended'
          ? { suspendedAt: now, deleteAfter: now + DELETE_AFTER_DAYS * 86_400_000 }
          : { suspendedAt: undefined, deleteAfter: undefined }
    await ctx.db.patch(args.id, { name: args.name.trim(), modules: args.modules, status: args.status, ...status })
    const detail = diff({ name: c.name, modules: [...c.modules].sort(), status: c.status }, { name: args.name.trim(), modules: [...args.modules].sort(), status: args.status })
    if (detail) await audit(ctx.db, { actor: ctx.sessionUser.name, action: 'company.update', target: args.name.trim(), detail, companyId: args.id, holdingId: c.holdingId })
    return null
  },
})

/** Fabrika ekler: General ya da şirketin creator'ı. Boş başlar (veri ve ayar yok). */
export const createPlant = userMutation({
  args: {
    companyId: v.id('companies'),
    name: v.string(),
    code: v.optional(v.string()),
    country: v.string(),
    timeZone: v.string(),
    departments: v.optional(v.array(v.string())),
    costCenters: v.optional(costCenterList),
  },
  returns: v.id('plants'),
  handler: async (ctx, args) => {
    if (!canManageCompany(ctx.sessionUser, args.companyId)) throw new ConvexError('Only a creator of this company can add a plant')
    const company = await ctx.db.get(args.companyId)
    if (!company) throw new ConvexError('Company not found')
    if (company.status !== 'active') throw new ConvexError('The company is suspended')
    if (!args.name.trim()) throw new ConvexError('A plant name is required')
    await plantNameFree(ctx.db, args.companyId, args.name.trim())
    const locale = checkLocale(args.country, args.timeZone)
    const departments = checkDepartments(args.departments ?? [])
    const doc = {
      companyId: args.companyId,
      name: args.name.trim(),
      code: args.code?.trim() || undefined,
      ...locale,
      departments,
      costCenters: checkCostCenters(args.costCenters ?? [], departments, []),
      createdAt: Date.now(),
    }
    const id = await ctx.db.insert('plants', doc)
    await audit(ctx.db, { actor: ctx.sessionUser.name, action: 'plant.add', target: doc.name, detail: diff({}, plantSummary(doc)), companyId: args.companyId })
    return id
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
    departments: v.optional(v.array(v.string())),
    costCenters: v.optional(costCenterList),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const me = ctx.sessionUser
    const plant = await ctx.db.get(args.id)
    if (!plant) throw new ConvexError('Plant not found')
    if (!canManageCompany(me, plant.companyId)) throw new ConvexError('Only a creator of this company can change the plant')
    if (!args.name.trim()) throw new ConvexError('A plant name is required')
    await plantNameFree(ctx.db, plant.companyId, args.name.trim(), args.id)
    const patch: Any = {
      name: args.name.trim(),
      // Kod gönderilmezse dokunulmaz (ekran kodu göndermiyor).
      ...(args.code !== undefined ? { code: args.code.trim() || undefined } : {}),
      ...(args.country?.trim() || args.timeZone?.trim()
        ? checkLocale(args.country ?? plant.country ?? '', args.timeZone ?? plant.timeZone ?? '')
        : {}),
    }
    const departments = args.departments !== undefined ? checkDepartments(args.departments) : (plant.departments ?? [])
    if (args.departments !== undefined) patch.departments = departments
    // Bölüm listesi değişince masraf yerleri de yeniden denetlenir (silinen bölümde masraf yeri kalmasın).
    const costCenters = args.costCenters ?? (args.departments !== undefined ? plant.costCenters : undefined)
    if (costCenters !== undefined) {
      const before: CostCenter[] = plant.costCenters ?? []
      for (const cc of before) {
        if (cc.department && !departments.includes(cc.department) && costCenters.some((x: CostCenter) => x.code === cc.code && x.department === cc.department)) {
          throw new ConvexError(`Department ${cc.department} still has cost centers — move or remove them first`)
        }
      }
      patch.costCenters = checkCostCenters(costCenters, departments, before)
      // Work center'ı bağlı olan masraf yeri kaldırılamaz.
      const kept = new Set(patch.costCenters.map((c: CostCenter) => c.code))
      const orphaned = (await workCentersOf(ctx.db, args.id)).filter((w) => w.costCenter && !kept.has(w.costCenter))
      if (orphaned.length) {
        const cc = orphaned[0].costCenter
        throw new ConvexError(`Cost center ${cc} still has work centers (${orphaned.filter((w) => w.costCenter === cc).map((w) => w.name).join(', ')}) — move them on Work Center Definitions first`)
      }
      // KPI girişi olan masraf yeri kaldırılırsa girişler sessizce hesaptan düşerdi.
      const removed = new Set(((plant.costCenters ?? []) as CostCenter[]).map((c) => c.code).filter((c) => !kept.has(c)))
      if (removed.size) {
        const kpi: Any[] = await ctx.db
          .query('kpiEntries')
          .withIndex('by_plant', (q: Any) => q.eq('plantId', args.id))
          .collect()
        const used = [...removed].filter((code) => kpi.some((e) => e.costCenter === code))
        if (used.length) throw new ConvexError(`Cost center ${used[0]} has KPI entries — it cannot be removed (its history would stop counting)`)
      }
    }
    if (args.disabledModules !== undefined) {
      const same = JSON.stringify([...args.disabledModules].sort()) === JSON.stringify([...(plant.disabledModules ?? [])].sort())
      if (!same) {
        requirePlatform(me)
        patch.disabledModules = args.disabledModules
      }
    }
    await ctx.db.patch(args.id, patch)
    const detail = diff(plantSummary(plant), plantSummary({ ...plant, ...patch }))
    if (detail) await audit(ctx.db, { actor: me.name, action: 'plant.update', target: patch.name, detail, companyId: plant.companyId })
    return null
  },
})

// ---- Aşama 6: dışa aktarım ve kalıcı silme -----------------------------------------

/** Dışa aktarılmayan, yeniden hesaplanan tablolar (plan sonucu). */
const DERIVED_TABLES = new Set(['planRuns', 'planRunChunks', 'planStatus'])

async function requireCompanyExport(ctx: Any, companyId: string) {
  if (!canManageCompany(ctx.sessionUser, companyId)) throw new ConvexError('Only a creator of this company or a General can export it')
  const company = await ctx.db.get(companyId)
  if (!company) throw new ConvexError('Company not found')
  return company
}

/** Dışa aktarımın tabloları (fabrikaya ait, hesaplanmayan). */
export const exportTables = userQuery({
  args: { companyId: v.id('companies') },
  returns: v.array(v.string()),
  handler: async (ctx, { companyId }) => {
    await requireCompanyExport(ctx, companyId)
    return TABLES.filter((t) => isPlantTable(t) && !DERIVED_TABLES.has(t))
  },
})

/**
 * Bir fabrikanın bir tablosundan bir sayfa (ekran sayfa sayfa toplayıp tek
 * JSON dosyası indirir). Kiralama bitince ya da yedek için.
 */
export const exportPage = userQuery({
  args: { companyId: v.id('companies'), plantId: v.id('plants'), table: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: v.any(),
  handler: async (ctx, { companyId, plantId, table, cursor }) => {
    await requireCompanyExport(ctx, companyId)
    const plant = await ctx.db.get(plantId)
    if (!plant || plant.companyId !== companyId) throw new ConvexError('Plant not found')
    if (!isPlantTable(table) || DERIVED_TABLES.has(table) || !TABLES.includes(table)) throw new ConvexError(`Unknown table ${table}`)
    // Tablo adı parametre (dışa aktarım): tablo-genel okuma, bilerek gevşek.
    const r = await (ctx.db as Any)
      .query(table)
      .withIndex('by_plant', (q: Any) => q.eq('plantId', plantId))
      .paginate({ cursor, numItems: table === 'oeeDowntimeDays' ? 20 : 200 })
    return { page: r.page, isDone: r.isDone, continueCursor: r.continueCursor }
  },
})

/**
 * Kalıcı silme: yalnızca General, şirket askıdayken ve silme tarihi
 * (askıya alındıktan 90 gün sonra) geçtiyse; şirket adı yazılarak onaylanır.
 * Önce kullanıcılar, gruplar ve fabrikalar kalkar (kimse giremez), sonra
 * fabrika verisi arka planda parça parça silinir. Geri alınamaz.
 */
export const deleteCompany = userMutation({
  args: { id: v.id('companies'), confirmName: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, confirmName }) => {
    requirePlatform(ctx.sessionUser)
    const c = await ctx.db.get(id)
    if (!c) throw new ConvexError('Company not found')
    if (c.status !== 'suspended' || !c.deleteAfter) throw new ConvexError('Suspend the company first')
    if (Date.now() < c.deleteAfter) throw new ConvexError(`The data can be deleted after ${new Date(c.deleteAfter).toISOString().slice(0, 10)}`)
    if (confirmName.trim() !== c.name) throw new ConvexError('Type the company name exactly to confirm')
    const plants: Any[] = await ctx.db
      .query('plants')
      .withIndex('by_company', (q: Any) => q.eq('companyId', id))
      .collect()
    const users: Any[] = await ctx.db
      .query('users')
      .withIndex('by_company', (q: Any) => q.eq('companyId', id))
      .collect()
    for (const u of users) {
      if (u.platformRole) {
        await ctx.db.patch(u._id, { companyId: undefined, isCreator: undefined, groupIds: undefined })
        continue
      }
      const sessions: Any[] = await ctx.db
        .query('sessions')
        .withIndex('by_user', (q: Any) => q.eq('userId', u._id))
        .collect()
      for (const s of sessions) await ctx.db.delete(s._id)
      await ctx.db.delete(u._id)
    }
    const groups: Any[] = await ctx.db
      .query('userGroups')
      .withIndex('by_company', (q: Any) => q.eq('companyId', id))
      .collect()
    for (const g of groups) await ctx.db.delete(g._id)
    for (const p of plants) await ctx.db.delete(p._id)
    await ctx.db.delete(id)
    await audit(ctx.db, { actor: ctx.sessionUser.name, action: 'company.delete', target: c.name, detail: `plants: ${plants.map((p) => p.name).join(', ')}; data purged in the background`, companyId: id, holdingId: c.holdingId })
    await ctx.db.insert('platformState', {
      key: `purge:${id}`,
      value: { companyName: c.name, plantIds: plants.map((p) => p._id), tableIndex: 0, deleted: 0, done: false },
      updatedAt: Date.now(),
    })
    await ctx.scheduler.runAfter(0, internal.platform.purge, { key: `purge:${id}` })
    return null
  },
})

/**
 * Fabrikayı siler (ör. yanlışlıkla ikinci kez açılan fabrika): General ya da
 * şirketin creator'ı, fabrika adı yazılarak. Fabrika kaydı, gruplardaki yeri
 * ve oturumlardaki seçimi hemen kalkar; verisi arka planda silinir. Şirketin
 * son fabrikası silinemez. Geri alınamaz.
 */
export const deletePlant = userMutation({
  args: { id: v.id('plants'), confirmName: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, confirmName }) => {
    const plant = await ctx.db.get(id)
    if (!plant) throw new ConvexError('Plant not found')
    if (!canManageCompany(ctx.sessionUser, plant.companyId)) throw new ConvexError('Only a creator of this company can delete a plant')
    if (confirmName.trim() !== plant.name) throw new ConvexError('Type the plant name exactly to confirm')
    const siblings: Any[] = await ctx.db
      .query('plants')
      .withIndex('by_company', (q: Any) => q.eq('companyId', plant.companyId))
      .collect()
    if (siblings.length <= 1) throw new ConvexError('The last plant of a company cannot be deleted')
    const groups: Any[] = await ctx.db
      .query('userGroups')
      .withIndex('by_company', (q: Any) => q.eq('companyId', plant.companyId))
      .collect()
    for (const g of groups) {
      if (g.plantIds.includes(id)) await ctx.db.patch(g._id, { plantIds: g.plantIds.filter((x: string) => x !== id) })
    }
    for (const s of await ctx.db.query('sessions').collect()) {
      if (s.plantId === id) await ctx.db.patch(s._id, { plantId: undefined })
    }
    await ctx.db.delete(id)
    await audit(ctx.db, { actor: ctx.sessionUser.name, action: 'plant.delete', target: plant.name, detail: 'data purged in the background', companyId: plant.companyId })
    await ctx.db.insert('platformState', {
      key: `purge:plant:${id}`,
      value: { plantName: plant.name, plantIds: [id], tableIndex: 0, deleted: 0, done: false },
      updatedAt: Date.now(),
    })
    await ctx.scheduler.runAfter(0, internal.platform.purge, { key: `purge:plant:${id}` })
    return null
  },
})

/** Silinen şirketin fabrika verisini parça parça siler (fotoğraflar dahil). */
export const purge = internalMutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    const state = await ctx.db
      .query('platformState')
      .withIndex('by_key', (q: Any) => q.eq('key', key))
      .first()
    if (!state || state.value.done) return null
    const tables = TABLES.filter(isPlantTable)
    let { tableIndex, deleted } = state.value
    let budget = 300
    while (tableIndex < tables.length && budget > 0) {
      const table = tables[tableIndex]
      let emptied = true
      let checked = 0
      for (const plantId of state.value.plantIds) {
        checked++
        // Tablo-genel silme: bilerek gevşek tip.
        const docs: Any[] = await (ctx.db as Any)
          .query(table)
          .withIndex('by_plant', (q: Any) => q.eq('plantId', plantId))
          .take(Math.min(budget, table === 'planRunChunks' || table === 'oeeDowntimeDays' ? 5 : 100))
        for (const d of docs) {
          for (const photo of d.photos ?? []) await ctx.storage.delete(photo).catch(() => {})
          await ctx.db.delete(d._id)
        }
        deleted += docs.length
        budget -= Math.max(docs.length, 1)
        if (docs.length) emptied = false
        if (budget <= 0) break
      }
      // Tablo ancak bütün fabrikalarda boşsa geçilir.
      if (emptied && checked === state.value.plantIds.length) tableIndex++
      else break
    }
    const done = tableIndex >= tables.length
    await ctx.db.patch(state._id, { value: { ...state.value, tableIndex, deleted, done }, updatedAt: Date.now() })
    if (!done) await ctx.scheduler.runAfter(0, internal.platform.purge, { key })
    return null
  },
})

// ---- Holding (grup): General açar, şirketleri bağlar ---------------------------------

export const holdings = userQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    requirePlatform(ctx.sessionUser)
    const out: Any[] = []
    for (const h of await ctx.db.query('holdings').collect()) {
      const companies: Any[] = await ctx.db
        .query('companies')
        .withIndex('by_holding', (q: Any) => q.eq('holdingId', h._id))
        .collect()
      out.push({ ...h, companies: companies.map((c) => ({ _id: c._id, name: c.name })) })
    }
    return out
  },
})

async function holdingNameFree(db: Any, name: string, except?: string) {
  const all: Any[] = await db.query('holdings').collect()
  if (all.some((h) => h._id !== except && h.name.trim().toLowerCase() === name.toLowerCase())) throw new ConvexError(`A holding named ${name} already exists`)
}

export const saveHolding = userMutation({
  args: { id: v.optional(v.id('holdings')), name: v.string() },
  returns: v.id('holdings'),
  handler: async (ctx, { id, name }) => {
    requirePlatform(ctx.sessionUser)
    const n = name.trim()
    if (!n) throw new ConvexError('A holding name is required')
    await holdingNameFree(ctx.db, n, id)
    if (id) {
      const old = await ctx.db.get(id)
      await ctx.db.patch(id, { name: n })
      if (old?.name !== n) await audit(ctx.db, { actor: ctx.sessionUser.name, action: 'holding.rename', target: n, detail: diff({ name: old?.name }, { name: n }), holdingId: id })
      return id
    }
    const hid = await ctx.db.insert('holdings', { name: n, createdAt: Date.now() })
    await audit(ctx.db, { actor: ctx.sessionUser.name, action: 'holding.add', target: n, holdingId: hid })
    return hid
  },
})

/**
 * Holding'i siler: yalnızca şirketi kalmadıysa (şirketler holding'siz
 * kalmaz); board üyelerinin hesabı kapanır.
 */
export const removeHolding = userMutation({
  args: { id: v.id('holdings') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    requirePlatform(ctx.sessionUser)
    const companies: Any[] = await ctx.db.query('companies').withIndex('by_holding', (q: Any) => q.eq('holdingId', id)).collect()
    if (companies.length) throw new ConvexError(`The holding still has ${companies.length} compan${companies.length === 1 ? 'y' : 'ies'} — move them to another holding first`)
    for (const u of await ctx.db.query('users').withIndex('by_holding', (q: Any) => q.eq('holdingId', id)).collect()) {
      if (u.companyId || u.platformRole) {
        await ctx.db.patch(u._id, { holdingId: undefined })
        continue
      }
      for (const s of await ctx.db.query('sessions').withIndex('by_user', (q: Any) => q.eq('userId', u._id)).collect()) await ctx.db.delete(s._id)
      await ctx.db.delete(u._id)
    }
    const h = await ctx.db.get(id)
    await ctx.db.delete(id)
    await audit(ctx.db, { actor: ctx.sessionUser.name, action: 'holding.delete', target: h?.name ?? '?', holdingId: id })
    return null
  },
})

/** Şirketi bir holding'e bağlar ya da başka holding'e taşır (holding'siz bırakılmaz). */
export const setCompanyHolding = userMutation({
  args: { companyId: v.id('companies'), holdingId: v.id('holdings') },
  returns: v.null(),
  handler: async (ctx, { companyId, holdingId }) => {
    requirePlatform(ctx.sessionUser)
    const h = await ctx.db.get(holdingId)
    if (!h) throw new ConvexError('Holding not found')
    const c = await ctx.db.get(companyId)
    if (!c) throw new ConvexError('Company not found')
    await ctx.db.patch(companyId, { holdingId })
    if (c.holdingId !== holdingId) {
      const old = c.holdingId ? await ctx.db.get(c.holdingId) : null
      await audit(ctx.db, { actor: ctx.sessionUser.name, action: 'company.holding', target: c.name, detail: diff({ holding: old?.name }, { holding: h.name }), companyId, holdingId })
    }
    return null
  },
})

// ---- Denetim kaydı ---------------------------------------------------------------

/**
 * Platform denetim kaydı, en yeniden eskiye. General: hepsi ya da bir
 * şirketin; creator: yalnızca kendi şirketinin.
 */
export const auditLog = userQuery({
  args: { companyId: v.optional(v.id('companies')), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { companyId, limit }) => {
    const me = ctx.sessionUser
    const n = Math.min(Math.max(limit ?? 200, 1), 500)
    if (!companyId) {
      requirePlatform(me)
      return ctx.db.query('auditLog').withIndex('by_at').order('desc').take(n)
    }
    if (!canManageCompany(me, companyId)) throw new ConvexError('Only a creator of this company can see its history')
    return ctx.db
      .query('auditLog')
      .withIndex('by_company', (q: Any) => q.eq('companyId', companyId))
      .order('desc')
      .take(n)
  },
})

/** Güvenlik olayları: giriş kilidi / baskısı, parola ve oturum kapatma. */
export const isSecurityAction = (action: string) => /^(signin\.|password\.|user\.signout)/.test(action)

/**
 * Administration → Security (General: bütün hesaplar ve giriş istatistiği)
 * ve Users & permissions (creator: kendi şirketi). Kural:
 * src/lib/securityOverview.ts. Karma, tuz ve jeton dönülmez.
 */
export const securityOverview = userQuery({
  args: { companyId: v.optional(v.id('companies')) },
  returns: v.any(),
  handler: async (ctx, { companyId }) => {
    const me = ctx.sessionUser
    if (!companyId) requirePlatform(me)
    else if (!canManageCompany(me, companyId)) throw new ConvexError('Only a creator of this company can see this')
    const now = Date.now()
    const rows: Any[] = companyId
      ? await ctx.db
          .query('users')
          .withIndex('by_company', (q: Any) => q.eq('companyId', companyId))
          .collect()
      : await ctx.db.query('users').take(5000)
    const names = new Map<string, string>()
    if (!companyId) for (const c of await ctx.db.query('companies').collect()) names.set(c._id, c.name)
    const users: SecurityUser[] = rows.map((u) => ({
      _id: u._id,
      name: u.name,
      active: u.active,
      hasPassword: !!u.passwordHash,
      createdAt: u.createdAt ?? u._creationTime,
      lastLoginAt: u.lastLoginAt,
      lockedUntil: u.lockedUntil,
      mustChangePassword: u.mustChangePassword,
      isCreator: u.isCreator,
      platformRole: u.platformRole,
      company: u.companyId ? names.get(u.companyId) : u.platformRole ? 'Platform' : undefined,
    }))
    const ids = new Set(users.map((u) => u._id))
    const sessions = await ctx.db.query('sessions').take(10000)
    const activeSessions = sessions.filter((x: Any) => x.expiresAt > now && ids.has(x.userId)).length
    // Giriş istatistiği bütün siteye ait: yalnızca General görür.
    const buckets = companyId
      ? []
      : await ctx.db
          .query('signinStats')
          .withIndex('by_bucket', (q: Any) => q.gte('bucket', now - 7 * 24 * 60 * 60_000 - SIGNIN_BUCKET_MS))
          .collect()
    const recent = companyId
      ? await ctx.db
          .query('auditLog')
          .withIndex('by_company', (q: Any) => q.eq('companyId', companyId))
          .order('desc')
          .take(1000)
      : await ctx.db.query('auditLog').withIndex('by_at').order('desc').take(1000)
    return {
      ...buildSecurityOverview(users, buckets, activeSessions, now),
      platform: !companyId,
      events: recent.filter((r: Any) => isSecurityAction(r.action)).slice(0, 50),
    }
  },
})

// ---- vardiyalar (Company settings → Shifts; src/lib/shifts.ts) -------------------

const shiftsV = v.array(
  v.object({ number: v.number(), name: v.string(), start: v.optional(v.string()), end: v.optional(v.string()), codes: v.array(v.string()) }),
)

function checkShifts(list: ShiftDef[]): ShiftDef[] {
  const problems = shiftProblems(list)
  if (problems.length) throw new ConvexError(problems.join('; '))
  return normalizeShifts(list)
}

const shiftsText = (list: ShiftDef[] | undefined) => (list?.length ? list.map((s) => `${shiftLabel(s)} [${s.codes.join(', ')}]`).join('; ') : '—')

/** Şirket standardı ve plant'lerin kendi tanımları (creator; General seçili şirkette). */
export const shiftSettings = userQuery({
  args: { companyId: v.id('companies') },
  returns: v.any(),
  handler: async (ctx, { companyId }) => {
    if (!canManageCompany(ctx.sessionUser, companyId)) throw new ConvexError('Only a creator of this company can see this')
    const company: Any = await ctx.db.get(companyId)
    const plants: Any[] = await ctx.db
      .query('plants')
      .withIndex('by_company', (q: Any) => q.eq('companyId', companyId))
      .collect()
    return {
      company: company?.shifts ?? [],
      plants: plants
        .map((p) => ({ _id: p._id, name: p.name, own: p.shifts ?? [], effective: effectiveShifts(p.shifts, company?.shifts) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  },
})

export const saveCompanyShifts = userMutation({
  args: { companyId: v.id('companies'), shifts: shiftsV },
  returns: v.null(),
  handler: async (ctx, { companyId, shifts }) => {
    if (!canManageCompany(ctx.sessionUser, companyId)) throw new ConvexError('Only a creator of this company can change its shifts')
    const company: Any = await ctx.db.get(companyId)
    if (!company) throw new ConvexError('Company not found')
    const clean = checkShifts(shifts)
    await ctx.db.patch(companyId, { shifts: clean })
    await audit(ctx.db, {
      actor: ctx.sessionUser.name,
      action: 'company.shifts',
      target: company.name,
      detail: `${shiftsText(company.shifts)} → ${shiftsText(clean)}`,
      companyId,
      holdingId: company.holdingId,
    })
    return null
  },
})

/** Plant'in kendi vardiyaları; boş liste = şirket standardına dön. */
export const savePlantShifts = userMutation({
  args: { plantId: v.id('plants'), shifts: shiftsV },
  returns: v.null(),
  handler: async (ctx, { plantId, shifts }) => {
    const plant: Any = await ctx.db.get(plantId)
    if (!plant) throw new ConvexError('Plant not found')
    if (!canManageCompany(ctx.sessionUser, plant.companyId)) throw new ConvexError('Only a creator of this company can change its shifts')
    const clean = shifts.length ? checkShifts(shifts) : undefined
    await ctx.db.patch(plantId, { shifts: clean })
    await audit(ctx.db, {
      actor: ctx.sessionUser.name,
      action: 'plant.shifts',
      target: plant.name,
      detail: `${plant.shifts?.length ? shiftsText(plant.shifts) : 'company standard'} → ${clean ? shiftsText(clean) : 'company standard'}`,
      companyId: plant.companyId,
    })
    return null
  },
})
