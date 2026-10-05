// Administration → Security: hesapların güvenlik durumu (convex/security.ts).
// Saf kural; sunucu yalnızca satırları okur.

import { failuresSince, signinDelayMs, windowFailures, type SigninBucket } from './signinGuard'

const DAY = 24 * 60 * 60_000

/** Bu kadar gündür girmeyen etkin hesap "uykuda" sayılır: kapatılması önerilir. */
export const DORMANT_DAYS = 90
/** Geçici parolası bu kadar gündür değişmeyen hesap uyarı verir. */
export const TEMP_PASSWORD_DAYS = 7
/**
 * Son giriş zamanı bu tarihten beri yazılıyor (users.lastLoginAt). Daha eski
 * hesaplar için "hiç girmedi" denemez; uykuda sayımı bu tarihten başlar.
 */
export const LAST_LOGIN_TRACKED_SINCE = Date.UTC(2026, 9, 5)

export interface SecurityUser {
  _id: string
  name: string
  active: boolean
  hasPassword: boolean
  createdAt: number
  lastLoginAt?: number
  lockedUntil?: number
  mustChangePassword?: boolean
  isCreator?: boolean
  platformRole?: string
  company?: string
}

export type Severity = 'high' | 'medium' | 'info'

export interface SecurityFinding {
  key: string
  severity: Severity
  title: string
  advice: string
  users: { _id: string; name: string; company?: string; note?: string }[]
}

export interface SecurityOverview {
  findings: SecurityFinding[]
  counts: { active: number; privileged: number; activeSessions: number }
  signins: { last24h: number; last7d: number; unknown7d: number; window: number; delayMs: number }
}

const privileged = (u: SecurityUser) => !!u.platformRole || !!u.isCreator
const role = (u: SecurityUser) =>
  u.platformRole === 'owner' ? 'site owner' : u.platformRole ? 'General' : u.isCreator ? 'creator' : undefined
const days = (ms: number) => Math.floor(ms / DAY)

export function securityOverview(users: SecurityUser[], buckets: SigninBucket[], activeSessions: number, now: number): SecurityOverview {
  const live = users.filter((u) => u.active && u.hasPassword)
  const row = (u: SecurityUser, note?: string) => ({ _id: u._id, name: u.name, company: u.company, note })
  const findings: SecurityFinding[] = []

  const locked = live.filter((u) => (u.lockedUntil ?? 0) > now)
  if (locked.length)
    findings.push({
      key: 'locked',
      severity: 'high',
      title: 'Locked by wrong passwords now',
      advice:
        'Someone typed 5 wrong passwords in a row. If the user did not, a person is guessing the password: ask the user, and set a new password if in doubt.',
      users: locked.map((u) => row(u, `${Math.ceil(((u.lockedUntil ?? 0) - now) / 60_000)} min left`)),
    })

  const lastSeen = (u: SecurityUser) => Math.max(u.lastLoginAt ?? 0, u.createdAt, LAST_LOGIN_TRACKED_SINCE)
  const dormant = live.filter((u) => now - lastSeen(u) >= DORMANT_DAYS * DAY)
  const dormantPrivileged = dormant.filter(privileged)
  if (dormantPrivileged.length)
    findings.push({
      key: 'dormantPrivileged',
      severity: 'high',
      title: `Manager accounts not used for ${DORMANT_DAYS}+ days`,
      advice:
        'An unused account with wide rights is the best target: nobody notices when someone else signs in with it. Deactivate it or take the role away.',
      users: dormantPrivileged.map((u) =>
        row(u, `${role(u)} · ${u.lastLoginAt ? `last sign-in ${days(now - u.lastLoginAt)} days ago` : 'no sign-in recorded'}`),
      ),
    })

  const tempAll = live.filter((u) => u.mustChangePassword)
  const tempOld = tempAll.filter((u) => now - Math.max(u.createdAt, LAST_LOGIN_TRACKED_SINCE) >= TEMP_PASSWORD_DAYS * DAY)
  if (tempAll.length)
    findings.push({
      key: 'temporary',
      severity: tempAll.some(privileged) || tempOld.length ? 'medium' : 'info',
      title: 'Temporary password not changed yet',
      advice:
        'The person who set it knows this password. The user must sign in and choose their own; if the account is not needed, deactivate it.',
      users: tempAll.map((u) => row(u, role(u))),
    })

  const dormantOthers = dormant.filter((u) => !privileged(u))
  if (dormantOthers.length)
    findings.push({
      key: 'dormant',
      severity: 'medium',
      title: `Accounts not used for ${DORMANT_DAYS}+ days`,
      advice: 'People who left or changed jobs keep their access until the account is deactivated.',
      users: dormantOthers.map((u) => row(u, u.lastLoginAt ? `last sign-in ${days(now - u.lastLoginAt)} days ago` : 'no sign-in recorded')),
    })

  const priv = live.filter(privileged)
  findings.push({
    key: 'privileged',
    severity: 'info',
    title: 'Accounts with wide rights',
    advice: 'Keep this list short. Each of them can add users and give permissions.',
    users: priv.map((u) => row(u, role(u))),
  })

  const d1 = failuresSince(buckets, now - DAY)
  const d7 = failuresSince(buckets, now - 7 * DAY)
  const window = windowFailures(buckets, now)
  return {
    findings,
    counts: { active: live.length, privileged: priv.length, activeSessions },
    signins: { last24h: d1.failures, last7d: d7.failures, unknown7d: d7.unknownNames, window, delayMs: signinDelayMs(window) },
  }
}
