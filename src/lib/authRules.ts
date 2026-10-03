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

/** Yeni parola kuralı (docs/fixeddefinitions.md #17). Eski parolalar çalışmaya devam eder. */
export const MIN_PASSWORD_LENGTH = 8

/** Art arda bu kadar hatalı parolada hesap geçici kilitlenir (#38). */
export const MAX_FAILED_LOGINS = 5
/** Kilit süresi (#39). */
export const LOCKOUT_MS = 15 * 60 * 1000

/**
 * Yeni parola kabul edilebilir mi? Sunucu (convex/auth.ts) ve ekran aynı
 * kuralı kullanır. En az 8 karakter, en az bir harf ve bir rakam; kullanıcı
 * adı ya da varsayılan parola olamaz. Kurulumdan kalan kısa parolalar
 * girişte çalışır; yalnızca yeni konan parola bu kurala uyar.
 */
export function validatePassword(password: string, userName?: string): string | null {
  if (password.length === 0) return 'Enter a password'
  if (password.trim().length === 0) return 'A password cannot be only spaces'
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `At least ${MIN_PASSWORD_LENGTH} characters`
  }
  if (!/\p{L}/u.test(password) || !/\p{N}/u.test(password)) return 'Use at least one letter and one digit'
  if (isDefaultPassword(password.toLowerCase())) return 'This password is too easy to guess'
  if (userName && password.trim().toLowerCase() === userName.trim().toLowerCase()) return 'The password cannot be the user name'
  return null
}

export interface LoginState {
  failedLogins?: number
  lockedUntil?: number
}

/** Hesap kilitliyse kalan süre (ms), değilse 0. */
export function lockRemainingMs(state: LoginState, now: number): number {
  return state.lockedUntil && state.lockedUntil > now ? state.lockedUntil - now : 0
}

/**
 * Hatalı parolanın ardından yeni durum: sayaç artar; sınıra gelince hesap
 * kilitlenir ve sayaç sıfırlanır (kilit bitince yeniden 5 deneme).
 */
export function afterFailedLogin(state: LoginState, now: number): { failedLogins: number; lockedUntil?: number; locked: boolean } {
  const count = (lockRemainingMs(state, now) > 0 ? 0 : state.failedLogins ?? 0) + 1
  if (count >= MAX_FAILED_LOGINS) return { failedLogins: 0, lockedUntil: now + LOCKOUT_MS, locked: true }
  return { failedLogins: count, locked: false }
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
