// Sunucu verisi ile kullanıcının yazdığı taslağı birleştirme kuralı.
//
// Sorun: her sorgu tazelenmesinde (WebSocket yeniden bağlandığında ya da
// HTTPS yedek modunda her 20 saniyede bir) aynı kayıtlar yeniden gelir.
// Formu her gelen veriyle doldurursak kullanıcının yazdığı elinden alınır;
// hiç doldurmazsak başka bir cihazın değişikliği hiç görünmez.
//
// Kural: son görülen sunucu hâli (`baseline`) saklanır. Yerel değer
// baseline'dan farklıysa kullanıcı düzenlemiştir. Sunucu da baseline'dan
// farklıysa kayıt gerçekten değişmiştir ve sunucu kazanır — yoksa yerel
// düzenleme korunur.

export interface MergeResult<T> {
  drafts: Record<string, T>
  baseline: Record<string, T>
}

/**
 * @param server Sunucudaki güncel satırlar (anahtar → değer).
 * @param local Ekrandaki taslaklar.
 * @param baseline En son uygulanan sunucu hâli.
 * @param same İki değerin aynı sayılıp sayılmayacağı.
 */
export function mergeDrafts<T>(
  server: Record<string, T>,
  local: Record<string, T>,
  baseline: Record<string, T>,
  same: (a: T, b: T) => boolean,
): MergeResult<T> {
  const drafts: Record<string, T> = {}
  for (const key of Object.keys(server)) {
    const serverValue = server[key]
    const localValue = local[key]
    const baseValue = baseline[key]
    const known = localValue !== undefined && baseValue !== undefined
    const locallyEdited = known && !same(localValue, baseValue)
    const serverChanged = baseValue === undefined || !same(baseValue, serverValue)
    drafts[key] = locallyEdited && !serverChanged ? localValue : serverValue
  }
  // Sunucudan düşen satırın taslağı da düşer — silinmiş kaydı düzenletmenin
  // anlamı yok.
  return { drafts, baseline: server }
}

/** Sunucudan farklı olan satırların anahtarları. */
export function dirtyKeys<T>(
  server: Record<string, T>,
  drafts: Record<string, T>,
  same: (a: T, b: T) => boolean,
): string[] {
  return Object.keys(server).filter(
    (key) => drafts[key] !== undefined && !same(drafts[key], server[key]),
  )
}
