import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { CompanyGroups, CompanyUsers, type GroupRow } from '../components/CompanyAdmin'
import { ErrorBanner } from '../components/ErrorBanner'
import { useMutation, useQuery } from '../lib/convexTransport'
import { useCurrentUser } from '../lib/currentUser'
import { usePlant } from '../lib/plantContext'
import { useSafeMutation } from '../lib/useSafeMutation'

export const Route = createFileRoute('/yonetim')({
  component: AdminPage,
})

const LISTS = [
  { kind: 'operation', label: 'Operations', hint: 'OP10, OP20 … used on mold problem reports' },
  { kind: 'problemType', label: 'Problem types', hint: 'Burr, tear, punch breakage …' },
  { kind: 'maintenanceReason', label: 'Maintenance reasons', hint: 'Suggested on press maintenance' },
  { kind: 'machineProblemType', label: 'Machine problem types', hint: 'Hydraulic, electrical … used on machine breakdown reports' },
]

function AdminPage() {
  const { name: currentUser, user: session, setToken } = useCurrentUser()
  const { ctx, canManage } = usePlant()
  const companyId = ctx?.active?.companyId ?? null
  const groups = (useQuery(api.users.listGroups, canManage && companyId ? { companyId } : 'skip') ?? []) as GroupRow[]
  const companies = (useQuery(api.platform.companies, canManage ? {} : 'skip') ?? []) as { _id: string; plants: { _id: string; name: string }[] }[]
  const plants = companies.find((c) => c._id === companyId)?.plants ?? []
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

  const { run: addLookup, error: lookupError } = useSafeMutation(api.lookups.add)
  const { run: removeLookup } = useSafeMutation(api.lookups.remove)
  const seedDefaults = useMutation(api.lookups.seedDefaults)

  const [newValue, setNewValue] = useState<Record<string, string>>({})

  const byKind = useMemo(() => {
    const map = new Map<string, typeof lookups>()
    for (const row of lookups) {
      const list = map.get(row.kind) ?? []
      list.push(row)
      map.set(row.kind, list)
    }
    return map
  }, [lookups])

  const inputClass = 'rounded-md border border-input bg-background px-3 py-2 text-sm'

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
        message={lookupError}
      />

      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Signed in</h2>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-foreground">
            <strong>{currentUser}</strong>
            <span className="text-muted-foreground">
              {' '}
              · {session?.role}
              {ctx?.active && ` · ${ctx.active.companyName} / ${ctx.active.plantName}`}
            </span>
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

      {canManage && companyId ? (
        <>
          <h2 className="mt-8 text-sm font-semibold text-foreground">Users — {ctx?.active?.companyName}</h2>
          <CompanyUsers companyId={companyId} groups={groups} />
          <h2 className="mt-8 text-sm font-semibold text-foreground">User groups</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            A group gives its members plants and a permission per module (no access · views · edits). A person in
            several groups gets the widest permission. A creator needs no group.
          </p>
          <CompanyGroups companyId={companyId} groups={groups} plants={plants} />
        </>
      ) : (
        <p className="mt-8 text-sm text-muted-foreground">Users and groups are managed by a creator of your company.</p>
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

    </div>
  )
}
