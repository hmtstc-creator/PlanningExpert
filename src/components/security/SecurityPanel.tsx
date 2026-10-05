import { AlertTriangle, Info, ShieldCheck, XCircle } from 'lucide-react'

import { api } from '../../../convex/_generated/api'
import { useQuery } from '../../lib/convexTransport'
import type { SecurityFinding, SecurityOverview, Severity } from '../../lib/securityOverview'
import { DORMANT_DAYS } from '../../lib/securityOverview'

const TONE: Record<Severity, { box: string; icon: typeof XCircle; iconCls: string }> = {
  high: { box: 'border-destructive/40 bg-destructive/5', icon: XCircle, iconCls: 'text-destructive' },
  medium: { box: 'border-amber-300 bg-amber-50/70', icon: AlertTriangle, iconCls: 'text-amber-600' },
  info: { box: 'border-border bg-muted/40', icon: Info, iconCls: 'text-muted-foreground' },
}

interface EventRow {
  _id: string
  at: number
  actor?: string
  action: string
  target: string
  detail?: string
}

type Data = SecurityOverview & { platform: boolean; events: EventRow[] }

const fmtAt = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

const EVENT_LABELS: Record<string, string> = {
  'signin.locked': 'Account locked',
  'signin.pressure': 'Many wrong sign-ins',
  'password.change': 'Password changed',
  'password.set': 'Password set by a manager',
  'user.signout': 'Signed out',
}

/**
 * Hesapların güvenlik durumu (convex/platform.ts securityOverview).
 * companyId yoksa bütün site (General, Administration → Security).
 */
export function SecurityPanel({ companyId }: { companyId?: string }) {
  const data = useQuery(api.platform.securityOverview, companyId ? { companyId } : {}) as Data | undefined
  if (!data) return <p className="text-xs text-muted-foreground">Loading…</p>
  const problems = data.findings.filter((f) => f.severity !== 'info')
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Active accounts" value={data.counts.active} />
        <Stat label="With wide rights" value={data.counts.privileged} />
        <Stat label="Open sessions" value={data.counts.activeSessions} />
        {data.platform ? (
          <Stat
            label="Wrong sign-ins, 24 h / 7 days"
            value={`${data.signins.last24h} / ${data.signins.last7d}`}
            sub={data.signins.unknown7d ? `${data.signins.unknown7d} with a user name that does not exist` : undefined}
            alarm={data.signins.delayMs > 0}
          />
        ) : (
          <Stat label="Needs a look" value={problems.length} alarm={problems.some((f) => f.severity === 'high')} />
        )}
      </div>
      {data.platform && data.signins.delayMs > 0 && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <b>{data.signins.window} wrong sign-ins in the last 30 minutes.</b> Somebody may be guessing passwords; every sign-in now waits{' '}
          {data.signins.delayMs / 1000} s until it calms down. Accounts are also locked after 5 wrong passwords.
        </p>
      )}
      {problems.length === 0 && (
        <p className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50/60 p-3 text-sm">
          <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden /> No locked, unused ({DORMANT_DAYS}+ days) or temporary-password
          accounts.
        </p>
      )}
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
        {data.findings.map((f) => (
          <Finding key={f.key} f={f} showCompany={data.platform} />
        ))}
      </div>
      <section>
        <h3 className="text-sm font-semibold">Recent security events</h3>
        <p className="text-xs text-muted-foreground">Locks, wrong-sign-in alarms, password changes and sign-outs — newest first.</p>
        <div className="mt-2 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                {['When', 'Event', 'Account', 'By', 'Detail'].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e._id} className="border-t border-border align-top">
                  <td className="px-3 py-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums">{fmtAt(e.at)}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{EVENT_LABELS[e.action] ?? e.action}</td>
                  <td className="px-3 py-2 text-xs font-medium">{e.target}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{e.actor ?? '—'}</td>
                  <td className="px-3 py-2 text-xs break-words text-muted-foreground">{e.detail ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.events.length && <p className="px-3 py-3 text-xs text-muted-foreground">Nothing recorded yet.</p>}
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value, sub, alarm }: { label: string; value: number | string; sub?: string; alarm?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${alarm ? 'border-destructive/40 bg-destructive/5' : 'border-border'}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Finding({ f, showCompany }: { f: SecurityFinding; showCompany: boolean }) {
  const t = TONE[f.severity]
  const Icon = t.icon
  return (
    <div className={`rounded-lg border p-3 ${t.box}`}>
      <p className="flex items-start gap-2 text-sm font-semibold">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${t.iconCls}`} aria-hidden />
        <span>
          {f.title} <span className="font-normal text-muted-foreground">· {f.users.length}</span>
        </span>
      </p>
      <p className="mt-1 pl-6 text-xs text-muted-foreground">{f.advice}</p>
      {f.users.length > 0 && (
        <ul className="mt-1.5 max-h-48 space-y-0.5 overflow-y-auto pl-6 text-xs">
          {f.users.map((u) => (
            <li key={u._id}>
              <span className="font-medium">{u.name}</span>
              {showCompany && u.company && <span className="text-muted-foreground"> · {u.company}</span>}
              {u.note && <span className="text-muted-foreground"> — {u.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
