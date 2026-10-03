// @vitest-environment edge-runtime
import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import schema from './schema'
import { MAX_FAILED_LOGINS } from '../src/lib/authRules'

/**
 * Hatalı giriş kilidi (convex/auth.ts → authInternal): sayaç, kilit, kayıt;
 * başarılı giriş ve yeni parola sayacı sıfırlar.
 */
const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts', '!./planEngine.ts', '!./auth.ts'])
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

describe('giriş kilidi', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('art arda hatalı parola hesabı kilitler; yeni parola ve başarılı giriş sıfırlar', async () => {
    const t = convexTest(schema, modules)
    const id = await t.run((ctx: Any) => ctx.db.insert('users', { name: 'pl', role: 'planner', active: true, createdAt: Date.now() }))
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) {
      expect(await t.mutation(anyApi.authInternal.recordLoginFailure, { id })).toEqual({ locked: false })
    }
    expect(await t.mutation(anyApi.authInternal.recordLoginFailure, { id })).toEqual({ locked: true })
    let user: Any = await t.run((ctx: Any) => ctx.db.get(id))
    expect(user.lockedUntil).toBeGreaterThan(Date.now())
    const log: Any[] = await t.run((ctx: Any) => ctx.db.query('changeLog').collect())
    expect(log.map((l) => l.title)).toContain('Sign-in locked — pl')

    // Creator yeni parola verince kilit kalkar.
    await t.mutation(anyApi.authInternal.storePassword, { id, passwordHash: 'aa', passwordSalt: 'bb', mustChangePassword: true })
    user = await t.run((ctx: Any) => ctx.db.get(id))
    expect(user.lockedUntil).toBeUndefined()
    expect(user.failedLogins).toBeUndefined()

    // Başarılı giriş sayacı sıfırlar.
    await t.mutation(anyApi.authInternal.recordLoginFailure, { id })
    await t.mutation(anyApi.authInternal.createSession, { userId: id, token: 'tok' })
    user = await t.run((ctx: Any) => ctx.db.get(id))
    expect(user.failedLogins).toBeUndefined()
  })
})
