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
  frozenDays?: number
}

/**
 * Sayılar metin olarak tutulur: boş kutu "tanımsız" demektir ve bu sıfırdan
 * farklı bir şeydir — alan sayıya bağlanırsa bu ayrım kaybolur.
 */
export interface PressDraft {
  hall: string
  category: string
  feedsCoil: boolean
  frozenDays: string
}

export function draftOf(press: PressRecord): PressDraft {
  return {
    hall: press.hall ?? '',
    category: press.category ?? '',
    // Alan hiç yazılmamışsa rulo beslemeli kabul edilir.
    feedsCoil: press.feedsCoil !== false,
    frozenDays: press.frozenDays === undefined ? '' : String(press.frozenDays),
  }
}

export function sameDraft(a: PressDraft, b: PressDraft): boolean {
  return (
    a.hall === b.hall &&
    a.category === b.category &&
    a.feedsCoil === b.feedsCoil &&
    a.frozenDays === b.frozenDays
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
  frozenDays: number | undefined
}

/** Taslağı, sunucuya gidecek eksiksiz kayda çevirir. */
export function pressPayload(name: string, draft: PressDraft): PressPayload {
  return {
    name,
    hall: draft.hall.trim() || 'Hall 1',
    category: draft.category.trim() || undefined,
    feedsCoil: draft.feedsCoil,
    frozenDays: optionalNumber(draft.frozenDays, 0),
  }
}
