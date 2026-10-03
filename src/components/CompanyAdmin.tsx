import { useState } from 'react'

import { api } from '../../convex/_generated/api'
import { ErrorBanner } from './ErrorBanner'
import { SaveStatus } from './SaveStatus'
import { UnsavedBar } from './UnsavedBar'
import { useAction, useQuery } from '../lib/convexTransport'
import { validatePassword } from '../lib/authRules'
import { useCurrentUser } from '../lib/currentUser'
import { friendlyError } from '../lib/mutationErrors'
import { useDraftRows } from '../lib/useDraftRows'
import { useSafeMutation } from '../lib/useSafeMutation'
import { LEVELS, MODULES, MODULE_LABELS, type Level, type Module } from '../lib/tenancy'

/**
 * Şirket kullanıcıları ve kullanıcı grupları (docs/plant-genisletme.md, v3).
 * `companyId: null` → platform kullanıcıları (generaller; yalnızca owner ekler).
 */

export interface UserRow {
  _id: string
  name: string
  email?: string
  active: boolean
  hasPassword: boolean
  mustChangePassword: boolean
  isCreator: boolean
  groupIds: string[]
  platformRole: 'owner' | 'general' | null
  role: string
}

export interface GroupRow {
  _id: string
  name: string
  allPlants: boolean
  plantIds: string[]
  permissions: Partial<Record<Module, Level>>
  /** Board görünümü: üyeleri yalnızca Board Dashboard ve KPI / OEE dashboard'larını görür. */
  board?: boolean
}

interface UserDraft {
  name: string
  email: string
  active: boolean
  isCreator: boolean
  groupIds: string[]
}

const userDraft = (u: UserRow): UserDraft => ({ name: u.name, email: u.email ?? '', active: u.active, isCreator: u.isCreator, groupIds: [...u.groupIds].sort() })
const sameUser = (a: UserDraft, b: UserDraft) => JSON.stringify(a) === JSON.stringify(b)

const input = 'rounded-md border border-input bg-background px-2 py-1.5 text-sm'
const btn = 'rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40'

/**
 * `holdingId` verilirse holding board üyeleri (şirketsiz, yalnızca General
 * yönetir): holding'in bütün şirketlerinin özetini görürler.
 */
export function CompanyUsers({ companyId, groups, holdingId }: { companyId: string | null; groups: GroupRow[]; holdingId?: string }) {
  const users = (useQuery(api.users.list, holdingId ? { holdingId } : { companyId }) ?? []) as UserRow[]
  const { token, name: me, setToken } = useCurrentUser()
  const setPassword = useAction(api.auth.setPasswordAsAdmin)
  const { run: add, error: addError, clearError } = useSafeMutation(api.users.add)
  const { run: update, error: updateError } = useSafeMutation(api.users.update)
  const { run: remove, error: removeError } = useSafeMutation(api.users.remove)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [creator, setCreator] = useState(false)
  const [groupIds, setGroupIds] = useState<string[]>([])
  const [pwFor, setPwFor] = useState<string | null>(null)
  const [pw, setPw] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const company = companyId !== null

  const submit = async () => {
    if (!name.trim()) return
    const ok = await add({ companyId, name: name.trim(), email: email.trim() || undefined, ...(holdingId ? { holdingId } : {}), ...(company ? { isCreator: creator, groupIds } : {}) })
    if (ok) {
      setName('')
      setEmail('')
      setCreator(false)
      setGroupIds([])
    }
  }

  const drafts = useDraftRows(users, (u) => u._id, userDraft, sameUser)
  const saveUser = (u: UserRow) => (d: UserDraft) =>
    update({
      id: u._id,
      name: d.name,
      email: d.email.trim() || undefined,
      active: d.active,
      ...(company && !u.platformRole ? { isCreator: d.isCreator, groupIds: d.groupIds } : {}),
    })

  return (
    <div>
      <ErrorBanner message={addError ?? updateError ?? removeError ?? pwError} onDismiss={clearError} />
      <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
        <label className="text-xs text-muted-foreground">
          Name
          <input className={`mt-1 block w-40 ${input}`} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="text-xs text-muted-foreground">
          Email (opt.)
          <input className={`mt-1 block w-52 ${input}`} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {company && (
          <>
            <label className="flex items-center gap-1 pb-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={creator} onChange={(e) => setCreator(e.target.checked)} /> Creator
            </label>
            <GroupPicker groups={groups} value={groupIds} onChange={setGroupIds} />
          </>
        )}
        <button className={btn} disabled={!name.trim()} onClick={() => void submit()}>
          {company ? 'Add user' : holdingId ? 'Add board member' : 'Add General'}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        A new user signs in after you give a temporary password (Set password); they replace it at the first sign-in.
        {company ? ' A creator manages the whole company: every plant, every module, users and groups.' : ''}
      </p>

      <div className="mt-3 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Role</th>
              {company && <th className="px-3 py-2 font-medium">Groups</th>}
              <th className="px-3 py-2 font-medium">Active</th>
              <th className="px-3 py-2 font-medium">Password</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const d = drafts.draftFor(u)
              const dirty = drafts.isDirty(u)
              const busy = drafts.savingKey === u._id
              const edit = (patch: Partial<UserDraft>) => drafts.edit(u._id, patch)
              return (
              <tr key={u._id} className={`border-t border-border align-top ${dirty ? 'bg-amber-50' : ''}`}>
                <td className="px-3 py-2">
                  <input className={`w-36 ${input}`} value={d.name} onChange={(e) => edit({ name: e.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <input className={`w-48 ${input}`} value={d.email} onChange={(e) => edit({ email: e.target.value })} />
                </td>
                <td className="px-3 py-2 text-xs">
                  {u.platformRole || !company ? (
                    u.platformRole ?? u.role
                  ) : (
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={d.isCreator} onChange={(e) => edit({ isCreator: e.target.checked })} /> creator
                    </label>
                  )}
                </td>
                {company && (
                  <td className="px-3 py-2">
                    {u.platformRole || d.isCreator ? (
                      <span className="text-xs text-muted-foreground">all plants, all modules</span>
                    ) : (
                      <GroupPicker groups={groups} value={d.groupIds} onChange={(ids) => edit({ groupIds: [...ids].sort() })} />
                    )}
                  </td>
                )}
                <td className="px-3 py-2">
                  <input type="checkbox" checked={d.active} disabled={u.name === me} onChange={(e) => edit({ active: e.target.checked })} />
                </td>
                <td className="px-3 py-2 text-xs">
                  {pwFor === u._id ? (
                    <span className="flex flex-wrap items-center gap-1">
                      <input type="password" autoComplete="new-password" className={`w-32 ${input}`} placeholder="Temporary password" value={pw} onChange={(e) => setPw(e.target.value)} />
                      <button
                        className={btn}
                        onClick={async () => {
                          const problem = validatePassword(pw, u.name)
                          if (problem) return setPwError(problem)
                          try {
                            await setPassword({ token: token ?? '', userId: u._id, newPassword: pw })
                            setPwFor(null)
                            setPw('')
                            setPwError(null)
                          } catch (e) {
                            setPwError(friendlyError(e).message || 'Could not set the password')
                          }
                        }}
                      >
                        Set
                      </button>
                      <button className="underline" onClick={() => setPwFor(null)}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-2">
                      {!u.hasPassword ? <span className="text-destructive">cannot sign in</span> : u.mustChangePassword ? <span className="text-amber-700">must change</span> : <span className="text-muted-foreground">set</span>}
                      <button className="underline" onClick={() => (setPwFor(u._id), setPw(''), setPwError(null))}>
                        {u.hasPassword ? 'Reset' : 'Set password'}
                      </button>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <SaveStatus dirty={dirty} saving={busy} justSaved={!!drafts.justSaved[u._id]} />
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button className={btn} disabled={!dirty || busy} onClick={() => void drafts.commit(u._id, saveUser(u))}>
                    Save
                  </button>
                  {u.platformRole !== 'owner' && u.name !== me && (
                    <button
                      className="ml-2 text-xs text-destructive hover:underline"
                      onClick={() => {
                        if (window.confirm(`Delete ${u.name}? Their past entries keep their name; only the account goes.`)) {
                          void remove({ id: u._id }).then(() => u.name === me && setToken(null))
                        }
                      }}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <UnsavedBar
        count={drafts.dirtyKeys.length}
        saving={drafts.savingKey !== null}
        noun="user"
        onSaveAll={() => void drafts.commitAll((id, d) => saveUser(users.find((u) => u._id === id)!)(d))}
        onDiscard={drafts.discardAll}
      />
    </div>
  )
}

function GroupPicker({ groups, value, onChange }: { groups: GroupRow[]; value: string[]; onChange: (ids: string[]) => void }) {
  if (!groups.length) return <span className="pb-2 text-xs text-muted-foreground">no groups yet</span>
  return (
    <span className="flex max-w-xs flex-wrap gap-x-3 gap-y-1 pb-1 text-xs">
      {groups.map((g) => (
        <label key={g._id} className="flex items-center gap-1">
          <input type="checkbox" checked={value.includes(g._id)} onChange={(e) => onChange(e.target.checked ? [...value, g._id] : value.filter((x) => x !== g._id))} />
          {g.name}
        </label>
      ))}
    </span>
  )
}

const EMPTY_PERMS: Record<Module, Level> = { planning: 'none', oee: 'none', die: 'none', machine: 'none', kpi: 'none' }

export function CompanyGroups({ companyId, groups, plants }: { companyId: string; groups: GroupRow[]; plants: { _id: string; name: string }[] }) {
  const { run: saveGroup, error, clearError } = useSafeMutation(api.users.saveGroup)
  const { run: removeGroup } = useSafeMutation(api.users.removeGroup)
  const [draft, setDraft] = useState<GroupRow | null>(null)
  const blank: GroupRow = { _id: '', name: '', allPlants: true, plantIds: [], permissions: { ...EMPTY_PERMS } }

  const submit = async () => {
    if (!draft) return
    const ok = await saveGroup({
      ...(draft._id ? { id: draft._id } : {}),
      companyId,
      name: draft.name,
      allPlants: draft.allPlants,
      plantIds: draft.plantIds,
      permissions: { ...EMPTY_PERMS, ...draft.permissions },
      board: draft.board === true,
    })
    if (ok) setDraft(null)
  }

  return (
    <div>
      <ErrorBanner message={error} onDismiss={clearError} />
      <div className="mt-2 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Group</th>
              <th className="px-3 py-2 font-medium">Plants</th>
              {MODULES.map((m) => (
                <th key={m} className="px-3 py-2 font-medium">
                  {MODULE_LABELS[m]}
                </th>
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g._id} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{g.name}</td>
                <td className="px-3 py-2 text-xs">
                  {g.allPlants ? 'All plants' : plants.filter((p) => g.plantIds.includes(p._id)).map((p) => p.name).join(', ') || '—'}
                  {g.board && <span className="ml-1 rounded bg-muted px-1">board view</span>}
                </td>
                {MODULES.map((m) => (
                  <td key={m} className="px-3 py-2 text-xs">
                    {g.permissions[m] ?? 'none'}
                  </td>
                ))}
                <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                  <button className="underline" onClick={() => setDraft({ ...g, permissions: { ...EMPTY_PERMS, ...g.permissions } })}>
                    Edit
                  </button>
                  <button
                    className="ml-2 text-destructive hover:underline"
                    onClick={() => window.confirm(`Delete the group ${g.name}? Its members lose its permissions.`) && void removeGroup({ id: g._id })}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!draft && (
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          <button className="underline" onClick={() => setDraft(blank)}>
            + Add group
          </button>
          {/* Şablonlar: düzenlenip kaydedilir. */}
          <button
            className="underline"
            title="Sees every plant of the company (also plants added later), changes nothing"
            onClick={() => setDraft({ ...blank, name: 'Board members', allPlants: true, board: true, permissions: { planning: 'none', oee: 'view', die: 'none', machine: 'none', kpi: 'view' } })}
          >
            + Board members (all plants, KPI and OEE summary)
          </button>
          {plants.map((p) => (
            <button
              key={p._id}
              className="underline"
              title={`Sees only ${p.name}; edits OEE, views the rest`}
              onClick={() => setDraft({ ...blank, name: `Plant manager — ${p.name}`, allPlants: false, plantIds: [p._id], permissions: { planning: 'view', oee: 'edit', die: 'view', machine: 'view', kpi: 'edit' } })}
            >
              + Plant manager — {p.name}
            </button>
          ))}
        </div>
      )}
      {draft && (
        <div className="mt-3 space-y-2 rounded-lg border border-border p-3 text-sm">
          <label className="block text-xs text-muted-foreground">
            Group name (e.g. Board members, Plant 1 — planning engineers)
            <input className={`mt-1 block w-72 ${input}`} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={draft.allPlants} onChange={(e) => setDraft({ ...draft, allPlants: e.target.checked })} /> All plants of the company (also plants added later)
            </label>
            <label className="flex items-center gap-1" title="Members see only the Board Dashboard and the KPI / OEE dashboards (read only) — no entry pages, plan or follow-up details">
              <input type="checkbox" checked={draft.board === true} onChange={(e) => setDraft({ ...draft, board: e.target.checked })} /> Board view (summary only)
            </label>
            {!draft.allPlants &&
              plants.map((p) => (
                <label key={p._id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={draft.plantIds.includes(p._id)}
                    onChange={(e) => setDraft({ ...draft, plantIds: e.target.checked ? [...draft.plantIds, p._id] : draft.plantIds.filter((x) => x !== p._id) })}
                  />
                  {p.name}
                </label>
              ))}
          </div>
          <div className="flex flex-wrap gap-3">
            {MODULES.map((m) => (
              <label key={m} className="text-xs text-muted-foreground">
                {MODULE_LABELS[m]}
                <select className={`mt-1 block ${input}`} value={draft.permissions[m] ?? 'none'} onChange={(e) => setDraft({ ...draft, permissions: { ...draft.permissions, [m]: e.target.value as Level } })}>
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l === 'none' ? 'No access' : l === 'view' ? 'Views' : 'Edits'}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button className={btn} disabled={!draft.name.trim()} onClick={() => void submit()}>
              Save group
            </button>
            <button className="text-xs underline" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
