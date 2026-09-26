import { v } from 'convex/values'

import { internal } from './_generated/api'
import { internalMutation, internalQuery } from './_generated/server'
import { guardedMutation, guardedQuery } from './guarded'
import { planStatusDoc, requestRecompute } from './planQueue'
import { withDefaults } from './products'
import { liveRows } from './sapLive'
import { currentUploads } from './sapUploads'

/**
 * Sunucuda hesaplanan planın veritabanı tarafı.
 *
 * Hesabın kendisi `planEngine.ts` içindeki action'da (Node, 10 dakika
 * süre). Buradakiler o action'ın girdiyi okuduğu, sonucu yazdığı iç işlevler
 * ve sayfanın okuduğu genel sorgular.
 */

// Convex'in üretilen tipleri bu ortamda yok; gevşek tiplenmiş.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

/** Kaç hazır hesap saklansın. Eskileri silinir. */
const KEEP_RUNS = 3
/** Yarım kalmış (çökmüş) bir yazma bu kadar sonra temizlenir. */
const STALE_WRITE_MS = 15 * 60_000
/** Bu süreden uzun "çalışıyor" kaydı takılmış sayılır. */
const RUN_TIMEOUT_MS = 10 * 60_000

// ---- Girdi -------------------------------------------------------------------

/** Planın okuduğu küçük tablolar, tek seferde. */
export const smallInputs = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx: Ctx) => {
    const settings = await ctx.db
      .query('globalShiftSettings')
      .withIndex('by_key', (q: Ctx) => q.eq('key', 'default'))
      .first()
    const country = settings?.country ?? 'RO'
    return {
      settings,
      presses: await ctx.db.query('presses').collect(),
      templates: await ctx.db.query('pressTemplates').collect(),
      // Work Calendar istisna haftaları: o haftaya açılan fazla mesai dahil.
      weekOverrides: await ctx.db.query('pressWeekOverrides').collect(),
      workCalendar: await ctx.db
        .query('workCalendar')
        .withIndex('by_key', (q: Ctx) => q.eq('key', 'default'))
        .first(),
      officialHolidays: await ctx.db
        .query('officialHolidays')
        .withIndex('by_country', (q: Ctx) => q.eq('country', country))
        .collect(),
      latestSnapshot: await ctx.db
        .query('planSnapshots')
        .withIndex('by_created')
        .order('desc')
        .first(),
      plannedStops: await ctx.db.query('plannedStops').collect(),
      overrides: await ctx.db.query('planOverrides').collect(),
      moldMaintenance: await ctx.db.query('moldMaintenance').collect(),
      readiness: await ctx.db.query('moldReadiness').collect(),
      pressMaintenance: await ctx.db.query('pressMaintenance').collect(),
      alarms: await ctx.db.query('moldAlarms').collect(),
      // Açık makine arızaları — "pres duruyor" olanlar presi planda kapatır.
      machineProblems: await ctx.db
        .query('machineProblems')
        .withIndex('by_status', (q: Ctx) => q.eq('status', 'open'))
        .collect(),
      locations: await ctx.db.query('storageLocations').collect(),
      // Planlamacının pres başlangıcı / gecikme müdahaleleri.
      pressStarts: await ctx.db.query('pressPlanStarts').collect(),
      // Yoldaki hammadde — MRP'de varış haftasında giriş.
      inTransit: await (await liveRows(ctx, 'inTransit')).collect(),
      // Planın hangi SAP yüklemeleriyle hesaplandığı — SAP Data sayfası
      // "bu dosya planda mı" sorusunu buna bakarak cevaplar.
      sapUploads: await currentUploads(ctx),
    }
  },
})

const BIG_TABLES = ['products', 'demandWeekly', 'demandDaily', 'stock'] as const
const KEY_OF = { demandWeekly: 'weeklyDemand', demandDaily: 'dailyDemand', stock: 'stock' } as const

/**
 * Büyük tablolar sayfa sayfa. Sayfanın eski `listAll` sorgusu 8000 satırda
 * duruyordu; action birden çok sorgu çalıştırabildiği için burada öyle bir
 * sınır yok.
 */
export const inputPage = internalQuery({
  args: {
    table: v.union(...BIG_TABLES.map((t) => v.literal(t))),
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
  returns: v.any(),
  handler: async (ctx: Ctx, { table, cursor, numItems }: Ctx) => {
    // SAP tablolarında yalnızca geçerli yüklemenin satırları: yarım kalmış ya
    // da süren bir yükleme planı bozmasın.
    const source = table === 'products' ? ctx.db.query(table) : await liveRows(ctx, KEY_OF[table])
    const result = await source.paginate({ cursor, numItems })
    return {
      page: table === 'products' ? result.page.map(withDefaults) : result.page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    }
  },
})

/**
 * Tek seferlik ayar geçişleri; her hesabın başında denenir, yapıldıysa
 * işaretlenir ve bir daha dokunulmaz.
 *
 * - Setup'lar arası 60 dk → 10 dk (planlamacının kararı). Kayıtta eski
 *   varsayılan 60 duruyorsa 10 yapılır; başka bir değer elle girildiyse
 *   korunur. Sonradan tekrar 60 yapılırsa da artık değiştirilmez.
 */
async function migrateSettings(ctx: Ctx) {
  const settings = await ctx.db
    .query('globalShiftSettings')
    .withIndex('by_key', (q: Ctx) => q.eq('key', 'default'))
    .first()
  if (!settings || settings.migratedSetupGap10) return
  await ctx.db.patch(settings._id, {
    migratedSetupGap10: true,
    ...(settings.setupGapMinutes === undefined || settings.setupGapMinutes === 60
      ? { setupGapMinutes: 10 }
      : {}),
  })
}

// ---- Kuyruk ------------------------------------------------------------------

/**
 * Hesap başlıyor. Başka bir hesap sürüyorsa bu hesap biraz sonraya
 * ertelenir — iki hesabın aynı anda yazması boşa iş olur.
 */
export const beginRun = internalMutation({
  args: { trigger: v.optional(v.string()) },
  returns: v.object({ proceed: v.boolean() }),
  handler: async (ctx: Ctx, { trigger }: Ctx) => {
    const now = Date.now()
    await migrateSettings(ctx)
    const status = await planStatusDoc(ctx)
    if (status?.runningSince && now - status.runningSince < RUN_TIMEOUT_MS) {
      if (!status.scheduledFor || status.scheduledFor < now) {
        await ctx.scheduler.runAfter(15_000, internal.planEngine.recompute, { trigger })
        await ctx.db.patch(status._id, { scheduledFor: now + 15_000 })
      }
      return { proceed: false }
    }
    if (status) {
      await ctx.db.patch(status._id, { runningSince: now, scheduledFor: undefined })
    } else {
      await ctx.db.insert('planStatus', { key: 'default', runningSince: now })
    }
    return { proceed: true }
  },
})

export const finishRun = internalMutation({
  args: { startedAt: v.number(), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx: Ctx, { startedAt, error }: Ctx) => {
    const now = Date.now()
    const status = await planStatusDoc(ctx)
    if (!status) return null
    await ctx.db.patch(status._id, {
      runningSince: undefined,
      ...(error
        ? { lastError: error.slice(0, 2000), lastErrorAt: now }
        : { lastRunAt: now, lastDurationMs: now - startedAt, lastError: undefined }),
    })
    return null
  },
})

// ---- Sonucun yazılması --------------------------------------------------------

export const createRun = internalMutation({
  args: {
    startedAt: v.number(),
    computedAt: v.number(),
    trigger: v.optional(v.string()),
    summary: v.any(),
  },
  returns: v.id('planRuns'),
  handler: async (ctx: Ctx, args: Ctx) =>
    ctx.db.insert('planRuns', { ...args, status: 'writing' }),
})

export const addChunk = internalMutation({
  args: { runId: v.id('planRuns'), index: v.number(), kind: v.string(), items: v.any() },
  returns: v.null(),
  handler: async (ctx: Ctx, args: Ctx) => {
    await ctx.db.insert('planRunChunks', args)
    return null
  },
})

async function deleteRun(ctx: Ctx, runId: Ctx) {
  const chunks = await ctx.db
    .query('planRunChunks')
    .withIndex('by_run', (q: Ctx) => q.eq('runId', runId))
    .collect()
  for (const chunk of chunks) await ctx.db.delete(chunk._id)
  await ctx.db.delete(runId)
}

/** Hesap tamamlandı: yayınla, eskileri temizle. */
export const completeRun = internalMutation({
  args: { runId: v.id('planRuns'), chunkCount: v.number(), durationMs: v.number() },
  returns: v.null(),
  handler: async (ctx: Ctx, { runId, chunkCount, durationMs }: Ctx) => {
    await ctx.db.patch(runId, { status: 'ready', chunkCount, durationMs })

    const ready = await ctx.db
      .query('planRuns')
      .withIndex('by_status_computed', (q: Ctx) => q.eq('status', 'ready'))
      .order('desc')
      .take(KEEP_RUNS + 5)
    for (const old of ready.slice(KEEP_RUNS)) await deleteRun(ctx, old._id)

    const writing = await ctx.db
      .query('planRuns')
      .withIndex('by_status_computed', (q: Ctx) => q.eq('status', 'writing'))
      .take(20)
    for (const run of writing) {
      if (Date.now() - run.startedAt > STALE_WRITE_MS) await deleteRun(ctx, run._id)
    }
    return null
  },
})

// ---- Sayfanın okudukları --------------------------------------------------------

/**
 * Son hazır plan, parçaları birleştirilmiş olarak — `PlanRun` biçiminde
 * (src/lib/planPipeline.ts). Henüz hiç hesap yoksa null.
 */
export const latest = guardedQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx: Ctx) => {
    const run = await ctx.db
      .query('planRuns')
      .withIndex('by_status_computed', (q: Ctx) => q.eq('status', 'ready'))
      .order('desc')
      .first()
    if (!run) return null
    const chunks = await ctx.db
      .query('planRunChunks')
      .withIndex('by_run', (q: Ctx) => q.eq('runId', run._id))
      .collect()
    const lists: Record<string, unknown[]> = {
      jobs: [],
      unplanned: [],
      days: [],
      rawNeeds: [],
      maintenance: [],
    }
    for (const chunk of chunks) {
      const list = lists[chunk.kind] ?? (lists[chunk.kind] = [])
      for (const item of chunk.items) list.push(item)
    }
    return {
      ...run.summary,
      ...lists,
      runId: run._id,
      durationMs: run.durationMs,
      trigger: run.trigger,
    }
  },
})

/**
 * Yalnızca son hesabın alarmları. Kalıp ve makine sayfaları bütün planı
 * (megabaytlarca iş listesi) çekmeden "planı aksatan var mı" sorusuna cevap
 * alsın diye. Alarmlar özet dokümanında durur, parçalara bakılmaz.
 */
export const latestAlarms = guardedQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx: Ctx) => {
    const run = await ctx.db
      .query('planRuns')
      .withIndex('by_status_computed', (q: Ctx) => q.eq('status', 'ready'))
      .order('desc')
      .first()
    if (!run) return null
    return {
      computedAt: run.computedAt,
      todayIso: run.summary?.todayIso,
      alarms: run.summary?.alarms ?? { dies: [], machines: [] },
    }
  },
})

/**
 * Yalnızca son hesabın kapasite öngörüsü (Capacity Dashboard). Bütün planı
 * çekmeden; öngörü özet dokümanında durur.
 */
export const latestCapacity = guardedQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx: Ctx) => {
    const run = await ctx.db
      .query('planRuns')
      .withIndex('by_status_computed', (q: Ctx) => q.eq('status', 'ready'))
      .order('desc')
      .first()
    if (!run) return null
    return {
      computedAt: run.computedAt,
      todayIso: run.summary?.todayIso,
      capacity: run.summary?.capacity ?? null,
    }
  },
})

/** Raw Material Coverage sayfası: günlük rulo tüketimi ve stoğu. */
export const latestRawCoverage = guardedQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx: Ctx) => {
    const run = await ctx.db
      .query('planRuns')
      .withIndex('by_status_computed', (q: Ctx) => q.eq('status', 'ready'))
      .order('desc')
      .first()
    if (!run) return null
    return {
      computedAt: run.computedAt,
      todayIso: run.summary?.todayIso,
      rawRequirements: run.summary?.rawRequirements ?? null,
    }
  },
})

/** Kuyruğun durumu: hesap sürüyor mu, bekliyor mu, son hata ne. */
export const status = guardedQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx: Ctx) => {
    const doc = await planStatusDoc(ctx)
    if (!doc) return null
    const { _id, _creationTime, key, ...rest } = doc
    return rest
  },
})

/** "Şimdi yeniden hesapla" düğmesi. */
export const requestNow = guardedMutation({
  args: {},
  returns: v.null(),
  affectsPlan: false,
  handler: async (ctx: Ctx) => {
    await requestRecompute(ctx, 0, 'manual')
    return null
  },
})
