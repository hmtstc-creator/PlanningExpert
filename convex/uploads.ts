import { ConvexError } from 'convex/values'

/**
 * Yüklenen fotoğrafın sunucu denetimi. Tarayıcı `accept="image/*"` der ama
 * yükleme adresi her dosyayı kabul eder: kayda bağlanmadan önce türü, boyutu
 * ve sayısı burada denetlenir; uymayan dosya depodan silinir.
 */
export const MAX_PHOTOS = 10
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|heic|heif)$/i

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function checkPhotos(ctx: { storage: any }, ids: string[] | undefined): Promise<void> {
  if (!ids?.length) return
  if (ids.length > MAX_PHOTOS) throw new ConvexError(`At most ${MAX_PHOTOS} photos per report`)
  for (const id of ids) {
    const meta = await ctx.storage.getMetadata(id)
    const bad = !meta ? 'not found' : !IMAGE_TYPES.test(meta.contentType ?? '') ? 'is not a photo' : meta.size > MAX_PHOTO_BYTES ? 'is larger than 15 MB' : null
    if (bad) {
      if (meta) await ctx.storage.delete(id)
      throw new ConvexError(`An attached file ${bad} — attach photos (JPEG, PNG, WebP, HEIC) only`)
    }
  }
}
