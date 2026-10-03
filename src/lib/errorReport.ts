/**
 * Hangi ekran hatası hata kaydına gider? Sayfa başına en çok 10 gönderim;
 * kural mesajları (ConvexError), tarayıcı gürültüsü (ResizeObserver, eklenti
 * betikleri) ve ağ kopmaları
 * (bağlantı uyarısı zaten gösteriliyor) gönderilmez.
 */
// ConvexError = kural mesajı (kullanıcıya zaten "Not saved" olarak gösterilir), program hatası değil.
const NOISE = [/ConvexError/, /ResizeObserver loop/i, /^Script error\.?$/i, /failed to fetch|networkerror|load failed|network request failed/i, /chrome-extension:|moz-extension:/i]

export const MAX_REPORTS_PER_PAGE = 10

let sent = 0

export function shouldReport(message: string): boolean {
  if (!message || NOISE.some((r) => r.test(message))) return false
  if (sent >= MAX_REPORTS_PER_PAGE) return false
  sent++
  return true
}

/** Yalnızca test için. */
export function resetReportCount() {
  sent = 0
}
