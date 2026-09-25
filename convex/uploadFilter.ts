// Server side of the SAP upload filter: which codes are known. The filter
// itself is shared with the browser — see src/lib/uploadFilter.ts.

import type { QueryCtx } from './_generated/server'

export { filterRows, type FilterReport } from '../src/lib/uploadFilter'

export async function knownMaterialCodes(ctx: QueryCtx): Promise<Set<string>> {
  const products = await ctx.db.query('products').collect()
  return new Set(products.map((p) => p.code.trim()).filter((c) => c !== ''))
}

export async function knownLocationCodes(ctx: QueryCtx): Promise<Set<string>> {
  const locations = await ctx.db.query('storageLocations').collect()
  return new Set(locations.map((l) => l.code.trim()).filter((c) => c !== ''))
}
