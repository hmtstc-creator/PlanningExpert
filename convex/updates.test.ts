// @vitest-environment edge-runtime
import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import schema from './schema'
import { tokenKey } from './sessionStore'

/**
 * Ana sayfa Updates (docs/updates.md): kişi yalnızca okuyabildiği modülün
 * olayını ve verisinin tarihini görür; başka plant'in kaydı hiç görünmez.
 */

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts', '!./planEngine.ts', '!./auth.ts'])
const api = anyApi
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const H = 3_600_000

async function session(t: Any, userId: string, token: string) {
  await t.run((ctx: Any) => ctx.db.insert('sessions', { token: tokenKey(token), userId, createdAt: Date.now(), expiresAt: Date.now() + H }))
  return token
}

describe('Updates paneli', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 9, 19, 9, 0))
  })
  afterEach(() => vi.useRealTimers())

  it('modül izni kaynak başına; başka plant görünmez', async () => {
    const t = convexTest(schema, modules)
    const ids = await t.run(async (ctx: Any) => {
      const now = Date.now()
      await ctx.db.insert('platformState', { key: 'plantMigration', value: { done: true }, updatedAt: now })
      const company = await ctx.db.insert('companies', { name: 'A', status: 'active', modules: ['planning', 'oee', 'die', 'machine'], createdAt: now })
      const plant = await ctx.db.insert('plants', { companyId: company, name: 'P1', timeZone: 'UTC', createdAt: now })
      const other = await ctx.db.insert('plants', { companyId: company, name: 'P2', timeZone: 'UTC', createdAt: now })
      const group = (name: string, permissions: Any) => ctx.db.insert('userGroups', { companyId: company, name, allPlants: false, plantIds: [plant], permissions, createdAt: now })
      const dieOnly = await group('Die', { die: 'view' })
      const oeeOnly = await group('OEE', { oee: 'view' })
      const user = (name: string, groupIds: string[]) => ctx.db.insert('users', { name, role: 'viewer', active: true, createdAt: now, companyId: company, groupIds, passwordHash: 'h' })
      const die = await user('die', [dieOnly])
      const oee = await user('oee', [oeeOnly])
      const creator = await ctx.db.insert('users', { name: 'cr', role: 'admin', active: true, createdAt: now, companyId: company, isCreator: true, passwordHash: 'h' })

      const problem = (plantId: string, material: string) => ({
        plantId,
        material,
        operation: 'OP20',
        problemType: 'Burr',
        occurredAt: '2026-10-19',
        reportedAt: now - H,
        reportedBy: 'Ayse',
        status: 'open',
        press: 'P1',
        action: 'Grind punch',
      })
      await ctx.db.insert('moldProblems', problem(plant, '4711'))
      await ctx.db.insert('moldProblems', problem(other, '9999'))
      await ctx.db.insert('oeeImports', { plantId: plant, fileName: 'oee.xlsx', uploadedAt: now - 2 * H, uploadedBy: 'Ece', sheets: [], ranges: [] })
      await ctx.db.insert('sapUploads', { plantId: plant, key: 'stock', fileName: 'mb52.xlsx', uploadedAt: now - 3 * H, rowsInFile: 10, rowsImported: 10, skippedUnknownMaterial: 0, skippedUnknownLocation: 0 })
      await ctx.db.insert('changeLog', { plantId: plant, title: 'Plan approved — 12 jobs', category: 'decision', author: 'Mehmet', createdAt: now - 4 * H })
      return { die, oee, creator }
    })

    const die = await t.query(api.updates.feed, { token: await session(t, ids.die, 'die') })
    expect(die.feed.map((f: Any) => f.title)).toEqual(['New die topic — 4711 OP20'])
    expect(die.feed[0].detail).toBe('Burr on P1 · Action: Grind punch')
    expect(die.freshness).toEqual([])

    const oee = await t.query(api.updates.feed, { token: await session(t, ids.oee, 'oee') })
    expect(oee.feed.map((f: Any) => f.module)).toEqual(['oee'])
    expect(oee.freshness.map((r: Any) => r.key)).toEqual(['oee'])

    const all = await t.query(api.updates.feed, { token: await session(t, ids.creator, 'cr') })
    expect(all.feed.map((f: Any) => f.title)).toEqual(['New die topic — 4711 OP20', 'OEE data uploaded', 'Stock — MB52 uploaded', 'Plan approved'])
    expect(all.freshness.find((r: Any) => r.key === 'planApproved')).toMatchObject({ by: 'Mehmet' })
    expect(JSON.stringify(all)).not.toContain('9999')
  })
})
