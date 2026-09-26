import { ConvexError, v } from 'convex/values'

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

/** Rol adları. Yetki kontrolü bunlarla yapılır. */
export const ROLES = ['admin', 'planner', 'maintenance', 'viewer'] as const
export type Role = (typeof ROLES)[number]

/**
 * Oturumu doğrular ve kullanıcıyı döner; geçersizse atar.
 *
 * `ctx` gevşek tiplenmiş: hem query hem mutation bağlamından çağrılıyor ve
 * üretilen Convex tipleri bu ortamda yok.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function requireUser(ctx: any, token: string | undefined) {
  if (!token) throw new ConvexError('Not signed in')

  const session = await ctx.db
    .query('sessions')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .withIndex('by_token', (q: any) => q.eq('token', token))
    .first()
  if (!session) throw new ConvexError('Not signed in')
  if (session.expiresAt <= Date.now()) {
    throw new ConvexError('Your session has expired — sign in again')
  }

  const user = await ctx.db.get(session.userId)
  if (!user) throw new ConvexError('Not signed in')
  // Pasife alınan kullanıcının açık jetonu işe yaramamalı.
  if (!user.active) throw new ConvexError('This account is no longer active')

  return user
}

/**
 * Belirli roller gerektirir.
 *
 * Rol, ekranda ne sunulduğunu değiştirmenin ötesinde artık gerçekten
 * kısıtlıyor: `viewer` hiçbir şey yazamaz, kullanıcı yönetimi yalnızca
 * `admin`'dedir.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function requireRole(ctx: any, token: string | undefined, roles: readonly Role[]) {
  const user = await requireUser(ctx, token)
  if (!roles.includes(user.role)) {
    throw new ConvexError(`This needs one of: ${roles.join(', ')} — you are ${user.role}`)
  }
  return user
}

/** Yazma yetkisi olan roller. `viewer` yalnızca okur. */
export const CAN_WRITE = ['admin', 'planner', 'maintenance'] as const

/** Yalnızca yöneticinin yapabileceği işler. */
export const ADMIN_ONLY = ['admin'] as const
