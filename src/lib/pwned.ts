// Sızmış parola denetimi (convex/auth.ts): yeni parola bilinen veri
// sızıntılarında geçiyorsa kabul edilmez.
//
// Have I Been Pwned "range" servisi k-anonimlik ile çalışır: parolanın
// kendisi de tam karması da gönderilmez — yalnızca SHA-1 karmasının ilk 5
// hanesi. Servis o önekle başlayan yüz binlerce karmanın sonunu döner;
// eşleşme burada, sunucumuzda aranır. Servise ulaşılamazsa parola
// reddedilmez (uzunluk ve harf/rakam kuralı yine geçerli).

export const PWNED_RANGE_URL = 'https://api.pwnedpasswords.com/range/'
export const PWNED_TIMEOUT_MS = 3000

/** SHA-1 karmasını (40 hex) servis önekine ve aranacak sona ayırır. */
export function splitSha1(hex: string): { prefix: string; suffix: string } {
  const h = hex.toUpperCase()
  return { prefix: h.slice(0, 5), suffix: h.slice(5) }
}

/**
 * Servis cevabında (satır başına "SON35HANE:SAYI") sonun kaç kez geçtiği.
 * Dolgu satırları (Add-Padding) sayı 0 ile gelir ve sayılmaz.
 */
export function pwnedCount(body: string, suffix: string): number {
  const want = suffix.toUpperCase()
  for (const line of body.split(/\r?\n/)) {
    const [hash, count] = line.trim().split(':')
    if (hash?.toUpperCase() === want) return Number(count) || 0
  }
  return 0
}

export function pwnedMessage(count: number): string {
  return `This password appears in known data breaches (${count.toLocaleString('en-US')} times) — attackers try these first. Choose another one.`
}
