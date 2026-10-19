import { Link } from '@tanstack/react-router'
import { Bell, CircleAlert, CircleCheck, CircleDashed, Clock3 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { api } from '../../convex/_generated/api'
import { ageText } from '../lib/cockpit'
import { useQuery } from '../lib/convexTransport'
import { MODULE_AREAS } from '../lib/navigation'
import { useCanOpen } from '../lib/plantContext'
import { formatPlantTime } from '../lib/sapUploads'
import type { Module } from '../lib/tenancy'
import { FEED_WINDOW_DAYS, countNew, parseLastSeen, type FeedItem, type FreshnessRow, type FreshnessState } from '../lib/updates'
import { ACCENTS, NavIcon } from './nav/NavIcon'
import { InfoTip } from './PageHeader'

interface UpdatesData {
  now: number
  freshness: FreshnessRow[]
  feed: FeedItem[]
}

export interface Updates {
  data: UpdatesData | undefined
  /** Bu cihazda ana sayfanın son açıldığı an; ilk ziyarette null, okunmadan undefined. */
  lastSeen: number | null | undefined
  newCount: number
}

/**
 * Son ziyaret: kullanıcı × plant başına bu cihazda (kısayollar gibi
 * localStorage, sunucuya gitmez). Sayfa açılınca önceki değer alınır, yerine
 * şimdi yazılır. Aynı açılışta ikinci okuma (React'in geliştirmede çift
 * çalıştırması) yeni yazılanı değil önceki değeri görsün diye bellekte tutulur.
 */
const visits = new Map<string, { prev: number | null; at: number }>()

function useLastSeen(user: string | null | undefined, plantId: string | undefined): number | null | undefined {
  const [seen, setSeen] = useState<number | null | undefined>(undefined)
  useEffect(() => {
    if (!plantId) return
    const key = `pp.updates.seen.v1.${user ?? ''}.${plantId}`
    const hit = visits.get(key)
    if (hit && Date.now() - hit.at < 5_000) {
      setSeen(hit.prev)
      return
    }
    let prev: number | null = null
    try {
      prev = parseLastSeen(window.localStorage.getItem(key))
      window.localStorage.setItem(key, String(Date.now()))
    } catch {
      // Gizli pencere / dolu depo: "yeni" işareti yalnızca bu açılışta yok.
    }
    visits.set(key, { prev, at: Date.now() })
    setSeen(prev)
  }, [user, plantId])
  return seen
}

/** Panelin verisi ve "son ziyaretten beri yeni" sayısı (ana sayfa bir kez çağırır). */
export function useUpdates(user: string | null | undefined, plantId: string | undefined): Updates {
  const data = useQuery(api.updates.feed, plantId ? {} : 'skip') as UpdatesData | undefined
  const lastSeen = useLastSeen(user, plantId)
  return { data, lastSeen, newCount: data && lastSeen !== undefined ? countNew(data.feed, lastSeen) : 0 }
}

/** Göreli süreler ("5 h ago") dakikada bir yenilensin. */
function useNow(stepMs = 60_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), stepMs)
    return () => window.clearInterval(id)
  }, [stepMs])
  return now
}

const areaOf = (m: Module) => MODULE_AREAS.find((a) => a.module === m && a.key !== 'board')

const STATE: Record<FreshnessState, { label: string; cls: string; icon: typeof CircleCheck }> = {
  fresh: { label: 'Up to date', cls: 'text-emerald-700 bg-emerald-50 ring-emerald-200', icon: CircleCheck },
  stale: { label: 'Out of date', cls: 'text-amber-800 bg-amber-50 ring-amber-200', icon: CircleAlert },
  missing: { label: 'Missing', cls: 'text-destructive bg-destructive/5 ring-destructive/30', icon: CircleAlert },
  info: { label: '', cls: '', icon: CircleDashed },
}

/**
 * "Updates": oturum açan kişinin göreceği son gelişmeler (What's new) ve
 * her verinin son yayını (Latest data). Kural: src/lib/updates.ts,
 * docs/updates.md.
 */
export function UpdatesPanel({ updates, className = '' }: { updates: Updates; className?: string }) {
  const now = useNow()
  const { data, lastSeen, newCount } = updates
  if (!data || (data.feed.length === 0 && data.freshness.length === 0)) return null
  return (
    <section id="updates" aria-label="Updates" className={`scroll-mt-24 rounded-2xl border border-border bg-card shadow-sm ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Bell className="h-4 w-4 text-sky-600" aria-hidden />
          Updates
          {newCount > 0 && <span className="rounded-full bg-sky-600 px-2 py-0.5 text-[11px] font-semibold text-white">{newCount} new</span>}
          <InfoTip label="How Updates works">
            <p>What happened in the plant and when each piece of data was last published — only for the modules you can open.</p>
            <ul className="ml-4 list-disc space-y-0.5">
              <li>What&apos;s new: die topics and breakdowns opened or solved, plan calculated or approved, SAP and OEE uploads of the last {FEED_WINDOW_DAYS} days.</li>
              <li>Latest data: the last upload of every source, who published it and the period it covers. Demand (ZPP), stock (MB52) and the plan use the Today limits of this plant.</li>
              <li>“New” marks what came in since you last opened this page on this device.</li>
            </ul>
          </InfoTip>
        </h2>
        <span className="text-xs text-muted-foreground">Times in plant time</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5">
        <div className="min-w-0 px-5 py-4 lg:col-span-3 lg:border-r lg:border-border">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">What&apos;s new</h3>
          {data.feed.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Nothing new in the last {FEED_WINDOW_DAYS} days.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {data.feed.map((i) => (
                <FeedRow key={i.key} item={i} now={now} isNew={lastSeen !== null && lastSeen !== undefined && i.at > lastSeen} />
              ))}
            </ul>
          )}
        </div>
        {data.freshness.length > 0 && (
          <div className="min-w-0 border-t border-border px-5 py-4 lg:col-span-2 lg:border-t-0">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Latest data</h3>
            <ul className="mt-2 space-y-1">
              {data.freshness.map((r) => (
                <FreshRow key={r.key} row={r} now={now} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

/** Satır açabildiği sayfaya bağlantı; açamıyorsa düz satır. */
function RowLink({ to, className, children }: { to: string; className: string; children: ReactNode }) {
  const canOpen = useCanOpen()
  return canOpen(to) ? (
    <Link to={to} className={`${className} transition-colors hover:bg-muted/60`}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  )
}

function When({ at, now }: { at: number; now: number }) {
  return (
    <time dateTime={new Date(at).toISOString()} title={formatPlantTime(at)} className="flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
      <Clock3 className="h-3 w-3" aria-hidden />
      {ageText(Math.max(0, now - at))} ago
    </time>
  )
}

function FeedRow({ item, now, isNew }: { item: FeedItem; now: number; isNew: boolean }) {
  const a = areaOf(item.module)
  const accent = a?.accent ?? 'slate'
  return (
    <li>
      <RowLink to={item.to} className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-2">
        <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${ACCENTS[accent].soft}`} title={a?.title}>
          <NavIcon icon={a?.icon} className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 truncate text-sm font-medium text-foreground">{item.title}</span>
            {isNew && <span className="shrink-0 rounded-full bg-sky-100 px-1.5 py-px text-[10px] font-semibold text-sky-700 uppercase">New</span>}
          </span>
          {(item.detail || item.by) && (
            <span className="line-clamp-2 block text-xs text-muted-foreground">
              {item.detail}
              {item.detail && item.by ? ' · ' : ''}
              {item.by && <span>by {item.by}</span>}
            </span>
          )}
        </span>
        <When at={item.at} now={now} />
      </RowLink>
    </li>
  )
}

function FreshRow({ row, now }: { row: FreshnessRow; now: number }) {
  const a = areaOf(row.module)
  const s = STATE[row.state]
  return (
    <li>
      <RowLink to={row.to} className="-mx-2 block rounded-lg px-2 py-1.5">
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${ACCENTS[a?.accent ?? 'slate'].dot}`} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{row.label}</span>
          {s.label && (
            <span className={`flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-semibold ring-1 ${s.cls}`}>
              <s.icon className="h-3 w-3" aria-hidden />
              {s.label}
            </span>
          )}
        </span>
        <span className="block pl-4 text-xs text-muted-foreground">
          {row.at ? (
            <>
              <span className="text-foreground/80">{formatPlantTime(row.at)}</span> · {ageText(Math.max(0, now - row.at))} ago
              {row.by && <> · by {row.by}</>}
            </>
          ) : null}
          {row.detail && (
            <span className="block truncate" title={row.detail}>
              {row.detail}
            </span>
          )}
        </span>
      </RowLink>
    </li>
  )
}

/** Karşılamadaki küçük bildirim: son ziyaretten beri yeni olay sayısı → panel. */
export function NewUpdatesChip({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <a
      href="#updates"
      className="inline-flex items-center gap-2 rounded-full bg-sky-400/15 py-1 pr-3 pl-1.5 text-sm text-white ring-1 ring-sky-300/40 backdrop-blur transition hover:bg-sky-400/25"
    >
      <span className="grid h-6 w-6 place-items-center rounded-full bg-sky-500 text-white">
        <Bell className="h-3.5 w-3.5" aria-hidden />
      </span>
      {count} new since your last visit
    </a>
  )
}
