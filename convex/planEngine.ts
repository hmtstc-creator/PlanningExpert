'use node'

import { v } from 'convex/values'

import { internal } from './_generated/api'
import { internalAction } from './_generated/server'
import { computePlan, type PlanInputs, type PlanRun } from '../src/lib/planPipeline'

/**
 * Planlama motoru — sunucuda.
 *
 * Plan eskiden yalnızca Planlama sayfası açıkken, açan kişinin tarayıcısında
 * vardı: sayfa kapalıyken plan yoktu, iki kişi aynı anda iki farklı plan
 * görebiliyordu ve büyük veri yavaş bilgisayarı kilitliyordu. Artık girdi
 * değiştiğinde (ve saat başı, çünkü günün geçen saatleri kapasiteden düşer)
 * burada hesaplanıp saklanıyor; herkes aynı planı okuyor.
 *
 * Node çalışma ortamı bilerek seçildi: varsayılan ortamın bellek sınırı
 * büyük bir planda dar kalabilir, Node action'ı 512 MB ve 10 dakika verir.
 * Hesabın kendisi `src/lib/planPipeline.ts` — tarayıcıyla aynı kod.
 */

// Convex'in üretilen tipleri bu ortamda yok; gevşek tiplenmiş.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

const PAGE_SIZE = 1000
/** Bu kadar satırdan sonrası okunmaz ve plan "eksik" işaretlenir. */
const MAX_ROWS = 60_000
/** Bir parçanın yaklaşık JSON boyutu — doküman sınırı 1 MB. */
const CHUNK_BYTES = 400_000
/** Convex bir dizide en fazla 8192 öğe taşır. */
const CHUNK_ITEMS = 4000

async function readTable(
  ctx: Ctx,
  table: 'products' | 'demandWeekly' | 'stock',
): Promise<{ rows: Ctx[]; complete: boolean }> {
  const rows: Ctx[] = []
  let cursor: string | null = null
  for (;;) {
    const page: Ctx = await ctx.runQuery(internal.planRuns.inputPage, {
      table,
      cursor,
      numItems: PAGE_SIZE,
    })
    rows.push(...page.page)
    if (page.isDone) return { rows, complete: true }
    if (rows.length >= MAX_ROWS) return { rows, complete: false }
    cursor = page.continueCursor
  }
}

async function loadInputs(ctx: Ctx): Promise<PlanInputs> {
  const [small, products, demand, stock] = await Promise.all([
    ctx.runQuery(internal.planRuns.smallInputs, {}),
    readTable(ctx, 'products'),
    readTable(ctx, 'demandWeekly'),
    readTable(ctx, 'stock'),
  ])
  return {
    ...small,
    products: products.rows,
    weeklyDemand: demand.rows,
    stock: stock.rows,
    truncatedInputs: [
      products.complete ? null : 'master data',
      demand.complete ? null : 'demand',
      stock.complete ? null : 'stock',
    ].filter((name): name is string => name !== null),
  }
}

/** Listeyi doküman sınırına sığacak parçalara böler. */
export function chunkItems<T>(items: T[]): T[][] {
  const chunks: T[][] = []
  let current: T[] = []
  let bytes = 0
  for (const item of items) {
    const size = JSON.stringify(item).length
    if (current.length > 0 && (bytes + size > CHUNK_BYTES || current.length >= CHUNK_ITEMS)) {
      chunks.push(current)
      current = []
      bytes = 0
    }
    current.push(item)
    bytes += size
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

const LIST_KINDS = ['jobs', 'unplanned', 'days', 'rawNeeds', 'maintenance'] as const

async function storeRun(ctx: Ctx, run: PlanRun, startedAt: number, trigger?: string) {
  // JSON turu: `undefined` alanları atar — Convex dizilerde undefined kabul
  // etmez.
  const plain = JSON.parse(JSON.stringify(run)) as Record<string, unknown>
  const summary: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(plain)) {
    if (!(LIST_KINDS as readonly string[]).includes(key)) summary[key] = value
  }
  const runId = await ctx.runMutation(internal.planRuns.createRun, {
    startedAt,
    computedAt: run.computedAt,
    trigger,
    summary,
  })
  let index = 0
  for (const kind of LIST_KINDS) {
    for (const items of chunkItems((plain[kind] as unknown[]) ?? [])) {
      await ctx.runMutation(internal.planRuns.addChunk, { runId, index: index++, kind, items })
    }
  }
  await ctx.runMutation(internal.planRuns.completeRun, {
    runId,
    chunkCount: index,
    durationMs: Date.now() - startedAt,
  })
}

export const recompute = internalAction({
  args: { trigger: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx: Ctx, { trigger }: Ctx) => {
    const { proceed } = await ctx.runMutation(internal.planRuns.beginRun, { trigger })
    if (!proceed) return null
    const startedAt = Date.now()
    try {
      const inputs = await loadInputs(ctx)
      const run = computePlan(inputs, Date.now())
      await storeRun(ctx, run, startedAt, trigger)
      await ctx.runMutation(internal.planRuns.finishRun, { startedAt })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('Plan recompute failed', error)
      await ctx.runMutation(internal.planRuns.finishRun, { startedAt, error: message })
    }
    return null
  },
})
