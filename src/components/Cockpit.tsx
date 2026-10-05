import { Link } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'

import { api } from '../../convex/_generated/api'
import { useQuery } from '../lib/convexTransport'
import type { Signal, TodayThresholds } from '../lib/cockpit'
import { TODAY_DEFAULTS } from '../lib/settingsDefaults'
import { useCanOpen } from '../lib/plantContext'
import { InfoTip } from './PageHeader'

const TONE: Record<Signal['level'], { box: string; icon: typeof XCircle; iconCls: string }> = {
  critical: { box: 'border-destructive/40 bg-destructive/5', icon: XCircle, iconCls: 'text-destructive' },
  warning: { box: 'border-amber-300 bg-amber-50/70', icon: AlertTriangle, iconCls: 'text-amber-600' },
  ok: { box: 'border-emerald-300 bg-emerald-50/60', icon: CheckCircle2, iconCls: 'text-emerald-600' },
}

/**
 * "Today": yöneticinin ilk bakışta görmesi gereken kararlar (src/lib/cockpit.ts).
 * Her kart sorunun sayfasına götürür.
 */
export function Cockpit({ className = '' }: { className?: string }) {
  const signals = useQuery(api.cockpit.today) as Signal[] | undefined
  const t = ((useQuery(api.digest.settings) as { thresholds: TodayThresholds } | undefined)?.thresholds ?? TODAY_DEFAULTS) as TodayThresholds
  const canOpen = useCanOpen()
  if (!signals || signals.length === 0) return null
  return (
    <section className={className} aria-label="Today">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        Today — what needs a decision
        <InfoTip label="How Today works">
          <p>Risks and their reasons from the latest plan and the follow-up modules — not record counts. Each card opens its page.</p>
          <ul className="ml-4 list-disc space-y-0.5">
            <li>Late parts: the plan's late deliveries, worst first, with the engine's suggestion. “No plan can save” is proven from capacity — the decision there is overtime or another work center.</li>
            <li>Over capacity: work centers whose demand exceeds {t.overloadPercent} % of capacity in the next {t.bottleneckWeeks} weeks.</li>
            <li>Old data: demand (ZPP) or stock (MB52) older than {t.sapStaleHours} h — the plan is only as good as the upload.</li>
            <li>Plan health: the last calculation failed, or the plan is older than {t.planStaleHours} h.</li>
          </ul>
          <p>The limits are this plant's own: Company settings → Today &amp; daily digest.</p>
        </InfoTip>
      </h2>
      <div className="mt-2 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
        {signals.map((s) => {
          const t = TONE[s.level]
          const Icon = t.icon
          const body = (
            <>
              <p className="flex items-start gap-2 text-sm font-semibold text-foreground">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${t.iconCls}`} aria-hidden />
                {s.title}
              </p>
              {s.detail && <p className="mt-1 pl-6 text-xs text-muted-foreground">{s.detail}</p>}
              {s.items && s.items.length > 0 && (
                <ul className="mt-1.5 space-y-1 pl-6 text-xs">
                  {s.items.map((i, n) => (
                    <li key={n}>
                      <span className="text-foreground">{i.text}</span>
                      {i.sub && <span className="block text-muted-foreground">{i.sub}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )
          return canOpen(s.to) ? (
            <Link key={s.key} to={s.to} className={`block rounded-lg border p-3 transition-colors hover:border-foreground/40 ${t.box}`}>
              {body}
            </Link>
          ) : (
            <div key={s.key} className={`rounded-lg border p-3 ${t.box}`}>
              {body}
            </div>
          )
        })}
      </div>
    </section>
  )
}
