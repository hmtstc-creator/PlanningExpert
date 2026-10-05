import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, CornerDownLeft, Factory, LogOut, Search, Star } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { api } from '../../../convex/_generated/api'
import { useMutation } from '../../lib/convexTransport'
import { useCurrentUser } from '../../lib/currentUser'
import { MODULE_AREAS, PORTAL_AREA, type AccentKey, type IconKey } from '../../lib/navigation'
import { pageIndex, searchPages, fold, type PageEntry } from '../../lib/navSearch'
import { useCanOpen, usePlant } from '../../lib/plantContext'
import { useShortcuts } from '../../lib/shortcuts'
import { ACCENTS, Kbd, NavIcon } from './NavIcon'

const OPEN_EVENT = 'pp:command-palette'

/** Paleti her yerden açar (ana sayfadaki arama kutusu, çekmece …). */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

/** Mac'te ⌘, diğerlerinde Ctrl. */
export function modKey(): string {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
}

interface Item {
  id: string
  title: string
  sub?: string
  icon: IconKey | 'plant' | 'signout'
  accent: AccentKey
  /** Sayfa ise sabitlenebilir. */
  to?: string
  run: () => void
}

interface Section {
  title: string
  items: Item[]
}

/**
 * Komut paleti (Ctrl+K / ⌘K): bütün sayfalar (izinli olanlar), plant
 * değiştirme ve hesap işlemleri tek kutuda. Boşken sabitlenenler, son
 * açılanlar, modüller ve plant'ler; yazınca Türkçe de arar
 * (src/lib/navSearch.ts). Yıldız sayfayı sabitler (src/lib/shortcuts.ts).
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    const show = () => setOpen(true)
    window.addEventListener('keydown', key)
    window.addEventListener(OPEN_EVENT, show)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener(OPEN_EVENT, show)
    }
  }, [])
  if (!open) return null
  return <PaletteDialog onClose={() => setOpen(false)} />
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { name, setToken } = useCurrentUser()
  const { ctx, can } = usePlant()
  const canOpen = useCanOpen()
  const selectPlant = useMutation(api.tenancy.selectPlant)
  const shortcuts = useShortcuts(name)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const index = useMemo(() => pageIndex().filter((p) => canOpen(p.to)), [canOpen])
  const byTo = useMemo(() => new Map(index.map((p) => [p.to, p])), [index])

  const go = (to: string) => {
    onClose()
    void navigate({ to })
  }
  const pageItem = (p: PageEntry, idPrefix: string): Item => ({
    id: `${idPrefix}:${p.to}`,
    title: p.label,
    sub: [p.section, p.group].filter(Boolean).join(' › '),
    icon: p.icon,
    accent: p.accent,
    to: p.to,
    run: () => go(p.to),
  })

  const plants: Item[] = (ctx?.plants ?? [])
    .filter((p) => p._id !== ctx?.active?.plantId)
    .map((p) => ({
      id: `plant:${p._id}`,
      title: `Switch to ${p.name}`,
      sub: p.companyName,
      icon: 'plant' as const,
      accent: 'slate' as const,
      run: () => {
        onClose()
        void selectPlant({ plantId: p._id })
      },
    }))
  const signOut: Item = {
    id: 'signout',
    title: 'Sign out',
    sub: name ?? undefined,
    icon: 'signout',
    accent: 'slate',
    run: () => setToken(null),
  }

  const sections: Section[] = useMemo(() => {
    const query = q.trim()
    if (query) {
      const f = fold(query)
      const pages = searchPages(index, query, 14).map((p) => pageItem(p, 'r'))
      const extra = [...plants, signOut].filter((i) => fold(`${i.title} ${i.sub ?? ''}`).includes(f))
      return [
        { title: 'Pages', items: pages },
        { title: 'Actions', items: extra },
      ].filter((s) => s.items.length)
    }
    const pins = shortcuts.pins.flatMap((to) => (byTo.get(to) ? [pageItem(byTo.get(to)!, 'pin')] : []))
    const recent = shortcuts.recent
      .filter((to) => !shortcuts.pins.includes(to))
      .flatMap((to) => (byTo.get(to) ? [pageItem(byTo.get(to)!, 'recent')] : []))
    const modules: Item[] = [PORTAL_AREA, ...MODULE_AREAS]
      .filter((a) =>
        ctx?.isBoard ? a.key === 'board' || a.key === 'portal' : a.key === 'board' ? can('kpi') || can('oee') : !a.module || can(a.module),
      )
      .map((a) => ({
        id: `m:${a.key}`,
        title: a.title,
        sub: a.key === 'portal' ? 'Home — all modules' : 'Module home',
        icon: a.icon,
        accent: a.accent,
        to: a.home,
        run: () => go(a.home),
      }))
    return [
      { title: 'Pinned', items: pins },
      { title: 'Recently opened', items: recent },
      { title: 'Modules', items: modules },
      { title: 'Plants', items: plants },
      { title: 'Account', items: [signOut] },
    ].filter((s) => s.items.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, index, byTo, shortcuts.pins, shortcuts.recent, ctx])

  const flat = sections.flatMap((s) => s.items)
  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (flat.length ? (a + 1) % flat.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      flat[active]?.run()
    }
  }

  let n = -1
  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center px-3 pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Search"
    >
      <button
        aria-label="Close search"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm animate-in fade-in"
      />
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-background text-foreground shadow-2xl ring-1 ring-black/5 animate-in fade-in zoom-in-95 slide-in-from-top-2">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search pages, plants, actions — Turkish works too (arıza, kalıp, stok …)"
            className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/70"
            aria-label="Search"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={flat[active] ? `palette-${flat[active].id}` : undefined}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} id="palette-list" role="listbox" className="max-h-[60vh] overflow-y-auto overscroll-contain p-2">
          {sections.length === 0 && (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              Nothing found for “{q}”. Try another word — e.g. <i>stock</i>, <i>arıza</i>, <i>MB52</i>.
            </p>
          )}
          {sections.map((s) => (
            <div key={s.title} className="mb-1">
              <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{s.title}</p>
              {s.items.map((item) => {
                n++
                const idx = n
                const isActive = idx === active
                const pinned = !!item.to && shortcuts.pins.includes(item.to)
                return (
                  <div
                    key={item.id}
                    id={`palette-${item.id}`}
                    data-idx={idx}
                    role="option"
                    aria-selected={isActive}
                    onMouseMove={() => active !== idx && setActive(idx)}
                    onClick={item.run}
                    className={`group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 ${isActive ? 'bg-muted' : ''}`}
                  >
                    <ItemIcon item={item} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.title}</span>
                      {item.sub && <span className="block truncate text-xs text-muted-foreground">{item.sub}</span>}
                    </span>
                    {item.to && item.icon !== 'home' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          shortcuts.pin(item.to!)
                        }}
                        title={pinned ? 'Unpin' : 'Pin — keep it on top here, in the menu and on the home page'}
                        aria-label={pinned ? `Unpin ${item.title}` : `Pin ${item.title}`}
                        className={`rounded-md p-1.5 transition-opacity hover:bg-background ${pinned ? 'text-amber-500 opacity-100' : 'text-muted-foreground opacity-0 group-hover:opacity-100'} ${isActive ? 'opacity-100' : ''}`}
                      >
                        <Star className="h-4 w-4" fill={pinned ? 'currentColor' : 'none'} aria-hidden />
                      </button>
                    )}
                    {isActive && <CornerDownLeft className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
          <Hint keys={['↑', '↓']}>move</Hint>
          <Hint keys={['Enter']}>open</Hint>
          <Hint keys={['☆']}>pin a page</Hint>
          <span className="ml-auto hidden sm:inline">
            <Hint keys={[modKey(), 'K']}>anywhere</Hint>
          </span>
        </div>
      </div>
    </div>
  )
}

function Hint({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      <span>{children}</span>
    </span>
  )
}

function ItemIcon({ item }: { item: Item }) {
  const box = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg'
  if (item.icon === 'plant')
    return (
      <span className={`${box} bg-slate-100 text-slate-600`}>
        <Factory className="h-4 w-4" aria-hidden />
      </span>
    )
  if (item.icon === 'signout')
    return (
      <span className={`${box} bg-slate-100 text-slate-600`}>
        <LogOut className="h-4 w-4" aria-hidden />
      </span>
    )
  return (
    <span className={`${box} ${ACCENTS[item.accent].soft}`}>
      <NavIcon icon={item.icon} />
    </span>
  )
}

/** Çubuktaki arama düğmesi: geniş ekranda kutu gibi, telefonda ikon. */
export function SearchButton({ variant = 'bar' }: { variant?: 'bar' | 'icon' | 'hero' }) {
  if (variant === 'icon')
    return (
      <button onClick={openCommandPalette} aria-label="Search" className="rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white">
        <Search className="h-5 w-5" aria-hidden />
      </button>
    )
  if (variant === 'hero')
    return (
      <button
        onClick={openCommandPalette}
        className="group flex w-full max-w-2xl items-center gap-3 rounded-2xl bg-white px-4 py-3.5 text-left text-slate-500 shadow-2xl shadow-indigo-950/40 ring-1 ring-white/40 transition hover:ring-sky-300"
      >
        <Search className="h-5 w-5 text-indigo-500" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm sm:text-base">Where do you want to go? Plan, stock, breakdowns, arıza …</span>
        <span className="hidden items-center gap-1 sm:flex">
          <Kbd>{modKey()}</Kbd>
          <Kbd>K</Kbd>
        </span>
        <ArrowRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5 sm:hidden" aria-hidden />
      </button>
    )
  return (
    <button
      onClick={openCommandPalette}
      title="Search every page (Ctrl K)"
      className="flex h-9 w-56 items-center gap-2 rounded-xl bg-white/10 px-3 text-left text-sm text-white/60 ring-1 ring-white/15 transition hover:bg-white/15 hover:text-white/90 xl:w-72"
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">Search pages…</span>
      <span className="flex items-center gap-1">
        <Kbd dark>{modKey()}</Kbd>
        <Kbd dark>K</Kbd>
      </span>
    </button>
  )
}
