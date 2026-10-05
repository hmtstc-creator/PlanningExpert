'use node'

import { ConvexError, v } from 'convex/values'
import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'

import { api, internal } from './_generated/api'
import { action, internalAction } from './_generated/server'
import { DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_USERNAME, lockRemainingMs, validatePassword } from '../src/lib/authRules'
import { PWNED_RANGE_URL, PWNED_TIMEOUT_MS, pwnedCount, pwnedMessage, splitSha1 } from '../src/lib/pwned'
import { signinDelayMs } from '../src/lib/signinGuard'

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
/** Yeni karmalar: OWASP 2023 önerisi (PBKDF2-HMAC-SHA512 ≥ 210 000). */
const ITERATIONS = 210_000
/** `passwordIterations` alanı olmayan eski karmalar; ilk girişte yükseltilir. */
const LEGACY_ITERATIONS = 120_000
const KEY_LENGTH = 64
const DIGEST = 'sha512'

function hashPassword(password: string, salt: string, iterations = ITERATIONS): string {
  return pbkdf2Sync(password, salt, iterations, KEY_LENGTH, DIGEST).toString('hex')
}

/** Var olmayan kullanıcıda da aynı iş yapılır: cevap süresi kullanıcı adını ele vermesin. */
const DUMMY_SALT = randomBytes(16).toString('hex')

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

/** Yeni parola kuralı tek yerde: src/lib/authRules.ts (ekran da aynısını kullanır). */
function assertPassword(password: string, userName?: string): void {
  const problem = validatePassword(password, userName)
  if (problem) throw new ConvexError(problem)
}

/**
 * Yeni parola bilinen sızıntılarda geçiyor mu (src/lib/pwned.ts)? Servise
 * yalnızca SHA-1 karmasının ilk 5 hanesi gider. Servis cevap vermezse
 * parola reddedilmez. Kapatmak için Convex ortam değişkeni PWNED_CHECK=off.
 */
async function assertNotBreached(password: string): Promise<void> {
  if (process.env.PWNED_CHECK === 'off') return
  const { prefix, suffix } = splitSha1(createHash('sha1').update(password, 'utf8').digest('hex'))
  let body: string
  try {
    const res = await fetch(PWNED_RANGE_URL + prefix, { headers: { 'Add-Padding': 'true' }, signal: AbortSignal.timeout(PWNED_TIMEOUT_MS) })
    if (!res.ok) return
    body = await res.text()
  } catch {
    return
  }
  const count = pwnedCount(body, suffix)
  if (count > 0) throw new ConvexError(pwnedMessage(count))
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function lockedMessage(ms: number): string {
  return `Too many wrong passwords — the account is locked for ${Math.ceil(ms / 60_000)} more minute(s). A creator can also set a new password.`
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
      passwordIterations: ITERATIONS,
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
    // Genel fren (src/lib/signinGuard.ts): son 30 dakikada çok hatalı giriş
    // varsa her giriş birkaç saniye bekler — çok hesaba yayılan tahmin yavaşlar.
    const pressure: number = await ctx.runQuery(internal.authInternal.signinPressure, {})
    const delay = signinDelayMs(pressure)
    if (delay > 0) await sleep(delay)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user: any = await ctx.runQuery(internal.authInternal.findUser, { name })

    // Kullanıcı yok, parolası yok ya da pasif — hepsi aynı mesajı verir.
    // Hangisinin doğru olduğunu söylemek, var olan kullanıcı adlarını
    // sayar.
    const failed = new Error('Wrong user name or password')
    if (!user || !user.active || !user.passwordHash || !user.passwordSalt) {
      hashPassword(args.password, DUMMY_SALT)
      await ctx.runMutation(internal.authInternal.recordSigninFailure, { unknown: !user })
      throw failed
    }
    // Kilitliyken parola denenmez (kaba kuvvet denemesi kilit süresince durur).
    const wait = lockRemainingMs(user, Date.now())
    if (wait > 0) {
      await ctx.runMutation(internal.authInternal.recordSigninFailure, { unknown: false })
      throw new ConvexError(lockedMessage(wait))
    }
    const iterations = user.passwordIterations ?? LEGACY_ITERATIONS
    if (!hashesMatch(hashPassword(args.password, user.passwordSalt, iterations), user.passwordHash)) {
      const r: { locked: boolean } = await ctx.runMutation(internal.authInternal.recordLoginFailure, { id: user._id })
      if (r.locked) throw new ConvexError(lockedMessage(15 * 60_000))
      throw failed
    }
    // Eski (daha zayıf) karma: parola elimizdeyken güncel ayarla yeniden karılır.
    if (iterations < ITERATIONS) {
      const salt = randomBytes(16).toString('hex')
      await ctx.runMutation(internal.authInternal.upgradeHash, {
        id: user._id,
        passwordHash: hashPassword(args.password, salt),
        passwordSalt: salt,
        passwordIterations: ITERATIONS,
      })
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const me: any = await ctx.runQuery(api.authInternal.me, { token: args.token })
    if (!me) throw new ConvexError('Your session has expired — sign in again')
    assertPassword(args.newPassword, me.name)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user: any = await ctx.runQuery(internal.authInternal.findUser, { name: me.name })
    if (!user?.passwordHash || !user.passwordSalt) throw new ConvexError('User not found')

    if (!hashesMatch(hashPassword(args.currentPassword, user.passwordSalt, user.passwordIterations ?? LEGACY_ITERATIONS), user.passwordHash)) {
      throw new ConvexError('The current password is wrong')
    }
    if (args.newPassword === args.currentPassword) {
      throw new ConvexError('The new password must be different from the current one')
    }
    await assertNotBreached(args.newPassword)

    const salt = randomBytes(16).toString('hex')
    await ctx.runMutation(internal.authInternal.storePassword, {
      id: user._id,
      passwordHash: hashPassword(args.newPassword, salt),
      passwordSalt: salt,
      passwordIterations: ITERATIONS,
      mustChangePassword: false,
      // Kendi oturumu açık kalsın; diğer cihazlar kapansın.
      keepToken: args.token,
      actor: me.name,
    })
    return null
  },
})

/**
 * Acil durum: parolayı Convex panelinden sıfırlar.
 *
 * Yönetici parolası unutulursa uygulamada kimse onu değiştiremez. Bu işlev
 * dışarıdan çağrılamaz (internal); yalnızca Convex panelinin Functions
 * sekmesinden, yani deploy'a erişimi olan biri tarafından çalıştırılabilir.
 * Kullanıcı ilk girişte parolasını değiştirmeye zorlanır ve açık oturumları
 * kapanır.
 */
export const resetPassword = internalAction({
  args: { name: v.string(), newPassword: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user: any = await ctx.runQuery(internal.authInternal.findUser, {
      name: args.name.trim(),
    })
    if (!user) throw new ConvexError(`No user named ${args.name}`)
    assertPassword(args.newPassword, user.name)
    await assertNotBreached(args.newPassword)
    const salt = randomBytes(16).toString('hex')
    await ctx.runMutation(internal.authInternal.storePassword, {
      id: user._id,
      passwordHash: hashPassword(args.newPassword, salt),
      passwordSalt: salt,
      passwordIterations: ITERATIONS,
      mustChangePassword: true,
      actor: 'Convex dashboard (password reset)',
    })
    return null
  },
})

/**
 * Creator'ın (ya da platformun) başkasına geçici parola vermesi.
 *
 * Eski parola sorulmaz — zaten bilinmiyor olabilir — ama kullanıcı ilk
 * girişte kendi parolasını koymaya zorlanır.
 */
export const setPasswordAsAdmin = action({
  args: { token: v.string(), userId: v.id('users'), newPassword: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const target: any = await ctx.runQuery(internal.authInternal.getUser, { id: args.userId })
    assertPassword(args.newPassword, target?.name)
    // Şirket creator'ı kendi şirketinin, owner generallerin parolasını verir (users.ts).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const check: any = await ctx.runQuery(internal.users.canSetPassword, { token: args.token, userId: args.userId })
    if (!check.ok) throw new ConvexError('You cannot set this password')
    await assertNotBreached(args.newPassword)
    const me = { name: check.actor }

    const salt = randomBytes(16).toString('hex')
    await ctx.runMutation(internal.authInternal.storePassword, {
      id: args.userId,
      passwordHash: hashPassword(args.newPassword, salt),
      passwordSalt: salt,
      passwordIterations: ITERATIONS,
      mustChangePassword: true,
      actor: me.name,
    })
    return null
  },
})
