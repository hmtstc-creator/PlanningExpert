// @vitest-environment edge-runtime
import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import schema from './schema'
import { tokenKey } from './sessionStore'

/**
 * Master data yüklemesi: dosyada olmayan sütun kaydı silmez.
 *
 * Pres ve punta süreleri ayrı dosyalarda geliyor (kod + saniye). Böyle
 * üç sütunlu bir dosya yüklenince ana iş yeri, rulo verisi, setup süreleri ve
 * Accepted OEE yerinde kalmalı — yoksa tek yükleme bütün master data'yı
 * boşaltır. Kullanıcı 2026-10-29: "bu referanslar zaten var, sadece saniye
 * cinsinden süreleri alıp yerine koyacaksın".
 */

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

async function settle(t: Any) {
  for (let i = 0; i < 50; i++) {
    const done = await t.run(async (ctx: Any) => {
      const s = await ctx.db.query('platformState').first()
      return !!s?.value?.done
    })
    if (done) return
    await t.mutation(anyApi.tenancy.backfill, {})
  }
  throw new Error('migration did not finish')
}

/** Fabrika anahtarından önceki kurulum (tenancy.test.ts ile aynı desen). */
async function install(t: Any) {
  const admin = await t.run(async (ctx: Any) => {
    const id = await ctx.db.insert('users', { name: 'boss', role: 'admin', active: true, createdAt: Date.now() })
    await ctx.db.insert('presses', { name: 'PRS-106', hall: 'H1' })
    await ctx.db.insert('globalShiftSettings', {
      key: 'default', shiftMinutes: 480, overtimeShiftMinutes: 480, country: 'RO', timeZone: 'Europe/Bucharest',
    })
    return id
  })
  const token = await session(t, admin, 'boss')
  await t.mutation(api.tenancy.startMigration, { token })
  await settle(t)
  const plantId = (await t.query(api.tenancy.context, { token })).active.plantId
  return { token, plantId }
}

const full = {
  code: 'M1', mainMachine: 'PRS-106', altMachine1: 'PRS-107', coilWeight: 500, grossWeight: 2,
  minLotQty: 1000, setupMinutes: 45, coilSetupMinutes: 12, performanceFactor: 0.7,
  moldCavities: 2, spm: 30, rawMaterialCode: 'SAC1', maxShots: 100_000,
  qualityApprovalMinutes: 15, flexiblePress: true, stopEveryPcs: 400, cycleMinutes: 0.1,
}

describe('master data yüklemesi', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('yalnız kod + süre olan dosya başka hiçbir alanı silmez', async () => {
    const t = convexTest(schema, modules)
    const { token, plantId } = await install(t)
    await t.run((ctx: Any) => ctx.db.insert('products', { plantId, ...full }))

    // Pres dosyası: yalnız kod ve saniyeden gelen süre.
    const result = await t.mutation(api.products.bulkUpsert, {
      token,
      rows: [{ code: 'M1', cycleMinutes: 0.01852 }],
    })
    expect(result).toEqual({ inserted: 0, updated: 1 })

    const doc: Any = await t.run(async (ctx: Any) => (await ctx.db.query('products').collect())[0])
    expect(doc.cycleMinutes).toBe(0.01852)
    for (const [key, value] of Object.entries(full)) {
      if (key === 'cycleMinutes') continue
      expect({ [key]: doc[key] }).toEqual({ [key]: value })
    }
  })

  it('süre 5 haneye yuvarlanır (kayıt hassasiyeti), yeni parça eklenir', async () => {
    const t = convexTest(schema, modules)
    const { token } = await install(t)
    await t.mutation(api.products.bulkUpsert, {
      token,
      rows: [{ code: 'YENI', cycleMinutes: 0.018518518518518517 }],
    })
    const doc: Any = await t.run(async (ctx: Any) => (await ctx.db.query('products').collect())[0])
    expect(doc.cycleMinutes).toBe(0.01852)
  })
})
