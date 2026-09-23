import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { ADMIN_ONLY, requireRole, requireUser, type Role } from './authGuard'
import { requestRecompute } from './planQueue'

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

/**
 * Jeton yalnızca denetim içindir; handler'a gitmez. Gitseydi `args`'ı olduğu
 * gibi kayda yazan işlevler (ör. `ctx.db.patch(id, args)`) şemada olmayan
 * bir `token` alanı yazmaya kalkar ve hata verirdi.
 */
function withoutToken(args: Any): Any {
  const { token: _token, ...rest } = args ?? {}
  return rest
}

/** Giriş yapmış herkesin çalıştırabileceği sorgu. */
export function guardedQuery(spec: Any): Any {
  return query({
    ...spec,
    args: withSessionArg(spec.args),
    handler: async (ctx: Any, args: Any) => {
      await requireUser(ctx, args.token)
      return spec.handler(ctx, withoutToken(args))
    },
  })
}

/**
 * Yazma işlemi. Varsayılan olarak `viewer` dışındaki roller yapabilir —
 * salt okur bir kullanıcının veriyi değiştirebilmesi rolü anlamsız kılardı.
 */
export function guardedMutation(spec: Any, roles?: readonly Role[]): Any {
  // `affectsPlan: false` — planın okumadığı veriyi yazan işlevler (kullanıcılar,
  // kalıp problemleri, sözlükler…) planı yeniden hesaplatmaz.
  const { affectsPlan = true, ...definition } = spec
  return mutation({
    ...definition,
    args: withSessionArg(definition.args),
    handler: async (ctx: Any, args: Any) => {
      if (roles) await requireRole(ctx, args.token, roles)
      else await requireUser(ctx, args.token)
      const result = await definition.handler(ctx, withoutToken(args))
      // Plan sunucuda hesaplanıyor: girdisi değişince kısa bir gecikmeyle
      // yeniden hesaplanır. Art arda gelen yazmalar tek hesapta birleşir.
      if (affectsPlan) await requestRecompute(ctx)
      return result
    },
  })
}

/** Yalnızca yöneticinin yapabileceği işler. */
export function adminMutation(spec: Any): Any {
  return guardedMutation(spec, ADMIN_ONLY)
}
