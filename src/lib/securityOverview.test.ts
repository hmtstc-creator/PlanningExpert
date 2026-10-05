import { describe, expect, it } from 'vitest'

import { DORMANT_DAYS, LAST_LOGIN_TRACKED_SINCE, securityOverview, type SecurityUser } from './securityOverview'
import { bucketStart } from './signinGuard'

const DAY = 24 * 60 * 60_000
const NOW = LAST_LOGIN_TRACKED_SINCE + 200 * DAY

const user = (p: Partial<SecurityUser>): SecurityUser => ({
  _id: p.name ?? 'u',
  name: 'u',
  active: true,
  hasPassword: true,
  createdAt: LAST_LOGIN_TRACKED_SINCE - 400 * DAY,
  lastLoginAt: NOW - DAY,
  ...p,
})

const find = (o: ReturnType<typeof securityOverview>, key: string) => o.findings.find((f) => f.key === key)

describe('güvenlik özeti', () => {
  it('kilitli hesaplar', () => {
    const o = securityOverview([user({ name: 'a', lockedUntil: NOW + 5 * 60_000 }), user({ name: 'b', lockedUntil: NOW - 1 })], [], 0, NOW)
    expect(find(o, 'locked')?.users.map((u) => u.name)).toEqual(['a'])
    expect(find(o, 'locked')?.users[0].note).toBe('5 min left')
  })

  it('uykudaki yönetici ayrı ve yüksek önemde; pasif hesap sayılmaz', () => {
    const old = NOW - (DORMANT_DAYS + 1) * DAY
    const o = securityOverview(
      [
        user({ name: 'boss', isCreator: true, lastLoginAt: old }),
        user({ name: 'op', lastLoginAt: old }),
        user({ name: 'gone', lastLoginAt: old, active: false }),
        user({ name: 'fresh' }),
      ],
      [],
      0,
      NOW,
    )
    expect(find(o, 'dormantPrivileged')?.severity).toBe('high')
    expect(find(o, 'dormantPrivileged')?.users.map((u) => u.name)).toEqual(['boss'])
    expect(find(o, 'dormant')?.users.map((u) => u.name)).toEqual(['op'])
  })

  it('son giriş yazılmadan önceki hesaplar hemen uykuda sayılmaz', () => {
    const o = securityOverview([user({ name: 'old', lastLoginAt: undefined })], [], 0, LAST_LOGIN_TRACKED_SINCE + 10 * DAY)
    expect(find(o, 'dormant')).toBeUndefined()
  })

  it('geçici parola; yöneticiyse orta önem', () => {
    const o = securityOverview([user({ name: 'new', mustChangePassword: true, createdAt: NOW - DAY })], [], 0, NOW)
    expect(find(o, 'temporary')?.severity).toBe('info')
    const o2 = securityOverview(
      [user({ name: 'admin', mustChangePassword: true, platformRole: 'owner', createdAt: NOW - DAY })],
      [],
      0,
      NOW,
    )
    expect(find(o2, 'temporary')?.severity).toBe('medium')
  })

  it('giriş istatistiği ve şu anki bekleme', () => {
    const o = securityOverview([], [{ bucket: bucketStart(NOW), failures: 40, unknownNames: 30 }], 3, NOW)
    expect(o.signins).toEqual({ last24h: 40, last7d: 40, unknown7d: 30, window: 40, delayMs: 1000 })
    expect(o.counts.activeSessions).toBe(3)
  })
})
