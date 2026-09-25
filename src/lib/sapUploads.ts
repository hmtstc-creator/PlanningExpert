// SAP dosya yüklemelerinin kaydı ve "plan bu dosyayı kullanıyor mu" sorusu.
//
// Yükleme dosya seçilip onaylanınca kaydediliyor, ayrı bir "Kaydet" adımı
// yok. Bu yüzden ekranın, hangi dosyanın ne zaman yüklendiğini ve planın
// hangi yüklemeyle hesaplandığını açıkça söylemesi gerekiyor. Saf
// fonksiyonlar burada; sunucu (convex/sapUploads.ts) ve sayfa ortak kullanır.

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
