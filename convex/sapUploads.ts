import { v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'
import { runSync } from './moldAlarms'
import { planStatusDoc } from './planQueue'
import { TABLE_OF, liveUploadAt, uploadRecord } from './sapLive'
import { filterRows, knownLocationCodes, knownMaterialCodes } from './uploadFilter'
import { SAP_UPLOAD_KEYS, type SapUpload, type SapUploadKey } from '../src/lib/sapUploads'

/**
 * SAP yüklemeleri: parça parça yazma ve hangi dosyanın geçerli olduğu.
 *
 * Eskiden bir yükleme tek mutasyonda eski satırların hepsini silip yenilerini
 * yazıyordu. Büyük bir MB51'de bu, Convex'in bir işlemde yazabileceği belge
 * sınırını aşıyor ve yükleme "Server Error" ile düşüyordu. Artık:
 *
 *   1. `beginUpload`  — yeni yüklemenin zaman damgası alınır.
 *   2. `appendRows`   — satırlar küçük parçalar halinde, o damgayla yazılır.
 *                       Henüz kimse görmez: okuyanlar yalnızca GEÇERLİ
 *                       yüklemenin damgasını taşıyan satırları okur.
 *   3. `finishUpload` — kayıt yeni damgaya çevrilir; o anda bütün ekranlar
 *                       ve plan tek seferde yeni dosyaya geçer.
 *   4. `pruneOld`     — eski satırlar parça parça silinir.
 *
 * Yarıda kalan bir yükleme hiçbir şeyi bozmaz: geçerli dosya değişmez,
 * yarım satırlar sonradan temizlenir.
 */

// Convex'in üretilen tipleri bu ortamda yok; gevşek tiplenmiş.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

const keyValidator = v.union(...SAP_UPLOAD_KEYS.map((k) => v.literal(k)))

/** Her tabloya yazılabilecek alanlar; dosyadan gelen başka bir şey yazılmaz. */
const FIELDS_OF: Record<SapUploadKey, readonly string[]> = {
  weeklyDemand: ['material', 'stockInStorage', 'overdue', 'periods'],
  dailyDemand: ['material', 'stockInStorage', 'overdue', 'periods'],
  stock: [
    'material',
    'plant',
    'storageLocation',
    'unrestricted',
    'qualityInspection',
    'restricted',
    'blocked',
    'returns',
    'transit',
  ],
  actuals: ['material', 'postingDate', 'quantity', 'plant', 'storageLocation', 'movementType', 'orderNumber'],
}

/** Bir parçada en fazla bu kadar satır — işlem sınırının çok altında. */
export const APPEND_BATCH = 2000
/** Eski satırlar bu kadarlık parçalarla silinir. */
const PRUNE_BATCH = 4000
/** Bundan eski, hiç tamamlanmamış yüklemenin satırları çöp sayılır. */
const ABANDONED_MS = 60 * 60_000

export const beginUpload = guardedMutation({
  args: { key: keyValidator },
  returns: v.object({ uploadedAt: v.number(), batchSize: v.number() }),
  affectsPlan: false,
  handler: async (ctx: Ctx, { key }: Ctx) => {
    // Eski (kayıtsız) veri varsa önce onun yerini tutan bir kayıt açılır;
    // yoksa yazılan ilk parçalar "tablodaki en eski satır" sanılabilirdi.
    if (!(await uploadRecord(ctx, key))) {
      await ctx.db.insert('sapUploads', {
        key,
        uploadedAt: await liveUploadAt(ctx, key),
        rowsInFile: 0,
        rowsImported: 0,
        skippedUnknownMaterial: 0,
        skippedUnknownLocation: 0,
        legacy: true,
      })
    }
    return { uploadedAt: Date.now(), batchSize: APPEND_BATCH }
  },
})

export const appendRows = guardedMutation({
  args: { key: keyValidator, uploadedAt: v.number(), rows: v.array(v.any()) },
  returns: v.object({
    count: v.number(),
    skippedUnknownMaterial: v.number(),
    skippedUnknownLocation: v.number(),
    unknownMaterials: v.array(v.string()),
    unknownLocations: v.array(v.string()),
  }),
  affectsPlan: false,
  handler: async (ctx: Ctx, { key, uploadedAt, rows }: Ctx) => {
    if (rows.length > APPEND_BATCH) throw new Error(`At most ${APPEND_BATCH} rows per batch`)
    if (uploadedAt <= (await liveUploadAt(ctx, key))) {
      throw new Error('This upload is older than the current file — start again')
    }
    const fields = FIELDS_OF[key as SapUploadKey]
    const clean = (rows as Record<string, unknown>[]).map((row) => {
      const out: Record<string, unknown> = {}
      for (const field of fields) if (row[field] !== undefined) out[field] = row[field]
      return out
    })
    // Yalnızca bu pres atölyesinin malzemeleri; MB52'de yalnızca tanımlı depolar.
    const { kept, report } = filterRows<Record<string, unknown>>({
      rows: clean,
      materialOf: (r) => String(r.material ?? ''),
      locationOf: key === 'stock' ? (r) => r.storageLocation as string | undefined : undefined,
      knownMaterials: await knownMaterialCodes(ctx),
      knownLocations: key === 'stock' ? await knownLocationCodes(ctx) : undefined,
    })
    const table = TABLE_OF[key as SapUploadKey]
    for (const row of kept) await ctx.db.insert(table, { ...row, uploadedAt })
    return { count: kept.length, ...report }
  },
})

/** Yeni dosyayı geçerli yap. Plan bu andan sonra yeni dosyayla hesaplanır. */
export const finishUpload = guardedMutation({
  args: {
    key: keyValidator,
    uploadedAt: v.number(),
    fileName: v.optional(v.string()),
    rowsInFile: v.number(),
    rowsImported: v.number(),
    skippedUnknownMaterial: v.number(),
    skippedUnknownLocation: v.number(),
    coversFrom: v.optional(v.string()),
    coversTo: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx: Ctx, args: Ctx) => {
    const { key, uploadedAt } = args
    const current = await uploadRecord(ctx, key)
    if (current && current.uploadedAt >= uploadedAt) {
      throw new Error('A newer file was saved in the meantime — this one was not applied')
    }
    const doc = {
      ...args,
      fileName: args.fileName?.trim().slice(0, 200) || undefined,
      uploadedBy: ctx.sessionUser?.name,
    }
    if (current) await ctx.db.replace(current._id, doc)
    else await ctx.db.insert('sapUploads', doc)
    // Gerçekleşen üretim vuruş sayısını artıran tek şey. Limiti aşan kalıp
    // varsa alarm yüklemeyle birlikte doğsun.
    if (key === 'actuals') await runSync(ctx)
    return null
  },
})

/** Geçerli olmayan satırları sil; bitene kadar tekrar çağrılır. */
export const pruneOld = guardedMutation({
  args: { key: keyValidator },
  returns: v.object({ done: v.boolean() }),
  affectsPlan: false,
  handler: async (ctx: Ctx, { key }: Ctx) => {
    const live = await liveUploadAt(ctx, key)
    const table = TABLE_OF[key as SapUploadKey]
    const older = await ctx.db
      .query(table)
      .withIndex('by_uploadedAt', (q: Ctx) => q.lt('uploadedAt', live))
      .take(PRUNE_BATCH)
    // Geçerliden yeni satırlar ya süren bir yüklemenin ya da yarıda kalmış
    // bir yüklemenin; yalnızca yeterince eskiyse silinir.
    const abandoned = await ctx.db
      .query(table)
      .withIndex('by_uploadedAt', (q: Ctx) =>
        q.gt('uploadedAt', live).lt('uploadedAt', Date.now() - ABANDONED_MS),
      )
      .take(PRUNE_BATCH - older.length)
    for (const row of [...older, ...abandoned]) await ctx.db.delete(row._id)
    return { done: older.length + abandoned.length < PRUNE_BATCH }
  },
})

/**
 * Yüklemenin süzgeci: tanımlı malzeme ve depo kodları. Tarayıcı dosyayı bu
 * listeyle süzer ve sunucuya yalnızca işe yarayan satırları gönderir —
 * MB51 bütün fabrikanın hareketini taşır, çoğu bizim malzememiz değildir.
 */
export const filterCodes = guardedQuery({
  args: {},
  returns: v.object({ materials: v.array(v.string()), locations: v.array(v.string()) }),
  handler: async (ctx: Ctx) => ({
    materials: [...(await knownMaterialCodes(ctx))],
    locations: [...(await knownLocationCodes(ctx))],
  }),
})

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
      if (record.uploadedAt === 0) continue
      const { _id, _creationTime, ...rest } = record
      uploads.push(rest)
      continue
    }
    const at = await liveUploadAt(ctx, key)
    if (at) uploads.push({ key, uploadedAt: at, legacy: true })
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
