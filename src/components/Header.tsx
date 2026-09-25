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
      className="shrink-0 rounded-lg border border-white/25 px-3 py-1.5 text-xs font-medium text-white/85 transition-colors hover:bg-white/15 hover:text-white"
      title="Sign out of the portal"
    >
      Sign out
    </button>
  )

  // Çekmece açık zeminde: aynı düğmenin açık zemin hâli.
  const signOutButtonLight = (
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
        className="flex items-center gap-2 text-xs text-white/70 hover:text-white"
        title="Signed-in user — manage accounts on the Admin page"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-white/15 text-sm font-semibold uppercase text-white ring-1 ring-white/25">
          {(currentUser ?? '?').slice(0, 1)}
        </span>
        <span className="leading-tight">
          <span className="block text-[10px] uppercase tracking-wider text-white/55">Signed in</span>
          <span className="block font-medium text-white">{currentUser}</span>
        </span>
      </Link>
      {signOutButton}
    </div>
  )
  const signedInMobile = (
    <div className="ml-auto flex shrink-0 items-center gap-2 lg:hidden">
      <span className="hidden text-xs text-white/75 sm:inline">{currentUser}</span>
      {signOutButton}
    </div>
  )

  // Takip modülleri (kalıp, makine): kendi kısa menüleri, portala dönüş.
  const moduleNav = moduleNavFor(pathname)
  if (moduleNav) {
    return (
      <header className={HEADER_CLASS}>
        <nav className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
          <PortalButton />
          <Brand to={moduleNav.prefix} title={moduleNav.title} subtitle="Production Portal" />
          <div className="order-last flex w-full gap-1 overflow-x-auto text-sm lg:order-none lg:ml-6 lg:w-auto">
            {moduleNav.links.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`shrink-0 ${LINK_CLASS}`}
                activeProps={{ className: ACTIVE_CLASS }}
                activeOptions={{ exact: true }}
              >
                {item.label}
              </Link>
            ))}
          </div>
          {signedInMobile}
          {signedIn}
        </nav>
        <AccentLine />
      </header>
    )
  }

  // Portal sayfalarında PlanningExpert menüsü yok: yalnız portal adı ve kullanıcı.
  if (isPortalPath(pathname)) {
    return (
      <header className={HEADER_CLASS}>
        <nav className="flex w-full items-center gap-3 px-4 py-3 sm:px-6">
          <Brand to="/" title="Production Portal" subtitle="Planning · Dies · Machines · KPI" />
          {signedInMobile}
          {signedIn}
        </nav>
        <AccentLine />
      </header>
    )
  }

  const linkClass = LINK_CLASS
  const activeClass = { className: ACTIVE_CLASS }

  return (
    <>
      <header className={HEADER_CLASS}>
        <nav className="flex w-full items-center gap-3 px-4 py-3 sm:px-6">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            className="-ml-1 rounded-md p-2 text-white hover:bg-white/10 lg:hidden"
          >
            <span className="block h-0.5 w-5 bg-current" />
            <span className="mt-1 block h-0.5 w-5 bg-current" />
            <span className="mt-1 block h-0.5 w-5 bg-current" />
          </button>

          <PortalButton className="hidden sm:inline-flex" />
          <Brand to="/planningexpert" title="PlanningExpert" subtitle="Production planning" />

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
                    className={`${linkClass} ${hasActive || isOpen ? ACTIVE_CLASS : ''}`}
                  >
                    {group.label} <span aria-hidden>▾</span>
                  </button>
                  {isOpen && (
                    <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-xl">
                      {group.items.map((item) => (
                        <Link
                          key={item.to}
                          to={item.to}
                          className="block px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          activeProps={{ className: 'bg-muted text-foreground font-medium' }}
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
        <AccentLine />
      </header>

      {drawerOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col overflow-y-auto border-r border-border bg-background shadow-xl">
            <div className="flex items-center justify-between bg-gradient-to-r from-slate-950 via-indigo-950 to-blue-900 px-4 py-3">
              <span className="text-base font-bold tracking-tight text-white">PlanningExpert</span>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="rounded-md px-2 py-1 text-lg leading-none text-white/80 hover:bg-white/10"
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
                {signOutButtonLight}
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

// ---- Başlık görünümü -------------------------------------------------------
// Koyu lacivert-mavi degrade zemin, beyaz yazı; altta ince renkli şerit.
// Açılan menüler ve sayfanın kendisi açık zeminde kalır.

const HEADER_CLASS =
  'relative bg-gradient-to-r from-slate-950 via-indigo-950 to-blue-900 text-white shadow-lg shadow-indigo-950/20'
const LINK_CLASS =
  'rounded-lg px-3 py-1.5 text-white/75 transition-colors hover:bg-white/10 hover:text-white'
const ACTIVE_CLASS = 'bg-white/15 text-white font-medium ring-1 ring-white/20'

function AccentLine() {
  return (
    <div
      aria-hidden
      className="h-1 w-full bg-gradient-to-r from-sky-400 via-indigo-400 to-amber-400"
    />
  )
}

/** Logo + ad + alt başlık. */
function Brand({ to, title, subtitle }: { to: string; title: string; subtitle: string }) {
  return (
    <Link to={to} className="group flex shrink-0 items-center gap-3">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 shadow-md shadow-sky-500/30 ring-1 ring-white/30 transition-transform group-hover:scale-105">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 20h18" />
          <path d="M6 20V10l6-4 6 4v10" />
          <path d="M10 20v-5h4v5" />
          <path d="M12 2v4" />
        </svg>
      </span>
      <span className="leading-tight">
        <span className="block text-lg font-bold tracking-tight text-white sm:text-xl">{title}</span>
        <span className="hidden text-[10px] font-medium uppercase tracking-[0.18em] text-sky-200/80 sm:block">
          {subtitle}
        </span>
      </span>
    </Link>
  )
}

/** Portala dönüş — belirgin bir düğme, köşede kaybolan bir yazı değil. */
function PortalButton({ className = 'inline-flex' }: { className?: string }) {
  return (
    <Link
      to="/"
      title="Back to the portal"
      className={`${className} shrink-0 items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/25 transition-colors hover:bg-white/20`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
      Portal
    </Link>
  )
}
