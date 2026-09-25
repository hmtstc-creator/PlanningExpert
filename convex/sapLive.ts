import type { SapUploadKey } from '../src/lib/sapUploads'

/**
 * Hangi SAP yüklemesinin geçerli olduğu. Yükleme parça parça yazıldığı için
 * tabloda aynı anda eski ve yarım yeni satırlar bulunabilir; veriyi okuyan
 * her yer yalnızca geçerli yüklemenin satırlarını okur (bkz. sapUploads.ts).
 */

// Convex'in üretilen tipleri bu ortamda yok; gevşek tiplenmiş.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

export const TABLE_OF: Record<SapUploadKey, string> = {
  weeklyDemand: 'demandWeekly',
  dailyDemand: 'demandDaily',
  stock: 'stock',
  actuals: 'actualProduction',
}

export async function uploadRecord(ctx: Ctx, key: SapUploadKey) {
  return ctx.db
    .query('sapUploads')
    .withIndex('by_key', (q: Ctx) => q.eq('key', key))
    .first()
}

/**
 * Geçerli yüklemenin damgası. Kayıt yoksa (bu özellikten önceki yükleme)
 * tablodaki satırların damgası; eski kod her yüklemede tabloyu boşalttığı
 * için orada tek bir damga vardır.
 */
export async function liveUploadAt(ctx: Ctx, key: SapUploadKey): Promise<number> {
  const record = await uploadRecord(ctx, key)
  if (record) return record.uploadedAt
  const oldest = await ctx.db.query(TABLE_OF[key]).withIndex('by_uploadedAt').first()
  return oldest?.uploadedAt ?? 0
}

/** Geçerli yüklemenin satırları — bütün okuyanlar bunu kullanır. */
export async function liveRows(ctx: Ctx, key: SapUploadKey) {
  const at = await liveUploadAt(ctx, key)
  return ctx.db
    .query(TABLE_OF[key])
    .withIndex('by_uploadedAt', (q: Ctx) => q.eq('uploadedAt', at))
}

