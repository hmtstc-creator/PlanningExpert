import { describe, expect, it } from 'vitest'

import {
  isDefaultPassword,
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

  it('çok kısa parolayı reddeder', () => {
    expect(validatePassword('ab')).toContain('4 characters')
  })

  it('kabul edilebilir parolaya karışmaz', () => {
    expect(validatePassword('admin')).toBeNull()
    expect(validatePassword('pres-2026!')).toBeNull()
  })

  it('varsayılan parolayı tanır', () => {
    expect(isDefaultPassword('admin')).toBe(true)
    expect(isDefaultPassword('Admin')).toBe(false)
    expect(isDefaultPassword('baska')).toBe(false)
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
