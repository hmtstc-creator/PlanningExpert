// SAP dosya yüklemelerinin kaydı ve "plan bu dosyayı kullanıyor mu" sorusu.
//
// Yükleme dosya seçilip onaylanınca kaydediliyor, ayrı bir "Kaydet" adımı
// yok. Bu yüzden ekranın, hangi dosyanın ne zaman yüklendiğini ve planın
// hangi yüklemeyle hesaplandığını açıkça söylemesi gerekiyor. Saf
// fonksiyonlar burada; sunucu (convex/sapUploads.ts) ve sayfa ortak kullanır.

import { filterRows } from './uploadFilter'

export const SAP_UPLOAD_KEYS = ['weeklyDemand', 'dailyDemand', 'stock', 'actuals'] as const
export type SapUploadKey = (typeof SAP_UPLOAD_KEYS)[number]

export const SAP_UPLOAD_LABELS: Record<SapUploadKey, string> = {
  weeklyDemand: 'Weekly demand — ZPP',
  dailyDemand: 'Daily demand — ZPP_DAILY',
  stock: 'Stock — MB52',
  actuals: 'Actual production — MB51',
}

/** Bir yüklemenin kaydı. Özellikten önceki yüklemelerde dosya adı yok. */
export interface SapUpload {
  key: SapUploadKey
  fileName?: string
  uploadedAt: number
  uploadedBy?: string
  rowsInFile?: number
  rowsImported?: number
  skippedUnknownMaterial?: number
  skippedUnknownLocation?: number
  coversFrom?: string
  coversTo?: string
  /** Kayıt yok, tarih veri tablosundan çıkarıldı (eski yükleme). */
  legacy?: boolean
}

/** Planın hesap anında gördüğü yükleme: anahtar → yükleme zamanı. */
export type PlanDataSources = Partial<Record<SapUploadKey, { uploadedAt: number; fileName?: string }>>

/** ZPP / ZPP_DAILY: dosyanın ilk ve son dönem sütunu. */
export function demandCoverage(rows: { periods: { label: string }[] }[]): {
  coversFrom?: string
  coversTo?: string
} {
  const periods = rows.find((r) => r.periods.length > 0)?.periods
  if (!periods) return {}
  return { coversFrom: periods[0].label, coversTo: periods[periods.length - 1].label }
}

/** MB51: en eski ve en yeni kayıt tarihi. */
export function postingCoverage(rows: { postingDate: string }[]): {
  coversFrom?: string
  coversTo?: string
} {
  let from: string | undefined
  let to: string | undefined
  for (const { postingDate } of rows) {
    if (!postingDate) continue
    if (from === undefined || postingDate < from) from = postingDate
    if (to === undefined || postingDate > to) to = postingDate
  }
  return { coversFrom: from, coversTo: to }
}

export type PlanUsage =
  /** Mevcut plan tam bu yüklemeyle hesaplandı. */
  | { kind: 'inPlan'; computedAt: number }
  /** Yükleme plandan yeni; hesap sürüyor ya da sırada. */
  | { kind: 'recalculating' }
  /** Yükleme plandan yeni ve bekleyen hesap yok (ör. son hesap hata verdi). */
  | { kind: 'notYet' }
  /** Hiç yükleme yok. */
  | { kind: 'none' }

/**
 * Yükleme mevcut planda mı?
 *
 * Plan her hesapta yüklemelerin zamanını kaydeder. O zaman bu yüklemeninkiyle
 * aynıysa plan bu dosyayı kullanmıştır. Kayıt öncesi hesaplanmış planlarda
 * kaynak listesi yoktur; o zaman hesap zamanı yüklemeden sonraysa kullanılmış
 * sayılır.
 */
export function planUsage(
  upload: SapUpload | undefined,
  plan: { computedAt: number; dataSources?: PlanDataSources } | null | undefined,
  pending: boolean,
): PlanUsage {
  if (!upload) return { kind: 'none' }
  const seen = plan?.dataSources?.[upload.key]?.uploadedAt
  const used = plan
    ? seen !== undefined
      ? seen === upload.uploadedAt
      : plan.dataSources === undefined && plan.computedAt >= upload.uploadedAt
    : false
  if (used && plan) return { kind: 'inPlan', computedAt: plan.computedAt }
  return pending ? { kind: 'recalculating' } : { kind: 'notYet' }
}

/** Tarih ve saat, fabrikanın saat diliminde (Romanya). */
export function formatPlantTime(ms: number, timeZone = 'Europe/Bucharest'): string {
  return new Date(ms).toLocaleString('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Yükleme raporu — src/lib/uploadMessage.ts'in beklediği biçim. */
export interface BatchUploadReport {
  count: number
  skippedUnknownMaterial: number
  skippedUnknownLocation: number
  unknownMaterials: string[]
  unknownLocations: string[]
}

export interface BatchUploadApi {
  begin: (args: { key: SapUploadKey }) => Promise<{ uploadedAt: number; batchSize: number }>
  append: (args: { key: SapUploadKey; uploadedAt: number; rows: unknown[] }) => Promise<BatchUploadReport>
  finish: (args: {
    key: SapUploadKey
    uploadedAt: number
    fileName?: string
    rowsInFile: number
    rowsImported: number
    skippedUnknownMaterial: number
    skippedUnknownLocation: number
    coversFrom?: string
    coversTo?: string
  }) => Promise<unknown>
  prune: (args: { key: SapUploadKey }) => Promise<{ done: boolean }>
}

const MAX_REPORTED = 25

/**
 * Dosyayı parça parça yazar, sonra tek adımda geçerli yapar. Bir parça hata
 * verirse geçerli dosya değişmez (hata yukarı atılır). Eski satırların
 * silinmesi sonradan yapılır; onun hatası yüklemeyi bozmaz, çünkü eski
 * satırları artık kimse okumuyor.
 */
export async function uploadInBatches(
  api: BatchUploadApi,
  input: {
    key: SapUploadKey
    rows: unknown[]
    fileName?: string
    coversFrom?: string
    coversTo?: string
    onProgress?: (done: number, total: number) => void
    /** Tarayıcıda süzülüp hiç gönderilmeyen satırlar (bkz. prefilterRows). */
    prefiltered?: { rowsInFile: number; report: Omit<BatchUploadReport, 'count'> }
  },
): Promise<BatchUploadReport> {
  const { key, rows, prefiltered } = input
  const { uploadedAt, batchSize } = await api.begin({ key })
  const total: BatchUploadReport = {
    count: 0,
    skippedUnknownMaterial: prefiltered?.report.skippedUnknownMaterial ?? 0,
    skippedUnknownLocation: prefiltered?.report.skippedUnknownLocation ?? 0,
    unknownMaterials: [],
    unknownLocations: [],
  }
  const materials = new Set<string>(prefiltered?.report.unknownMaterials.slice(0, MAX_REPORTED))
  const locations = new Set<string>(prefiltered?.report.unknownLocations.slice(0, MAX_REPORTED))
  for (let start = 0; start < rows.length; start += batchSize) {
    input.onProgress?.(start, rows.length)
    const part = await api.append({ key, uploadedAt, rows: rows.slice(start, start + batchSize) })
    total.count += part.count
    total.skippedUnknownMaterial += part.skippedUnknownMaterial
    total.skippedUnknownLocation += part.skippedUnknownLocation
    for (const m of part.unknownMaterials) if (materials.size < MAX_REPORTED) materials.add(m)
    for (const l of part.unknownLocations) if (locations.size < MAX_REPORTED) locations.add(l)
  }
  input.onProgress?.(rows.length, rows.length)
  total.unknownMaterials = [...materials].sort()
  total.unknownLocations = [...locations].sort()

  await api.finish({
    key,
    uploadedAt,
    fileName: input.fileName,
    rowsInFile: prefiltered?.rowsInFile ?? rows.length,
    rowsImported: total.count,
    skippedUnknownMaterial: total.skippedUnknownMaterial,
    skippedUnknownLocation: total.skippedUnknownLocation,
    coversFrom: input.coversFrom,
    coversTo: input.coversTo,
  })

  try {
    for (let i = 0; i < 200; i++) if ((await api.prune({ key })).done) break
  } catch {
    // Eski satırlar bir sonraki yüklemede silinir; okuyan yok.
  }
  return total
}

/** Tarayıcıdaki süzgecin kodları — sunucudaki `sapUploads.filterCodes`. */
export interface FilterCodes {
  /** Master data malzemeleri ve eş ürünleri. */
  materials: string[]
  locations: string[]
  /** Master data'daki hammadde (rulo) kodları — yalnızca MB52 için. */
  rawMaterials?: string[]
}

/**
 * Dosyayı göndermeden önce süzer: master data'da olmayan malzemeler (MB52'de
 * tanımsız depolar) hiç gönderilmez. Sunucu aynı süzgeci yine uygular; bu
 * yalnızca gereksiz satırların yola çıkmaması için.
 */
export function prefilterRows<Row extends { material: string; storageLocation?: string }>(
  key: SapUploadKey,
  rows: Row[],
  codes: FilterCodes,
): { kept: Row[]; report: Omit<BatchUploadReport, 'count'> } {
  return filterRows<Row>({
    rows,
    materialOf: (r) => r.material,
    rename: (r, material) => ({ ...r, material }),
    locationOf: key === 'stock' ? (r) => r.storageLocation : undefined,
    // MB52'de rulo stoğu da gerekir (hammadde kontrolü).
    knownMaterials: new Set(key === 'stock' ? [...codes.materials, ...(codes.rawMaterials ?? [])] : codes.materials),
    knownLocations: key === 'stock' ? new Set(codes.locations) : undefined,
    locationExempt: key === 'stock' ? new Set(codes.rawMaterials ?? []) : undefined,
  })
}
