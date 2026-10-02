import { createFileRoute, Link } from '@tanstack/react-router'

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
  // Yalnızca bu fabrikada izni olan modüller.
  const modules = PORTAL_MODULES.filter((m) => !m.module || can(m.module))
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
