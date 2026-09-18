import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import { ALL_GROUPS, NAV_GROUPS, PRIMARY_LINKS } from '../lib/navigation'

/**
 * Two navigations from one definition.
 *
 * On a wide screen the daily destinations sit in the bar and the rest fold
 * into grouped menus, so thirteen pages do not become thirteen buttons. On a
 * phone the bar collapses to a title and a menu button, and everything moves
 * into a drawer that slides in from the left with the groups spelled out —
 * a dropdown inside a cramped bar is unusable with a thumb.
 */
export function Header() {
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navRef = useRef<HTMLDivElement>(null)

  // Navigating away should always leave the menus closed, however it happened.
  useEffect(() => {
    setOpenGroup(null)
    setDrawerOpen(false)
  }, [pathname])

  // A click anywhere else closes an open group; blur alone misses clicks on
  // the page body.
  useEffect(() => {
    if (!openGroup) return
    const onPointerDown = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) setOpenGroup(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [openGroup])

  useEffect(() => {
    if (!drawerOpen && !openGroup) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setDrawerOpen(false)
      setOpenGroup(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen, openGroup])

  const linkClass =
    'rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
  const activeClass = { className: 'bg-muted text-foreground font-medium' }

  return (
    <>
      <header className="border-b border-border bg-background/95 backdrop-blur">
        <nav className="flex w-full items-center gap-2 px-4 py-2.5 sm:px-6 sm:py-3">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            className="-ml-1 rounded-md p-2 text-foreground hover:bg-muted lg:hidden"
          >
            <span className="block h-0.5 w-5 bg-current" />
            <span className="mt-1 block h-0.5 w-5 bg-current" />
            <span className="mt-1 block h-0.5 w-5 bg-current" />
          </button>

          <Link
            to="/planlama"
            className="shrink-0 truncate text-sm font-semibold text-foreground sm:text-base"
          >
            Production Planning
          </Link>

          <div ref={navRef} className="ml-auto hidden items-center gap-1 text-sm lg:flex">
            {PRIMARY_LINKS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={linkClass}
                activeProps={activeClass}
                activeOptions={{ exact: item.to === '/' }}
              >
                {item.label}
              </Link>
            ))}

            {NAV_GROUPS.map((group) => {
              const isOpen = openGroup === group.label
              const hasActive = group.items.some((i) => i.to === pathname)
              return (
                <div key={group.label} className="relative">
                  <button
                    onClick={() => setOpenGroup(isOpen ? null : group.label)}
                    aria-expanded={isOpen}
                    className={`${linkClass} ${
                      hasActive || isOpen ? 'bg-muted text-foreground font-medium' : ''
                    }`}
                  >
                    {group.label} <span aria-hidden>▾</span>
                  </button>
                  {isOpen && (
                    <div className="absolute right-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-md border border-border bg-background shadow-lg">
                      {group.items.map((item) => (
                        <Link
                          key={item.to}
                          to={item.to}
                          className="block px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          activeProps={activeClass}
                        >
                          <span className="block">{item.label}</span>
                          {item.hint && (
                            <span className="block text-xs text-muted-foreground/80">
                              {item.hint}
                            </span>
                          )}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </nav>
      </header>

      {drawerOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col overflow-y-auto border-r border-border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold text-foreground">Production Planning</span>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="rounded-md px-2 py-1 text-lg leading-none text-muted-foreground hover:bg-muted"
              >
                ×
              </button>
            </div>

            <div className="flex-1 px-2 py-3">
              {ALL_GROUPS.map((group) => (
                <div key={group.label} className="mb-4 last:mb-0">
                  <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </p>
                  {group.items.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setDrawerOpen(false)}
                      className="block rounded-md px-2 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      activeProps={{ className: 'bg-muted text-foreground font-medium' }}
                      activeOptions={{ exact: item.to === '/' }}
                    >
                      <span className="block">{item.label}</span>
                      {item.hint && (
                        <span className="block text-xs text-muted-foreground/80">{item.hint}</span>
                      )}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
