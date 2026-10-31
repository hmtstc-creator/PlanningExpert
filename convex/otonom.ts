import { ConvexError, v } from 'convex/values'

import { internalQuery } from './_generated/server'
import { audit } from './audit'
import { userMutation, userQuery } from './guarded'

/**
 * Otonom geliştirme aç / kapat (wiki 13). Yalnız site sahibi değiştirir; varsayılan KAPALI.
 * Sunucuda `planningexpert-otonom-anahtar` (root, 5 dakikada bir) `aktifMi`'yi okur ve
 * /etc/otonom/DURDUR dosyasını buna göre koyar / kaldırır.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const KEY = 'otonomAktif'

async function oku(db: Any): Promise<{ aktif: boolean; updatedAt: number | null; by: string | null }> {
  const s = await db
    .query('platformState')
    .withIndex('by_key', (q: Any) => q.eq('key', KEY))
    .first()
  return { aktif: !!s?.value?.aktif, updatedAt: s?.updatedAt ?? null, by: s?.value?.by ?? null }
}

function sahipMi(user: Any) {
  if (user.platformRole !== 'owner') throw new ConvexError('Only the site owner can do this')
}

export const durum = userQuery({
  args: {},
  handler: async (ctx) => {
    sahipMi(ctx.sessionUser)
    return oku(ctx.db)
  },
})

export const ayarla = userMutation({
  args: { aktif: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { aktif }) => {
    const me = ctx.sessionUser
    sahipMi(me)
    const value = { aktif, by: me.name }
    const s = await ctx.db
      .query('platformState')
      .withIndex('by_key', (q: Any) => q.eq('key', KEY))
      .first()
    if (s) await ctx.db.patch(s._id, { value, updatedAt: Date.now() })
    else await ctx.db.insert('platformState', { key: KEY, value, updatedAt: Date.now() })
    await audit(ctx.db, { actor: me.name, action: aktif ? 'otonom.on' : 'otonom.off', target: 'Autonomous development' })
    return null
  },
})

/** Sunucu anahtarı okur (`npx convex run otonom:aktifMi`, yönetici anahtarıyla). */
export const aktifMi = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => (await oku(ctx.db)).aktif,
})
