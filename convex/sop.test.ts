// @vitest-environment edge-runtime
import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import schema from './schema'
import { tokenKey } from './sessionStore'

/** SOP oluşturma: yalnız creator; worker kuyruğu aynı anda tek iş alır (docs/wiki/12-sop-olusturma.md). */

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts', '!./planEngine.ts', '!./auth.ts'])
const api = anyApi
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

async function session(t: Any, userId: string, token: string) {
  await t.run((ctx: Any) => ctx.db.insert('sessions', { token: tokenKey(token), userId, createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 }))
  return token
}

/** Eski kurulum + geçiş: admin2 creator olur, planner düzenleyen ama creator olmayan üye. */
async function world() {
  const t = convexTest(schema, modules)
  const u = await t.run(async (ctx: Any) => {
    const now = Date.now()
    const boss = await ctx.db.insert('users', { name: 'boss', role: 'admin', active: true, createdAt: now - 10 })
    const creator = await ctx.db.insert('users', { name: 'cr', role: 'admin', active: true, createdAt: now })
    const planner = await ctx.db.insert('users', { name: 'pl', role: 'planner', active: true, createdAt: now })
    await ctx.db.insert('globalShiftSettings', { key: 'default', shiftMinutes: 480, overtimeShiftMinutes: 480, country: 'RO', timeZone: 'Europe/Bucharest' })
    return { boss, creator, planner }
  })
  const boss = await session(t, u.boss, 'boss')
  await t.mutation(api.tenancy.startMigration, { token: boss })
  for (let i = 0; i < 50; i++) {
    const done = await t.run(async (ctx: Any) => !!(await ctx.db.query('platformState').first())?.value?.done)
    if (done) break
    await t.mutation(api.tenancy.backfill, {})
  }
  const cr = await session(t, u.creator, 'cr')
  // Hazır: Gemini anahtarı girilmiş, worker bağlı.
  await t.mutation(api.sop.setAiKey, { token: cr, key: 'AIzaTESTKEY-1234567890abcd' })
  await t.mutation(api.sopQueue.authWorker, { hash: 'worker-hash' })
  return { t, cr, pl: await session(t, u.planner, 'pl') }
}

const video = (t: Any, type = 'video/mp4') => t.run((ctx: Any) => ctx.storage.store(new Blob(['fake video'], { type })))
const jpeg = (t: Any) => t.run((ctx: Any) => ctx.storage.store(new Blob(['jpg'], { type: 'image/jpeg' })))
const jobRow = (t: Any, id: string) => t.run((ctx: Any) => ctx.db.get(id))

const answer = JSON.stringify({
  adimlar: [
    { temel_adim: 'Sacı masaya yükle', puf_noktasi: 'Vinci yavaş indir', nedeni: 'Sac kayarsa yaralanabilirsin', baslangic_sn: 1, bitis_sn: 9, kareler: [{ saniye: 5 }] },
    { temel_adim: 'Panoya git ve arabayı indir', puf_noktasi: '', nedeni: '', baslangic_sn: 10, bitis_sn: 20, kareler: [{ saniye: 12 }, { saniye: 18 }] },
  ],
  kkd: { is_ayakkabisi: true, eldiven: true, tisort_pantolon: true },
})

async function newJob(t: Any, cr: string) {
  return t.mutation(api.sop.create, {
    token: cr,
    videoStorageId: await video(t),
    videoName: 'sac.mp4',
    language: 'tr',
    machine: 'PRS-106',
    header: { operation: 'Sac yükleme', reference: 'P-123' },
  })
}

describe('SOP', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 9, 29, 12, 0))
  })
  afterEach(() => vi.useRealTimers())

  it('anahtar ve worker hazır değilken yükleme kapalı; anahtar tarayıcıya gitmez', async () => {
    const { t, cr } = await world()
    const status = await t.query(api.sop.status, { token: cr })
    expect(status).toMatchObject({ ready: true, aiKeySet: true, aiKeyHint: '…abcd', workerConnected: true })
    expect(JSON.stringify(status)).not.toContain('AIzaTESTKEY')
    await t.mutation(api.sop.clearAiKey, { token: cr })
    await expect(t.mutation(api.sop.generateUploadUrl, { token: cr })).rejects.toThrow(/Gemini key/)
    await t.mutation(api.sop.setAiKey, { token: cr, key: 'AIzaTESTKEY-1234567890abcd' })
    // Worker 5 dakikadır sormadı: bağlı değil.
    vi.setSystemTime(Date.UTC(2026, 9, 29, 12, 6))
    await expect(t.mutation(api.sop.generateUploadUrl, { token: cr })).rejects.toThrow(/not running/)
    await expect(t.mutation(api.sop.setAiKey, { token: cr, key: 'kısa' })).rejects.toThrow(/API key/)
  })

  it('worker eşleşmesi: ilk jeton eşleşir, başkası reddedilir; sıfırlanınca yenisi eşleşir', async () => {
    const { t, cr } = await world()
    expect((await t.mutation(api.sopQueue.authWorker, { hash: 'worker-hash' })).ok).toBe(true)
    expect((await t.mutation(api.sopQueue.authWorker, { hash: 'other' })).ok).toBe(false)
    await t.mutation(api.sop.resetWorker, { token: cr })
    expect(await t.mutation(api.sopQueue.authWorker, { hash: 'other' })).toEqual({ ok: true, paired: true })
  })

  it('HTTP ucu: jetonsuz ya da kısa jetonla 401; eşleşmiş jetonla iş verir', async () => {
    const { t, cr } = await world()
    await t.mutation(api.sop.resetWorker, { token: cr })
    const post = (token: string) => t.fetch('/sop/worker/claim', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{}' })
    expect((await post('short')).status).toBe(401)
    const tok = 'a'.repeat(64)
    expect((await post(tok)).status).toBe(200)
    expect((await post('b'.repeat(64))).status).toBe(401)
    await newJob(t, cr)
    const task = await (await post(tok)).json()
    expect(task).toMatchObject({ type: 'analyze', aiKey: 'AIzaTESTKEY-1234567890abcd' })
  })

  it('yalnız creator kullanır', async () => {
    const { t, cr, pl } = await world()
    await expect(t.query(api.sop.list, { token: pl })).rejects.toThrow(/creator/)
    await expect(
      t.mutation(api.sop.create, { token: pl, videoStorageId: await video(t), videoName: 'a.mp4', language: 'tr', header: { operation: 'x' } }),
    ).rejects.toThrow(/creator/)
    expect(await t.query(api.sop.list, { token: cr })).toEqual([])
  })

  it('video olmayan dosya reddedilir; gece temizliği onu siler, SOP dosyalarını silmez', async () => {
    const { t, cr } = await world()
    const id = await video(t, 'application/pdf')
    await expect(t.mutation(api.sop.create, { token: cr, videoStorageId: id, videoName: 'a.pdf', language: 'tr', header: { operation: 'x' } })).rejects.toThrow(/not a video/)
    const a = await newJob(t, cr)
    const videoId = (await jobRow(t, a)).videoStorageId
    vi.setSystemTime(Date.UTC(2026, 9, 31, 12, 0))
    await t.mutation(api.tenancy.purgeOrphanUploads, {})
    expect(await t.run((ctx: Any) => ctx.db.system.get(id))).toBeNull()
    expect(await t.run((ctx: Any) => ctx.db.system.get(videoId))).not.toBeNull()
  })

  it('kuyruk: aynı anda tek iş; video diske geçince depodan silinir; cevap taslağa döner', async () => {
    const { t, cr } = await world()
    const a = await newJob(t, cr)
    const b = await newJob(t, cr)

    const first = await t.mutation(api.sopQueue.claim, {})
    expect(first.type).toBe('analyze')
    expect(first.jobId).toBe(a)
    expect(first.videoUrl).toBeTruthy()
    expect(first.operation).toBe('Sac yükleme')
    // İlki işlenirken ikincisi verilmez.
    expect(await t.mutation(api.sopQueue.claim, {})).toBeNull()

    await t.mutation(api.sopQueue.heartbeat, { jobId: a, progress: 'Video saved', videoPath: '/data/videos/a.mp4', videoSeconds: 20 })
    const moved = await jobRow(t, a)
    expect(moved.videoStorageId).toBeUndefined()
    expect(moved.videoPath).toBe('/data/videos/a.mp4')

    expect((await t.query(api.sopQueue.check, { resultJson: '{"adimlar":[]}' })).ok).toBe(false)
    expect(await t.query(api.sopQueue.check, { resultJson: answer })).toEqual({ ok: true, steps: 2 })

    const frames = [
      { step: 0, photo: 0, second: 5, storageId: await jpeg(t) },
      { step: 1, photo: 0, second: 12, storageId: await jpeg(t) },
      { step: 1, photo: 1, second: 18, storageId: await jpeg(t) },
    ]
    expect(await t.mutation(api.sopQueue.complete, { jobId: a, resultJson: answer, duration: 20, model: 'gemini', frames })).toEqual({ ok: true })
    const job = await t.query(api.sop.get, { token: cr, id: a })
    expect(job.status).toBe('review')
    expect(job.draft.header).toMatchObject({ operation: 'Sac yükleme', reference: 'P-123', tut: 'TÜT' })
    expect(job.draft.steps.map((s: Any) => s.photos.length)).toEqual([1, 2])
    expect(Object.keys(job.urls)).toHaveLength(3)

    // İlki bitti: sıradaki verilir.
    expect((await t.mutation(api.sopQueue.claim, {})).jobId).toBe(b)
  })

  it('ekrandan istenen kare: önce o verilir, gelince eskisi silinir', async () => {
    const { t, cr } = await world()
    const a = await newJob(t, cr)
    await t.mutation(api.sopQueue.claim, {})
    await t.mutation(api.sopQueue.heartbeat, { jobId: a, progress: 'x', videoPath: '/data/videos/a.mp4', videoSeconds: 20 })
    const old = await jpeg(t)
    await t.mutation(api.sopQueue.complete, {
      jobId: a, resultJson: answer, duration: 20, model: 'g',
      frames: [{ step: 0, photo: 0, second: 5, storageId: old }],
    })
    await newJob(t, cr)
    await t.mutation(api.sop.requestFrame, { token: cr, id: a, step: 0, photo: 0, second: 6.04 })
    const task = await t.mutation(api.sopQueue.claim, {})
    expect(task).toMatchObject({ type: 'frames', jobId: a, videoPath: '/data/videos/a.mp4', frames: [{ step: 0, photo: 0, second: 6 }] })
    const fresh = await jpeg(t)
    await t.mutation(api.sopQueue.framesDone, { jobId: a, frames: [{ step: 0, photo: 0, second: 6, storageId: fresh }] })
    const job = await t.query(api.sop.get, { token: cr, id: a })
    expect(job.draft.steps[0].photos[0]).toEqual({ storageId: fresh, second: 6 })
    expect(job.pendingFrames).toEqual([])
    expect(await t.run((ctx: Any) => ctx.db.system.get(old))).toBeNull()
  })

  it('worker cevap vermezse iş sıraya döner; ikinci kez takılırsa hata', async () => {
    const { t, cr } = await world()
    const a = await newJob(t, cr)
    await t.mutation(api.sopQueue.claim, {})
    vi.setSystemTime(Date.UTC(2026, 9, 29, 12, 11))
    await t.mutation(api.sopQueue.recoverStuck, {})
    expect((await jobRow(t, a)).status).toBe('queued')
    await t.mutation(api.sopQueue.claim, {})
    vi.setSystemTime(Date.UTC(2026, 9, 29, 12, 30))
    await t.mutation(api.sopQueue.recoverStuck, {})
    const row = await jobRow(t, a)
    expect(row.status).toBe('error')
    expect(row.error).toMatch(/stopped/)
  })
})
