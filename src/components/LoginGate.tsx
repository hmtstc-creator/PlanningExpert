import { useEffect, useState, type ReactNode } from 'react'

import { api } from '../../convex/_generated/api'
import { useAction } from '../lib/convexTransport'
import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  screenFor,
  validatePassword,
} from '../lib/authRules'
import { useCurrentUser } from '../lib/currentUser'

/**
 * Giriş kapısı.
 *
 * Kimse giriş yapmadan uygulama görünmez ve varsayılan parolayla giren
 * kullanıcı kendi parolasını koymadan içeri geçemez — zorunlu değişikliği
 * atlanabilir yapmak onu bir öneriye çevirirdi.
 */
export function LoginGate({ children }: { children: ReactNode }) {
  const { user, token, loading, setToken } = useCurrentUser()
  const login = useAction(api.auth.login)
  const seedAdmin = useAction(api.auth.seedAdmin)
  const changePassword = useAction(api.auth.changePassword)

  const [name, setName] = useState(DEFAULT_ADMIN_USERNAME)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [seedError, setSeedError] = useState<string | null>(null)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const screen = screenFor({ loading, user })

  // Hiç kullanıcı yoksa ilk yöneticiyi oluştur. Boş bir kurulumda giriş
  // ekranının hiçbir parolayı kabul etmemesi çıkmaz sokak olurdu.
  useEffect(() => {
    // Sessizce yutulursa, boş bir kurulumda hiçbir parola çalışmaz ve
    // kullanıcı sebebini göremez.
    if (screen === 'login') {
      void seedAdmin({})
        .then(() => setSeedError(null))
        .catch((e: unknown) =>
          setSeedError(e instanceof Error ? e.message : 'Could not create the first account'),
        )
    }
  }, [screen, seedAdmin])

  if (screen === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </div>
    )
  }

  if (screen === 'login') {
    return (
      <div className="mx-auto w-full max-w-sm px-4 py-16">
        <h1 className="text-xl font-bold text-foreground">Production Planning</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to continue.</p>

        <form
          className="mt-6 space-y-3"
          onSubmit={async (event) => {
            event.preventDefault()
            setError(null)
            setBusy(true)
            try {
              const result = await login({ name, password })
              setToken(result.token)
              setPassword('')
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not sign in')
            } finally {
              setBusy(false)
            }
          }}
        >
          <label className="block text-sm">
            <span className="block text-xs text-muted-foreground">User name</span>
            <input
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="block text-xs text-muted-foreground">Password</span>
            <input
              type="password"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {seedError && (
            <p className="text-sm text-destructive">
              The first account could not be created: {seedError}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !name.trim() || !password}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          First time here? The account is{' '}
          <strong>{DEFAULT_ADMIN_USERNAME}</strong> with the password{' '}
          <strong>{DEFAULT_ADMIN_PASSWORD}</strong>. You will be asked to
          replace it straight away — anyone who finds this address could use it
          otherwise.
        </p>
      </div>
    )
  }

  if (screen === 'mustChangePassword') {
    const problem = newPassword ? validatePassword(newPassword) : null
    const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword
    return (
      <div className="mx-auto w-full max-w-sm px-4 py-16">
        <h1 className="text-xl font-bold text-foreground">Choose a password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {user?.name} is still using the password it was created with. Pick a
          new one to continue.
        </p>

        <form
          className="mt-6 space-y-3"
          onSubmit={async (event) => {
            event.preventDefault()
            setError(null)
            setBusy(true)
            try {
              await changePassword({
                token: token ?? '',
                currentPassword: password,
                newPassword,
              })
              setPassword('')
              setNewPassword('')
              setConfirmPassword('')
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not change the password')
            } finally {
              setBusy(false)
            }
          }}
        >
          <label className="block text-sm">
            <span className="block text-xs text-muted-foreground">Current password</span>
            <input
              type="password"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="block text-xs text-muted-foreground">New password</span>
            <input
              type="password"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="block text-xs text-muted-foreground">New password again</span>
            <input
              type="password"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>

          {problem && <p className="text-sm text-destructive">{problem}</p>}
          {mismatch && <p className="text-sm text-destructive">The two do not match</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={busy || !password || !!problem || mismatch || !confirmPassword}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Set password'}
          </button>
          <button
            type="button"
            onClick={() => setToken(null)}
            className="w-full text-xs text-muted-foreground underline"
          >
            Sign out instead
          </button>
        </form>
      </div>
    )
  }

  return <>{children}</>
}
