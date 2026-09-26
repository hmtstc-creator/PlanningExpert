// Server side of the SAP upload filter: which codes are known. The filter
// itself is shared with the browser — see src/lib/uploadFilter.ts.

import type { QueryCtx } from './_generated/server'

export { filterRows, type FilterReport } from '../src/lib/uploadFilter'

/**
 * Yüklemede tutulacak malzeme kodları: master data'daki ürünler ve eş
 * ürünleri (eş ürün kendi satırı olmasa da talebi gerekir). `raw` ile
 * hammadde (rulo) kodları da eklenir — MB52'deki rulo stoğu için.
 */
export async function knownMaterialCodes(
  ctx: QueryCtx,
  options: { raw?: boolean } = {},
): Promise<Set<string>> {
  const products = await ctx.db.query('products').collect()
  const codes = new Set<string>()
  for (const p of products) {
    for (const c of [p.code, p.coProduct, options.raw ? p.rawMaterialCode : undefined]) {
      const t = c?.trim()
      if (t) codes.add(t)
    }
  }
  return codes
}

export async function rawMaterialCodes(ctx: QueryCtx): Promise<Set<string>> {
  const products = await ctx.db.query('products').collect()
  return new Set(products.map((p) => p.rawMaterialCode?.trim() ?? '').filter((c) => c !== ''))
}

export async function knownLocationCodes(ctx: QueryCtx): Promise<Set<string>> {
  const locations = await ctx.db.query('storageLocations').collect()
  return new Set(locations.map((l) => l.code.trim()).filter((c) => c !== ''))
}
