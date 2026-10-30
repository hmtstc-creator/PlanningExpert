import { httpRouter } from 'convex/server'

import { internal } from './_generated/api'
import { httpAction } from './_generated/server'

/**
 * SOP işleyicisinin (`sop-worker`) uçları — yalnız Docker ağının içinden
 * (http://backend:3211) ve `SOP_WORKER_TOKEN` ile. Kuyruk mantığı
 * convex/sopQueue.ts; burada yalnız kimlik denetimi ve JSON.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const http = httpRouter()

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Sabit sürede karşılaştırma: jetonun uzunluğu / içeriği zamanlamadan sızmasın. */
function sameToken(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

function authorized(req: Request): Response | null {
  const token = process.env.SOP_WORKER_TOKEN
  if (!token) return json({ error: 'SOP_WORKER_TOKEN is not set' }, 503)
  const got = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  return sameToken(got, token) ? null : json({ error: 'unauthorized' }, 401)
}

const route = (path: string, run: (ctx: Any, req: Request) => Promise<Response>) =>
  http.route({
    path: `/sop/worker/${path}`,
    method: 'POST',
    handler: httpAction(async (ctx, req) => authorized(req) ?? run(ctx, req)),
  })

route('claim', async (ctx) => json(await ctx.runMutation(internal.sopQueue.claim, {})))
route('heartbeat', async (ctx, req) => json(await ctx.runMutation(internal.sopQueue.heartbeat, await req.json())))
route('check', async (ctx, req) => json(await ctx.runQuery(internal.sopQueue.check, await req.json())))
route('done', async (ctx, req) => json(await ctx.runMutation(internal.sopQueue.complete, await req.json())))
route('fail', async (ctx, req) => json(await ctx.runMutation(internal.sopQueue.fail, await req.json())))
route('frames-done', async (ctx, req) => json(await ctx.runMutation(internal.sopQueue.framesDone, await req.json())))
// Kare (JPEG, birkaç yüz KB): gövde doğrudan depoya.
route('frame', async (ctx, req) => {
  const blob = await req.blob()
  if (!/^image\/jpeg$/i.test(blob.type) || blob.size > 8 * 1024 * 1024) return json({ error: 'JPEG up to 8 MB' }, 400)
  return json({ storageId: await ctx.storage.store(blob) })
})

export default http
