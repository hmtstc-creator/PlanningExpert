import { createFileRoute, Link, Navigate } from '@tanstack/react-router'

import { api } from '../../convex/_generated/api'
import { useQuery } from '../lib/convexTransport'
import type { Module } from '../lib/tenancy'

import { PORTAL_MODULES } from '../lib/portal'
import { usePlant } from '../lib/plantContext'

export const Route = createFileRoute('/')({
  component: PortalHome,
})

/**
 * Portalın ana sayfası. Giriş ekranı bunun da önündedir (LoginGate kökte);
 * buradan her modül kendi sayfalarına açılır.
 */
function PortalHome() {
  const { ctx, can, canManage, isPlatform } = usePlant()
  // Board görünümü doğrudan Board Dashboard'la açılır.
  if (ctx?.isBoard) return <Navigate to="/board" />
  // Yalnızca bu fabrikada izni olan modüller.
  const modules = PORTAL_MODULES.filter((m) => (m.to === '/board' ? can('kpi') || can('oee') : !m.module || can(m.module)))
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-2xl font-bold text-foreground">Production Portal</h1>
      <p className="mt-1 text-muted-foreground">
        {ctx?.active ? `${ctx.active.companyName} · ${ctx.active.plantName} — choose a module.` : 'Choose a module.'}
      </p>
      {(canManage || isPlatform) && (
        <p className="mt-2 text-sm">
          <Link to="/platform" className="underline">
            {isPlatform ? 'Companies and plants' : 'Plants of your company'}
          </Link>
          {' · '}
          <Link to="/yonetim" className="underline">
            Users and groups
          </Link>
        </p>
      )}
      {(ctx?.plants.length ?? 0) > 1 && (
        <p className="mt-1 text-sm">
          <Link to="/compare" className="underline">
            Compare plants
          </Link>
        </p>
      )}

      {canManage && ctx?.active && <SetupChecklist can={can} />}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((m, i) => (
          <Link
            key={m.to}
            to={m.to}
            className={`group flex min-h-40 flex-col rounded-xl border p-5 transition-colors ${
              m.ready
                ? 'border-foreground/20 bg-background hover:border-foreground hover:bg-muted/50'
                : 'border-border bg-muted/30 hover:bg-muted/60'
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold ${
                  m.ready ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                }`}
              >
                {i + 1}
              </span>
              {!m.ready && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                  Coming soon
                </span>
              )}
            </div>
            <h2 className="mt-4 text-lg font-semibold text-foreground">{m.title}</h2>
            <p className="mt-1 flex-1 text-sm text-muted-foreground">{m.description}</p>
            <span className="mt-3 text-sm font-medium text-foreground group-hover:underline">
              {m.ready ? 'Open →' : 'See details →'}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

interface Step {
  key: string
  label: string
  done: boolean
  to: string
  module: Module
  hint: string
}

/** Fabrika kurulum listesi (creator): veriye bakılarak tamam / eksik. Hepsi tamamsa görünmez. */
function SetupChecklist({ can }: { can: (m: Module) => boolean }) {
  const steps = ((useQuery(api.setup.checklist) ?? []) as Step[]).filter((s) => can(s.module))
  const open = steps.filter((s) => !s.done)
  if (!open.length) return null
  return (
    <section className="mt-6 rounded-xl border border-amber-300 bg-amber-50/60 p-4">
      <h2 className="text-sm font-semibold text-foreground">
        Plant setup — {steps.length - open.length} of {steps.length} done
      </h2>
      <ol className="mt-2 space-y-1 text-sm">
        {steps.map((s) => (
          <li key={s.key} className="flex flex-wrap items-baseline gap-2">
            <span className={s.done ? 'text-emerald-700' : 'text-amber-800'}>{s.done ? '✓' : '○'}</span>
            <Link to={s.to} className={s.done ? 'text-muted-foreground' : 'font-medium text-foreground underline'}>
              {s.label}
            </Link>
            {!s.done && <span className="text-xs text-muted-foreground">{s.hint}</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}
