// Pres tanımı satırının düzenlenebilir hâli.
//
// Neden ayrı bir katman: `presses.upsert` kaydı tümüyle değiştirir —
// gönderilmeyen isteğe bağlı alan silinmiş sayılır. Sayfa eskiden her alanı
// kendi `onBlur`'unda ayrı ayrı kaydediyordu ve hol kutusunu düzenlemek
// kategoriyi, rulo beslemesini ve dondurulmuş gün sayısını sessizce
// uçuruyordu. Artık tek bir taslak tutuluyor ve kayıt hep eksiksiz gidiyor.

export interface PressRecord {
  name: string
  hall: string
  category?: string
  feedsCoil?: boolean
  /** Frekansiyel duruşun adı (plant'in listesinden); doluysa feedsCoil açık. */
  frequencyStop?: string
  /** Üretim modeli: 'stroke' (pres; varsayılan) ya da 'cycle' (src/lib/rateModel.ts). */
  rateModel?: string
  frozenDays?: number
  /** Bağlı masraf yeri (fabrikanın cost center kodu). */
  costCenter?: string
}

/**
 * Sayılar metin olarak tutulur: boş kutu "tanımsız" demektir ve bu sıfırdan
 * farklı bir şeydir — alan sayıya bağlanırsa bu ayrım kaybolur.
 */
export interface PressDraft {
  hall: string
  category: string
  feedsCoil: boolean
  frequencyStop: string
  rateModel: 'stroke' | 'cycle'
  frozenDays: string
  costCenter: string
}

export function draftOf(press: PressRecord): PressDraft {
  return {
    hall: press.hall ?? '',
    category: press.category ?? '',
    // Alan hiç yazılmamışsa rulo beslemeli kabul edilir.
    feedsCoil: press.feedsCoil !== false,
    frequencyStop: press.frequencyStop ?? '',
    rateModel: press.rateModel === 'cycle' ? 'cycle' : 'stroke',
    frozenDays: press.frozenDays === undefined ? '' : String(press.frozenDays),
    costCenter: press.costCenter ?? '',
  }
}

export function sameDraft(a: PressDraft, b: PressDraft): boolean {
  return (
    a.hall === b.hall &&
    a.category === b.category &&
    a.feedsCoil === b.feedsCoil &&
    a.frequencyStop === b.frequencyStop &&
    a.rateModel === b.rateModel &&
    a.frozenDays === b.frozenDays &&
    a.costCenter === b.costCenter
  )
}

function optionalNumber(value: string, min?: number): number | undefined {
  const text = value.trim()
  if (text === '') return undefined
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) return undefined
  return min === undefined ? parsed : Math.max(min, parsed)
}

/** `presses.upsert`'e gidecek eksiksiz kayıt. */
export interface PressPayload {
  name: string
  hall: string
  category: string | undefined
  feedsCoil: boolean
  frequencyStop: string | undefined
  rateModel: 'stroke' | 'cycle'
  frozenDays: number | undefined
  costCenter: string | undefined
}

/** Taslağı, sunucuya gidecek eksiksiz kayda çevirir. */
export function pressPayload(name: string, draft: PressDraft): PressPayload {
  return {
    name,
    // Hol isteğe bağlı: boşsa work center kimseyle vinç paylaşmaz (hall.ts).
    hall: draft.hall.trim(),
    category: draft.category.trim() || undefined,
    // Adı seçilmiş duruş her zaman açıktır.
    feedsCoil: draft.feedsCoil || !!draft.frequencyStop.trim(),
    frequencyStop: draft.frequencyStop.trim() || undefined,
    rateModel: draft.rateModel,
    frozenDays: optionalNumber(draft.frozenDays, 0),
    // Zorunlu (yeni kayıtta); boşsa sunucu reddeder.
    costCenter: draft.costCenter.trim() || undefined,
  }
}

/** Frekansiyel duruşu açık ama adı seçilmemiş eski kayıt (seçicide ayrı satır). */
export const UNNAMED_STOP = '\u0001'

/** Seçicinin değeri: '' yok, ad, ya da adsız açık. */
export function stopValue(draft: Pick<PressDraft, 'feedsCoil' | 'frequencyStop'>): string {
  if (draft.frequencyStop) return draft.frequencyStop
  return draft.feedsCoil ? UNNAMED_STOP : ''
}

/** Seçicideki değeri taslağa çevirir. */
export function stopPatch(value: string): Pick<PressDraft, 'feedsCoil' | 'frequencyStop'> {
  if (value === UNNAMED_STOP) return { feedsCoil: true, frequencyStop: '' }
  return { feedsCoil: value !== '', frequencyStop: value }
}
