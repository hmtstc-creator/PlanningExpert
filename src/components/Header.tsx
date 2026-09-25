import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import { useCurrentUser } from '../lib/currentUser'
import { ALL_GROUPS, NAV_GROUPS, PRIMARY_LINKS, moduleNavFor } from '../lib/navigation'
import { isPortalPath } from '../lib/portal'

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
  const { name: currentUser, setToken } = useCurrentUser()

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

  // Oturumu kapatır: jeton sunucuda silinir, giriş ekranı geri gelir.
  const signOut = () => setToken(null)
  const signOutButton = (
    <button
      onClick={signOut}
      className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      title="Sign out of the portal"
    >
      Sign out
    </button>
  )

  // Masaüstü: kim giriş yaptı + çıkış. Telefonda `signedInMobile`.
  const signedIn = (
    <div className="ml-auto hidden shrink-0 items-center gap-3 lg:flex">
      <Link
        to="/yonetim"
        className="text-xs text-muted-foreground hover:text-foreground"
        title="Signed-in user — manage accounts on the Admin page"
      >
        <span className="text-muted-foreground/70">Signed in as </span>
        <span className="font-medium text-foreground">{currentUser}</span>
      </Link>
      {signOutButton}
    </div>
  )
  const signedInMobile = (
    <div className="ml-auto flex shrink-0 items-center gap-2 lg:hidden">
      <span className="text-xs text-muted-foreground">{currentUser}</span>
      {signOutButton}
    </div>
  )

  // Takip modülleri (kalıp, makine): kendi kısa menüleri, portala dönüş.
  const moduleNav = moduleNavFor(pathname)
  if (moduleNav) {
    return (
      <header className="border-b border-border bg-background/95 backdrop-blur">
        <nav className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 sm:px-6 sm:py-3">
          <Link
            to="/"
            className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Back to the portal"
          >
            ← Portal
          </Link>
          <Link to={moduleNav.prefix} className="shrink-0 text-sm font-semibold text-foreground sm:text-base">
            {moduleNav.title}
          </Link>
          <div className="order-last flex w-full gap-1 overflow-x-auto text-sm lg:order-none lg:ml-4 lg:w-auto">
            {moduleNav.links.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="shrink-0 rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                activeProps={{ className: 'bg-muted text-foreground font-medium' }}
                activeOptions={{ exact: true }}
              >
                {item.label}
              </Link>
            ))}
          </div>
          {signedInMobile}
          {signedIn}
        </nav>
      </header>
    )
  }

  // Portal sayfalarında PlanningExpert menüsü yok: yalnız portal adı ve kullanıcı.
  if (isPortalPath(pathname)) {
    return (
      <header className="border-b border-border bg-background/95 backdrop-blur">
        <nav className="flex w-full items-center gap-3 px-4 py-2.5 sm:px-6 sm:py-3">
          <Link to="/" className="text-sm font-semibold text-foreground sm:text-base">
            Production Portal
          </Link>
          {signedInMobile}
          {signedIn}
        </nav>
      </header>
    )
  }

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
            to="/"
            className="hidden shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground sm:block"
            title="Back to the portal"
          >
            ← Portal
          </Link>
          <Link
            to="/planningexpert"
            className="shrink-0 truncate text-sm font-semibold text-foreground sm:text-base"
          >
            PlanningExpert
          </Link>

          <div ref={navRef} className="ml-auto hidden items-center gap-1 text-sm lg:flex">
            {PRIMARY_LINKS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={linkClass}
                activeProps={activeClass}
                activeOptions={{ exact: item.to === '/planningexpert' }}
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

          {/*
            Kayıtların üzerine hangi ismin yazıldığı her ekranda görünmeli:
            yanlış kişiyle çalışıldığı fark edilmeden saatler geçebilir.
          */}
          {signedIn}
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
              <span className="text-sm font-semibold text-foreground">PlanningExpert</span>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="rounded-md px-2 py-1 text-lg leading-none text-muted-foreground hover:bg-muted"
              >
                ×
              </button>
            </div>

            <div className="flex-1 px-2 py-3">
              <Link
                to="/"
                onClick={() => setDrawerOpen(false)}
                className="mb-3 block rounded-md px-2 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                ← Portal
              </Link>
              <div className="mb-4 flex items-center justify-between rounded-md bg-muted/50 px-2 py-2 text-sm">
                <span className="text-muted-foreground">
                  Signed in as <span className="font-medium text-foreground">{currentUser}</span>
                </span>
                {signOutButton}
              </div>
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
                      activeOptions={{ exact: item.to === '/planningexpert' }}
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
