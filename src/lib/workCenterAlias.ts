/**
 * Work center kod eşlemesi (eski kod → yeni kod; K5, 2026-10-24).
 *
 * Kod değişince OEE geçmişi yeni koda taşınır; SAP dosyası bir süre eski kodu
 * getirmeye devam eder. Eşleme yüklemede eski kodu yeni koda çevirir, böylece
 * aynı work center'ın geçmişi iki koda bölünmez. Saf hesap: veritabanı yok.
 */

export interface Alias {
  from: string
  to: string
}

/**
 * Kod değişikliğinden sonraki eşleme listesi. A → B değişince: A → B eklenir,
 * B'ye işaret eden eski kodlar da yeni koda gider (zincir kısa kalır), yeni kod
 * artık gerçek bir kod olduğu için B'den çıkan eşleme kalkar.
 */
export function nextAliases(existing: Alias[], from: string, to: string): Alias[] {
  const out = existing.filter((a) => a.from !== to && a.from !== from).map((a) => (a.to === from ? { ...a, to } : a))
  if (from !== to) out.push({ from, to })
  return out
}

/** Kodun güncel karşılığı (eşleme yoksa kendisi). Döngüye karşı en çok liste uzunluğu kadar adım. */
export function resolveCode(aliases: Map<string, string>, code: string): string {
  let cur = code
  for (let i = 0; i <= aliases.size; i++) {
    const next = aliases.get(cur)
    if (next === undefined || next === cur) return cur
    cur = next
  }
  return cur
}

/** OEE açık konu anahtarı `masraf yeri|iş yeri|kayıp grubu`: iş yeri kısmı değişir. */
export function renameTopicKey(key: string, from: string, to: string): string {
  const parts = key.split('|')
  if (parts[1] === from) parts[1] = to
  return parts.join('|')
}
