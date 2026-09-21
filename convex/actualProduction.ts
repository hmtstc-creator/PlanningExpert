import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { runSync } from './moldAlarms'
import { filterRows, knownMaterialCodes } from './uploadFilter'

const rowValidator = v.object({
  _id: v.id('actualProduction'),
  _creationTime: v.number(),
  material: v.string(),
  postingDate: v.string(),
  quantity: v.number(),
  plant: v.optional(v.string()),
  storageLocation: v.optional(v.string()),
  movementType: v.optional(v.string()),
  orderNumber: v.optional(v.string()),
  uploadedAt: v.number(),
})

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(rowValidator),
  handler: async (ctx, args) =>
    ctx.db.query('actualProduction').order('desc').paginate(args.paginationOpts),
})

/** Tek sorguda okunacak en fazla satır — bkz. products.listAll. */
const PLANNING_ROW_LIMIT = 20000

/**
 * Gerçekleşen üretimin tamamı.
 *
 * Kalıp ömrü ve gerçekleşme oranı bu satırların TOPLAMINDAN çıkıyor.
 * Sayfalı okumak toplamı eksik bırakır: kalıp limitine yaklaşmış bir kalıp
 * güvenli görünür, gerçekleşme oranı olduğundan yüksek çıkar ve o oran tüm
 * planın kapasitesini çarpar. Eksiklik saklanmaz, bildirilir.
 */
export const listAll = query({
  args: {},
  returns: v.object({
    rows: v.array(rowValidator),
    complete: v.boolean(),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db.query('actualProduction').take(PLANNING_ROW_LIMIT + 1)
    return {
      rows: rows.slice(0, PLANNING_ROW_LIMIT),
      complete: rows.length <= PLANNING_ROW_LIMIT,
    }
  },
})

export const replaceAll = mutation({
  args: {
    rows: v.array(
      v.object({
        material: v.string(),
        postingDate: v.string(),
        quantity: v.number(),
        plant: v.optional(v.string()),
        storageLocation: v.optional(v.string()),
        movementType: v.optional(v.string()),
        orderNumber: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({
    count: v.number(),
    skippedUnknownMaterial: v.number(),
    skippedUnknownLocation: v.number(),
    unknownMaterials: v.array(v.string()),
    unknownLocations: v.array(v.string()),
  }),
  handler: async (ctx, { rows }) => {
    // MB51 covers every movement in the plant; keep only our own materials.
    const { kept, report } = filterRows<(typeof rows)[number]>({
      rows,
      materialOf: (r) => r.material,
      knownMaterials: await knownMaterialCodes(ctx),
    })

    const existing = await ctx.db.query('actualProduction').collect()
    await Promise.all(existing.map((doc) => ctx.db.delete(doc._id)))
    const now = Date.now()
    await Promise.all(
      kept.map((row) => ctx.db.insert('actualProduction', { ...row, uploadedAt: now })),
    )
    // Gerçekleşen üretim vuruş sayısını artıran tek şey. Limiti aşan kalıp
    // varsa alarmı yüklemeyle birlikte doğsun; kimsenin bir ekranı açmasını
    // beklemek alarmı günlerce geciktirirdi.
    await runSync(ctx)

    return { count: kept.length, ...report }
  },
})
