import { Link, useRouterState } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, Factory, LogOut, Menu, Search, Star, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { api } from '../../convex/_generated/api'
import { useMutation } from '../lib/convexTransport'
import { useCurrentUser } from '../lib/currentUser'
import {
  ACCOUNT_LINKS,
  BOARD_AREA,
  MODULE_AREAS,
  PORTAL_AREA,
  areaFor,
  nodeHas,
  type Area,
  type NavItem,
  type NavNode,
} from '../lib/navigation'
import { pageIndex } from '../lib/navSearch'
import { useCanOpen, usePlant } from '../lib/plantContext'
import { useShortcuts } from '../lib/shortcuts'
import { CommandPalette, SearchButton, modKey, openCommandPalette } from './nav/CommandPalette'
import { ACCENTS, IconTile, Kbd, NavIcon } from './nav/NavIcon'

/**
 * Üst çubuk — iki kat (docs/architecture.md → Arayüz):
 *
 *   1. kat (koyu):  [☰] [logo]  [modül şeridi: her modül kendi renk ve ikonuyla]   [Ara Ctrl K] [Plant ▾] [kişi ▾]
 *   ── modülün renginde ince şerit ──
 *   2. kat (açık):  [modül]  Plan · Overview · Menu ▾ (mega menü: bütün gruplar yan yana + kısayollar)
 *
 * - Logo portala döner; modül şeridi izinli modüller arasında tek tıkla geçer.
 * - Ctrl+K (⌘K) her ekrandan bütün sayfaları, plant'leri ve hesap
 *   işlemlerini arar (nav/CommandPalette.tsx). Sabitlenen ve son açılan
 *   sayfalar mega menüde, aramada ve ana sayfada (src/lib/shortcuts.ts).
 * - Telefonda: 1. katta menü, logo, arama, kişi; 2. kat yana kayan sekmeler;
 *   çekmecede modül ızgarası, alanın sayfaları ve hesap.
 */
export function Header() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { ctx, can } = usePlant()
  const { name } = useCurrentUser()
  const { visit } = useShortcuts(name)
  const isBoard = ctx?.isBoard === true
  const area = isBoard ? BOARD_AREA : areaFor(pathname)
  const [drawer, setDrawer] = useState(false)

  useEffect(() => setDrawer(false), [pathname])
  // Son açılan sayfalar (yalnızca menüdeki sayfalar; ana sayfa değil).
  useEffect(() => {
    if (pathname !== '/' && KNOWN_PAGES.has(pathname)) visit(pathname)
  }, [pathname, visit])

  // İzinli modüller (Board: KPI ya da OEE izni).
  const modules = isBoard ? [] : MODULE_AREAS.filter((a) => (a.key === 'board' ? can('kpi') || can('oee') : !a.module || can(a.module)))
  const showSubNav = !(area.key === 'portal' && pathname === '/')

  return (
    <>
      <header className="relative bg-gradient-to-r from-slate-950 via-indigo-950 to-blue-900 text-white">
        <nav className="flex h-14 w-full items-center gap-1.5 px-2 sm:gap-2 sm:px-5">
          <button
            onClick={() => setDrawer(true)}
            aria-label="Open menu"
            aria-expanded={drawer}
            className="rounded-lg p-2 text-white/90 hover:bg-white/10 lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <Brand area={area} />
          {modules.length > 0 && <ModuleRail area={area} modules={modules} />}
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <span className="hidden lg:block">
              <SearchButton />
            </span>
            <span className="lg:hidden">
              <SearchButton variant="icon" />
            </span>
            <ContextSwitch />
            <UserMenu />
          </div>
        </nav>
        {/* Modülün rengi: hangi modülde olunduğu ilk bakışta. */}
        <div aria-hidden className={`h-[3px] w-full bg-gradient-to-r ${ACCENTS[area.accent].bar}`} />
      </header>
      {showSubNav && <SubNav area={area} pathname={pathname} />}
      {drawer && <Drawer area={area} modules={modules} onClose={() => setDrawer(false)} />}
      <CommandPalette />
    </>
  )
}

const KNOWN_PAGES = new Set(pageIndex().map((p) => p.to))

// ---- 1. kat ------------------------------------------------------------------

function Logo() {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 shadow-lg shadow-sky-500/30 ring-1 ring-white/30 transition-transform group-hover:scale-105">
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5 text-white"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M3 20h18" />
        <path d="M6 20V10l6-4 6 4v10" />
        <path d="M10 20v-5h4v5" />
        <path d="M12 2v4" />
      </svg>
    </span>
  )
}

/** Logo ve ad: portal ana sayfasına döner. Telefonda alanın adı da burada. */
function Brand({ area }: { area: Area }) {
  return (
    <Link to="/" title="Production Portal — home" className="group flex min-w-0 shrink items-center gap-2.5">
      <Logo />
      <span className="min-w-0 leading-tight lg:hidden 2xl:block">
        <span className="block truncate text-[15px] font-bold tracking-tight">
          <span className="lg:hidden">{area.key === 'portal' ? 'Production Portal' : area.title}</span>
          <span className="hidden lg:inline">Production Portal</span>
        </span>
        <span className="hidden text-[10px] font-medium tracking-[0.18em] text-sky-200/70 uppercase sm:block">
          <span className="lg:hidden">{area.key === 'portal' ? 'Home' : 'Production Portal'}</span>
          <span className="hidden lg:inline">Planning · OEE · Dies · Machines</span>
        </span>
      </span>
    </Link>
  )
}

/** Modül şeridi: izinli modüller; seçili olan beyaz kart, renkli ikon ve adıyla. */
function ModuleRail({ area, modules }: { area: Area; modules: Area[] }) {
  return (
    <div className="ml-3 hidden min-w-0 items-center gap-1 lg:flex" role="navigation" aria-label="Modules">
      {modules.map((m) => {
        const isActive = m.key === area.key
        return (
          <Link
            key={m.key}
            to={m.home}
            title={m.title}
            aria-current={isActive ? 'true' : undefined}
            className={`group flex shrink-0 items-center gap-2 rounded-xl py-1.5 pr-3 pl-1.5 text-sm transition-all ${
              isActive ? 'bg-white text-slate-900 shadow-lg shadow-black/25' : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            <span
              className={`grid h-7 w-7 place-items-center rounded-lg transition-colors ${
                isActive ? `${ACCENTS[m.accent].tile} shadow-md` : 'bg-white/10 group-hover:bg-white/15'
              }`}
            >
              <NavIcon icon={m.icon} className="h-4 w-4" />
            </span>
            <span className={isActive ? 'font-semibold' : 'hidden xl:inline'}>{m.short}</span>
          </Link>
        )
      })}
    </div>
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

function Panel({ children, width = 'w-72' }: { children: ReactNode; width?: string }) {
  return (
    <div
      className={`absolute top-full right-0 z-50 mt-2 ${width} max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-border bg-background text-foreground shadow-2xl ring-1 ring-black/5 animate-in fade-in slide-in-from-top-1`}
    >
      {children}
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
    <span className="flex min-w-0 items-center gap-2 text-left leading-tight">
      <Factory className="hidden h-4 w-4 shrink-0 text-sky-300 sm:block" aria-hidden />
      <span className="min-w-0">
        <span className="hidden max-w-[11rem] truncate text-[10px] text-white/55 sm:block">{active.companyName}</span>
        <span className="block max-w-[6rem] truncate text-xs font-semibold sm:max-w-[11rem]">{active.plantName}</span>
      </span>
    </span>
  )
  if (ctx.plants.length < 2) {
    return (
      <span className="hidden items-center rounded-xl px-2.5 py-1 sm:flex" title="The data on every page belongs to this plant">
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
        className="flex h-9 items-center gap-1.5 rounded-xl bg-white/10 px-2.5 ring-1 ring-white/15 transition hover:bg-white/15"
      >
        {label}
        <ChevronDown className="hidden h-3.5 w-3.5 shrink-0 text-white/60 sm:block" aria-hidden />
      </button>
      {open && (
        <Panel width="w-72">
          <p className="border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
            The data on every page belongs to the selected plant.
          </p>
          <div className="max-h-[70vh] overflow-y-auto py-1">
            {companies.map(([id, cname]) => (
              <div key={id} className="py-1">
                <p className="px-4 pt-1 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{cname}</p>
                {ctx.plants
                  .filter((p) => p.companyId === id)
                  .map((p) => {
                    const isActive = p._id === active.plantId
                    return (
                      <button
                        key={p._id}
                        onClick={() => {
                          setOpen(false)
                          if (!isActive) void select({ plantId: p._id })
                        }}
                        className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm hover:bg-muted ${isActive ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        <span
                          className={`grid h-7 w-7 place-items-center rounded-lg ${isActive ? 'bg-sky-100 text-sky-700' : 'bg-muted text-muted-foreground'}`}
                        >
                          <Factory className="h-3.5 w-3.5" aria-hidden />
                        </span>
                        <span className="flex-1">{p.name}</span>
                        {isActive && <span className="h-2 w-2 rounded-full bg-emerald-500" aria-label="selected" />}
                      </button>
                    )
                  })}
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

/** Kişinin göreceği hesap / yönetim bağlantıları. */
function useAccountLinks(): NavItem[] {
  const { ctx, isPlatform, canManage } = usePlant()
  return ACCOUNT_LINKS.filter((l) => {
    if (l.need === 'manage') return canManage && !ctx?.isBoard
    if (l.need === 'platform') return isPlatform
    if (l.to === '/compare') return (ctx?.plants.length ?? 0) > 1
    return true
  })
}

function Avatar({ name, size = 'h-8 w-8 text-sm' }: { name: string | null | undefined; size?: string }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 font-semibold text-white uppercase ring-2 ring-white/20 ${size}`}
    >
      {(name ?? '?').slice(0, 1)}
    </span>
  )
}

/** Kullanıcı menüsü: hesap, yönetim (yetkiye göre), teşhis, çıkış. */
function UserMenu() {
  const { name, setToken } = useCurrentUser()
  const { ctx } = usePlant()
  const links = useAccountLinks()
  const { open, setOpen, ref } = usePopover()
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Account and settings"
        className="flex items-center gap-2 rounded-xl p-1 hover:bg-white/10"
      >
        <Avatar name={name} />
        <span className="hidden text-left leading-tight 2xl:block">
          <span className="block text-xs font-medium">{name}</span>
          <span className="block text-[10px] text-white/60">{roleLabel(ctx)}</span>
        </span>
      </button>
      {open && (
        <Panel width="w-72">
          <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-3">
            <Avatar name={name} size="h-10 w-10 text-base" />
            <span>
              <span className="block text-sm font-semibold text-foreground">{name}</span>
              <span className="block text-xs text-muted-foreground">
                {roleLabel(ctx)}
                {ctx?.active ? ` · ${ctx.active.companyName}` : ''}
              </span>
            </span>
          </div>
          <div className="p-1.5">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                activeProps={{ className: 'bg-muted text-foreground' }}
              >
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-foreground/70">
                  <NavIcon icon={l.icon} />
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">{l.label}</span>
                  <span className="block truncate text-xs">{l.hint}</span>
                </span>
              </Link>
            ))}
          </div>
          <button
            onClick={() => setToken(null)}
            className="flex w-full items-center gap-3 border-t border-border px-4 py-3 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </Panel>
      )}
    </div>
  )
}

// ---- 2. kat: alanın menüsü ------------------------------------------------------

/** Bağlantı bu sayfa mı (modül ana sayfası tam eşleşir). */
const isHere = (to: string, pathname: string, home: string) =>
  pathname === to || (to !== home && to !== '/' && pathname.startsWith(`${to}/`))

/**
 * Alanın menü çubuğu: solda modül kimliği, sonra sayfalar sekme gibi;
 * grup düğümü mega menü açar. Telefonda sekmeler yana kayar; mega menü
 * tam genişlik açılır.
 */
function SubNav({ area, pathname }: { area: Area; pathname: string }) {
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  // Açılan grubun düğmesinin soldan uzaklığı (kısa menü düğmenin altında açılır).
  const [anchor, setAnchor] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const accent = ACCENTS[area.accent]
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
  const nav = area.key === 'portal' ? [{ to: '/', label: 'Home', icon: 'home' as const }] : area.nav
  const openNode = nav.find((n) => !n.to && n.label === openGroup)
  return (
    <div ref={ref} className="relative border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="flex h-12 items-center gap-1 px-2 sm:px-5">
        <Link
          to={area.home}
          className="mr-1 hidden shrink-0 items-center gap-2.5 rounded-xl py-1 pr-2 sm:flex"
          title={`${area.title} — home`}
        >
          <IconTile icon={area.icon} accent={area.accent} size="sm" />
          <span className="text-sm font-semibold tracking-tight text-foreground">{area.title}</span>
        </Link>
        <span aria-hidden className="mx-1.5 hidden h-5 w-px bg-border sm:block" />
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {nav.map((node) => {
            if (node.to) {
              const here = isHere(node.to, pathname, area.home)
              return (
                <Link
                  key={node.to}
                  to={node.to}
                  aria-current={here ? 'page' : undefined}
                  className={`relative flex h-12 shrink-0 items-center gap-2 px-3 text-sm transition-colors ${here ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <NavIcon icon={node.icon} className={`h-4 w-4 ${here ? accent.text : ''}`} />
                  {node.label}
                  {here && <span aria-hidden className={`absolute inset-x-2 bottom-0 h-[3px] rounded-t-full ${accent.dot}`} />}
                </Link>
              )
            }
            const isOpen = openGroup === node.label
            const here = nodeHas(node, pathname)
            const trail = here ? findTrail(node, pathname) : []
            return (
              <button
                key={node.label}
                onClick={(e) => {
                  setAnchor(e.currentTarget.getBoundingClientRect().left - (ref.current?.getBoundingClientRect().left ?? 0))
                  setOpenGroup(isOpen ? null : node.label)
                }}
                aria-expanded={isOpen}
                className={`relative flex h-12 shrink-0 items-center gap-2 px-3 text-sm transition-colors ${here || isOpen ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <NavIcon icon={node.icon} className={`h-4 w-4 ${here ? accent.text : ''}`} />
                {node.label}
                {/* Menüdeki bir sayfadaysa: hangi sayfa olduğu çubukta görünür. */}
                {trail.length > 0 && (
                  <span className="max-w-[7rem] truncate font-normal text-muted-foreground sm:hidden">· {trail[trail.length - 1]}</span>
                )}
                {trail.length > 0 && (
                  <span className="hidden items-center gap-1 font-normal text-muted-foreground sm:flex">
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    <span className="max-w-[14rem] truncate">{trail.join(' › ')}</span>
                  </span>
                )}
                <ChevronDown
                  className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  aria-hidden
                />
                {(here || isOpen) && (
                  <span aria-hidden className={`absolute inset-x-2 bottom-0 h-[3px] rounded-t-full ${here ? accent.dot : 'bg-border'}`} />
                )}
              </button>
            )
          })}
        </div>
      </div>
      {openNode && (openNode.children ?? []).some((c) => c.children?.length) ? (
        <MegaMenu area={area} node={openNode} pathname={pathname} onPick={() => setOpenGroup(null)} />
      ) : openNode ? (
        <DropMenu area={area} node={openNode} pathname={pathname} anchor={anchor} onPick={() => setOpenGroup(null)} />
      ) : null}
    </div>
  )
}

/** Sayfaya giden etiketler (grup › sayfa). */
function findTrail(node: NavNode, pathname: string): string[] {
  for (const c of node.children ?? []) {
    if (c.to === pathname) return [c.label]
    if (nodeHas(c, pathname)) return [c.label, ...findTrail(c, pathname)]
  }
  return []
}

/**
 * Mega menü: grupların hepsi yan yana sütun (menü → alt menü → sayfa tek
 * bakışta), sağda kişinin sabitlediği ve son açtığı sayfalar ve arama.
 * Alt grubu olmayan menü (ör. OEE) kart ızgarası olur.
 */
function MegaMenu({ area, node, pathname, onPick }: { area: Area; node: NavNode; pathname: string; onPick: () => void }) {
  const children = node.children ?? []
  const groups = children.filter((c) => c.children?.length)
  const leaves = children.filter((c) => c.to)
  const cols =
    groups.length >= 4
      ? 'lg:grid-cols-4'
      : groups.length === 3
        ? 'lg:grid-cols-3'
        : groups.length === 2
          ? 'lg:grid-cols-2'
          : 'lg:grid-cols-3'
  return (
    <div className="absolute inset-x-0 top-full z-40 border-b border-border bg-background shadow-2xl shadow-slate-900/10 animate-in fade-in slide-in-from-top-1">
      <div className="flex max-h-[calc(100vh-8rem)] w-full flex-col overflow-y-auto lg:flex-row">
        <div className="min-w-0 flex-1 p-4 sm:p-6">
          {groups.length > 0 ? (
            <div className={`grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2 ${cols}`}>
              {groups.map((g) => (
                <div key={g.label}>
                  <div className="mb-2 flex items-center gap-2 px-2">
                    <span className={`grid h-6 w-6 place-items-center rounded-md ${ACCENTS[area.accent].soft}`}>
                      <NavIcon icon={g.icon} className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{g.label}</span>
                  </div>
                  <div className="space-y-0.5">
                    {(g.children ?? []).map((c) =>
                      c.to ? <MegaItem key={c.to} node={c} area={area} pathname={pathname} onPick={onPick} /> : null,
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {leaves.length > 0 && (
            <div
              className={`grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3 ${groups.length ? 'mt-4 border-t border-border pt-4' : ''}`}
            >
              {leaves.map((c) => (
                <MegaItem key={c.to} node={c} area={area} pathname={pathname} onPick={onPick} />
              ))}
            </div>
          )}
        </div>
        <ShortcutsAside onPick={onPick} />
      </div>
    </div>
  )
}

/** Alt grubu olmayan kısa menü (ör. OEE → Menu): düğmenin altında kart. */
function DropMenu({
  area,
  node,
  pathname,
  anchor,
  onPick,
}: {
  area: Area
  node: NavNode
  pathname: string
  anchor: number
  onPick: () => void
}) {
  return (
    <div
      style={{ ['--anchor' as string]: `${Math.max(8, anchor - 8)}px` }}
      className="absolute top-full right-2 left-2 z-40 mt-1 overflow-hidden rounded-2xl border border-border bg-background shadow-2xl shadow-slate-900/10 ring-1 ring-black/5 animate-in fade-in slide-in-from-top-1 sm:right-auto sm:left-[var(--anchor)] sm:w-[26rem]"
    >
      <div className="space-y-0.5 p-2">
        {(node.children ?? []).map((c) => (c.to ? <MegaItem key={c.to} node={c} area={area} pathname={pathname} onPick={onPick} /> : null))}
      </div>
      <button
        onClick={() => {
          onPick()
          openCommandPalette()
        }}
        className="flex w-full items-center gap-2 border-t border-border bg-muted/40 px-4 py-2.5 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        <Search className="h-3.5 w-3.5" aria-hidden />
        <span className="flex-1">Search every page</span>
        <Kbd>{modKey()}</Kbd>
        <Kbd>K</Kbd>
      </button>
    </div>
  )
}

function PinButton({ to, label, pinned, onToggle }: { to: string; label: string; pinned: boolean; onToggle: (to: string) => void }) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onToggle(to)
      }}
      title={pinned ? 'Unpin' : 'Pin — keep it in the menu, the search and on the home page'}
      aria-label={pinned ? `Unpin ${label}` : `Pin ${label}`}
      className={`rounded-md p-1.5 transition-opacity hover:bg-background ${pinned ? 'text-amber-500 opacity-100' : 'text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}
    >
      <Star className="h-3.5 w-3.5" fill={pinned ? 'currentColor' : 'none'} aria-hidden />
    </button>
  )
}

function MegaItem({ node, area, pathname, onPick }: { node: NavNode; area: Area; pathname: string; onPick: () => void }) {
  const { name } = useCurrentUser()
  const { pins, pin } = useShortcuts(name)
  const here = isHere(node.to!, pathname, area.home)
  const accent = ACCENTS[area.accent]
  return (
    <Link
      to={node.to!}
      onClick={onPick}
      aria-current={here ? 'page' : undefined}
      className={`group flex items-start gap-3 rounded-xl p-2 transition-colors ${here ? `ring-1 ${accent.ring}` : 'hover:bg-muted'}`}
    >
      <span
        className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-transform group-hover:scale-105 ${accent.soft}`}
      >
        <NavIcon icon={node.icon} className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{node.label}</span>
        {node.hint && <span className="block text-xs leading-snug text-muted-foreground">{node.hint}</span>}
      </span>
      <PinButton to={node.to!} label={node.label} pinned={pins.includes(node.to!)} onToggle={pin} />
    </Link>
  )
}

/** Mega menünün sağı: sabitlenenler, son açılanlar, arama. */
function ShortcutsAside({ onPick }: { onPick: () => void }) {
  const { name } = useCurrentUser()
  const { pins, recent } = useShortcuts(name)
  const canOpen = useCanOpen()
  const byTo = useMemo(() => new Map(pageIndex().map((p) => [p.to, p])), [])
  const list = (tos: string[]) => tos.filter((to) => canOpen(to)).flatMap((to) => (byTo.get(to) ? [byTo.get(to)!] : []))
  const pinned = list(pins).slice(0, 6)
  const recentPages = list(recent.filter((to) => !pins.includes(to))).slice(0, 4)
  const row = (p: ReturnType<typeof pageIndex>[number]) => (
    <Link
      key={p.to}
      to={p.to}
      onClick={onPick}
      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-foreground hover:bg-background"
    >
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${ACCENTS[p.accent].soft}`}>
        <NavIcon icon={p.icon} className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate">{p.label}</span>
      <span className="hidden truncate text-[11px] text-muted-foreground xl:block">{p.section === 'Account' ? '' : p.section}</span>
    </Link>
  )
  return (
    <aside className="shrink-0 border-t border-border bg-muted/40 p-4 sm:p-6 lg:w-80 lg:border-t-0 lg:border-l">
      <p className="mb-1.5 flex items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        <Star className="h-3 w-3" aria-hidden /> Pinned
      </p>
      {pinned.length ? (
        <div className="space-y-0.5">{pinned.map(row)}</div>
      ) : (
        <p className="px-2 text-xs text-muted-foreground">
          Pin the pages you use every day with ☆ — they stay here, in the search and on the home page.
        </p>
      )}
      {recentPages.length > 0 && (
        <>
          <p className="mt-4 mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Recently opened</p>
          <div className="space-y-0.5">{recentPages.map(row)}</div>
        </>
      )}
      <button
        onClick={() => {
          onPick()
          openCommandPalette()
        }}
        className="mt-4 flex w-full items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-left text-sm text-muted-foreground shadow-sm hover:text-foreground"
      >
        <Search className="h-4 w-4" aria-hidden />
        <span className="flex-1">Search every page</span>
        <Kbd>{modKey()}</Kbd>
        <Kbd>K</Kbd>
      </button>
    </aside>
  )
}

// ---- Telefon çekmecesi ------------------------------------------------------------

/** Telefon: soldan açılan çekmece — arama, modül ızgarası, alanın sayfaları, hesap. */
function Drawer({ area, modules, onClose }: { area: Area; modules: Area[]; onClose: () => void }) {
  const { name, setToken } = useCurrentUser()
  const { ctx } = usePlant()
  const links = useAccountLinks()
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])
  const tiles = [PORTAL_AREA, ...modules]
  return (
    <div className="fixed inset-0 z-[60] lg:hidden">
      <button aria-label="Close menu" onClick={onClose} className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm animate-in fade-in" />
      <div className="absolute inset-y-0 left-0 flex w-[88%] max-w-sm flex-col overflow-y-auto bg-background shadow-2xl animate-in slide-in-from-left">
        <div className="bg-gradient-to-br from-slate-950 via-indigo-950 to-blue-900 px-4 pt-4 pb-5 text-white">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-3">
              <Avatar name={name} size="h-10 w-10 text-base" />
              <span className="leading-tight">
                <span className="block text-sm font-semibold">{name}</span>
                <span className="block text-xs text-white/60">
                  {roleLabel(ctx)}
                  {ctx?.active ? ` · ${ctx.active.plantName}` : ''}
                </span>
              </span>
            </span>
            <button onClick={onClose} aria-label="Close menu" className="rounded-lg p-1.5 hover:bg-white/10">
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
          <button
            onClick={() => {
              onClose()
              openCommandPalette()
            }}
            className="mt-4 flex w-full items-center gap-2 rounded-xl bg-white/10 px-3 py-2.5 text-left text-sm text-white/70 ring-1 ring-white/15"
          >
            <Search className="h-4 w-4" aria-hidden /> Search pages — arıza, stok, plan …
          </button>
        </div>
        <div className="flex-1 space-y-5 px-3 py-4">
          {tiles.length > 1 && (
            <div className="grid grid-cols-3 gap-2">
              {tiles.map((m) => {
                const isActive = m.key === area.key
                return (
                  <Link
                    key={m.key}
                    to={m.home}
                    onClick={onClose}
                    className={`flex flex-col items-center gap-1.5 rounded-2xl border p-2.5 text-center text-xs transition ${isActive ? `font-semibold text-foreground ring-1 ${ACCENTS[m.accent].ring} border-transparent` : 'border-border text-muted-foreground hover:bg-muted'}`}
                  >
                    <IconTile icon={m.icon} accent={m.accent} size="md" />
                    <span className="leading-tight">{m.key === 'portal' ? 'Home' : m.short}</span>
                  </Link>
                )
              })}
            </div>
          )}
          <DrawerNav area={area} onClose={onClose} />
          <div>
            <p className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Account</p>
            {links.map((l) => (
              <DrawerLink key={l.to} node={l} accent="slate" onClose={onClose} />
            ))}
            <button
              onClick={() => setToken(null)}
              className="mt-1 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-muted">
                <LogOut className="h-4 w-4" aria-hidden />
              </span>
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Çekmecedeki alan menüsü: doğrudan bağlantılar üstte; çubuktaki "Menu"
 * gibi grupların içi açılır, alt gruplar katlanır bölüm olur (bulunulan
 * sayfanın bölümü açık gelir).
 */
function DrawerNav({ area, onClose }: { area: Area; onClose: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  if (!area.nav.length) return null
  // Çubuktaki grup başlığı ("Menu") çekmecede tekrar etmez: içi düzleşir.
  const nodes = area.nav.flatMap((n) => (n.to ? [n] : (n.children ?? [])))
  const leaves = nodes.filter((n) => n.to)
  const groups = nodes.filter((n) => !n.to && n.children?.length)
  return (
    <div>
      <p className={`px-2 pb-1 text-[11px] font-semibold tracking-wider uppercase ${ACCENTS[area.accent].text}`}>{area.title}</p>
      {leaves.map((n) => (
        <DrawerLink key={n.to} node={n} accent={area.accent} exact={n.to === area.home} onClose={onClose} />
      ))}
      {groups.map((g) => (
        <DrawerGroup key={g.label} node={g} area={area} initiallyOpen={nodeHas(g, pathname)} onClose={onClose} />
      ))}
    </div>
  )
}

function DrawerGroup({ node, area, initiallyOpen, onClose }: { node: NavNode; area: Area; initiallyOpen: boolean; onClose: () => void }) {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <div className="mt-0.5">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm font-medium text-foreground hover:bg-muted"
      >
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${ACCENTS[area.accent].soft}`}>
          <NavIcon icon={node.icon} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block">{node.label}</span>
          {!open && node.hint && <span className="block truncate text-xs font-normal text-muted-foreground">{node.hint}</span>}
        </span>
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="ml-6 border-l border-border pl-2">
          {(node.children ?? []).map((c) =>
            c.to ? <DrawerLink key={c.to} node={c} accent={area.accent} onClose={onClose} compact /> : null,
          )}
        </div>
      )}
    </div>
  )
}

function DrawerLink({
  node,
  accent,
  exact,
  compact,
  onClose,
}: {
  node: NavNode | NavItem
  accent: Area['accent']
  exact?: boolean
  compact?: boolean
  onClose: () => void
}) {
  return (
    <Link
      to={node.to!}
      onClick={onClose}
      className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      activeProps={{ className: 'bg-muted text-foreground font-medium' }}
      activeOptions={{ exact }}
    >
      {!compact && (
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${ACCENTS[accent].soft}`}>
          <NavIcon icon={node.icon} />
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-foreground">{node.label}</span>
        {node.hint && <span className="block truncate text-xs text-muted-foreground">{node.hint}</span>}
      </span>
    </Link>
  )
}
