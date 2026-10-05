import { createFileRoute, Link, Navigate } from '@tanstack/react-router'
import { ArrowRight, ArrowUpRight, Clock3, Star } from 'lucide-react'

import { api } from '../../convex/_generated/api'
import { useQuery } from '../lib/convexTransport'
import type { Module } from '../lib/tenancy'

import { Cockpit } from '../components/Cockpit'
import { SearchButton } from '../components/nav/CommandPalette'
import { ACCENTS, IconTile, NavIcon } from '../components/nav/NavIcon'
import { useCurrentUser } from '../lib/currentUser'
import { isoWeek } from '../lib/dates'
import { ACCOUNT_LINKS, BOARD_AREA, MODULE_AREAS, areaLinks, type Area } from '../lib/navigation'
import { pageIndex, type PageEntry } from '../lib/navSearch'
import { PORTAL_MODULES, type PortalModule } from '../lib/portal'
import { useCanOpen, usePlant } from '../lib/plantContext'
import { useShortcuts } from '../lib/shortcuts'

export const Route = createFileRoute('/')({
  component: PortalHome,
})

const PAGES = new Map(pageIndex().map((p) => [p.to, p]))

function greeting(hour: number) {
  return hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

/**
 * Portalın ana sayfası: karşılama (gün, hafta, plant, arama ve kişinin
 * kısayolları), kurulum listesi, Today (kararlar) ve modüller — her modül
 * kartında en çok kullanılan sayfalarına doğrudan bağlantı. Giriş ekranı
 * bunun da önündedir (LoginGate kökte).
 */
function PortalHome() {
  const { ctx, can, canManage } = usePlant()
  // Board görünümü doğrudan Board Dashboard'la açılır.
  if (ctx?.isBoard) return <Navigate to="/board" />
  // Yalnızca bu fabrikada izni olan modüller.
  const modules = PORTAL_MODULES.filter((m) => (m.to === '/board' ? can('kpi') || can('oee') : !m.module || can(m.module)))
  return (
    <div className="pb-24">
      <Hero />
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        {canManage && ctx?.active && <SetupChecklist can={can} />}
        {ctx?.active && <Cockpit className="mt-8" />}

        <section className="mt-10" aria-label="Modules">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Modules</h2>
            <p className="hidden text-xs text-muted-foreground sm:block">Open a module, or jump straight to one of its pages.</p>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {modules.map((m) => (
              <ModuleCard key={m.to} m={m} />
            ))}
          </div>
        </section>

        <Tools />
      </div>
    </div>
  )
}

/** Karşılama: tarih, hafta, plant; arama; sabitlenen ve son açılan sayfalar. */
function Hero() {
  const { ctx } = usePlant()
  const { name } = useCurrentUser()
  const { pins, recent } = useShortcuts(name)
  const canOpen = useCanOpen()
  const now = new Date()
  const date = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const pick = (tos: string[]) => tos.filter((to) => canOpen(to)).flatMap((to) => (PAGES.get(to) ? [PAGES.get(to)!] : []))
  const pinned = pick(pins)
  const recentPages = pick(recent.filter((to) => !pins.includes(to))).slice(0, 4)
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-blue-900 text-white">
      {/* Arka plan: ince ızgara ve ışık — yalnızca süs. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: 'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      <div aria-hidden className="absolute -top-32 right-[-10%] h-96 w-96 rounded-full bg-sky-500/25 blur-3xl" />
      <div aria-hidden className="absolute -bottom-40 left-[-5%] h-96 w-96 rounded-full bg-indigo-500/25 blur-3xl" />
      <div className="relative mx-auto w-full max-w-7xl px-4 pt-8 pb-10 sm:px-6 sm:pt-12 sm:pb-14">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium tracking-wide text-sky-200/80 uppercase">
          <span>{date}</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white ring-1 ring-white/15">Week {isoWeek(now)}</span>
          {ctx?.active && (
            <span className="normal-case">
              · {ctx.active.companyName} · <b className="font-semibold text-white">{ctx.active.plantName}</b>
            </span>
          )}
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          {greeting(now.getHours())}
          {name ? `, ${name}` : ''}.
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-white/65 sm:text-base">
          Everything for the plant in one place — plan, OEE, dies, machines and KPIs. Search any page, or pick a module below.
        </p>
        <div className="mt-6">
          <SearchButton variant="hero" />
        </div>
        {(pinned.length > 0 || recentPages.length > 0) && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {pinned.map((p) => (
              <Chip key={p.to} p={p} kind="pin" />
            ))}
            {recentPages.map((p) => (
              <Chip key={p.to} p={p} kind="recent" />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function Chip({ p, kind }: { p: PageEntry; kind: 'pin' | 'recent' }) {
  return (
    <Link
      to={p.to}
      title={kind === 'pin' ? 'Pinned' : 'Recently opened'}
      className="group flex items-center gap-2 rounded-full bg-white/10 py-1 pr-3 pl-1 text-sm text-white/85 ring-1 ring-white/15 backdrop-blur transition hover:bg-white/20 hover:text-white"
    >
      <span className={`grid h-6 w-6 place-items-center rounded-full ${ACCENTS[p.accent].tile}`}>
        <NavIcon icon={p.icon} className="h-3.5 w-3.5" />
      </span>
      {p.label}
      {kind === 'pin' ? (
        <Star className="h-3 w-3 text-amber-300" fill="currentColor" aria-hidden />
      ) : (
        <Clock3 className="h-3 w-3 text-white/40" aria-hidden />
      )}
    </Link>
  )
}

/** Modülün menü alanı (renk, ikon, sayfalar). */
function areaOf(m: PortalModule): Area | undefined {
  return m.to === '/board' ? BOARD_AREA : MODULE_AREAS.find((a) => a.home === m.to)
}

function ModuleCard({ m }: { m: PortalModule }) {
  const canOpen = useCanOpen()
  const a = areaOf(m)
  const accent = a?.accent ?? 'slate'
  const links = a
    ? areaLinks(a)
        .filter((l) => l.to !== a.home && canOpen(l.to))
        .slice(0, 4)
    : []
  // Aynı ad iki kez geçerse (KPI: Entry, Dashboard) grubuyla: "Monthly · Entry".
  const quick = links.map((l) => {
    const same = links.filter((x) => x.label === l.label).length > 1
    const group = PAGES.get(l.to)?.group
    return same && group ? { ...l, label: `${group} · ${l.label}` } : l
  })
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-slate-900/5">
      <div aria-hidden className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${ACCENTS[accent].bar}`} />
      <div className="flex items-start gap-4">
        <IconTile icon={a?.icon ?? 'grid'} accent={accent} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-foreground">
            {/* Kartın tamamı modülü açar (iç bağlantılar üstte kalır). */}
            <Link to={m.to} className="after:absolute after:inset-0 after:content-['']">
              {m.title}
            </Link>
          </h3>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">{m.description}</p>
        </div>
        <ArrowUpRight
          className={`h-5 w-5 shrink-0 text-muted-foreground/40 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground/70`}
          aria-hidden
        />
      </div>
      {quick.length > 0 && (
        <div className="relative z-10 mt-4 grid grid-cols-2 gap-1.5 border-t border-border pt-4">
          {quick.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${ACCENTS[accent].soft}`}>
                <NavIcon icon={l.icon} className="h-3.5 w-3.5" />
              </span>
              <span className="truncate">{l.label}</span>
            </Link>
          ))}
        </div>
      )}
    </article>
  )
}

/** Yönetim kısayolları (yetkiye göre): ayarlar, kullanıcılar, yönetim, karşılaştırma. */
function Tools() {
  const { ctx, isPlatform, canManage } = usePlant()
  const tools = ACCOUNT_LINKS.filter((l) =>
    l.need === 'manage' ? canManage : l.need === 'platform' ? isPlatform : l.to === '/compare' ? (ctx?.plants.length ?? 0) > 1 : false,
  )
  if (!tools.length) return null
  return (
    <section className="mt-10" aria-label="Administration">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">Manage</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tools.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition hover:border-foreground/20 hover:shadow-md"
          >
            <IconTile icon={t.icon ?? 'settings'} accent="slate" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">{t.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{t.hint}</span>
            </span>
            <ArrowRight className="h-4 w-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        ))}
      </div>
    </section>
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
  const pct = Math.round(((steps.length - open.length) / steps.length) * 100)
  return (
    <section className="relative z-10 -mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-lg shadow-amber-900/5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Plant setup — {steps.length - open.length} of {steps.length} done
        </h2>
        <span className="text-xs font-medium text-amber-800">{pct} %</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-amber-200/70">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500" style={{ width: `${pct}%` }} />
      </div>
      <ol className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm md:grid-cols-2">
        {steps.map((s) => (
          <li key={s.key} className="flex items-baseline gap-2">
            <span className={s.done ? 'text-emerald-600' : 'text-amber-700'}>{s.done ? '✓' : '○'}</span>
            <span className="min-w-0">
              <Link
                to={s.to}
                className={
                  s.done
                    ? 'text-muted-foreground line-through decoration-muted-foreground/40'
                    : 'font-medium text-foreground underline underline-offset-2'
                }
              >
                {s.label}
              </Link>
              {!s.done && <span className="block text-xs text-muted-foreground">{s.hint}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
