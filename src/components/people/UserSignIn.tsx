import { useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { useAction } from '../../lib/convexTransport'
import { validatePassword } from '../../lib/authRules'
import { useCurrentUser } from '../../lib/currentUser'
import { friendlyError } from '../../lib/mutationErrors'
import type { PeopleUser } from '../../lib/peopleTree'
import { formatPlantTime } from '../../lib/sapUploads'
import { useSafeMutation } from '../../lib/useSafeMutation'
import { ErrorBanner } from '../ErrorBanner'

/**
 * Kullanıcının girişi: son giriş, hatalı parola kilidi, her yerden çıkış ve
 * geçici parola verme. Users & permissions ile Organization map (kullanıcı
 * düğümü) aynı bileşeni kullanır; yetki sunucuda (`users.signOutEverywhere`,
 * `auth.setPasswordAsAdmin`). `compact`: haritanın dar kutusu için küçük yazı.
 */
export function UserSignIn({ user: u, compact = false }: { user: PeopleUser; compact?: boolean }) {
  const { token } = useCurrentUser()
  const { run: signOutAll, error: signOutError, clearError } = useSafeMutation(api.users.signOutEverywhere)
  const setPassword = useAction(api.auth.setPasswordAsAdmin)
  const [signedOut, setSignedOut] = useState(false)
  const [pw, setPw] = useState('')
  const [pwOpen, setPwOpen] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwDone, setPwDone] = useState(false)
  const text = compact ? 'text-xs' : 'text-sm'
  const input = `rounded-md border border-input bg-background px-2 ${compact ? 'w-36 py-1 text-xs' : 'w-44 py-1.5 text-sm'}`
  const btn = compact
    ? 'rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40'
    : 'rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40'

  return (
    <div>
      <ErrorBanner message={signOutError ?? pwError} onDismiss={() => (clearError(), setPwError(null))} />
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${text}`}>
        <span>
          <span className="text-xs text-muted-foreground">Last sign-in: </span>
          {u.lastLoginAt ? formatPlantTime(u.lastLoginAt) : <span className="text-muted-foreground">never (since sign-ins are recorded)</span>}
        </span>
        {u.locked && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900" title="Too many wrong passwords — setting a new password unlocks it">
            locked after wrong passwords
          </span>
        )}
        <button
          className="text-xs underline"
          title="Close every open session of this user — they must sign in again on every device. The password does not change."
          onClick={() => {
            if (window.confirm(`Sign ${u.name} out on every device?`)) void signOutAll({ id: u._id }).then((ok) => ok && setSignedOut(true))
          }}
        >
          Sign out everywhere
        </button>
        {signedOut && <span className="text-xs text-emerald-700">signed out on every device</span>}
      </div>

      <div className={`mt-3 ${text}`}>
        <span className="text-xs text-muted-foreground">Password: </span>
        {!u.hasPassword ? <span className="text-destructive">not set — cannot sign in</span> : u.mustChangePassword ? <span className="text-amber-700">temporary — changes it at the next sign-in</span> : <span>set</span>}
        {pwDone && <span className="ml-2 text-emerald-700">temporary password set</span>}
        {pwOpen ? (
          <span className="ml-2 inline-flex flex-wrap items-center gap-1">
            <input type="password" autoComplete="new-password" className={input} placeholder="Temporary password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <button
              className={btn}
              onClick={async () => {
                const problem = validatePassword(pw, u.name)
                if (problem) return setPwError(problem)
                try {
                  await setPassword({ token: token ?? '', userId: u._id, newPassword: pw })
                  setPwOpen(false)
                  setPw('')
                  setPwError(null)
                  setPwDone(true)
                } catch (e) {
                  setPwError(friendlyError(e).message || 'Could not set the password')
                }
              }}
            >
              Set
            </button>
            <button className="text-xs underline" onClick={() => setPwOpen(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button className="ml-2 text-xs underline" onClick={() => (setPwOpen(true), setPwDone(false))}>
            {u.hasPassword ? 'Reset password' : 'Set password'}
          </button>
        )}
      </div>
    </div>
  )
}
