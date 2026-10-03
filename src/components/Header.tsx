import { Link, useRouterState } from '@tanstack/react-router'
import { ChevronDown, LayoutGrid, LogOut, Menu, Settings, Shield, UserRound, Wifi, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { api } from '../../convex/_generated/api'
import { useMutation } from '../lib/convexTransport'
import { useCurrentUser } from '../lib/currentUser'
import { BOARD_AREA, MODULE_AREAS, areaFor, type Area, type NavItem } from '../lib/navigation'
import { usePlant } from '../lib/plantContext'

/**
 * Üst çubuk — her alanda aynı düzen (docs/architecture.md → Arayüz):
 *
 *   [☰] [logo] [Alan ▾]  alanın menüsü …        [Şirket › Plant ▾] [kullanıcı ▾]
 *
 * - Logo portala döner; "Alan ▾" izinli modüller arasında geçiş yapar.
 * - Menüde yalnızca o alanın sayfaları var; yönetim (Company settings,
 *   Administration), hesap ve teşhis kullanıcı menüsündedir.
 * - Telefonda menü, alanlar ve kullanıcı bağlantıları soldan açılan
 *   çekmecede; çubukta yalnızca logo, alan adı ve plant kalır.
 */
export function Header() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { ctx, can } = usePlant()
  const isBoard = ctx?.isBoard === true
  const area = isBoard ? BOARD_AREA : areaFor(pathname)
  const [drawer, setDrawer] = useState(false)

  useEffect(() => setDrawer(false), [pathname])

  // İzinli modüller (Board: KPI ya da OEE izni).
  const modules = isBoard
    ? []
    : MODULE_AREAS.filter((a) => (a.key === 'board' ? can('kpi') || can('oee') : !a.module || can(a.module)))

  return (
    <>
      <header className="relative bg-gradient-to-r from-slate-950 via-indigo-950 to-blue-900 text-white shadow-lg shadow-indigo-950/20">
        <nav className="flex w-full items-center gap-2 px-3 py-2.5 sm:px-5">
          <button
            onClick={() => setDrawer(true)}
            aria-label="Open menu"
            aria-expanded={drawer}
            className="rounded-md p-2 text-white hover:bg-white/10 lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <Logo />
          {modules.length > 0 ? <AreaSwitcher area={area} modules={modules} /> : <AreaTitle area={area} />}
          <DesktopNav area={area} pathname={pathname} />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ContextSwitch />
            <UserMenu />
          </div>
        </nav>
        <div aria-hidden className="h-1 w-full bg-gradient-to-r from-sky-400 via-indigo-400 to-amber-400" />
      </header>
      {drawer && <Drawer area={area} modules={modules} onClose={() => setDrawer(false)} />}
    </>
  )
}

// ---- Parçalar ---------------------------------------------------------------

const BAR_LINK = 'rounded-lg px-3 py-1.5 text-sm text-white/75 transition-colors hover:bg-white/10 hover:text-white'
const BAR_ACTIVE = 'bg-white/15 text-white font-medium ring-1 ring-white/20'

function Logo() {
  return (
    <Link to="/" title="Production Portal — all modules" className="group shrink-0">
      <span className="grid h-8 w-8 place-items-center rounded-xl sm:h-9 sm:w-9 bg-gradient-to-br from-sky-400 to-indigo-500 shadow-md shadow-sky-500/30 ring-1 ring-white/30 transition-transform group-hover:scale-105">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 20h18" />
          <path d="M6 20V10l6-4 6 4v10" />
          <path d="M10 20v-5h4v5" />
          <path d="M12 2v4" />
        </svg>
      </span>
    </Link>
  )
}

function AreaTitle({ area }: { area: Area }) {
  return (
    <Link to={area.home} className="min-w-0 shrink leading-tight">
      <span className="block truncate text-base font-bold tracking-tight sm:text-lg">{area.title}</span>
      <span className="hidden text-[10px] font-medium tracking-[0.18em] text-sky-200/80 uppercase sm:block">{area.subtitle}</span>
    </Link>
  )
}

/** Açılır pencere: dışarı tıklayınca ya da Esc ile kapanır. */
function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  return { open, setOpen, ref }
}

function Panel({ children, align = 'left', width = 'w-72' }: { children: ReactNode; align?: 'left' | 'right'; width?: string }) {
  return (
    <div
      className={`absolute top-full z-50 mt-2 ${width} overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}
    >
      {children}
    </div>
  )
}

function MenuLink({ item, onClick, exact }: { item: NavItem; onClick?: () => void; exact?: boolean }) {
  return (
    <Link
      to={item.to}
      onClick={onClick}
      className="block px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      activeProps={{ className: 'bg-muted text-foreground font-medium' }}
      activeOptions={{ exact }}
    >
      <span className="block">{item.label}</span>
      {item.hint && <span className="block text-xs text-muted-foreground/80">{item.hint}</span>}
    </Link>
  )
}

/** "PlanningExpert ▾": izinli modüller arasında geçiş; en üstte portal. */
function AreaSwitcher({ area, modules }: { area: Area; modules: Area[] }) {
  const { open, setOpen, ref } = usePopover()
  return (
    <div ref={ref} className="relative min-w-0">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-left hover:bg-white/10"
        title="Switch module"
      >
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-base font-bold tracking-tight sm:text-lg">{area.title}</span>
          <span className="hidden text-[10px] font-medium tracking-[0.18em] text-sky-200/80 uppercase sm:block">{area.subtitle}</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 shrink-0 text-white/70 sm:block" aria-hidden />
      </button>
      {open && (
        <Panel width="w-64">
          <p className="px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Modules</p>
          <Link to="/" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <LayoutGrid className="h-4 w-4" aria-hidden /> Portal home
          </Link>
          {modules.map((m) => (
            <Link
              key={m.key}
              to={m.home}
              onClick={() => setOpen(false)}
              className={`block px-4 py-2 text-sm hover:bg-muted ${m.key === area.key ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {m.title}
            </Link>
          ))}
        </Panel>
      )}
    </div>
  )
}

/** Masaüstü menüsü: alanın doğrudan bağlantıları + açılır gruplar. */
function DesktopNav({ area, pathname }: { area: Area; pathname: string }) {
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => setOpenGroup(null), [pathname])
  useEffect(() => {
    if (!openGroup) return
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpenGroup(null)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpenGroup(null)
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [openGroup])
  if (!area.primary.length && !area.groups.length) return null
  return (
    <div ref={ref} className="ml-3 hidden min-w-0 items-center gap-0.5 lg:flex">
      {area.primary.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className={`shrink-0 ${BAR_LINK}`}
          activeProps={{ className: BAR_ACTIVE }}
          activeOptions={{ exact: item.to === area.home }}
        >
          {item.label}
        </Link>
      ))}
      {area.groups.map((g) => {
        const isOpen = openGroup === g.label
        const active = g.items.some((i) => i.to === pathname)
        return (
          <div key={g.label} className="relative">
            <button
              onClick={() => setOpenGroup(isOpen ? null : g.label)}
              aria-expanded={isOpen}
              className={`flex items-center gap-1 ${BAR_LINK} ${active || isOpen ? BAR_ACTIVE : ''}`}
            >
              {g.label}
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </button>
            {isOpen && (
              <Panel>
                {g.items.map((item) => (
                  <MenuLink key={item.to} item={item} onClick={() => setOpenGroup(null)} />
                ))}
              </Panel>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Şirket › Plant: her sayfanın verisi bu plant'e aittir. Birden çok plant
 * görene liste (şirketlere göre gruplu) açılır; tek plant'te yalnızca ad.
 */
function ContextSwitch() {
  const { ctx } = usePlant()
  const select = useMutation(api.tenancy.selectPlant)
  const { open, setOpen, ref } = usePopover()
  if (!ctx?.active) return null
  const active = ctx.active
  const label = (
    <span className="min-w-0 text-left leading-tight">
      <span className="hidden max-w-[12rem] truncate text-[10px] text-white/60 sm:block">{active.companyName}</span>
      <span className="block max-w-[6.5rem] truncate text-xs font-semibold sm:max-w-[12rem]">{active.plantName}</span>
    </span>
  )
  if (ctx.plants.length < 2) {
    return (
      <span className="hidden items-center rounded-lg px-2 py-1 sm:flex" title="The data on every page belongs to this plant">
        {label}
      </span>
    )
  }
  const companies = [...new Map(ctx.plants.map((p) => [p.companyId, p.companyName])).entries()]
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Plant — the data on every page belongs to this plant"
        className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1 ring-1 ring-white/20 hover:bg-white/15"
      >
        {label}
        <ChevronDown className="hidden h-3.5 w-3.5 shrink-0 text-white/70 sm:block" aria-hidden />
      </button>
      {open && (
        <Panel align="right" width="w-64">
          <div className="max-h-[70vh] overflow-y-auto py-1">
            {companies.map(([id, name]) => (
              <div key={id} className="py-1">
                <p className="px-4 pt-1 pb-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{name}</p>
                {ctx.plants
                  .filter((p) => p.companyId === id)
                  .map((p) => (
                    <button
                      key={p._id}
                      onClick={() => {
                        setOpen(false)
                        if (p._id !== active.plantId) void select({ plantId: p._id })
                      }}
                      className={`block w-full px-4 py-1.5 text-left text-sm hover:bg-muted ${p._id === active.plantId ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {p._id === active.plantId ? '● ' : ''}
                      {p.name}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}

/** Oturumdaki kişinin rolü (ekranda gösterilen ad). */
export function roleLabel(ctx: ReturnType<typeof usePlant>['ctx']): string {
  if (!ctx) return ''
  if (ctx.platformRole === 'owner') return 'Site owner'
  if (ctx.platformRole === 'general') return 'General'
  if (ctx.isBoard) return 'Board member'
  return ctx.isCreator ? 'Creator' : 'Member'
}

/** Kullanıcı menüsü: hesap, yönetim (yetkiye göre), teşhis, çıkış. */
function UserMenu() {
  const { name, setToken } = useCurrentUser()
  const { ctx, isPlatform, canManage } = usePlant()
  const { open, setOpen, ref } = usePopover()
  const close = () => setOpen(false)
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Account and settings"
        className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/10"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-white/15 text-sm font-semibold uppercase ring-1 ring-white/25">
          {(name ?? '?').slice(0, 1)}
        </span>
        <span className="hidden text-left leading-tight xl:block">
          <span className="block text-xs font-medium">{name}</span>
          <span className="block text-[10px] text-white/60">{roleLabel(ctx)}</span>
        </span>
      </button>
      {open && (
        <Panel align="right" width="w-64">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">{name}</p>
            <p className="text-xs text-muted-foreground">{roleLabel(ctx)}</p>
          </div>
          <div className="py-1">
            <UserLink to="/account" icon={<UserRound className="h-4 w-4" />} label="My account" hint="Password, who you are" onClick={close} />
            {canManage && !ctx?.isBoard && (
              <UserLink to="/settings" icon={<Settings className="h-4 w-4" />} label="Company settings" hint="Plants, departments, users, lists" onClick={close} />
            )}
            {isPlatform && (
              <UserLink to="/admin" icon={<Shield className="h-4 w-4" />} label="Administration" hint="Holdings, companies, Generals, system" onClick={close} />
            )}
            <UserLink to="/tani" icon={<Wifi className="h-4 w-4" />} label="Connection diagnostics" hint="Is this device connected?" onClick={close} />
          </div>
          <button
            onClick={() => setToken(null)}
            className="flex w-full items-center gap-2 border-t border-border px-4 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </Panel>
      )}
    </div>
  )
}

function UserLink({ to, icon, label, hint, onClick }: { to: string; icon: ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <Link to={to} onClick={onClick} className="flex items-start gap-2.5 px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" activeProps={{ className: 'bg-muted text-foreground' }}>
      <span className="mt-0.5" aria-hidden>
        {icon}
      </span>
      <span>
        <span className="block text-foreground">{label}</span>
        <span className="block text-xs">{hint}</span>
      </span>
    </Link>
  )
}

/** Telefon: soldan açılan çekmece — alanın menüsü, modüller, hesap. */
function Drawer({ area, modules, onClose }: { area: Area; modules: Area[]; onClose: () => void }) {
  const { name, setToken } = useCurrentUser()
  const { ctx, isPlatform, canManage } = usePlant()
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])
  const section = (title: string, items: NavItem[]) =>
    items.length > 0 && (
      <div className="mb-3">
        <p className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            onClick={onClose}
            className="block rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            activeProps={{ className: 'bg-muted text-foreground font-medium' }}
            activeOptions={{ exact: item.to === area.home }}
          >
            <span className="block">{item.label}</span>
            {item.hint && <span className="block text-xs text-muted-foreground/80">{item.hint}</span>}
          </Link>
        ))}
      </div>
    )
  const account: NavItem[] = [
    { to: '/account', label: 'My account', hint: 'Password, who you are' },
    ...(canManage && !ctx?.isBoard ? [{ to: '/settings', label: 'Company settings', hint: 'Plants, departments, users, lists' }] : []),
    ...(isPlatform ? [{ to: '/admin', label: 'Administration', hint: 'Holdings, companies, Generals, system' }] : []),
    { to: '/tani', label: 'Connection diagnostics', hint: 'Is this device connected?' },
  ]
  return (
    <div className="fixed inset-0 z-[60] lg:hidden">
      <button aria-label="Close menu" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-y-0 left-0 flex w-[84%] max-w-xs flex-col overflow-y-auto border-r border-border bg-background shadow-xl">
        <div className="flex items-center justify-between bg-gradient-to-r from-slate-950 via-indigo-950 to-blue-900 px-4 py-3 text-white">
          <span className="leading-tight">
            <span className="block text-base font-bold">{area.title}</span>
            <span className="block text-xs text-white/70">
              {name} · {roleLabel(ctx)}
            </span>
          </span>
          <button onClick={onClose} aria-label="Close menu" className="rounded-md p-1.5 hover:bg-white/10">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="flex-1 px-2 py-3">
          {section(area.title, area.primary)}
          {area.groups.map((g) => (
            <div key={g.label}>{section(g.label, g.items)}</div>
          ))}
          {section('Modules', [{ to: '/', label: 'Portal home' }, ...modules.filter((m) => m.key !== area.key).map((m) => ({ to: m.home, label: m.title }))])}
          {section('Account', account)}
          <button
            onClick={() => setToken(null)}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </div>
      </div>
    </div>
  )
}

