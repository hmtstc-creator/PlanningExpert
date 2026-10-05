import { ConvexError, v } from 'convex/values'

import { findSession } from './sessionStore'

/**
 * Sunucu tarafı yetki denetimi.
 *
 * Giriş ekranı yalnızca EKRANI koruyordu: Convex işlevleri deploy adresini
 * bilen herkes tarafından doğrudan çağrılabiliyordu. Artık her genel sorgu
 * ve mutasyon oturumu kendisi denetliyor.
 *
 * Denetimden muaf olanlar, ve yalnızca bunlar:
 * - `auth.login`     — girerken elde jeton olmaz
 * - `auth.seedAdmin` — ilk kurulumda hiç kullanıcı yokken çalışır
 * - `auth.logout`    — süresi dolmuş jetonu da silebilmeli
 * - `authInternal.me`— jetonun kime ait olduğunu söyleyen sorgu
 *
 * Başka hiçbir işlev muaf değildir; unutulan bir işlev sessizce açık
 * kalmaz, gürültülü biçimde hata verir.
 */

/** Her genel işlevin args'ına eklenen alan. */
export const sessionArg = { token: v.optional(v.string()) }

/**
 * Oturumu doğrular; kullanıcıyı ve oturum kaydını döner, geçersizse atar.
 *
 * `ctx` gevşek tiplenmiş: hem query hem mutation bağlamından çağrılıyor ve
 * üretilen Convex tipleri bu ortamda yok.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function requireSession(ctx: any, token: string | undefined) {
  if (!token) throw new ConvexError('Not signed in')

  // Jeton veritabanında karma olarak durur (sessionStore.ts).
  const session = await findSession(ctx.db, token)
  if (!session) throw new ConvexError('Not signed in')
  if (session.expiresAt <= Date.now()) {
    throw new ConvexError('Your session has expired — sign in again')
  }

  const user = await ctx.db.get(session.userId)
  if (!user) throw new ConvexError('Not signed in')
  // Pasife alınan kullanıcının açık jetonu işe yaramamalı.
  if (!user.active) throw new ConvexError('This account is no longer active')

  return { user, session }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function requireUser(ctx: any, token: string | undefined) {
  return (await requireSession(ctx, token)).user
}
