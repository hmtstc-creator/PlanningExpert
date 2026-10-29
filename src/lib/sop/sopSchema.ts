// SOP: yapay zekâdan beklenen JSON ve formun taslağı (veritabanında tutulan,
// ekranda düzeltilen hâli). Tek kaynak: Convex (`convex/sopQueue.ts`) gelen
// cevabı bununla denetler, worker aynı şemayı Gemini'ye `responseSchema` olarak
// gönderir (iş alınırken Convex'ten gelir). Alanlar formun satırlarıdır (TWI):
// temel adım (PAȘI DE BAZĂ), püf noktası (PUNCTE CHEIE), nedeni (CAUZE).

import { z } from 'zod'

import { HEADER_DEFAULTS, type Header, type PpeKey } from './sopLayout'

/** Adım başına en çok fotoğraf (kullanıcı 2026-10-29: daha iyi anlatıyorsa 2). */
export const MAX_PHOTOS_PER_STEP = 2
export const MAX_STEPS = 60
/** Metin üst sınırları: kutuya sığması için modelden istenen (karakter). */
export const TEXT_LIMITS = { step: 120, key: 160, reason: 160 } as const
/** Modelin sınırı biraz aşmasına izin (tekrar denemeye değmez; ekranda yazı küçülür). */
const SLACK = 1.5

export const LANGUAGES = ['tr', 'ro'] as const
export type Language = (typeof LANGUAGES)[number]
export const LANGUAGE_NAMES: Record<Language, string> = { tr: 'Türkçe', ro: 'Română' }

const box = z
  .array(z.number().min(0).max(1000))
  .length(4)
  .refine(([ymin, xmin, ymax, xmax]) => ymin < ymax && xmin < xmax, 'işaret kutusu ters')

/** Gemini'nin cevabı. */
export const aiResultSchema = z.object({
  adimlar: z
    .array(
      z.object({
        temel_adim: z.string().trim().min(3).max(Math.round(TEXT_LIMITS.step * SLACK)),
        puf_noktasi: z.string().trim().max(Math.round(TEXT_LIMITS.key * SLACK)),
        nedeni: z.string().trim().max(Math.round(TEXT_LIMITS.reason * SLACK)),
        baslangic_sn: z.number().min(0),
        bitis_sn: z.number().min(0),
        kareler: z
          .array(z.object({ saniye: z.number().min(0), isaret: box.optional().nullable() }))
          .min(1)
          .max(MAX_PHOTOS_PER_STEP),
      }),
    )
    .min(1)
    .max(MAX_STEPS),
  kkd: z.object({ is_ayakkabisi: z.boolean(), eldiven: z.boolean(), tisort_pantolon: z.boolean() }),
})
export type AiResult = z.infer<typeof aiResultSchema>

/** Gemini `responseSchema` (OpenAPI alt kümesi) — aiResultSchema ile aynı biçim. */
export const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    adimlar: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          temel_adim: { type: 'STRING' },
          puf_noktasi: { type: 'STRING' },
          nedeni: { type: 'STRING' },
          baslangic_sn: { type: 'NUMBER' },
          bitis_sn: { type: 'NUMBER' },
          kareler: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                saniye: { type: 'NUMBER' },
                isaret: { type: 'ARRAY', items: { type: 'NUMBER' }, nullable: true },
              },
              required: ['saniye'],
            },
          },
        },
        required: ['temel_adim', 'puf_noktasi', 'nedeni', 'baslangic_sn', 'bitis_sn', 'kareler'],
      },
    },
    kkd: {
      type: 'OBJECT',
      properties: { is_ayakkabisi: { type: 'BOOLEAN' }, eldiven: { type: 'BOOLEAN' }, tisort_pantolon: { type: 'BOOLEAN' } },
      required: ['is_ayakkabisi', 'eldiven', 'tisort_pantolon'],
    },
  },
  required: ['adimlar', 'kkd'],
} as const

/** Fotoğraftaki kırmızı işaret: kutunun kesirleri (0…1, sol-üst köşe + boyut). */
export interface Mark {
  x: number
  y: number
  w: number
  h: number
}

export interface Photo {
  /** Convex deposundaki kare; yeni saniye istenmişse kare gelene kadar yok. */
  storageId?: string
  second: number
  mark?: Mark
}

export interface Step {
  text: string
  key: string
  reason: string
  start?: number
  end?: number
  photos: Photo[]
}

export interface Draft {
  header: Header
  steps: Step[]
  ppe: Record<PpeKey, boolean>
}

export const emptyDraft = (header: Partial<Header> = {}): Draft => ({
  header: { ...HEADER_DEFAULTS, ...header },
  steps: [],
  ppe: { shoes: false, gloves: false, clothes: false },
})

const round = (n: number) => Math.round(n * 10) / 10

/** Gemini kutusu [ymin, xmin, ymax, xmax] (0…1000) → işaret (0…1). */
export function boxToMark(b: readonly number[] | null | undefined): Mark | undefined {
  if (!b || b.length !== 4) return undefined
  const [ymin, xmin, ymax, xmax] = b.map((n) => Math.min(1000, Math.max(0, n)) / 1000)
  const r3 = (n: number) => Math.round(n * 1000) / 1000
  return ymax > ymin && xmax > xmin ? { x: r3(xmin), y: r3(ymin), w: r3(xmax - xmin), h: r3(ymax - ymin) } : undefined
}

/**
 * Doğrulanmış cevap → taslak adımları. Saniyeler videonun içine kırpılır
 * (`duration` saniye); fotoğrafın deposu worker kareyi yükleyince yazılır.
 */
export function aiToDraft(ai: AiResult, duration: number, header: Partial<Header>): Draft {
  const clamp = (s: number) => round(Math.min(Math.max(0, s), Math.max(0, duration - 0.05)))
  return {
    header: { ...HEADER_DEFAULTS, ...header },
    steps: ai.adimlar.map((a) => ({
      text: a.temel_adim.trim(),
      key: a.puf_noktasi.trim(),
      reason: a.nedeni.trim(),
      start: clamp(a.baslangic_sn),
      end: clamp(Math.max(a.baslangic_sn, a.bitis_sn)),
      photos: a.kareler.slice(0, MAX_PHOTOS_PER_STEP).map((k) => ({ second: clamp(k.saniye), mark: boxToMark(k.isaret) })),
    })),
    ppe: { shoes: ai.kkd.is_ayakkabisi, gloves: ai.kkd.eldiven, clothes: ai.kkd.tisort_pantolon },
  }
}

/** Taslağın bağlı olduğu depo dosyaları (kareler) — sahipsiz dosya temizliği bunları silmez. */
export function draftStorageIds(draftJson: string | undefined): string[] {
  if (!draftJson) return []
  try {
    const d = JSON.parse(draftJson) as Draft
    return d.steps.flatMap((st) => st.photos.map((ph) => ph.storageId).filter((x): x is string => !!x))
  } catch {
    return []
  }
}

/** Cevabı doğrular; hata metni worker'ın tekrar denemesinde modele geri gider. */
export function parseAiResult(raw: unknown): { ok: true; value: AiResult } | { ok: false; error: string } {
  let data = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch (e) {
      return { ok: false, error: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  const r = aiResultSchema.safeParse(data)
  if (r.success) return { ok: true, value: r.data }
  return {
    ok: false,
    error: r.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; '),
  }
}

/** Taslağın sunucu denetimi (ekrandan kaydedilen hâl). */
const markSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) })
export const draftSchema = z.object({
  header: z.record(z.string(), z.string().max(300)),
  steps: z
    .array(
      z.object({
        text: z.string().max(600),
        key: z.string().max(600),
        reason: z.string().max(600),
        start: z.number().optional(),
        end: z.number().optional(),
        photos: z
          .array(z.object({ storageId: z.string().optional(), second: z.number().min(0), mark: markSchema.optional() }))
          .max(MAX_PHOTOS_PER_STEP),
      }),
    )
    .max(MAX_STEPS),
  ppe: z.object({ shoes: z.boolean(), gloves: z.boolean(), clothes: z.boolean() }),
})
