import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { api } from '../../convex/_generated/api'
import { useMutation, useQuery } from '../lib/convexTransport'
import { friendlyError } from '../lib/mutationErrors'
import { boardAllows, moduleOfPath, usePlant } from '../lib/plantContext'
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
  const { ctx, can, isPlatform, canManage } = usePlant()
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

  const under = (p: string) => pathname === p || pathname.startsWith(`${p}/`)
  // Plant'siz de açılan sayfalar: hesap, teşhis; General için Administration.
  const plantless = under('/account') || under('/tani') || (isPlatform && (under('/admin') || under('/platform')))
  if (!ctx.active && !plantless) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16 text-center text-sm text-muted-foreground">
        <p className="text-foreground">Your account has no plant yet.</p>
        <p className="mt-1">
          {isPlatform ? (
            <Link to="/admin" className="underline">
              Add a company and a plant
            </Link>
          ) : (
            'Ask a creator of your company to add you to a group.'
          )}
        </p>
      </div>
    )
  }

  // Administration yalnızca General; Company settings şirketi yöneten (creator ya da General).
  if (under('/admin') && !isPlatform) return <NoAccess text="Administration is for Generals only." />
  if (under('/settings') && !canManage) return <NoAccess text="Company settings are managed by a creator of your company." />

  // Board görünümü: yalnızca özet ve dashboard'lar.
  if (ctx.isBoard && !boardAllows(pathname)) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16 text-center text-sm text-muted-foreground">
        <p className="text-foreground">This page is not part of the board view.</p>
        <Link to="/board" className="mt-2 inline-block underline">
          Open the Board Dashboard
        </Link>
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

function NoAccess({ text }: { text: string }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-16 text-center text-sm text-muted-foreground">
      <p className="text-foreground">{text}</p>
      <Link to="/" className="mt-2 inline-block underline">
        Back to the portal
      </Link>
    </div>
  )
}
