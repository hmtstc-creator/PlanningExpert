import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { adminMutation, guardedMutation, guardedQuery } from './guarded'

const productValidator = v.object({
  _id: v.id('products'),
  _creationTime: v.number(),
  code: v.string(),
  coProduct: v.optional(v.string()),
  moldCavities: v.number(),
  spm: v.number(),
  rawMaterialCode: v.string(),
  coilWeight: v.number(),
  grossWeight: v.optional(v.number()),
  setupMinutes: v.number(),
  coilSetupMinutes: v.optional(v.number()),
  mainMachine: v.string(),
  altMachine1: v.optional(v.string()),
  altMachine2: v.optional(v.string()),
  altMachine3: v.optional(v.string()),
  altMachine4: v.optional(v.string()),
  flexiblePress: v.optional(v.boolean()),
  maxShots: v.optional(v.number()),
  qualityApprovalMinutes: v.optional(v.number()),
  performanceFactor: v.optional(v.number()),
  name: v.string(),
  material: v.string(),
  cycleTimeSeconds: v.number(),
})

const productArgs = {
  code: v.string(),
  coProduct: v.optional(v.string()),
  moldCavities: v.optional(v.number()),
  spm: v.optional(v.number()),
  rawMaterialCode: v.optional(v.string()),
  coilWeight: v.optional(v.number()),
  grossWeight: v.optional(v.number()),
  setupMinutes: v.optional(v.number()),
  coilSetupMinutes: v.optional(v.number()),
  mainMachine: v.optional(v.string()),
  altMachine1: v.optional(v.string()),
  altMachine2: v.optional(v.string()),
  altMachine3: v.optional(v.string()),
  altMachine4: v.optional(v.string()),
  flexiblePress: v.optional(v.boolean()),
  maxShots: v.optional(v.number()),
  qualityApprovalMinutes: v.optional(v.number()),
  performanceFactor: v.optional(v.number()),
  name: v.optional(v.string()),
  material: v.optional(v.string()),
  cycleTimeSeconds: v.optional(v.number()),
}

/**
 * Tek sorguda okunacak en fazla satır. Convex'in okuma sınırının altında
 * kalacak kadar küçük, bir pres atölyesinin malzeme sayısının kat kat
 * üstünde. Aşılırsa sorgu bunu saklamaz.
 */
const PLANNING_ROW_LIMIT = 8000

export function withDefaults<T extends Record<string, unknown>>(doc: T) {
  return {
    ...doc,
    moldCavities: (doc.moldCavities as number | undefined) ?? 0,
    spm: (doc.spm as number | undefined) ?? 0,
    rawMaterialCode: (doc.rawMaterialCode as string | undefined) ?? '',
    coilWeight: (doc.coilWeight as number | undefined) ?? 0,
    setupMinutes: (doc.setupMinutes as number | undefined) ?? 0,
    mainMachine: (doc.mainMachine as string | undefined) ?? '',
    name: (doc.name as string | undefined) ?? '',
    material: (doc.material as string | undefined) ?? '',
    cycleTimeSeconds: (doc.cycleTimeSeconds as number | undefined) ?? 0,
  }
}

export const list = guardedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(productValidator),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('products')
      .order('desc')
      .paginate(args.paginationOpts)
    return { ...result, page: result.page.map(withDefaults) }
  },
})

/**
 * Planlamanın okuduğu eksiksiz liste.
 *
 * Sayfalı `list` ekranda iyi çalışır ama planlama için tehlikelidir: sayfa
 * sınırında kalan malzemeler sessizce plana girmez ve hiçbir uyarı çıkmaz.
 * Bu sorgu ya hepsini verir ya da `complete: false` diyerek yalan söylemeyi
 * reddeder — ekran o zaman planın eksik olduğunu söyler.
 */
export const listAll = guardedQuery({
  args: {},
  returns: v.object({
    rows: v.array(productValidator),
    complete: v.boolean(),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db.query('products').take(PLANNING_ROW_LIMIT + 1)
    return {
      rows: rows.slice(0, PLANNING_ROW_LIMIT).map(withDefaults),
      complete: rows.length <= PLANNING_ROW_LIMIT,
    }
  },
})

export const create = guardedMutation({
  args: productArgs,
  returns: v.id('products'),
  handler: async (ctx, args) => {
    const code = args.code.trim()
    if (!code) throw new Error('Material code is required')
    const { name: _n, material: _m, cycleTimeSeconds: _c, ...rest } = args
    return ctx.db.insert('products', { ...rest, code })
  },
})

export const bulkUpsert = guardedMutation({
  args: { rows: v.array(v.object(productArgs)) },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, { rows }) => {
    let inserted = 0
    let updated = 0
    for (const row of rows) {
      const code = row.code.trim()
      if (!code) continue
      const { name: _n, material: _m, cycleTimeSeconds: _c, ...rest } = row
      const data: Record<string, unknown> = { ...rest, code }
      // "Flexible press" SAP'den gelmez, burada işaretlenir. Dosyada sütun
      // yoksa mevcut işaret korunur — yeniden yükleme onu silmemeli.
      if (data.flexiblePress === undefined) delete data.flexiblePress
      const existing = await ctx.db
        .query('products')
        .withIndex('by_code', (q) => q.eq('code', code))
        .first()
      if (existing) {
        await ctx.db.patch(existing._id, data)
        updated++
      } else {
        await ctx.db.insert('products', data as typeof rest & { code: string })
        inserted++
      }
    }
    return { inserted, updated }
  },
})

export const remove = guardedMutation({
  args: { id: v.id('products') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  },
})

/**
 * Updates a single field on one material.
 *
 * Master data arrives in bulk from Excel, but individual values still need
 * correcting by hand — a wrong cavity count or SPM silently distorts every
 * plan. Passing `null` clears an optional field; `undefined` leaves it
 * untouched.
 */
export const updateField = guardedMutation({
  args: {
    id: v.id('products'),
    field: v.string(),
    value: v.union(v.string(), v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, { id, field, value }) => {
    const textFields = [
      'code',
      'coProduct',
      'rawMaterialCode',
      'mainMachine',
      'altMachine1',
      'altMachine2',
      'altMachine3',
      'altMachine4',
    ]
    const numberFields = [
      'moldCavities',
      'spm',
      'coilWeight',
      'grossWeight',
      'setupMinutes',
      'coilSetupMinutes',
      'maxShots',
      'qualityApprovalMinutes',
      'performanceFactor',
    ]

    if (field === 'flexiblePress') {
      const on = value === true || value === 1 || ['yes', 'true', '1', 'x'].includes(String(value).toLowerCase())
      await ctx.db.patch(id, { flexiblePress: on ? true : undefined })
      return null
    }

    if (!textFields.includes(field) && !numberFields.includes(field)) {
      throw new Error(`Unknown field: ${field}`)
    }

    if (value === null) {
      if (field === 'code') throw new Error('Material code cannot be empty')
      await ctx.db.patch(id, { [field]: undefined })
      return null
    }

    if (numberFields.includes(field)) {
      const parsed = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(parsed)) throw new Error(`${field} must be a number`)
      if (parsed < 0) throw new Error(`${field} cannot be negative`)
      if (field === 'performanceFactor' && (parsed <= 0 || parsed > 1)) {
        // A factor above 1 would claim the press runs faster than its own
        // cycle time; zero would make the job infinitely long.
        throw new Error('Performance factor must be greater than 0 and at most 1')
      }
      await ctx.db.patch(id, { [field]: parsed })
      return null
    }

    const text = String(value).trim()
    if (field === 'code') {
      if (!text) throw new Error('Material code cannot be empty')
      // A duplicate code would make bulk upload and planning ambiguous.
      const clash = await ctx.db
        .query('products')
        .withIndex('by_code', (q) => q.eq('code', text))
        .first()
      if (clash && clash._id !== id) {
        throw new Error(`Material code ${text} is already used by another record`)
      }
    }
    await ctx.db.patch(id, { [field]: text === '' ? undefined : text })
    return null
  },
})

/**
 * Bir alanı bütün parçalara birden yazar: kalite onay süresi (dk) ve/veya
 * performans çarpanı (0–1). Kapasite öngörüsü için bütün kalıpların aynı
 * varsayımla hesaplanması istendiğinde. Yalnızca yönetici.
 */
export const applyToAll = adminMutation({
  args: {
    qualityApprovalMinutes: v.optional(v.number()),
    performanceFactor: v.optional(v.number()),
  },
  returns: v.object({ updated: v.number() }),
  handler: async (ctx, { qualityApprovalMinutes, performanceFactor }) => {
    if (qualityApprovalMinutes !== undefined && (qualityApprovalMinutes < 0 || qualityApprovalMinutes > 600)) {
      throw new Error('Approval time must be between 0 and 600 minutes')
    }
    if (performanceFactor !== undefined && (performanceFactor <= 0 || performanceFactor > 1)) {
      throw new Error('Performance factor must be above 0 and at most 1 (e.g. 0.6 for 60 %)')
    }
    const patch: Record<string, number> = {}
    if (qualityApprovalMinutes !== undefined) patch.qualityApprovalMinutes = qualityApprovalMinutes
    if (performanceFactor !== undefined) patch.performanceFactor = performanceFactor
    if (Object.keys(patch).length === 0) return { updated: 0 }
    const products = await ctx.db.query('products').collect()
    for (const product of products) await ctx.db.patch(product._id, patch)
    await ctx.db.insert('changeLog', {
      title: `Master data: set for all ${products.length} parts`,
      detail: [
        qualityApprovalMinutes !== undefined ? `quality approval ${qualityApprovalMinutes} min` : null,
        performanceFactor !== undefined ? `performance factor ${Math.round(performanceFactor * 100)} %` : null,
      ]
        .filter(Boolean)
        .join(', '),
      category: 'decision',
      author: ctx.sessionUser?.name,
      createdAt: Date.now(),
    })
    return { updated: products.length }
  },
})
