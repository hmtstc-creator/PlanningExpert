/**
 * Sitenin her cevabına eklenen güvenlik başlıkları (vite.config.ts → Nitro
 * routeRules). VPS'te de aynı sunucu çalıştığı için başlıklar programla gelir;
 * nginx'te tekrar yazmak gerekmez (docs/deployment.md).
 *
 * CSP notu: TanStack Start sayfayı sunucuda üretirken satır içi <script>
 * yazar; bu yüzden script-src 'unsafe-inline' içerir. Yine de dış kaynaktan
 * betik yüklenemez, veri yalnızca kendi sunucumuza ve Convex'e gider,
 * <object> ve başka sitede çerçeve (clickjacking) kapalıdır.
 */
const CONVEX = ['https://*.convex.cloud', 'wss://*.convex.cloud', 'https://*.convex.site']

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${CONVEX[0]}`,
  "font-src 'self' data:",
  `connect-src 'self' ${CONVEX.join(' ')}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  // Yalnızca HTTPS'te geçerli (tarayıcı HTTP'de yok sayar).
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  // Kapalı portal: giriş sayfası da arama sonuçlarında çıkmasın (robots.txt de kapalı).
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
}
