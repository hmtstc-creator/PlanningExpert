import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { ADMIN_ONLY, requireRole, requireUser, type Role } from './authGuard'

/**
 * Oturum denetimi yapan `query` / `mutation` sarmalayıcıları.
 *
 * Yüz küsur işlevin her birinin gövdesine elle denetim eklemek yerine
 * tanımın kendisi sarmalanıyor: çağrı `query(...)` yerine
 * `guardedQuery(...)` oluyor, gerisi aynı kalıyor. Böylece hiçbir handler
 * kesilip biçilmiyor ve bir işlevin korumasız kaldığı tek yerden görülüyor
 * — dosyada `query(` kalmışsa korumasızdır.
 *
 * Denetimden muaf olması GEREKEN işlevler (giriş, ilk kurulum, çıkış ve
 * jetonun sahibini söyleyen sorgu) bilerek sarmalanmıyor; onlar `auth.ts`
 * ve `authInternal.ts` içinde ve orada gerekçesi yazıyor.
 */

// Convex'in üretilen tipleri bu ortamda yok; sarmalayıcı gevşek tiplenmiş.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

function withSessionArg(args: Any): Any {
  return { ...(args ?? {}), token: v.optional(v.string()) }
}

/** Giriş yapmış herkesin çalıştırabileceği sorgu. */
export function guardedQuery(spec: Any): Any {
  return query({
    ...spec,
    args: withSessionArg(spec.args),
    handler: async (ctx: Any, args: Any) => {
      await requireUser(ctx, args.token)
      return spec.handler(ctx, args)
    },
  })
}

/**
 * Yazma işlemi. Varsayılan olarak `viewer` dışındaki roller yapabilir —
 * salt okur bir kullanıcının veriyi değiştirebilmesi rolü anlamsız kılardı.
 */
export function guardedMutation(spec: Any, roles?: readonly Role[]): Any {
  return mutation({
    ...spec,
    args: withSessionArg(spec.args),
    handler: async (ctx: Any, args: Any) => {
      if (roles) await requireRole(ctx, args.token, roles)
      else await requireUser(ctx, args.token)
      return spec.handler(ctx, args)
    },
  })
}

/** Yalnızca yöneticinin yapabileceği işler. */
export function adminMutation(spec: Any): Any {
  return guardedMutation(spec, ADMIN_ONLY)
}
