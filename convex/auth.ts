'use node'

import { v } from 'convex/values'
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'

import { api, internal } from './_generated/api'
import { action } from './_generated/server'

/**
 * Giriş.
 *
 * Parolalar PBKDF2-SHA512 ile, kullanıcıya özel rastgele tuzla saklanır.
 * Düz parola hiçbir yere yazılmaz ve tarayıcıya geri dönmez. Karma işlemi
 * Node kriptosu gerektirdiği için bu dosya action olarak çalışıyor.
 *
 * Oturum jetonu her sorgu ve mutasyonda sunucuda denetlenir (guarded.ts);
 * yani deploy adresini bilen biri de jetonsuz veri okuyamaz ya da yazamaz.
 */
const ITERATIONS = 120_000
const KEY_LENGTH = 64
const DIGEST = 'sha512'

function hashPassword(password: string, salt: string): string {
  return pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex')
}

/**
 * Sabit süreli karşılaştırma: `===` ilk farklı bayta kadar çalışır ve
 * süreden parola sızdırır.
 */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  if (left.length !== right.length || left.length === 0) return false
  return timingSafeEqual(left, right)
}

const DEFAULT_ADMIN_USERNAME = 'admin'
const DEFAULT_ADMIN_PASSWORD = 'admin'
const MIN_PASSWORD_LENGTH = 4

function assertPassword(password: string): void {
  if (password.trim().length === 0) throw new Error('A password cannot be empty')
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`The password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
}

/**
 * Hiç kullanıcı yoksa ilk yöneticiyi oluşturur: admin / admin.
 *
 * Yalnızca boş bir kurulumda çalışır — var olan bir sistemin yöneticisini
 * sıfırlamak, giriş eklemenin tüm anlamını ortadan kaldırırdı. Hesap
 * "parolanı değiştir" işaretiyle doğar.
 */
export const seedAdmin = action({
  // Taşıma katmanı her çağrıya jeton ekliyor; bu işlev denetimden muaf ama
  // alanı yine de tanımlamalı, yoksa Convex bilinmeyen alan diye reddeder.
  args: { token: v.optional(v.string()) },
  returns: v.object({ created: v.boolean() }),
  handler: async (ctx): Promise<{ created: boolean }> => {
    const existing: number = await ctx.runQuery(internal.authInternal.countUsers, {})
    if (existing > 0) return { created: false }

    const salt = randomBytes(16).toString('hex')
    await ctx.runMutation(internal.authInternal.createUserWithPassword, {
      name: DEFAULT_ADMIN_USERNAME,
      role: 'admin',
      passwordHash: hashPassword(DEFAULT_ADMIN_PASSWORD, salt),
      passwordSalt: salt,
      mustChangePassword: true,
    })
    return { created: true }
  },
})

export const login = action({
  // `token` taşıma katmanından gelir ve YOK SAYILIR: girerken elde geçerli
  // bir jeton olmaz, eski bir jetonun girişi etkilemesi de istenmez.
  args: { name: v.string(), password: v.string(), token: v.optional(v.string()) },
  returns: v.object({ token: v.string() }),
  handler: async (ctx, args): Promise<{ token: string }> => {
    const name = args.name.trim()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user: any = await ctx.runQuery(internal.authInternal.findUser, { name })

    // Kullanıcı yok, parolası yok ya da pasif — hepsi aynı mesajı verir.
    // Hangisinin doğru olduğunu söylemek, var olan kullanıcı adlarını
    // sayar.
    const failed = new Error('Wrong user name or password')
    if (!user || !user.active || !user.passwordHash || !user.passwordSalt) throw failed
    if (!hashesMatch(hashPassword(args.password, user.passwordSalt), user.passwordHash)) {
      throw failed
    }

    const token = randomBytes(32).toString('hex')
    await ctx.runMutation(internal.authInternal.createSession, { userId: user._id, token })
    return { token }
  },
})

export const logout = action({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, { token }): Promise<null> => {
    await ctx.runMutation(internal.authInternal.deleteSession, { token })
    return null
  },
})

/** Kullanıcının kendi parolasını değiştirmesi — eskisini bilmesi gerekir. */
export const changePassword = action({
  args: { token: v.string(), currentPassword: v.string(), newPassword: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    assertPassword(args.newPassword)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const me: any = await ctx.runQuery(api.authInternal.me, { token: args.token })
    if (!me) throw new Error('Your session has expired — sign in again')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user: any = await ctx.runQuery(internal.authInternal.findUser, { name: me.name })
    if (!user?.passwordHash || !user.passwordSalt) throw new Error('User not found')

    if (!hashesMatch(hashPassword(args.currentPassword, user.passwordSalt), user.passwordHash)) {
      throw new Error('The current password is wrong')
    }
    if (args.newPassword === args.currentPassword) {
      throw new Error('The new password must be different from the current one')
    }

    const salt = randomBytes(16).toString('hex')
    await ctx.runMutation(internal.authInternal.storePassword, {
      id: user._id,
      passwordHash: hashPassword(args.newPassword, salt),
      passwordSalt: salt,
      mustChangePassword: false,
      // Kendi oturumu açık kalsın; diğer cihazlar kapansın.
      keepToken: args.token,
      actor: me.name,
    })
    return null
  },
})

/**
 * Yöneticinin başkasının parolasını belirlemesi.
 *
 * Eski parola sorulmaz — zaten bilinmiyor olabilir — ama kullanıcı ilk
 * girişte kendi parolasını koymaya zorlanır.
 */
export const setPasswordAsAdmin = action({
  args: { token: v.string(), userId: v.id('users'), newPassword: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    assertPassword(args.newPassword)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const me: any = await ctx.runQuery(api.authInternal.me, { token: args.token })
    if (!me) throw new Error('Your session has expired — sign in again')
    if (me.role !== 'admin') throw new Error('Only an admin can set another password')

    const salt = randomBytes(16).toString('hex')
    await ctx.runMutation(internal.authInternal.storePassword, {
      id: args.userId,
      passwordHash: hashPassword(args.newPassword, salt),
      passwordSalt: salt,
      mustChangePassword: true,
      actor: me.name,
    })
    return null
  },
})
