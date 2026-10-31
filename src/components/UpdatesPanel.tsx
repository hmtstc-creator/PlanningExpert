import { Link } from '@tanstack/react-router'
import { Clock3 } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { api } from '../../convex/_generated/api'
import { ageText } from '../lib/cockpit'
import { useQuery } from '../lib/convexTransport'
import { MODULE_AREAS } from '../lib/navigation'
import { useCanOpen } from '../lib/plantContext'
import { formatPlantTime } from '../lib/sapUploads'
import type { Module } from '../lib/tenancy'
import { FEED_WINDOW_DAYS, parseLastSeen, type FeedItem, type FreshnessRow } from '../lib/updates'
import { ACCENTS, NavIcon } from './nav/NavIcon'
import { InfoTip } from './PageHeader'

interface UpdatesData {
  now: number
  freshness: FreshnessRow[]
  feed: FeedItem[]
}

export interface Updates {
  data: UpdatesData | undefined
  /** Bu cihazda bildirimlerin son açıldığı an; kayıt yoksa null, okunmadan undefined. */
  seen: number | null | undefined
  /** Bildirimleri açınca çağrılır: "yeni" sayacı sıfırlanır, yeni an kaydedilir. */
  markRead: () => void
}

/**
 * Bildirimler: kişi × plant başına bu cihazda son açılış anı (kısayollar gibi
 * localStorage, sunucuya gitmez). Sayfa gezinince değil, yalnızca bildirim
 * paneli açılınca yazılır; böylece sayaç bir sonraki açılışa kadar düşük kalmaz.
 */
export function useUpdates(user: string | null | undefined, plantId: string | undefined): Updates {
  const data = useQuery(api.updates.feed, plantId ? {} : 'skip') as UpdatesData | undefined
  const key = plantId ? `pp.updates.seen.v1.${user ?? ''}.${plantId}` : undefined
  const [seen, setSeen] = useState<number | null | undefined>(undefined)

  useEffect(() => {
    if (!key) return
    let prev: number | null = null
    try {
      prev = parseLastSeen(window.localStorage.getItem(key))
    } catch {
      // Gizli pencere / dolu depo: sayaç bu oturumda sıfırdan başlar.
    }
    setSeen(prev)
  }, [key])

  const markRead = useCallback(() => {
    if (!key) return
    const now = Date.now()
    try {
      window.localStorage.setItem(key, String(now))
    } catch {
      // Yazılamazsa yalnızca bu oturumda sayaç sıfırlanır.
    }
    setSeen(now)
  }, [key])

  return { data, seen, markRead }
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

/**
 * Bildirim listesi (üst çubuktaki zil panelinde): son {FEED_WINDOW_DAYS} günün
 * olayları — plan, die/arıza, SAP ve OEE yüklemeleri. "New" işareti, panel
 * açılmadan önceki son ziyaretten sonra gelenlere konur (`since`).
 * Verinin son yayını bu panelde değil, Planning sayfasında gösterilir.
 */
export function NotificationsList({ data, since }: { data: UpdatesData | undefined; since: number | null }) {
  const now = useNow()
  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          Notifications
          <InfoTip label="How notifications work">
            <p>What happened in the plant in the last {FEED_WINDOW_DAYS} days, only for the modules you can open.</p>
            <ul className="ml-4 list-disc space-y-0.5">
              <li>Die topics and breakdowns opened or solved, plan calculated or approved, SAP and OEE uploads.</li>
              <li>“New” marks what came in since you last opened this panel on this device.</li>
            </ul>
          </InfoTip>
        </h2>
        <span className="text-xs text-muted-foreground">Times in plant time</span>
      </div>
      <div className="max-h-[70vh] min-w-0 overflow-y-auto px-4 py-2">
        {!data ? (
          <p className="py-4 text-sm text-muted-foreground">Loading…</p>
        ) : data.feed.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Nothing new in the last {FEED_WINDOW_DAYS} days.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.feed.map((i) => (
              <FeedRow key={i.key} item={i} now={now} isNew={since !== null && i.at > since} />
            ))}
          </ul>
        )}
      </div>
    </div>
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
