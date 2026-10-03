import { ConvexError, v } from 'convex/values'

import { userMutation, userQuery } from './guarded'
import { isPlatform } from '../src/lib/tenancy'

/**
 * Uygulama içi hata kaydı (todolist.md 4.1 — izleme): ekranda yakalanan
 * hatalar (sayfa çöktü, yakalanmamış hata) ve plan motoru hataları. Aynı
 * kaynak + mesaj 24 saat içinde tekrar gelirse yeni satır açılmaz, sayaç
 * artar. Yalnızca General görür (Companies and plants → System errors).
 * Dış servis (Sentry vb.) bağlanırsa bu kayıt yine kalır.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const DAY = 86_400_000

export interface ErrorEntry {
  source: 'client' | 'planEngine'
  message: string
  detail?: string
  url?: string
  user?: string
  plant?: string
}

export async function recordError(db: Any, e: ErrorEntry): Promise<void> {
  const now = Date.now()
  const message = (e.message || 'Unknown error').slice(0, 500)
  const key = `${e.source}|${message}`.slice(0, 300)
  const last = await db
    .query('errorLog')
    .withIndex('by_key', (q: Any) => q.eq('key', key))
    .order('desc')
    .first()
  const context = {
    ...(e.url ? { url: e.url.slice(0, 300) } : {}),
    ...(e.user ? { user: e.user } : {}),
    ...(e.plant ? { plant: e.plant } : {}),
  }
  if (last && now - last.lastAt < DAY) {
    await db.patch(last._id, { count: last.count + 1, lastAt: now, ...context })
    return
  }
  await db.insert('errorLog', {
    key,
    source: e.source,
    message,
    ...(e.detail ? { detail: e.detail.slice(0, 4000) } : {}),
    ...context,
    count: 1,
    firstAt: now,
    lastAt: now,
  })
}

/** Ekrandan gelen hata (ErrorBoundary, yakalanmamış hata). */
export const report = userMutation({
  args: { message: v.string(), stack: v.optional(v.string()), url: v.optional(v.string()), plant: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await recordError(ctx.db, { source: 'client', message: args.message, detail: args.stack, url: args.url, plant: args.plant, user: ctx.sessionUser.name })
    return null
  },
})

/** Son hatalar, en yeniden eskiye — yalnızca General. */
export const list = userQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    if (!isPlatform(ctx.sessionUser)) throw new ConvexError('Only a General can see system errors')
    return ctx.db.query('errorLog').withIndex('by_last').order('desc').take(100)
  },
})
