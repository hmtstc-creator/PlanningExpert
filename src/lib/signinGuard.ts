// Parola püskürtmeye karşı genel giriş freni (convex/auth.ts).
//
// Hesap kilidi (authRules.ts) tek hesaba art arda denemeyi durdurur. Saldırgan
// ise her hesaba 4 parola deneyip geçer ya da var olmayan adlar dener; kilit
// hiç devreye girmez. Bu yüzden kullanıcıdan bağımsız sayılır: son 30
// dakikadaki hatalı girişler eşikleri geçince HER giriş beklemeye girer.
// Doğru parolayı bilen kullanıcı yalnızca birkaç saniye bekler; saldırganın
// denemesi ise yüzlerce kat yavaşlar. Convex'te istek IP'si görünmediği için
// sayaç geneldir.

export const SIGNIN_BUCKET_MS = 10 * 60_000
/** Pencere: son 3 dilim (30 dakika). */
export const SIGNIN_WINDOW_BUCKETS = 3
/** Silinmeden önce saklanan istatistik (Administration → Security). */
export const SIGNIN_KEEP_MS = 30 * 24 * 60 * 60_000

/** Büyükten küçüğe: pencerede bu kadar hatalı giriş varsa her giriş bu kadar bekler. */
export const PRESSURE_STEPS: readonly { failures: number; delayMs: number }[] = [
  { failures: 300, delayMs: 5000 },
  { failures: 100, delayMs: 3000 },
  { failures: 30, delayMs: 1000 },
]

export const bucketStart = (now: number) => now - (now % SIGNIN_BUCKET_MS)

/** Pencerenin ilk diliminin başı. */
export const windowStart = (now: number) => bucketStart(now) - (SIGNIN_WINDOW_BUCKETS - 1) * SIGNIN_BUCKET_MS

export interface SigninBucket {
  bucket: number
  failures: number
  unknownNames?: number
}

/** Penceredeki hatalı giriş sayısı. */
export function windowFailures(buckets: SigninBucket[], now: number): number {
  const from = windowStart(now)
  return buckets.filter((b) => b.bucket >= from && b.bucket <= now).reduce((n, b) => n + b.failures, 0)
}

/** Bu kadar hatalı girişte her giriş kaç ms bekler. */
export function signinDelayMs(failures: number): number {
  return PRESSURE_STEPS.find((s) => failures >= s.failures)?.delayMs ?? 0
}

/** Bir hata daha eklenince yeni bir eşik aşıldıysa o eşik (denetim kaydına bir kez yazılır). */
export function crossedStep(before: number, after: number): { failures: number; delayMs: number } | null {
  return PRESSURE_STEPS.find((s) => before < s.failures && after >= s.failures) ?? null
}

/** Belirli bir süredeki hatalı giriş toplamı (güvenlik ekranı). */
export function failuresSince(buckets: SigninBucket[], since: number): { failures: number; unknownNames: number } {
  let failures = 0
  let unknownNames = 0
  for (const b of buckets) {
    if (b.bucket + SIGNIN_BUCKET_MS <= since) continue
    failures += b.failures
    unknownNames += b.unknownNames ?? 0
  }
  return { failures, unknownNames }
}
