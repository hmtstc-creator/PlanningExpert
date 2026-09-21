// Giriş kurallarının veritabanından bağımsız kısmı.
//
// Parola karması Node tarafında üretiliyor (Convex action) ve orada test
// edilemiyor. Karar verilebilir kurallar — parola kabul edilir mi, oturum
// geçerli mi, hangi ekran gösterilir — buraya ayrıldı ve test ediliyor.

/** Oturum ömrü. Vardiya değişimlerini kapsayacak kadar uzun, sonsuz değil. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000

/** Kurulumda oluşturulan ilk yönetici. */
export const DEFAULT_ADMIN_USERNAME = 'admin'
export const DEFAULT_ADMIN_PASSWORD = 'admin'

export const MIN_PASSWORD_LENGTH = 4

/**
 * Parola kabul edilebilir mi?
 *
 * Kasten gevşek: bu bir atölye programı, banka değil. Tek katı kural,
 * parolanın boş ya da yalnızca boşluk olmaması. Varsayılan parolanın
 * zayıflığı burada değil, ekrandaki uyarıyla ele alınıyor.
 */
export function validatePassword(password: string): string | null {
  if (password.length === 0) return 'Enter a password'
  if (password.trim().length === 0) return 'A password cannot be only spaces'
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `At least ${MIN_PASSWORD_LENGTH} characters`
  }
  return null
}

/** Hâlâ varsayılan parola mı kullanılıyor? Ekranda uyarı bunun üstüne kurulu. */
export function isDefaultPassword(password: string): boolean {
  return password === DEFAULT_ADMIN_PASSWORD
}

export interface SessionLike {
  expiresAt: number
}

/** Oturum hâlâ geçerli mi? Sınır anı geçmiş sayılır. */
export function isSessionValid(session: SessionLike | null | undefined, now: number): boolean {
  if (!session) return false
  return session.expiresAt > now
}

export function sessionExpiry(now: number): number {
  return now + SESSION_TTL_MS
}

export type Screen = 'loading' | 'login' | 'mustChangePassword' | 'app'

/**
 * Hangi ekran gösterilmeli?
 *
 * Sıralama önemli: parola değiştirmesi gereken kullanıcı uygulamayı
 * göremez, yoksa "zorunlu değişiklik" bir öneriye dönüşür.
 */
export function screenFor(state: {
  loading: boolean
  user: { mustChangePassword?: boolean } | null
}): Screen {
  if (state.loading) return 'loading'
  if (!state.user) return 'login'
  if (state.user.mustChangePassword) return 'mustChangePassword'
  return 'app'
}
