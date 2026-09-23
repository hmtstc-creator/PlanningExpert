// Malzeme kodu arama kutusunun süzme kuralı.
//
// Atölyede kodlar uzun ve birbirine benziyor (M250SP001RO, M250SP002RO…).
// Elle yazmak hem yavaş hem hataya açık: bir harf şaşarsa kayıt master
// data'da olmayan bir koda gider ve plana hiç yansımaz. Bu yüzden seçim
// listeden yapılıyor, yazılan şey de süzgeç oluyor.

export interface MaterialOption {
  code: string
  /** Varsa eş ürün — aynı kalıptan çıktığı için aramada işe yarar. */
  coProduct?: string
}

/**
 * Sorguya uyan kodlar, en iyi eşleşme başta.
 *
 * Sıra: tam eşleşme → kodun başında geçen → kodun içinde geçen → eş
 * üründe geçen. Biri kodun tamamını yazdıysa aradığı odur; baştan yazmaya
 * başlayan da listenin dibinde kendi kodunu aramamalı.
 */
export function filterMaterials(
  options: MaterialOption[],
  query: string,
  limit = 50,
): MaterialOption[] {
  const q = query.trim().toLowerCase()
  const sorted = [...options].sort((a, b) => a.code.localeCompare(b.code))
  if (q === '') return sorted.slice(0, limit)

  const scored: { option: MaterialOption; rank: number }[] = []
  for (const option of sorted) {
    const code = option.code.toLowerCase()
    const co = option.coProduct?.toLowerCase() ?? ''
    let rank: number
    if (code === q) rank = 0
    else if (code.startsWith(q)) rank = 1
    else if (code.includes(q)) rank = 2
    else if (co.includes(q)) rank = 3
    else continue
    scored.push({ option, rank })
  }

  // Aynı sıradakiler alfabetik kalsın: liste her yazışta zıplamamalı.
  scored.sort((a, b) => a.rank - b.rank || a.option.code.localeCompare(b.option.code))
  return scored.slice(0, limit).map((entry) => entry.option)
}

/** Yazılan kod master data'da var mı? Yoksa kayıt plana yansımaz. */
export function isKnownMaterial(options: MaterialOption[], value: string): boolean {
  const v = value.trim().toLowerCase()
  if (v === '') return false
  return options.some((option) => option.code.toLowerCase() === v)
}
