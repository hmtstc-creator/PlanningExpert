import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { api } from '../../convex/_generated/api'
import { roleLabel } from '../components/Header'
import { PageHeader } from '../components/PageHeader'
import { validatePassword } from '../lib/authRules'
import { useAction } from '../lib/convexTransport'
import { useCurrentUser } from '../lib/currentUser'
import { friendlyError } from '../lib/mutationErrors'
import { MODULE_LABELS, MODULES } from '../lib/tenancy'
import { usePlant } from '../lib/plantContext'

export const Route = createFileRoute('/account')({
  component: AccountPage,
})

const input = 'mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm'

/** Hesabım: kim olduğum, seçili plant'teki izinlerim, parola değiştirme, çıkış. */
function AccountPage() {
  const { name, token, setToken } = useCurrentUser()
  const { ctx } = usePlant()
  const changePassword = useAction(api.auth.changePassword)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const problem = next ? validatePassword(next, name ?? undefined) : null
  const mismatch = confirm.length > 0 && next !== confirm
  const access = ctx?.active?.access

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader title="My account" summary="Who you are, what you may do in the selected plant, and your password." />

      <section className="mt-6 rounded-lg border border-border p-4">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="font-medium text-foreground">{name}</dd>
          <dt className="text-muted-foreground">Role</dt>
          <dd className="text-foreground">{roleLabel(ctx)}</dd>
          {ctx?.active && (
            <>
              <dt className="text-muted-foreground">Plant</dt>
              <dd className="text-foreground">
                {ctx.active.companyName} › {ctx.active.plantName}
              </dd>
            </>
          )}
          {access && (
            <>
              <dt className="text-muted-foreground">Permissions</dt>
              <dd className="flex flex-wrap gap-1.5">
                {MODULES.map((m) => (
                  <span
                    key={m}
                    className={`rounded px-1.5 py-0.5 text-xs ${access[m] === 'edit' ? 'bg-emerald-600 text-white' : access[m] === 'view' ? 'border border-emerald-600 text-emerald-700' : 'bg-muted text-muted-foreground line-through'}`}
                  >
                    {MODULE_LABELS[m]}: {access[m] === 'edit' ? 'edits' : access[m] === 'view' ? 'views' : 'no access'}
                  </span>
                ))}
              </dd>
            </>
          )}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">Everything you save is recorded under your name.</p>
      </section>

      <section className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Change password</h2>
        <form
          className="mt-3 grid max-w-sm gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (problem || mismatch || !current) return
            setBusy(true)
            setMessage(null)
            try {
              await changePassword({ token: token ?? '', currentPassword: current, newPassword: next })
              setCurrent('')
              setNext('')
              setConfirm('')
              setMessage({ ok: true, text: 'Password changed. Your other devices were signed out.' })
            } catch (err) {
              setMessage({ ok: false, text: friendlyError(err).message || 'Could not change the password' })
            } finally {
              setBusy(false)
            }
          }}
        >
          <label className="text-xs text-muted-foreground">
            Current password
            <input type="password" autoComplete="current-password" className={input} value={current} onChange={(e) => setCurrent(e.target.value)} />
          </label>
          <label className="text-xs text-muted-foreground">
            New password
            <input type="password" autoComplete="new-password" className={input} value={next} onChange={(e) => setNext(e.target.value)} />
            {problem && <span className="mt-1 block text-destructive">{problem}</span>}
          </label>
          <label className="text-xs text-muted-foreground">
            Repeat the new password
            <input type="password" autoComplete="new-password" className={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {mismatch && <span className="mt-1 block text-destructive">The two passwords differ</span>}
          </label>
          <p className="text-xs text-muted-foreground">At least 8 characters with a letter and a digit; not your user name.</p>
          <button
            type="submit"
            disabled={busy || !current || !next || !!problem || mismatch || next !== confirm}
            className="justify-self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Change password'}
          </button>
          {message && <p className={`text-sm ${message.ok ? 'text-emerald-700' : 'text-destructive'}`}>{message.text}</p>}
        </form>
      </section>

      <button onClick={() => setToken(null)} className="mt-6 rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
        Sign out
      </button>
    </div>
  )
}
