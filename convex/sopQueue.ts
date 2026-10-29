import { v } from 'convex/values'

import { GEMINI_RESPONSE_SCHEMA, aiToDraft, parseAiResult, type Draft } from '../src/lib/sop/sopSchema'
import { internalMutation, internalQuery } from './_generated/server'

/**
 * SOP işleyicisinin (`sop-worker` kapsayıcısı) kuyruğu. Worker tek: bütün
 * fabrikaların işlerini sırayla, **aynı anda yalnız bir** iş alır (VPS
 * zorlanmasın — kullanıcı, 2026-10-28). Bu yüzden işlevler fabrika kilidinin
 * dışındadır ve yalnız `sopJobs`'a dokunur; dışarıdan yalnız convex/http.ts
 * çağırır (`SOP_WORKER_TOKEN` ile). Ayrıntı docs/wiki/12-sop-olusturma.md.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** Kalp atışı bu kadar gelmeyen iş takılmış sayılır ve sıraya geri döner. */
export const STUCK_MS = 10 * 60_000
/** Bir iş en çok bu kadar denenir (worker çökmesi, ağ hatası). */
export const MAX_ATTEMPTS = 2
/** Prompt'a örnek olarak giden son onaylı SOP sayısı ve her birinden adım sayısı. */
const EXAMPLES = 3
const EXAMPLE_STEPS = 8

const draftOf = (job: Any): Draft => JSON.parse(job.draftJson)

async function jobsWithStatus(ctx: Any, status: string): Promise<Any[]> {
  const out: Any[] = []
  for (const plant of await ctx.db.query('plants').collect()) {
    const rows = await ctx.db
      .query('sopJobs')
      .withIndex('by_status', (q: Any) => q.eq('plantId', plant._id).eq('status', status))
      .collect()
    out.push(...rows)
  }
  return out.sort((a, b) => a.createdAt - b.createdAt)
}

/** Aynı fabrikanın, aynı dildeki son onaylı SOP'ları: few-shot örnek. */
async function examplesFor(ctx: Any, job: Any) {
  const approved = await ctx.db
    .query('sopJobs')
    .withIndex('by_status', (q: Any) => q.eq('plantId', job.plantId).eq('status', 'approved'))
    .order('desc')
    .take(20)
  return approved
    .filter((j: Any) => j.language === job.language && j._id !== job._id)
    .slice(0, EXAMPLES)
    .map((j: Any) => {
      const d = draftOf(j)
      return {
        operation: d.header.operation,
        steps: d.steps.slice(0, EXAMPLE_STEPS).map((s) => ({ temel_adim: s.text, puf_noktasi: s.key, nedeni: s.reason })),
      }
    })
}

/**
 * Sıradaki iş: önce ekrandan istenen kareler (kısa), sonra en eski bekleyen
 * analiz. İşlenen bir iş varsa hiçbir şey verilmez (aynı anda bir iş).
 */
export const claim = internalMutation({
  args: {},
  handler: async (ctx: Any) => {
    const now = Date.now()
    const busy = (await jobsWithStatus(ctx, 'processing')).some((j) => (j.heartbeatAt ?? 0) > now - STUCK_MS)
    if (busy) return null

    for (const plant of await ctx.db.query('plants').collect()) {
      const withFrames = await ctx.db
        .query('sopJobs')
        .withIndex('by_frames', (q: Any) => q.eq('plantId', plant._id).eq('framesPending', true))
        .first()
      if (withFrames?.pendingFrames?.length) {
        return { type: 'frames', jobId: withFrames._id, videoPath: withFrames.videoPath ?? null, frames: withFrames.pendingFrames }
      }
    }

    const job = (await jobsWithStatus(ctx, 'queued'))[0]
    if (!job) return null
    await ctx.db.patch(job._id, {
      status: 'processing',
      attempts: job.attempts + 1,
      claimedAt: now,
      heartbeatAt: now,
      progress: 'Started',
      error: undefined,
    })
    const d = draftOf(job)
    return {
      type: 'analyze',
      jobId: job._id,
      language: job.language,
      videoName: job.videoName ?? '',
      videoUrl: job.videoStorageId ? await ctx.storage.getUrl(job.videoStorageId) : null,
      videoPath: job.videoPath ?? null,
      operation: d.header.operation,
      reference: d.header.reference,
      machine: job.machine ?? '',
      partName: job.partName ?? '',
      notes: job.notes ?? '',
      keyMoments: job.keyMoments ?? [],
      examples: await examplesFor(ctx, job),
      responseSchema: GEMINI_RESPONSE_SCHEMA,
    }
  },
})

/** Kalp atışı ve ilerleme metni; video diske taşındıysa yolu ve süresi. */
export const heartbeat = internalMutation({
  args: { jobId: v.id('sopJobs'), progress: v.string(), videoPath: v.optional(v.string()), videoSeconds: v.optional(v.number()) },
  handler: async (ctx: Any, a: Any) => {
    const job = await ctx.db.get(a.jobId)
    if (!job || job.status !== 'processing') return { ok: false }
    const patch: Any = { heartbeatAt: Date.now(), progress: a.progress.slice(0, 200) }
    if (a.videoPath) patch.videoPath = a.videoPath
    if (a.videoSeconds !== undefined) patch.videoSeconds = a.videoSeconds
    // Video worker'ın diskine geçti: Convex deposundaki kopya gereksiz (gece yedeği büyümesin).
    if (a.videoPath && job.videoStorageId) {
      await ctx.storage.delete(job.videoStorageId).catch(() => {})
      patch.videoStorageId = undefined
    }
    await ctx.db.patch(a.jobId, patch)
    return { ok: true }
  },
})

/** Yalnız denetim: cevap şemaya uyuyor mu (worker uymazsa bir kez daha sorar). */
export const check = internalQuery({
  args: { resultJson: v.string() },
  handler: async (_ctx: Any, { resultJson }: Any) => {
    const r = parseAiResult(resultJson)
    return r.ok ? { ok: true, steps: r.value.adimlar.length } : { ok: false, error: r.error }
  },
})

/**
 * Analiz bitti: cevap yeniden denetlenir, taslağa çevrilir, kareler bağlanır.
 * `frames`: her adımın fotoğrafları için depoya yüklenmiş kare.
 */
export const complete = internalMutation({
  args: {
    jobId: v.id('sopJobs'),
    resultJson: v.string(),
    duration: v.number(),
    model: v.string(),
    frames: v.array(v.object({ step: v.number(), photo: v.number(), storageId: v.id('_storage'), second: v.number() })),
  },
  handler: async (ctx: Any, a: Any) => {
    const job = await ctx.db.get(a.jobId)
    if (!job || job.status !== 'processing') {
      for (const f of a.frames) await ctx.storage.delete(f.storageId).catch(() => {})
      return { ok: false, error: 'The job is no longer being processed' }
    }
    const r = parseAiResult(a.resultJson)
    if (!r.ok) return { ok: false, error: r.error }
    const draft = aiToDraft(r.value, a.duration, draftOf(job).header)
    for (const f of a.frames) {
      const photo = draft.steps[f.step]?.photos[f.photo]
      if (photo) Object.assign(photo, { storageId: f.storageId, second: f.second })
      else await ctx.storage.delete(f.storageId).catch(() => {})
    }
    const now = Date.now()
    await ctx.db.patch(a.jobId, {
      status: 'review',
      draftJson: JSON.stringify(draft),
      videoSeconds: a.duration,
      aiModel: a.model,
      progress: 'Ready for review',
      finishedAt: now,
      heartbeatAt: now,
      updatedAt: now,
    })
    return { ok: true }
  },
})

/** Hata: deneme hakkı kaldıysa sıraya geri, yoksa `error`. */
export const fail = internalMutation({
  args: { jobId: v.id('sopJobs'), error: v.string(), retryable: v.boolean() },
  handler: async (ctx: Any, a: Any) => {
    const job = await ctx.db.get(a.jobId)
    if (!job || job.status !== 'processing') return null
    const again = a.retryable && job.attempts < MAX_ATTEMPTS
    await ctx.db.patch(a.jobId, {
      status: again ? 'queued' : 'error',
      error: a.error.slice(0, 1000),
      progress: again ? 'Waiting to retry' : 'Failed',
      heartbeatAt: Date.now(),
    })
    return null
  },
})

/** Ekrandan istenen kareler geldi: fotoğraf yenisiyle değişir, eskisi silinir. */
export const framesDone = internalMutation({
  args: {
    jobId: v.id('sopJobs'),
    frames: v.array(v.object({ step: v.number(), photo: v.number(), second: v.number(), storageId: v.id('_storage') })),
    /** Video diskte yok: bekleyen istekler düşer (yoksa sonsuza dek beklerdi). */
    dropPending: v.optional(v.boolean()),
  },
  handler: async (ctx: Any, a: Any) => {
    const job = await ctx.db.get(a.jobId)
    if (!job) {
      for (const f of a.frames) await ctx.storage.delete(f.storageId).catch(() => {})
      return null
    }
    const draft = draftOf(job)
    for (const f of a.frames) {
      const step = draft.steps[f.step]
      if (!step) {
        await ctx.storage.delete(f.storageId).catch(() => {})
        continue
      }
      const old = step.photos[f.photo]
      if (old?.storageId) await ctx.storage.delete(old.storageId).catch(() => {})
      // Yeni kare yeni yer: eski işaret o kareye ait olmayabilir, kaldırılır.
      step.photos[f.photo] = { storageId: f.storageId, second: f.second }
      step.photos = step.photos.filter(Boolean)
    }
    const done = new Set(a.frames.map((f: Any) => `${f.step}:${f.photo}:${f.second}`))
    const pending = a.dropPending ? [] : (job.pendingFrames ?? []).filter((p: Any) => !done.has(`${p.step}:${p.photo}:${p.second}`))
    await ctx.db.patch(a.jobId, { draftJson: JSON.stringify(draft), pendingFrames: pending, framesPending: pending.length > 0, updatedAt: Date.now() })
    return null
  },
})

/** Takılan iş (worker yeniden başladı, çöktü): sıraya geri ya da hata. 15 dakikada bir. */
export const recoverStuck = internalMutation({
  args: {},
  handler: async (ctx: Any) => {
    const now = Date.now()
    for (const job of await jobsWithStatus(ctx, 'processing')) {
      if ((job.heartbeatAt ?? 0) > now - STUCK_MS) continue
      const again = job.attempts < MAX_ATTEMPTS
      await ctx.db.patch(job._id, {
        status: again ? 'queued' : 'error',
        error: 'The SOP worker stopped answering',
        progress: again ? 'Waiting to retry' : 'Failed',
      })
    }
    return null
  },
})
