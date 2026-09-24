import { Link } from '@tanstack/react-router'

import { PORTAL_MODULES } from '../lib/portal'

/** Henüz hazır olmayan bir portal modülünün sayfası. */
export function ModulePlaceholder({ path }: { path: string }) {
  const module = PORTAL_MODULES.find((m) => m.to === path)
  if (!module) return null
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
        ← Portal
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-foreground">{module.title}</h1>
      <p className="mt-2 text-muted-foreground">{module.description}</p>
      <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        This module is being prepared.
      </p>
      {module.related && module.related.length > 0 && (
        <div className="mt-6">
          <p className="text-sm font-medium text-foreground">Available today in PlanningExpert</p>
          <ul className="mt-2 space-y-1 text-sm">
            {module.related.map((r) => (
              <li key={r.to}>
                <Link to={r.to} className="underline hover:no-underline">
                  {r.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
