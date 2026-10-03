import { describe, expect, it } from 'vitest'

import {
  afterFailedLogin,
  isDefaultPassword,
  LOCKOUT_MS,
  lockRemainingMs,
  MAX_FAILED_LOGINS,
  isSessionValid,
  screenFor,
  sessionExpiry,
  SESSION_TTL_MS,
  validatePassword,
} from './authRules'

describe('parola kuralı', () => {
  it('boş parolayı reddeder', () => {
    expect(validatePassword('')).toBe('Enter a password')
    expect(validatePassword('   ')).toBe('A password cannot be only spaces')
  })

  it('8 karakterden kısa parolayı reddeder', () => {
    expect(validatePassword('ab12')).toContain('8 characters')
    expect(validatePassword('abcd123')).toContain('8 characters')
  })

  it('harf ve rakam ister', () => {
    expect(validatePassword('abcdefgh')).toBe('Use at least one letter and one digit')
    expect(validatePassword('12345678')).toBe('Use at least one letter and one digit')
    expect(validatePassword('şifre2026')).toBeNull()
  })

  it('kullanıcı adı parola olamaz', () => {
    expect(validatePassword('ahmet2026', 'Ahmet2026')).toBe('The password cannot be the user name')
    expect(validatePassword('pres-2026!', 'ahmet')).toBeNull()
  })

  it('varsayılan parolayı tanır', () => {
    expect(isDefaultPassword('admin')).toBe(true)
    expect(isDefaultPassword('Admin')).toBe(false)
    expect(isDefaultPassword('baska')).toBe(false)
  })
})

describe('hatalı giriş kilidi', () => {
  const now = 1_700_000_000_000

  it(`${MAX_FAILED_LOGINS}. hatalı parolada ${LOCKOUT_MS / 60_000} dakika kilitlenir`, () => {
    let state: { failedLogins?: number; lockedUntil?: number } = {}
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) {
      const r = afterFailedLogin(state, now)
      expect(r).toEqual({ failedLogins: i, locked: false })
      state = r
    }
    const last = afterFailedLogin(state, now)
    expect(last).toEqual({ failedLogins: 0, lockedUntil: now + LOCKOUT_MS, locked: true })
    expect(lockRemainingMs(last, now + 60_000)).toBe(LOCKOUT_MS - 60_000)
  })

  it('kilit bitince yeniden sayılır', () => {
    const after = { failedLogins: 0, lockedUntil: now - 1 }
    expect(lockRemainingMs(after, now)).toBe(0)
    expect(afterFailedLogin(after, now)).toEqual({ failedLogins: 1, locked: false })
  })
})

describe('oturum geçerliliği', () => {
  const now = 1_700_000_000_000

  it('süresi dolmamış oturum geçerlidir', () => {
    expect(isSessionValid({ expiresAt: now + 1000 }, now)).toBe(true)
  })

  it('süresi dolmuş oturum geçersizdir', () => {
    expect(isSessionValid({ expiresAt: now - 1 }, now)).toBe(false)
    // Sınır anı da geçmiş sayılır.
    expect(isSessionValid({ expiresAt: now }, now)).toBe(false)
  })

  it('oturum yoksa geçersizdir', () => {
    expect(isSessionValid(null, now)).toBe(false)
    expect(isSessionValid(undefined, now)).toBe(false)
  })

  it('bitiş anı ömür kadar ileridedir', () => {
    expect(sessionExpiry(now)).toBe(now + SESSION_TTL_MS)
  })
})

describe('hangi ekran', () => {
  it('yüklenirken bekletir', () => {
    expect(screenFor({ loading: true, user: null })).toBe('loading')
    // Yüklenirken kullanıcı varmış gibi görünse de bekler.
    expect(screenFor({ loading: true, user: {} })).toBe('loading')
  })

  it('kullanıcı yoksa giriş ister', () => {
    expect(screenFor({ loading: false, user: null })).toBe('login')
  })

  it('parola değişmeden uygulamayı göstermez', () => {
    // Zorunlu değişiklik bir öneri değil: uygulama açılmamalı.
    expect(screenFor({ loading: false, user: { mustChangePassword: true } })).toBe(
      'mustChangePassword',
    )
  })

  it('her şey tamamsa uygulamayı gösterir', () => {
    expect(screenFor({ loading: false, user: { mustChangePassword: false } })).toBe('app')
    expect(screenFor({ loading: false, user: {} })).toBe('app')
  })
})
