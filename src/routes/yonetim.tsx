import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { ErrorBanner } from '../components/ErrorBanner'
import { SaveStatus } from '../components/SaveStatus'
import { UnsavedBar } from '../components/UnsavedBar'
import { useAction, useMutation, useQuery } from '../lib/convexTransport'
import { validatePassword } from '../lib/authRules'
import { useCurrentUser } from '../lib/currentUser'
import { useDraftRows } from '../lib/useDraftRows'
import { useSafeMutation } from '../lib/useSafeMutation'

export const Route = createFileRoute('/yonetim')({
  component: AdminPage,
})

type User = {
  _id: string
  name: string
  email?: string
  role: string
  active: boolean
  hasPassword: boolean
  mustChangePassword: boolean
}

const ROLES = [
  { value: 'admin', label: 'Admin', hint: 'Manages users and the lists below' },
  { value: 'planner', label: 'Planner', hint: 'Runs and approves the plan' },
  { value: 'maintenance', label: 'Maintenance', hint: 'Press and mold maintenance' },
  { value: 'viewer', label: 'Viewer', hint: 'Reads only' },
]

const LISTS = [
  { kind: 'operation', label: 'Operations', hint: 'OP10, OP20 … used on mold problem reports' },
  { kind: 'problemType', label: 'Problem types', hint: 'Burr, tear, punch breakage …' },
  { kind: 'maintenanceReason', label: 'Maintenance reasons', hint: 'Suggested on press maintenance' },
]

interface Draft {
  name: string
  email: string
  role: string
  active: boolean
}

function draftOf(user: User): Draft {
  return { name: user.name, email: user.email ?? '', role: user.role, active: user.active }
}

function sameDraft(a: Draft, b: Draft): boolean {
  return a.name === b.name && a.email === b.email && a.role === b.role && a.active === b.active
}

function AdminPage() {
  const { name: currentUser, user: session, token, setToken } = useCurrentUser()
  const users = (useQuery(api.authInternal.listWithPasswordState) ?? []) as User[]
  const setPasswordAsAdmin = useAction(api.auth.setPasswordAsAdmin)
  const [passwordFor, setPasswordFor] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const lookups = (useQuery(api.lookups.list) ?? []) as {
    _id: string
    kind: string
    value: string
  }[]
  const logs = (useQuery(api.changeLog.recent, { limit: 50 }) ?? []) as {
    _id: string
    title: string
    detail?: string
    category: string
    author?: string
    createdAt: number
  }[]

  const { run: addUser, error: addError, clearError } = useSafeMutation(api.users.add)
  const { run: updateUser, error: updateError } = useSafeMutation(api.users.update)
  const { run: removeUser, error: removeError } = useSafeMutation(api.users.remove)
  const { run: addLookup, error: lookupError } = useSafeMutation(api.lookups.add)
  const { run: removeLookup } = useSafeMutation(api.lookups.remove)
  const seedDefaults = useMutation(api.lookups.seedDefaults)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('planner')
  const [saving, setSaving] = useState(false)
  const [newValue, setNewValue] = useState<Record<string, string>>({})

  const drafts = useDraftRows(users, (u) => u._id, draftOf, sameDraft)

  const byKind = useMemo(() => {
    const map = new Map<string, typeof lookups>()
    for (const row of lookups) {
      const list = map.get(row.kind) ?? []
      list.push(row)
      map.set(row.kind, list)
    }
    return map
  }, [lookups])

  async function submitUser() {
    if (!name.trim()) return
    setSaving(true)
    let ok = false
    try {
      ok = await addUser({ name: name.trim(), email: email.trim() || undefined, role })
    } finally {
      setSaving(false)
    }
    if (ok) {
      setName('')
      setEmail('')
    }
  }

  const saveUser = (id: string) => (draft: Draft) =>
    updateUser({
      id,
      name: draft.name,
      email: draft.email.trim() || undefined,
      role: draft.role,
      active: draft.active,
    })

  const inputClass = 'rounded-md border border-input bg-background px-3 py-2 text-sm'
  const activeUsers = users.filter((u) => u.active)

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Admin</h1>
      <p className="mt-2 text-muted-foreground">
        People, the lists they choose from, and a record of who changed what.
      </p>

      <div className="mt-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">
          What this login does, and what it does not
        </p>
        <p className="mt-1 text-sm text-amber-900">
          Passwords are real: stored as a salted PBKDF2 hash, never in plain
          text, and a session expires after twelve hours. Changing a password
          signs that user out everywhere else. This keeps someone who finds the
          address out of the plan.
        </p>
        <p className="mt-1 text-sm text-amber-900">
          It now guards the data too: every database function checks the
          session before it runs, so knowing the deployment address is no
          longer enough. Roles are enforced on the server — a viewer cannot
          write anything, and only an admin can manage users and the lists
          below.
        </p>
        <p className="mt-1 text-sm text-amber-900">
          What is left: passwords have no complexity rule beyond a minimum
          length, there is no lockout after repeated wrong attempts, and the
          session token lives in this browser's storage.
        </p>
      </div>

      <ErrorBanner
        message={addError ?? updateError ?? removeError ?? lookupError ?? passwordError}
        onDismiss={clearError}
      />

      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Signed in</h2>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-foreground">
            <strong>{currentUser}</strong>
            <span className="text-muted-foreground"> · {session?.role}</span>
          </span>
          <button
            onClick={() => setToken(null)}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          >
            Sign out
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Everything you save is recorded under this name.
        </p>
      </div>

      <h2 className="mt-8 text-sm font-semibold text-foreground">Users</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        A new user cannot sign in until you set a password for them. They are
        asked to replace it the first time they sign in.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-border p-4">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Name</span>
          <input
            className={`mt-1 w-44 ${inputClass}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ayşe Yılmaz"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitUser()
            }}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Email (opt.)</span>
          <input
            className={`mt-1 w-56 ${inputClass}`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Role</span>
          <select
            className={`mt-1 w-40 ${inputClass}`}
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => void submitUser()}
          disabled={!name.trim() || saving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Adding…' : 'Add user'}
        </button>
      </div>

      {users.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No users yet. Add the people who use this program so their changes
          carry a name.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Active</th>
                <th className="px-3 py-2 font-medium">Password</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const draft = drafts.draftFor(user)
                const dirty = drafts.isDirty(user)
                const busy = drafts.savingKey === user._id
                const save = () => {
                  if (dirty && !busy) void drafts.commit(user._id, saveUser(user._id))
                }
                return (
                  <tr
                    key={user._id}
                    className={`border-t border-border ${dirty ? 'bg-amber-50' : ''}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') save()
                    }}
                  >
                    <td className="px-3 py-2">
                      <input
                        className={`w-40 ${inputClass}`}
                        value={draft.name}
                        onChange={(e) => drafts.edit(user._id, { name: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className={`w-52 ${inputClass}`}
                        value={draft.email}
                        onChange={(e) => drafts.edit(user._id, { email: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className={`w-36 ${inputClass}`}
                        value={draft.role}
                        onChange={(e) => drafts.edit(user._id, { role: e.target.value })}
                      >
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={draft.active}
                        onChange={(e) => drafts.edit(user._id, { active: e.target.checked })}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {passwordFor === user._id ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <input
                            type="password"
                            className="w-36 rounded-md border border-input bg-background px-2 py-1 text-sm"
                            placeholder="New password"
                            autoComplete="new-password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                          />
                          <button
                            onClick={async () => {
                              const problem = validatePassword(newPassword)
                              if (problem) {
                                setPasswordError(problem)
                                return
                              }
                              setPasswordError(null)
                              try {
                                await setPasswordAsAdmin({
                                  token: token ?? '',
                                  userId: user._id,
                                  newPassword,
                                })
                                setPasswordFor(null)
                                setNewPassword('')
                              } catch (e) {
                                setPasswordError(
                                  e instanceof Error ? e.message : 'Could not set the password',
                                )
                              }
                            }}
                            className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                          >
                            Set
                          </button>
                          <button
                            onClick={() => {
                              setPasswordFor(null)
                              setPasswordError(null)
                            }}
                            className="text-xs text-muted-foreground underline"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          {!user.hasPassword ? (
                            <span className="text-destructive">cannot sign in</span>
                          ) : user.mustChangePassword ? (
                            <span className="text-amber-700">must change</span>
                          ) : (
                            <span className="text-muted-foreground">set</span>
                          )}
                          <button
                            onClick={() => {
                              setPasswordFor(user._id)
                              setNewPassword('')
                              setPasswordError(null)
                            }}
                            className="text-foreground underline hover:no-underline"
                          >
                            {user.hasPassword ? 'Reset' : 'Set password'}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <SaveStatus
                        dirty={dirty}
                        saving={busy}
                        justSaved={!!drafts.justSaved[user._id]}
                      />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={save}
                        disabled={!dirty || busy}
                        className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete ${user.name}? Their past entries keep their name; only the account goes.`,
                            )
                          ) {
                            void removeUser({ id: user._id })
                            // Kendini silen kullanıcı oturumda kalmamalı.
                            if (currentUser === user.name) setToken(null)
                          }
                        }}
                        className="ml-2 text-xs text-destructive hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-foreground">Selection lists</h2>
        {lookups.length === 0 && (
          <button
            onClick={() => void seedDefaults()}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          >
            Fill with common defaults
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {LISTS.map((list) => (
          <div key={list.kind} className="rounded-lg border border-border p-3">
            <p className="text-sm font-medium text-foreground">{list.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{list.hint}</p>
            <div className="mt-2 flex gap-1">
              <input
                className={`w-full ${inputClass}`}
                placeholder="Add a value"
                value={newValue[list.kind] ?? ''}
                onChange={(e) => setNewValue((v) => ({ ...v, [list.kind]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  const value = (newValue[list.kind] ?? '').trim()
                  if (!value) return
                  void addLookup({ kind: list.kind, value }).then((ok) => {
                    if (ok) setNewValue((v) => ({ ...v, [list.kind]: '' }))
                  })
                }}
              />
              <button
                onClick={() => {
                  const value = (newValue[list.kind] ?? '').trim()
                  if (!value) return
                  void addLookup({ kind: list.kind, value }).then((ok) => {
                    if (ok) setNewValue((v) => ({ ...v, [list.kind]: '' }))
                  })
                }}
                disabled={!(newValue[list.kind] ?? '').trim()}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                Add
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {(byKind.get(list.kind) ?? []).map((row) => (
                <span
                  key={row._id}
                  className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground"
                >
                  {row.value}
                  <button
                    onClick={() => {
                      if (window.confirm(`Remove "${row.value}" from ${list.label}?`)) {
                        void removeLookup({ id: row._id })
                      }
                    }}
                    className="text-destructive"
                    title="Remove"
                  >
                    ×
                  </button>
                </span>
              ))}
              {(byKind.get(list.kind) ?? []).length === 0 && (
                <span className="text-xs text-muted-foreground">Empty.</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-sm font-semibold text-foreground">
        Who changed what (last {logs.length})
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Written automatically when a plan is approved, maintenance is booked or
        completed, a mold is held or released, a problem is reported or solved,
        and when users change.
      </p>
      {logs.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          Nothing recorded yet.
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">What</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log._id} className="border-t border-border">
                  <td className="px-3 py-2 text-xs whitespace-nowrap text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString('en-GB')}
                  </td>
                  <td className="px-3 py-2 text-xs text-foreground">{log.author ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="text-foreground">{log.title}</span>
                    {log.detail && (
                      <span className="block text-xs text-muted-foreground">{log.detail}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UnsavedBar
        count={drafts.dirtyKeys.length}
        saving={drafts.savingKey !== null}
        noun="user"
        onSaveAll={() => void drafts.commitAll((id, draft) => saveUser(id)(draft))}
        onDiscard={drafts.discardAll}
      />
    </div>
  )
}
