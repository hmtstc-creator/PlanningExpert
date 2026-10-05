// @vitest-environment edge-runtime
import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import schema from './schema'
import { tokenKey } from './sessionStore'

/** Sitenin hacklenmesine karşı: genel giriş freni, sahipsiz yüklemeler, güvenlik özeti. */

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts', '!./planEngine.ts', '!./auth.ts'])
const api = anyApi
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

async function session(t: Any, userId: string, token: string) {
  await t.run((ctx: Any) =>
    ctx.db.insert('sessions', { token: tokenKey(token), userId, createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 }),
  )
  return token
}

describe('güvenlik', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 9, 5, 12, 0))
  })
  afterEach(() => vi.useRealTimers())

  it('çok hatalı giriş: sayaç yükselir, eşik bir kez denetim kaydına yazılır', async () => {
    const t = convexTest(schema, modules)
    for (let i = 0; i < 31; i++) await t.mutation(api.authInternal.recordSigninFailure, { unknown: i % 2 === 0 })
    expect(await t.query(api.authInternal.signinPressure, {})).toBe(31)
    const audit: Any[] = await t.run((ctx: Any) => ctx.db.query('auditLog').collect())
    expect(audit.filter((a) => a.action === 'signin.pressure')).toHaveLength(1)
    // 30 dakika sonra pencere boşalır; istatistik 30 gün saklanır.
    vi.setSystemTime(Date.UTC(2026, 9, 5, 12, 40))
    expect(await t.query(api.authInternal.signinPressure, {})).toBe(0)
    vi.setSystemTime(Date.UTC(2026, 10, 5, 12, 0))
    await t.mutation(api.tenancy.purgeExpiredSessions, {})
    expect(await t.run((ctx: Any) => ctx.db.query('signinStats').collect())).toEqual([])
  })

  it('kayda bağlanmayan eski yükleme silinir; bağlı ya da yeni olan kalır', async () => {
    const t = convexTest(schema, modules)
    const blob = () => new Blob(['x'], { type: 'image/png' })
    const [used, orphan] = await t.run(async (ctx: Any) => [await ctx.storage.store(blob()), await ctx.storage.store(blob())])
    await t.run((ctx: Any) =>
      ctx.db.insert('machineProblems', {
        press: 'PRS-1',
        problemType: 'Hydraulic',
        stopsPress: false,
        description: 'x',
        occurredAt: '2026-10-05',
        reportedAt: Date.now(),
        status: 'open',
        photos: [used],
      }),
    )
    vi.setSystemTime(Date.UTC(2026, 9, 6, 13, 0))
    const fresh = await t.run((ctx: Any) => ctx.storage.store(blob()))
    expect(await t.mutation(api.tenancy.purgeOrphanUploads, {})).toBe(1)
    const left: Any[] = await t.run((ctx: Any) => ctx.db.system.query('_storage').collect())
    expect(left.map((f) => f._id).sort()).toEqual([used, fresh].sort())
    expect(left.some((f) => f._id === orphan)).toBe(false)
  })

  it('güvenlik özeti: General hepsini, creator yalnızca kendi şirketini görür', async () => {
    const t = convexTest(schema, modules)
    const ids = await t.run(async (ctx: Any) => {
      const now = Date.now()
      const c1 = await ctx.db.insert('companies', { name: 'A', status: 'active', modules: ['planning'], createdAt: now })
      const c2 = await ctx.db.insert('companies', { name: 'B', status: 'active', modules: ['planning'], createdAt: now })
      const owner = await ctx.db.insert('users', {
        name: 'owner',
        role: 'admin',
        active: true,
        createdAt: now,
        platformRole: 'owner',
        passwordHash: 'h',
      })
      const cr = await ctx.db.insert('users', {
        name: 'cr',
        role: 'admin',
        active: true,
        createdAt: now,
        companyId: c1,
        isCreator: true,
        passwordHash: 'h',
      })
      await ctx.db.insert('users', {
        name: 'locked',
        role: 'viewer',
        active: true,
        createdAt: now,
        companyId: c1,
        passwordHash: 'h',
        lockedUntil: now + 60_000,
      })
      await ctx.db.insert('users', {
        name: 'other',
        role: 'viewer',
        active: true,
        createdAt: now,
        companyId: c2,
        passwordHash: 'h',
        mustChangePassword: true,
      })
      return { c1, c2, owner, cr }
    })
    const owner = await session(t, ids.owner, 'owner')
    const all = await t.query(api.platform.securityOverview, { token: owner })
    expect(all.platform).toBe(true)
    expect(all.counts.active).toBe(4)
    expect(all.findings.find((f: Any) => f.key === 'locked').users[0]).toMatchObject({ name: 'locked', company: 'A' })
    expect(JSON.stringify(all)).not.toContain('passwordHash')

    const cr = await session(t, ids.cr, 'cr')
    const mine = await t.query(api.platform.securityOverview, { token: cr, companyId: ids.c1 })
    expect(mine.platform).toBe(false)
    expect(mine.counts.active).toBe(2)
    expect(mine.findings.find((f: Any) => f.key === 'temporary')).toBeUndefined()
    await expect(t.query(api.platform.securityOverview, { token: cr, companyId: ids.c2 })).rejects.toThrow(/creator of this company/)
    await expect(t.query(api.platform.securityOverview, { token: cr })).rejects.toThrow(/General/)
  })
})
