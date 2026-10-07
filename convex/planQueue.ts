import { internal } from './_generated/api'

/**
 * Planın hesaplanma kuyruğu.
 *
 * Plan yalnızca elle hesaplanır (Planning → "Calculate plan"; planlamacı,
 * 2026-10-07: otomatik hesap Convex'in okuma / yazma kotasını dolduruyordu).
 * Plan girdisini değiştiren yazma yalnızca `markPlanChanged` ile "plan güncel
 * değil" işaretini koyar. Hesap isteği kısa gecikmeyle kurulur; zaten bekleyen
 * bir hesap varsa yenisi kurulmaz.
 */
export const RECOMPUTE_DELAY_MS = 4_000

// Convex'in üretilen tipleri bu ortamda yok; gevşek tiplenmiş.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

export async function planStatusDoc(ctx: Ctx) {
  return ctx.db
    .query('planStatus')
    .withIndex('by_key', (q: Ctx) => q.eq('key', 'default'))
    .first()
}

/** Plan girdisi değişti: plan elle yeniden hesaplanana kadar güncel değil. */
export async function markPlanChanged(ctx: Ctx): Promise<void> {
  const now = Date.now()
  const status = await planStatusDoc(ctx)
  if (status) await ctx.db.patch(status._id, { dataChangedAt: now })
  else await ctx.db.insert('planStatus', { key: 'default', dataChangedAt: now })
}

/** `ctx`: fabrikaya kilitli bağlam (`ctx.plantId`, convex/guarded.ts). */
export async function requestRecompute(
  ctx: Ctx,
  delayMs: number = RECOMPUTE_DELAY_MS,
  trigger = 'change',
): Promise<void> {
  const now = Date.now()
  const status = await planStatusDoc(ctx)
  const pending = status?.scheduledFor
  // Yakında başlayacak bir hesap var: bu değişikliği de o görecek. Bir
  // dakikadan eski "bekleyen" kayıt takılmış sayılır ve yenisi kurulur.
  if (pending !== undefined && pending > now - 60_000 && pending <= now + delayMs) return

  await ctx.scheduler.runAfter(delayMs, internal.planEngine.recompute, { trigger, plantId: ctx.plantId })
  const patch = { requestedAt: now, scheduledFor: now + delayMs }
  if (status) await ctx.db.patch(status._id, patch)
  else await ctx.db.insert('planStatus', { key: 'default', ...patch })
}
