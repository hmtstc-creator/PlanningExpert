import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { v } from 'convex/values'

import { guardedQuery } from './guarded'
import { liveRows } from './sapLive'
import { countedLocations, productionRows } from '../src/lib/stockLocations'

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

export const list = guardedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(rowValidator),
  handler: async (ctx, args) =>
    (await liveRows(ctx, 'actuals')).order('desc').paginate(args.paginationOpts),
})

/** Tek sorguda okunacak en fazla satır — bkz. products.listAll. */
const PLANNING_ROW_LIMIT = 20000

/**
 * Gerçekleşen üretimin tamamı — yalnızca üretim hareketleri (bkz.
 * productionQuantity): üretim deposuna 101, iptali 102 (eksi).
 *
 * Kalıp ömrü ve gerçekleşme oranı bu satırların TOPLAMINDAN çıkıyor.
 * Sayfalı okumak toplamı eksik bırakır: kalıp limitine yaklaşmış bir kalıp
 * güvenli görünür, gerçekleşme oranı olduğundan yüksek çıkar ve o oran tüm
 * planın kapasitesini çarpar. Eksiklik saklanmaz, bildirilir.
 */
export const listAll = guardedQuery({
  args: {},
  returns: v.object({
    rows: v.array(rowValidator),
    complete: v.boolean(),
  }),
  handler: async (ctx) => {
    const rows = await (await liveRows(ctx, 'actuals')).take(PLANNING_ROW_LIMIT + 1)
    // Üretim = "Production receipt" tikli depoya (varsayılan 2009) 101 − 102.
    // Performans, kalıp ömrü ve Actual Production aynı süzgeçten okur.
    const counted = countedLocations(await ctx.db.query('storageLocations').collect())
    return {
      rows: productionRows(counted, rows.slice(0, PLANNING_ROW_LIMIT)),
      complete: rows.length <= PLANNING_ROW_LIMIT,
    }
  },
})
