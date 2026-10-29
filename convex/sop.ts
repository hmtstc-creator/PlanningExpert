import { ConvexError, v } from 'convex/values'

import { HEADER_FIELDS, type Header } from '../src/lib/sop/sopLayout'
import { LANGUAGES, MAX_PHOTOS_PER_STEP, draftSchema, emptyDraft, type Draft } from '../src/lib/sop/sopSchema'
import { canManageCompany } from '../src/lib/tenancy'
import { adminMutation, guardedQuery } from './guarded'

/**
 * SOP oluşturma (docs/wiki/12-sop-olusturma.md): yalnız şirket creator'ı
 * (ve platform) kullanır — menüde de yalnız ona görünür (kullanıcı, 2026-10-28).
 * Akış: video yüklenir → iş sıraya girer → `sop-worker` (convex/sopQueue.ts,
 * convex/http.ts) adımları ve kareleri çıkarır → taslak ekranda düzeltilir →
 * PDF tarayıcıda. Video worker'ın diskinde saklanır, Convex deposunda kalmaz.
 */

// Convex'in üretilen tipleri bu ortamda yok; gevşek tiplenmiş.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const MODULES = ['machine'] as const
const VIDEO_TYPES = /^video\//i
const VIDEO_NAMES = /\.(mp4|mov|m4v|webm|avi|mkv)$/i

function requireCreator(ctx: Any) {
  if (!canManageCompany(ctx.sessionUser, ctx.plant.companyId)) {
    throw new ConvexError('Only a company creator can use SOP Builder')
  }
}

async function jobOf(ctx: Any, id: string) {
  const job = await ctx.db.get(id)
  if (!job) throw new ConvexError('This SOP no longer exists')
  return job
}

export const readDraft = (job: { draftJson?: string }): Draft => (job.draftJson ? (JSON.parse(job.draftJson) as Draft) : emptyDraft())

const photoIds = (d: Draft) => new Set(d.steps.flatMap((s) => s.photos.map((p) => p.storageId).filter(Boolean) as string[]))

/** Bir SOP'un bütün dosyaları (kareler + henüz taşınmamış video). */
async function deleteFiles(ctx: Any, job: Any) {
  for (const id of photoIds(readDraft(job))) await ctx.storage.delete(id).catch(() => {})
  if (job.videoStorageId) await ctx.storage.delete(job.videoStorageId).catch(() => {})
}

/**
 * İşleyici kurulu mu (Convex'te `SOP_WORKER_TOKEN` var mı)? Kurulmadan yüklenen
 * video Convex deposunda bekler ve her gece yedeğine girer: yükleme kapalı tutulur.
 */
const workerReady = () => !!process.env.SOP_WORKER_TOKEN

export const status = guardedQuery({
  modules: MODULES,
  args: {},
  handler: async (ctx: Any) => {
    requireCreator(ctx)
    return { workerReady: workerReady() }
  },
})

export const list = guardedQuery({
  modules: MODULES,
  args: {},
  handler: async (ctx: Any) => {
    requireCreator(ctx)
    const rows = await ctx.db.query('sopJobs').withIndex('by_created').order('desc').take(100)
    return rows.map((j: Any) => {
      const d = readDraft(j)
      return {
        _id: j._id,
        status: j.status,
        language: j.language,
        operation: d.header.operation,
        reference: d.header.reference,
        sopNo: d.header.sopNo,
        machine: j.machine ?? '',
        steps: d.steps.length,
        createdAt: j.createdAt,
        createdBy: j.createdBy ?? '',
        progress: j.progress ?? '',
        error: j.error ?? '',
      }
    })
  },
})

export const get = guardedQuery({
  modules: MODULES,
  args: { id: v.id('sopJobs') },
  handler: async (ctx: Any, { id }: Any) => {
    requireCreator(ctx)
    const j = await ctx.db.get(id)
    if (!j) return null
    const draft = readDraft(j)
    const urls: Record<string, string | null> = {}
    for (const sid of photoIds(draft)) urls[sid] = await ctx.storage.getUrl(sid)
    return {
      _id: j._id,
      status: j.status,
      language: j.language,
      machine: j.machine ?? '',
      partName: j.partName ?? '',
      videoName: j.videoName ?? '',
      videoSeconds: j.videoSeconds ?? null,
      progress: j.progress ?? '',
      error: j.error ?? '',
      attempts: j.attempts,
      pendingFrames: j.pendingFrames ?? [],
      createdAt: j.createdAt,
      createdBy: j.createdBy ?? '',
      approvedAt: j.approvedAt ?? null,
      approvedBy: j.approvedBy ?? '',
      updatedAt: j.updatedAt ?? null,
      draft,
      urls,
    }
  },
})

export const generateUploadUrl = adminMutation({
  modules: MODULES,
  affectsPlan: false,
  args: {},
  returns: v.string(),
  handler: async (ctx: Any) => {
    if (!workerReady()) throw new ConvexError('The SOP worker is not set up on the server yet')
    return ctx.storage.generateUploadUrl()
  },
})

const text = (s: string | undefined, max = 300) => (s ?? '').trim().slice(0, max)

export const create = adminMutation({
  modules: MODULES,
  affectsPlan: false,
  args: {
    videoStorageId: v.id('_storage'),
    videoName: v.string(),
    language: v.string(),
    machine: v.optional(v.string()),
    partName: v.optional(v.string()),
    notes: v.optional(v.string()),
    keyMoments: v.optional(v.array(v.number())),
    header: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.id('sopJobs'),
  handler: async (ctx: Any, a: Any) => {
    if (!workerReady()) throw new ConvexError('The SOP worker is not set up on the server yet')
    const meta = await ctx.db.system.get(a.videoStorageId)
    const isVideo = meta && (VIDEO_TYPES.test(meta.contentType ?? '') || VIDEO_NAMES.test(a.videoName))
    // Hata işlemi geri alır; bağlanmayan dosyayı gece temizliği siler (tenancy.purgeOrphanUploads).
    if (!isVideo) throw new ConvexError('The file is not a video (MP4, MOV…)')
    if (!(LANGUAGES as readonly string[]).includes(a.language)) throw new ConvexError('Choose Turkish or Romanian')
    const header: Partial<Header> = {}
    for (const f of HEADER_FIELDS) if (a.header?.[f] !== undefined) header[f] = text(a.header[f])
    if (!header.operation) throw new ConvexError('Write the operation name')
    const now = Date.now()
    return ctx.db.insert('sopJobs', {
      status: 'queued',
      language: a.language,
      machine: text(a.machine),
      partName: text(a.partName),
      notes: text(a.notes, 2000),
      keyMoments: (a.keyMoments ?? []).filter((n: number) => Number.isFinite(n) && n >= 0).slice(0, 100),
      videoStorageId: a.videoStorageId,
      videoName: text(a.videoName),
      videoBytes: meta.size,
      draftJson: JSON.stringify(emptyDraft(header)),
      attempts: 0,
      progress: 'Waiting in the queue',
      createdBy: ctx.sessionUser.name,
      createdAt: now,
      updatedAt: now,
    })
  },
})

/** Ekrandan kaydedilen taslak; artık kullanılmayan kareler depodan silinir. */
export const saveDraft = adminMutation({
  modules: MODULES,
  affectsPlan: false,
  args: { id: v.id('sopJobs'), draftJson: v.string() },
  returns: v.null(),
  handler: async (ctx: Any, { id, draftJson }: Any) => {
    const job = await jobOf(ctx, id)
    if (job.status !== 'review' && job.status !== 'approved') throw new ConvexError('The SOP is not ready for editing yet')
    let parsed: unknown
    try {
      parsed = JSON.parse(draftJson)
    } catch {
      throw new ConvexError('The form could not be read')
    }
    const r = draftSchema.safeParse(parsed)
    if (!r.success) throw new ConvexError(`The form is not valid: ${r.error.issues[0]?.message ?? ''}`)
    const next = r.data as Draft
    const keep = photoIds(next)
    for (const old of photoIds(readDraft(job))) if (!keep.has(old)) await ctx.storage.delete(old).catch(() => {})
    await ctx.db.patch(id, { draftJson: JSON.stringify(next), updatedAt: Date.now() })
    return null
  },
})

/** Bir fotoğraf için videonun başka saniyesinden kare istenir (worker çıkarır). */
export const requestFrame = adminMutation({
  modules: MODULES,
  affectsPlan: false,
  args: { id: v.id('sopJobs'), step: v.number(), photo: v.number(), second: v.number() },
  returns: v.null(),
  handler: async (ctx: Any, a: Any) => {
    const job = await jobOf(ctx, a.id)
    if (job.status !== 'review' && job.status !== 'approved') throw new ConvexError('The SOP is not ready for editing yet')
    if (!job.videoPath) throw new ConvexError('The video is not on the server')
    if (a.photo < 0 || a.photo >= MAX_PHOTOS_PER_STEP) throw new ConvexError(`At most ${MAX_PHOTOS_PER_STEP} photos per step`)
    const max = job.videoSeconds ?? Number.MAX_SAFE_INTEGER
    const second = Math.round(Math.min(Math.max(0, a.second), max) * 10) / 10
    const rest = (job.pendingFrames ?? []).filter((f: Any) => !(f.step === a.step && f.photo === a.photo))
    await ctx.db.patch(a.id, { pendingFrames: [...rest, { step: a.step, photo: a.photo, second }], framesPending: true, updatedAt: Date.now() })
    return null
  },
})

export const approve = adminMutation({
  modules: MODULES,
  affectsPlan: false,
  args: { id: v.id('sopJobs') },
  returns: v.null(),
  handler: async (ctx: Any, { id }: Any) => {
    const job = await jobOf(ctx, id)
    if (job.status !== 'review' && job.status !== 'approved') throw new ConvexError('The SOP is not ready yet')
    await ctx.db.patch(id, { status: 'approved', approvedAt: Date.now(), approvedBy: ctx.sessionUser.name })
    return null
  },
})

/** Hatalı işi yeniden sıraya koyar. */
export const retry = adminMutation({
  modules: MODULES,
  affectsPlan: false,
  args: { id: v.id('sopJobs') },
  returns: v.null(),
  handler: async (ctx: Any, { id }: Any) => {
    const job = await jobOf(ctx, id)
    if (job.status !== 'error') throw new ConvexError('Only a failed SOP can be retried')
    if (!job.videoStorageId && !job.videoPath) throw new ConvexError('The video is gone — upload it again')
    await ctx.db.patch(id, { status: 'queued', attempts: 0, error: undefined, progress: 'Waiting in the queue', updatedAt: Date.now() })
    return null
  },
})

export const remove = adminMutation({
  modules: MODULES,
  affectsPlan: false,
  args: { id: v.id('sopJobs') },
  returns: v.null(),
  handler: async (ctx: Any, { id }: Any) => {
    const job = await jobOf(ctx, id)
    if (job.status === 'processing') throw new ConvexError('The SOP is being analysed — wait until it finishes')
    await deleteFiles(ctx, job)
    await ctx.db.delete(id)
    return null
  },
})
