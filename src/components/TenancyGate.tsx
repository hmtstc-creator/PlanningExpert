import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { api } from '../../convex/_generated/api'
import { useMutation, useQuery } from '../lib/convexTransport'
import { friendlyError } from '../lib/mutationErrors'
import { moduleOfPath, usePlant } from '../lib/plantContext'
import { MODULE_LABELS } from '../lib/tenancy'

/**
 * Giriş sonrası kapı (docs/plant-genisletme.md):
 * 1. Fabrika anahtarı geçişi yapılmadıysa başlatır ve ilerlemeyi gösterir
 *    (bir kez; mevcut veri "Company 1 / Plant 1" olur).
 * 2. Kullanıcının hiç fabrikası yoksa söyler (platform kullanıcısı yönetim
 *    sayfalarına yine girer).
 * 3. Sayfanın modülünde izni yoksa sayfayı açmaz.
 */
export function TenancyGate({ children }: { children: ReactNode }) {
  const { ctx, can, isPlatform } = usePlant()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const start = useMutation(api.tenancy.startMigration)
  const status = useQuery(api.tenancy.migrationStatus, ctx && !ctx.migration.done ? {} : 'skip') as
    | { started: boolean; done: boolean; progress: number }
    | undefined
  const [error, setError] = useState<string | null>(null)
  const asked = useRef(false)

  useEffect(() => {
    if (!ctx || ctx.migration.done || ctx.migration.started || asked.current) return
    asked.current = true
    void start({}).catch((e: unknown) => {
      asked.current = false
      setError(friendlyError(e).message)
    })
  }, [ctx, start])

  if (!ctx) {
    return <p className="px-4 py-16 text-center text-sm text-muted-foreground">Loading your plant…</p>
  }
  if (!ctx.migration.done) {
    const pct = Math.round((status?.progress ?? 0) * 100)
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-foreground">Preparing the data for multiple plants</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This happens once. All existing data becomes Company 1 / Plant 1; nothing is deleted.
        </p>
        <div className="mt-4 h-2 w-full overflow-hidden rounded bg-muted">
          <div className="h-full bg-foreground transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{pct}%</p>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </div>
    )
  }

  const adminPage = pathname.startsWith('/platform') || pathname.startsWith('/yonetim')
  if (!ctx.active && !(isPlatform && adminPage)) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16 text-center text-sm text-muted-foreground">
        <p className="text-foreground">Your account has no plant yet.</p>
        <p className="mt-1">
          {isPlatform ? (
            <Link to="/platform" className="underline">
              Add a company and a plant
            </Link>
          ) : (
            'Ask a creator of your company to add you to a group.'
          )}
        </p>
      </div>
    )
  }

  const module = moduleOfPath(pathname)
  if (module && !can(module)) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16 text-center text-sm text-muted-foreground">
        <p className="text-foreground">
          You have no access to {MODULE_LABELS[module]} in {ctx.active?.plantName ?? 'this plant'}.
        </p>
        <Link to="/" className="mt-2 inline-block underline">
          Back to the portal
        </Link>
      </div>
    )
  }

  return (
    <>
      {ctx.active && ctx.active.companyStatus !== 'active' && (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
          {ctx.active.companyName} is suspended — read only.
          {ctx.active.deleteAfter ? ` Data can be deleted after ${new Date(ctx.active.deleteAfter).toISOString().slice(0, 10)}.` : ''}
        </div>
      )}
      {children}
    </>
  )
}

/** Üst çubukta fabrika: birden çok fabrikası olana seçici, olmayana ad. */
export function PlantSwitch({ light = false }: { light?: boolean }) {
  const { ctx } = usePlant()
  const select = useMutation(api.tenancy.selectPlant)
  if (!ctx?.active) return null
  const cls = light
    ? 'rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground'
    : 'max-w-[14rem] rounded-md border border-white/25 bg-white/10 px-2 py-1 text-xs text-white'
  const companies = new Set(ctx.plants.map((p) => p.companyId))
  const label = (p: { name: string; companyName: string }) => (companies.size > 1 ? `${p.companyName} · ${p.name}` : p.name)
  if (ctx.plants.length <= 1) {
    return <span className={`${cls} border-transparent bg-transparent`} title={ctx.active.companyName}>{label({ name: ctx.active.plantName, companyName: ctx.active.companyName })}</span>
  }
  return (
    <select
      aria-label="Plant"
      title="Plant — the data on every page belongs to this plant"
      className={cls}
      value={ctx.active.plantId}
      onChange={(e) => void select({ plantId: e.target.value })}
    >
      {ctx.plants.map((p) => (
        <option key={p._id} value={p._id} className="text-foreground">
          {label(p)}
        </option>
      ))}
    </select>
  )
}
