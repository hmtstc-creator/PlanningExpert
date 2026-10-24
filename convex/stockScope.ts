import { stockScope, type StockScope } from '../src/lib/stockLocations'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

/**
 * Fabrikanın stok kapsamı: depo tikleri + cost center başına depolar +
 * parçanın cost center'ı (ana makinesinin work center'ından). Plan,
 * gerçekleşen üretim, kalıp vuruşları ve Demand sayfası aynı kuralı okur.
 */
export async function loadStockScope(ctx: Ctx): Promise<StockScope> {
  const [locations, costCenterLocations, presses, products] = await Promise.all([
    ctx.db.query('storageLocations').collect(),
    ctx.db.query('costCenterStorage').collect(),
    ctx.db.query('presses').collect(),
    ctx.db.query('products').collect(),
  ])
  return stockScope({ locations, costCenterLocations, presses, products })
}
