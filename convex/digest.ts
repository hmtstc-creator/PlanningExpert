import { ConvexError, v } from 'convex/values'

import { internal } from './_generated/api'
import { internalAction } from './_generated/server'
import { cockpitSignals, todayThresholds } from './cockpit'
import { ALL_MODULES, adminMutation, guardedQuery, plantInternalMutation, plantInternalQuery } from './guarded'
import type { LockedDb } from './lockedDbTypes'
import { EMPTY_DIGEST, composeDigest, digestProblems, digestSignals, hasIssues, localNow, type DigestConfig } from '../src/lib/digest'
import { MODULES, type Access } from '../src/lib/tenancy'

/**
 * Today ayarları ve günlük özet e-postası (Company settings → Today & daily
 * digest). E-posta servisi: Resend (https://resend.com). Anahtar ve gönderen
 * adresi Convex ortam değişkenleridir — veritabanında ve kodda değil:
 *
 *   RESEND_API_KEY   servisin API anahtarı
 *   DIGEST_FROM      gönderen, ör. "Production Portal <portal@firma.com>"
 *   APP_URL          (isteğe bağlı) e-postadaki bağlantılar için sitenin adresi
 */

const digestValidator = v.object({
  enabled: v.boolean(),
  time: v.string(),
  days: v.array(v.string()),
  to: v.array(v.string()),
  cc: v.array(v.string()),
  signals: v.array(v.string()),
  onlyWhenIssues: v.boolean(),
})

const mailConfigured = () => !!process.env.RESEND_API_KEY && !!process.env.DIGEST_FROM

async function settingsDoc(db: LockedDb) {
  return db.query('todaySettings').withIndex('by_plant').first()
}

/** Plant'in kiraladığı ve açık modüller: özet bütün plant için yazılır. */
async function plantAccess(db: LockedDb, plantId: string): Promise<{ access: Access; plant: any; company: any }> {
  const plant: any = await db.get(plantId as any)
  const company: any = plant ? await db.get(plant.companyId) : null
  const access = Object.fromEntries(
    MODULES.map((m) => [m, company?.modules.includes(m) && !(plant?.disabledModules ?? []).includes(m) ? 'view' : 'none']),
  ) as Access
  return { access, plant, company }
}

/** Sayfa: eşikler, özet ayarı, son gönderim ve e-posta servisinin durumu. */
export const settings = guardedQuery({
  modules: ALL_MODULES,
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const s = await settingsDoc(ctx.db)
    return {
      thresholds: await todayThresholds(ctx.db),
      saved: {
        sapStaleHours: s?.sapStaleHours,
        planStaleHours: s?.planStaleHours,
        overloadPercent: s?.overloadPercent,
        bottleneckWeeks: s?.bottleneckWeeks,
      },
      digest: (s?.digest ?? EMPTY_DIGEST) as DigestConfig,
      last: s?.lastDigestAt ? { at: s.lastDigestAt, result: s.lastDigestResult ?? '' } : null,
      mailConfigured: mailConfigured(),
      timeZone: ctx.plant.timeZone ?? 'UTC',
    }
  },
})

async function upsertSettings(ctx: { db: any; sessionUser: { name?: string } }, patch: Record<string, unknown>) {
  const s = await settingsDoc(ctx.db)
  const row = { ...patch, updatedAt: Date.now(), updatedBy: ctx.sessionUser.name }
  if (s) await ctx.db.patch(s._id, row)
  else await ctx.db.insert('todaySettings', row)
}

const positive = (name: string, n: number | undefined, max: number) => {
  if (n === undefined) return undefined
  if (!Number.isFinite(n) || n <= 0 || n > max) throw new ConvexError(`${name} must be between 0 and ${max}`)
  return n
}

export const saveThresholds = adminMutation({
  modules: ALL_MODULES,
  affectsPlan: false,
  args: {
    sapStaleHours: v.optional(v.number()),
    planStaleHours: v.optional(v.number()),
    overloadPercent: v.optional(v.number()),
    bottleneckWeeks: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx: any, a: any) => {
    await upsertSettings(ctx, {
      sapStaleHours: positive('Old SAP data (h)', a.sapStaleHours, 24 * 30),
      planStaleHours: positive('Old plan (h)', a.planStaleHours, 24 * 7),
      overloadPercent: positive('Over capacity (%)', a.overloadPercent, 1000),
      bottleneckWeeks: a.bottleneckWeeks === undefined ? undefined : Math.round(positive('Weeks ahead', a.bottleneckWeeks, 12)!),
    })
    return null
  },
})

export const saveDigest = adminMutation({
  modules: ALL_MODULES,
  affectsPlan: false,
  args: { digest: digestValidator },
  returns: v.null(),
  handler: async (ctx: any, { digest }: { digest: DigestConfig }) => {
    const clean: DigestConfig = {
      ...digest,
      to: [...new Set(digest.to.map((x) => x.trim().toLowerCase()).filter(Boolean))],
      cc: [...new Set(digest.cc.map((x) => x.trim().toLowerCase()).filter(Boolean))],
    }
    const problems = digestProblems(clean)
    if (problems.length) throw new ConvexError(problems.join('; '))
    await upsertSettings(ctx, { digest: clean })
    return null
  },
})

/** Bugün gidecek e-postanın önizlemesi (sayfada). */
export const preview = guardedQuery({
  modules: ALL_MODULES,
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const s = await settingsDoc(ctx.db)
    const cfg = (s?.digest ?? EMPTY_DIGEST) as DigestConfig
    const { access, plant, company } = await plantAccess(ctx.db, ctx.plantId)
    const signals = digestSignals(await cockpitSignals(ctx, access), cfg)
    const date = localNow(Date.now(), plant?.timeZone ?? 'UTC').date
    return composeDigest({ company: company?.name ?? '', plant: plant?.name ?? '' }, signals, { date, appUrl: process.env.APP_URL })
  },
})

/** "Şimdi deneme gönder": ayardaki alıcılara hemen (gün / saat / tekrar sayılmaz). */
export const sendTest = adminMutation({
  modules: ALL_MODULES,
  affectsPlan: false,
  args: {},
  returns: v.null(),
  handler: async (ctx: any) => {
    const s = await settingsDoc(ctx.db)
    if (!s?.digest?.to.length) throw new ConvexError('Save at least one recipient first')
    if (!mailConfigured()) throw new ConvexError('The mail service is not set up yet (RESEND_API_KEY, DIGEST_FROM)')
    await ctx.scheduler.runAfter(0, internal.digest.sendForPlant, { plantId: ctx.plantId, test: true })
    return null
  },
})

/** Gönderilecek e-posta (zamanlayıcı ve deneme aynı hesabı kullanır). */
export const composeFor = plantInternalQuery({
  args: {},
  handler: async (ctx: any) => {
    const s = await settingsDoc(ctx.db)
    const cfg = (s?.digest ?? EMPTY_DIGEST) as DigestConfig
    const { access, plant, company } = await plantAccess(ctx.db, ctx.plantId)
    const signals = digestSignals(await cockpitSignals(ctx, access), cfg)
    const date = localNow(Date.now(), plant?.timeZone ?? 'UTC').date
    return {
      cfg,
      date,
      issues: hasIssues(signals),
      mail: composeDigest({ company: company?.name ?? '', plant: plant?.name ?? '' }, signals, { date, appUrl: process.env.APP_URL }),
    }
  },
})

export const markSent = plantInternalMutation({
  args: { date: v.optional(v.string()), result: v.string() },
  handler: async (ctx: any, { date, result }: { date?: string; result: string }) => {
    const s = await settingsDoc(ctx.db)
    const patch: Record<string, unknown> = { lastDigestAt: Date.now(), lastDigestResult: result }
    if (date) patch.lastDigestDate = date
    if (s) await ctx.db.patch(s._id, patch)
    return null
  },
})

/** Bir plant'in özetini gönderir (zamanlayıcı: tenancy.digestTick; deneme: sendTest). */
export const sendForPlant = internalAction({
  args: { plantId: v.id('plants'), test: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { plantId, test }) => {
    const c: any = await ctx.runQuery(internal.digest.composeFor, { plantId })
    // Zamanlı gönderimde günü işaretle: hata da olsa aynı gün tekrar denenmez
    // (her 15 dakikada bir e-posta yağmasın); sonuç sayfada görünür.
    const date = test ? undefined : c.date
    if (!test && c.cfg.onlyWhenIssues && !c.issues) {
      await ctx.runMutation(internal.digest.markSent, { plantId, date, result: 'Not sent — all clear (send only when there are issues)' })
      return null
    }
    const key = process.env.RESEND_API_KEY
    const from = process.env.DIGEST_FROM
    if (!key || !from) {
      await ctx.runMutation(internal.digest.markSent, { plantId, date, result: 'Not sent — the mail service is not set up (RESEND_API_KEY, DIGEST_FROM)' })
      return null
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: c.cfg.to,
          cc: c.cfg.cc.length ? c.cfg.cc : undefined,
          subject: test ? `[Test] ${c.mail.subject}` : c.mail.subject,
          text: c.mail.text,
          html: c.mail.html,
        }),
      })
      const result = res.ok
        ? `${test ? 'Test sent' : 'Sent'} to ${c.cfg.to.length + c.cfg.cc.length} recipient(s)`
        : `Not sent — mail service answered ${res.status}: ${(await res.text()).slice(0, 200)}`
      await ctx.runMutation(internal.digest.markSent, { plantId, date, result })
    } catch (e) {
      await ctx.runMutation(internal.digest.markSent, { plantId, date, result: `Not sent — ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) })
    }
    return null
  },
})
