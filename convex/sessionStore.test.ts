// @vitest-environment edge-runtime
import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { describe, expect, it } from 'vitest'

import schema from './schema'
import { tokenKey } from './sessionStore'

/** Oturum jetonu veritabanında karma olarak durur; eski açık jetonlar süreleri boyunca çalışır. */
const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts', '!./planEngine.ts', '!./auth.ts'])
const api = anyApi
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

async function user(t: Any) {
  return t.run((ctx: Any) => ctx.db.insert('users', { name: 'zeynep', role: 'member', active: true, createdAt: 0 }))
}

describe('oturum jetonu', () => {
  it('karma ile saklanan oturum açılır; karmanın kendisi jeton olarak işe yaramaz', async () => {
    const t = convexTest(schema, modules)
    const id = await user(t)
    const token = 'a'.repeat(64)
    await t.run((ctx: Any) => ctx.db.insert('sessions', { token: tokenKey(token), userId: id, createdAt: 0, expiresAt: Date.now() + 60_000 }))
    expect((await t.query(api.authInternal.me, { token }))?.name).toBe('zeynep')
    // Yedekten sızan değer ("h:…") ile giriş olmaz.
    expect(await t.query(api.authInternal.me, { token: tokenKey(token) })).toBeNull()
  })

  it('eski (açık) jeton süresi bitene kadar çalışır; giriş yeni oturumu karmayla yazar', async () => {
    const t = convexTest(schema, modules)
    const id = await user(t)
    await t.run((ctx: Any) => ctx.db.insert('sessions', { token: 'legacy-token', userId: id, createdAt: 0, expiresAt: Date.now() + 60_000 }))
    expect((await t.query(api.authInternal.me, { token: 'legacy-token' }))?.name).toBe('zeynep')
    const fresh = 'b'.repeat(64)
    await t.mutation((anyApi as Any).authInternal.createSession, { userId: id, token: fresh })
    const stored: Any[] = await t.run((ctx: Any) => ctx.db.query('sessions').collect())
    expect(stored.map((s: Any) => s.token)).not.toContain(fresh)
    expect(stored.map((s: Any) => s.token)).toContain(tokenKey(fresh))
    const u: Any = await t.run((ctx: Any) => ctx.db.get(id))
    expect(u.lastLoginAt).toBeGreaterThan(0)
  })

  it('süresi dolmuş oturum açılmaz ve gece temizliğinde silinir', async () => {
    const t = convexTest(schema, modules)
    const id = await user(t)
    const token = 'c'.repeat(64)
    await t.run((ctx: Any) => ctx.db.insert('sessions', { token: tokenKey(token), userId: id, createdAt: 0, expiresAt: Date.now() - 1 }))
    expect(await t.query(api.authInternal.me, { token })).toBeNull()
    expect(await t.mutation((anyApi as Any).tenancy.purgeExpiredSessions, {})).toBe(1)
  })
})
