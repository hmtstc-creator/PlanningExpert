import { v } from 'convex/values'

import { guardedQuery } from './guarded'
import { planStatusDoc } from './planQueue'
import { SAP_UPLOAD_KEYS, type SapUpload, type SapUploadKey } from '../src/lib/sapUploads'

/**
 * SAP yüklemelerinin kaydı: hangi dosya, ne zaman, kim yükledi, kaç satır.
 *
 * Veri tablolarında dosya adı yok; bu kayıt olmadan ekran "şu an hangi
 * dosyayla çalışıyorsun" sorusuna cevap veremiyordu.
 */

// Convex'in üretilen tipleri bu ortamda yok; gevşek tiplenmiş.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

const TABLE_OF: Record<SapUploadKey, string> = {
  weeklyDemand: 'demandWeekly',
  dailyDemand: 'demandDaily',
  stock: 'stock',
  actuals: 'actualProduction',
}

/** Yükleme mutasyonları bunu çağırır; anahtar başına tek kayıt tutulur. */
export async function recordUpload(
  ctx: Ctx,
  key: SapUploadKey,
  info: {
    fileName?: string
    uploadedAt: number
    rowsInFile: number
    rowsImported: number
    skippedUnknownMaterial: number
    skippedUnknownLocation: number
    coversFrom?: string
    coversTo?: string
  },
): Promise<void> {
  const doc = {
    key,
    ...info,
    fileName: info.fileName?.trim().slice(0, 200) || undefined,
    uploadedBy: ctx.sessionUser?.name,
  }
  const existing = await ctx.db
    .query('sapUploads')
    .withIndex('by_key', (q: Ctx) => q.eq('key', key))
    .first()
  if (existing) await ctx.db.replace(existing._id, doc)
  else await ctx.db.insert('sapUploads', doc)
}

/**
 * Her veri için son yükleme. Kayıt yoksa (bu özellikten önceki yükleme)
 * tarih veri tablosundaki satırdan alınır, dosya adı bilinmez.
 */
export async function currentUploads(ctx: Ctx): Promise<SapUpload[]> {
  const records = await ctx.db.query('sapUploads').collect()
  const uploads: SapUpload[] = []
  for (const key of SAP_UPLOAD_KEYS) {
    const record = records.find((r: Ctx) => r.key === key)
    if (record) {
      const { _id, _creationTime, ...rest } = record
      uploads.push(rest)
      continue
    }
    const row = await ctx.db.query(TABLE_OF[key]).first()
    if (row?.uploadedAt) uploads.push({ key, uploadedAt: row.uploadedAt, legacy: true })
  }
  return uploads
}

/**
 * SAP Data sayfasının durumu: son yüklemeler, planın hangi yüklemelerle
 * hesaplandığı ve bekleyen bir hesap olup olmadığı.
 */
export const status = guardedQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx: Ctx) => {
    const run = await ctx.db
      .query('planRuns')
      .withIndex('by_status_computed', (q: Ctx) => q.eq('status', 'ready'))
      .order('desc')
      .first()
    const planStatus = await planStatusDoc(ctx)
    const now = Date.now()
    const running = !!planStatus?.runningSince && now - planStatus.runningSince < 10 * 60_000
    const scheduled = !!planStatus?.scheduledFor && planStatus.scheduledFor > now - 60_000
    return {
      uploads: await currentUploads(ctx),
      plan: run
        ? { computedAt: run.computedAt, dataSources: run.summary?.dataSources }
        : null,
      pending: running || scheduled,
      lastError: planStatus?.lastError,
    }
  },
})
