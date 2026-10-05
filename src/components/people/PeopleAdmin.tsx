import { useMemo, useRef, useState, type ReactNode } from 'react'

import { api } from '../../../convex/_generated/api'
import { useAction, useMutation, useQuery } from '../../lib/convexTransport'
import { validatePassword } from '../../lib/authRules'
import { useCurrentUser } from '../../lib/currentUser'
import { friendlyError } from '../../lib/mutationErrors'
import {
  draftAreaLevel,
  groupDraft,
  groupPayload,
  groupRow,
  peopleTree,
  samePeopleNode,
  userAreas,
  type GroupDraft,
  type PeopleGroup,
  type PeopleNode,
  type PeopleUser,
} from '../../lib/peopleTree'
import { AREAS, MODULES, MODULE_LABELS, areasOf, moduleAccessOf, type AreaAccess, type CompanyStatus, type Level, type Module } from '../../lib/tenancy'
import { formatPlantTime } from '../../lib/sapUploads'
import { useSafeMutation } from '../../lib/useSafeMutation'
import { ErrorBanner } from '../ErrorBanner'
import { LevelChip, TreeRow } from '../OrgTree'
import { InfoTip } from '../PageHeader'

/**
 * Users & permissions (Company settings): şirket → gruplar → kullanıcılar
 * ağacı solda, seçilen düğümün paneli sağda. İzin kuralı src/lib/tenancy.ts
 * (sunucu aynı kuralla denetler): grup her modüle bir seviye verir, alanları
 * ayrıca daraltabilir / genişletebilir; birden çok grubun en genişi geçerli.
 */

interface CompanyRow {
  _id: string
  name: string
  status: CompanyStatus
  modules: string[]
  plants: { _id: string; companyId: string; name: string; disabledModules?: string[] }[]
}

const input = 'rounded-md border border-input bg-background px-2 py-1.5 text-sm'
const btn = 'rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40'
const td = 'px-3 py-2'

// ---- Rozetler -----------------------------------------------------------------

type PeopleKind = 'group' | 'user' | 'creator' | 'board'
const PEOPLE_CHIP: Record<PeopleKind, { short: string; cls: string; title: string }> = {
  group: { short: 'G', cls: 'bg-violet-600 text-white', title: 'Group' },
  board: { short: 'B', cls: 'bg-indigo-500 text-white', title: 'Board group' },
  user: { short: 'U', cls: 'bg-slate-600 text-white', title: 'User' },
  creator: { short: 'CR', cls: 'bg-amber-500 text-white', title: 'Creator' },
}

function Chip({ kind, className = '' }: { kind: PeopleKind; className?: string }) {
  const c = PEOPLE_CHIP[kind]
  return (
    <span title={c.title} className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 text-[10px] font-bold ${c.cls} ${className}`}>
      {c.short}
    </span>
  )
}

const MODULE_SHORT: Record<Module, string> = { planning: 'Plan', oee: 'OEE', die: 'Die', machine: 'Machine', kpi: 'KPI' }

const LEVEL_TEXT: Record<Level, string> = { none: 'No access', view: 'Views', edit: 'Edits' }

/** İzin hücresi: düzenler = dolu, görür = çerçeve, yok = çizgi. */
function LevelCell({ level, title, text }: { level: Level; title?: string; text?: string }) {
  if (level === 'none')
    return (
      <span title={title ?? LEVEL_TEXT.none} className="text-xs text-muted-foreground/60">
        —
      </span>
    )
  return (
    <span
      title={title ?? LEVEL_TEXT[level]}
      className={`inline-block rounded px-1.5 py-px text-[10px] font-semibold ${level === 'edit' ? 'bg-emerald-600 text-white' : 'border border-emerald-600 text-emerald-700'}`}
    >
      {text ?? (level === 'edit' ? 'Edit' : 'View')}
    </span>
  )
}

function Legend() {
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" aria-label="Levels">
      {(
        [
          ['company', 'Company'],
          ['group', 'Group'],
          ['user', 'User'],
        ] as const
      ).map(([k, label], i) => (
        <li key={k} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>→</span>}
          <span className="flex items-center gap-1 rounded-full border border-border bg-background py-0.5 pr-2 pl-0.5">
            {k === 'company' ? <LevelChip level="company" className="rounded-full" /> : <Chip kind={k} className="rounded-full" />}
            <span className="font-medium text-foreground">{label}</span>
          </span>
        </li>
      ))}
      <li className="ml-3 flex items-center gap-1.5">
        <LevelCell level="edit" /> edits
        <LevelCell level="view" /> views
        <LevelCell level="none" /> no access
      </li>
    </ol>
  )
}

// ---- Sayfa --------------------------------------------------------------------

export function PeopleAdmin({ companyId }: { companyId: string }) {
  const company = ((useQuery(api.platform.companies) ?? []) as CompanyRow[]).find((c) => c._id === companyId)
  const users = ((useQuery(api.users.list, { companyId }) ?? []) as PeopleUser[]).filter((u) => !u.platformRole)
  const groups = (useQuery(api.users.listGroups, { companyId }) ?? []) as PeopleGroup[]
  const [node, setNode] = useState<PeopleNode>({ kind: 'company' })
  const detailRef = useRef<HTMLDivElement>(null)
  const tree = useMemo(() => peopleTree(users, groups), [users, groups])

  const select = (n: PeopleNode) => {
    setNode(n)
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }
  if (!company) return <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
  const modules = MODULES.filter((m) => company.modules.includes(m))
  const is = (n: PeopleNode) => samePeopleNode(node, n)
  const userRow = (u: PeopleUser, via?: string) => (
    <TreeRow
      key={`${via ?? ''}${u._id}`}
      level="workCenter"
      chip={<Chip kind={u.isCreator ? 'creator' : 'user'} />}
      label={u.name}
      muted={!u.active}
      warn={!u.hasPassword || !!u.locked}
      meta={!u.active ? 'inactive' : u.locked ? 'locked' : !u.hasPassword ? 'no password' : undefined}
      selected={node.kind === 'user' && node.id === u._id && node.via === via}
      onSelect={() => select({ kind: 'user', id: u._id, via })}
      open={false}
    />
  )

  return (
    <div>
      <div className="mt-3">
        <Legend />
      </div>

      {tree.noGroup.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50/70 p-3 text-xs text-amber-950">
          <button className="text-left underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700" onClick={() => select({ kind: 'noGroup' })}>
            {tree.noGroup.length} user{tree.noGroup.length === 1 ? '' : 's'} without a group see nothing: {tree.noGroup.map((u) => u.name).join(', ')}
          </button>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(280px,340px)_1fr]">
        <aside className="min-w-0 rounded-lg border border-border bg-card p-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Structure</h2>
          <div className="mb-2 flex gap-1.5">
            <button className="flex-1 rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-foreground" onClick={() => select({ kind: 'newGroup' })}>
              + New group
            </button>
            <button className="flex-1 rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-foreground" onClick={() => select({ kind: 'newUser' })}>
              + New user
            </button>
          </div>
          <TreeRow level="company" label={company.name} meta={`${users.length} users`} selected={is({ kind: 'company' })} onSelect={() => select({ kind: 'company' })} open>
            <TreeRow
              level="company"
              chip={<Chip kind="creator" />}
              label="Creators"
              meta={`${tree.creators.length} · everything`}
              selected={is({ kind: 'creators' })}
              onSelect={() => select({ kind: 'creators' })}
              open
              onToggle={undefined}
            >
              {tree.creators.map((u) => userRow(u, 'creators'))}
            </TreeRow>
            {tree.groups.map(({ group: g, members }) => (
              <TreeRow
                key={g._id}
                level="company"
                chip={<Chip kind={g.board ? 'board' : 'group'} />}
                label={g.name}
                meta={`${members.length} · ${g.allPlants ? 'all plants' : `${g.plantIds.length} plant${g.plantIds.length === 1 ? '' : 's'}`}`}
                warn={members.length === 0}
                selected={is({ kind: 'group', id: g._id })}
                onSelect={() => select({ kind: 'group', id: g._id })}
                open
              >
                {members.map((u) => userRow(u, g._id))}
              </TreeRow>
            ))}
            {tree.noGroup.length > 0 && (
              <TreeRow
                level="company"
                chip={<Chip kind="user" />}
                label="Without a group"
                dashed
                warn
                meta={`${tree.noGroup.length}`}
                selected={is({ kind: 'noGroup' })}
                onSelect={() => select({ kind: 'noGroup' })}
                open
              >
                {tree.noGroup.map((u) => userRow(u, 'noGroup'))}
              </TreeRow>
            )}
          </TreeRow>
        </aside>

        <main ref={detailRef} className="min-w-0 scroll-mt-4">
          <div className="rounded-lg border border-border bg-card p-4">
            {node.kind === 'company' && <CompanyOverview company={company} modules={modules} users={users} groups={groups} tree={tree} onSelect={select} />}
            {node.kind === 'creators' && <UserList title="Creators" kind="creator" hint="A creator manages the whole company: every plant, every module, users and groups. No group needed." users={tree.creators} onSelect={select} />}
            {node.kind === 'noGroup' && (
              <UserList title="Without a group" kind="user" hint="These users can sign in but see no plant. Put each in a group (or make them a creator)." users={tree.noGroup} onSelect={select} />
            )}
            {node.kind === 'group' && groups.find((g) => g._id === node.id) && (
              <GroupPanel
                key={node.id}
                companyId={companyId}
                company={company}
                modules={modules}
                group={groups.find((g) => g._id === node.id)!}
                users={users}
                onSelect={select}
              />
            )}
            {node.kind === 'newGroup' && <GroupPanel key="new" companyId={companyId} company={company} modules={modules} users={users} onSelect={select} />}
            {node.kind === 'user' && users.find((u) => u._id === node.id) && (
              <UserPanel key={node.id} companyId={companyId} company={company} modules={modules} user={users.find((u) => u._id === node.id)!} groups={groups} onSelect={select} />
            )}
            {node.kind === 'newUser' && <NewUser companyId={companyId} groups={groups} onSelect={select} />}
          </div>
        </main>
      </div>
    </div>
  )
}

// ---- Şirket özeti ve matris -----------------------------------------------------

function Stats({ items }: { items: { label: string; value: number; chip?: ReactNode }[] }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      {items.map((s) => (
        <div key={s.label} className="rounded-md border border-border bg-background px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {s.chip}
            {s.label}
          </div>
          <div className="mt-0.5 text-lg font-semibold text-foreground tabular-nums">{s.value}</div>
        </div>
      ))}
    </div>
  )
}

/** Matris başlığı: modüller ve altında alanları (yalnızca şirketin kiraladıkları). */
function AreaHead({ modules, first }: { modules: Module[]; first: ReactNode }) {
  return (
    <thead className="bg-muted text-xs text-muted-foreground">
      <tr>
        <th rowSpan={2} className="sticky left-0 bg-muted px-3 py-2 text-left font-medium">
          {first}
        </th>
        {modules.map((m) => (
          <th key={m} colSpan={areasOf(m).length} className="border-l border-border px-2 pt-2 pb-1 text-center font-semibold text-foreground">
            {MODULE_LABELS[m]}
          </th>
        ))}
      </tr>
      <tr>
        {modules.flatMap((m) =>
          areasOf(m).map((a, i) => (
            <th key={a.key} title={a.hint} className={`px-2 pb-2 text-center text-[11px] font-normal whitespace-nowrap ${i === 0 ? 'border-l border-border' : ''}`}>
              {a.label}
            </th>
          )),
        )}
      </tr>
    </thead>
  )
}

function AreaCells({ modules, row }: { modules: Module[]; row: AreaAccess }) {
  return (
    <>
      {modules.flatMap((m) =>
        areasOf(m).map((a, i) => (
          <td key={a.key} className={`px-2 py-2 text-center ${i === 0 ? 'border-l border-border' : ''}`}>
            <LevelCell level={row[a.key]} title={`${MODULE_LABELS[m]} · ${a.label}: ${LEVEL_TEXT[row[a.key]]}`} />
          </td>
        )),
      )}
    </>
  )
}

const ALL_EDIT = Object.fromEntries(AREAS.map((a) => [a.key, 'edit'])) as AreaAccess

function CompanyOverview({
  company,
  modules,
  users,
  groups,
  tree,
  onSelect,
}: {
  company: CompanyRow
  modules: Module[]
  users: PeopleUser[]
  groups: PeopleGroup[]
  tree: ReturnType<typeof peopleTree>
  onSelect: (n: PeopleNode) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <LevelChip level="company" className="h-6 min-w-6 text-xs" />
        <h2 className="text-lg font-semibold text-foreground">{company.name}</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Who may see and change what — by group, by area of each module, by plant.</p>
      <Stats
        items={[
          { label: 'Users', value: users.length, chip: <Chip kind="user" /> },
          { label: 'Active', value: users.filter((u) => u.active).length },
          { label: 'Creators', value: tree.creators.length, chip: <Chip kind="creator" /> },
          { label: 'Groups', value: groups.length, chip: <Chip kind="group" /> },
          { label: 'Without a group', value: tree.noGroup.length },
        ]}
      />

      <h3 className="mt-6 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        Permission matrix — groups × areas
        <InfoTip label="How permissions work">
          <p>
            A group gives its members <b>plants</b> and a level per <b>module</b> (no access · views · edits). Each module is split into
            <b> areas</b>; an area can be set apart from its module — e.g. PlanningExpert <i>views</i>, only Work calendar <i>edits</i>.
          </p>
          <p>A person in several groups gets the widest level of each area. A creator edits everything and needs no group.</p>
          <p>
            Viewing a module opens its pages; editing an area allows its changes (the server checks every change). A module the company
            does not rent, or that is switched off for a plant, is closed there for everyone.
          </p>
        </InfoTip>
      </h3>
      <div className="mt-2 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <AreaHead modules={modules} first="Group" />
          <tbody>
            <tr className="border-t border-border">
              <td className={`${td} sticky left-0 bg-card`}>
                <button className="flex items-center gap-1.5 whitespace-nowrap hover:underline" onClick={() => onSelect({ kind: 'creators' })}>
                  <Chip kind="creator" /> Creators
                </button>
              </td>
              <AreaCells modules={modules} row={ALL_EDIT} />
            </tr>
            {tree.groups.map(({ group: g, members }) => (
              <tr key={g._id} className="border-t border-border">
                <td className={`${td} sticky left-0 bg-card`}>
                  <button className="flex items-center gap-1.5 whitespace-nowrap hover:underline" onClick={() => onSelect({ kind: 'group', id: g._id })}>
                    <Chip kind={g.board ? 'board' : 'group'} /> {g.name}
                    <span className="text-[11px] text-muted-foreground">({members.length})</span>
                  </button>
                </td>
                <AreaCells modules={modules} row={groupRow(g)} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {groups.length === 0 && <p className="mt-2 text-xs text-muted-foreground">No group yet — “+ New group” on the left.</p>}

      <h3 className="mt-6 text-sm font-semibold text-foreground">Who sees which plant</h3>
      <p className="text-xs text-muted-foreground">Per plant, the modules each user opens (widest area). Click a user for the area detail.</p>
      <div className="mt-2 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">User</th>
              {company.plants.map((p) => (
                <th key={p._id} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                  <span className="flex items-center gap-1">
                    <LevelChip level="plant" /> {p.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...users]
              .sort((a, b) => Number(b.isCreator) - Number(a.isCreator) || a.name.localeCompare(b.name))
              .map((u) => (
                <tr key={u._id} className={`border-t border-border ${u.active ? '' : 'opacity-50'}`}>
                  <td className={td}>
                    <button className="flex items-center gap-1.5 font-medium whitespace-nowrap hover:underline" onClick={() => onSelect({ kind: 'user', id: u._id })}>
                      <Chip kind={u.isCreator ? 'creator' : 'user'} /> {u.name}
                    </button>
                  </td>
                  {company.plants.map((p) => {
                    const access = moduleAccessOf(userAreas(u, company._id, p, company, groups))
                    const open = MODULES.filter((m) => access[m] !== 'none')
                    return (
                      <td key={p._id} className={td}>
                        {open.length ? (
                          <span className="flex flex-wrap gap-1">
                            {open.map((m) => (
                              <LevelCell key={m} level={access[m]} text={MODULE_SHORT[m]} title={`${MODULE_LABELS[m]}: ${LEVEL_TEXT[access[m]]}`} />
                            ))}
                          </span>
                        ) : (
                          <LevelCell level="none" />
                        )}
                        {open.length > 0 && <span className="sr-only">{open.map((m) => MODULE_LABELS[m]).join(', ')}</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Filled = edits at least one area of the module, outlined = views.</p>
    </div>
  )
}

function UserList({ title, kind, hint, users, onSelect }: { title: string; kind: PeopleKind; hint: string; users: PeopleUser[]; onSelect: (n: PeopleNode) => void }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Chip kind={kind} className="h-6 min-w-6 text-xs" />
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
        {users.map((u) => (
          <li key={u._id}>
            <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onSelect({ kind: 'user', id: u._id })}>
              <Chip kind={u.isCreator ? 'creator' : 'user'} />
              <span className="font-medium">{u.name}</span>
              <span className="text-xs text-muted-foreground">{u.email}</span>
              {!u.active && <span className="ml-auto text-xs text-muted-foreground">inactive</span>}
            </button>
          </li>
        ))}
        {users.length === 0 && <li className="px-3 py-4 text-center text-xs text-muted-foreground">Nobody.</li>}
      </ul>
    </div>
  )
}

// ---- Grup ---------------------------------------------------------------------

function LevelSelect({ value, onChange, inherit, className = '' }: { value: Level | ''; onChange: (v: Level | '') => void; inherit?: Level; className?: string }) {
  return (
    <select className={`${input} py-1 text-xs ${className}`} value={value} onChange={(e) => onChange(e.target.value as Level | '')}>
      {inherit !== undefined && <option value="">Same as module ({LEVEL_TEXT[inherit].toLowerCase()})</option>}
      <option value="none">No access</option>
      <option value="view">Views</option>
      <option value="edit">Edits</option>
    </select>
  )
}

function GroupPanel({
  companyId,
  company,
  modules,
  group,
  users,
  onSelect,
}: {
  companyId: string
  company: CompanyRow
  modules: Module[]
  group?: PeopleGroup
  users: PeopleUser[]
  onSelect: (n: PeopleNode) => void
}) {
  const save = useMutation(api.users.saveGroup)
  const { run: removeGroup, error: removeError } = useSafeMutation(api.users.removeGroup)
  const { run: updateUser, error: updateError } = useSafeMutation(api.users.update)
  const [d, setD] = useState<GroupDraft>(() => groupDraft(group))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const base = useMemo(() => JSON.stringify(groupPayload(groupDraft(group))), [group])
  const dirty = JSON.stringify(groupPayload(d)) !== base
  const members = group ? users.filter((u) => !u.isCreator && u.groupIds.includes(group._id)) : []
  const others = group ? users.filter((u) => !u.isCreator && !u.groupIds.includes(group._id)) : []

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      const id = await save({ id: group?._id, companyId, ...groupPayload(d) })
      if (!group && id) onSelect({ kind: 'group', id })
    } catch (e) {
      setError(friendlyError(e).message)
    } finally {
      setSaving(false)
    }
  }
  const setMember = (u: PeopleUser, on: boolean) =>
    void updateUser({
      id: u._id,
      name: u.name,
      email: u.email || undefined,
      active: u.active,
      isCreator: u.isCreator,
      groupIds: on ? [...u.groupIds, group!._id] : u.groupIds.filter((x) => x !== group!._id),
    })

  return (
    <div>
      <ErrorBanner message={error ?? removeError ?? updateError} onDismiss={() => setError(null)} />
      <div className="flex flex-wrap items-center gap-2">
        <Chip kind={d.board ? 'board' : 'group'} className="h-6 min-w-6 text-xs" />
        <input className={`w-64 font-semibold ${input}`} placeholder="Group name, e.g. Planners — Romania" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} aria-label="Group name" />
        <button className={btn} disabled={!d.name.trim() || !dirty || saving} onClick={() => void submit()}>
          {saving ? 'Saving…' : group ? 'Save' : 'Create group'}
        </button>
        {dirty && group && (
          <button className="text-xs underline" onClick={() => setD(groupDraft(group))}>
            Discard
          </button>
        )}
        {group && (
          <button
            className="ml-auto text-xs text-destructive hover:underline"
            onClick={() => {
              if (window.confirm(`Delete the group ${group.name}? Its members lose what the group gave them.`)) {
                void removeGroup({ id: group._id }).then((ok) => ok && onSelect({ kind: 'company' }))
              }
            }}
          >
            Delete group
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {group ? `${members.length} member${members.length === 1 ? '' : 's'}` : 'New group'} · changes apply when saved
      </p>

      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={d.board} onChange={(e) => setD({ ...d, board: e.target.checked })} />
        <span>
          Board group
          <span className="block text-xs text-muted-foreground">Members use the board view only: Board Dashboard and the KPI / OEE dashboards, read only.</span>
        </span>
      </label>

      <h3 className="mt-5 text-sm font-semibold text-foreground">Plants</h3>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={d.allPlants} onChange={(e) => setD({ ...d, allPlants: e.target.checked })} />
          All plants <span className="text-xs text-muted-foreground">(plants added later too)</span>
        </label>
        {!d.allPlants &&
          company.plants.map((p) => (
            <label key={p._id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={d.plantIds.includes(p._id)}
                onChange={(e) => setD({ ...d, plantIds: e.target.checked ? [...d.plantIds, p._id] : d.plantIds.filter((x) => x !== p._id) })}
              />
              <LevelChip level="plant" /> {p.name}
            </label>
          ))}
      </div>

      <h3 className="mt-5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        Permissions
        <InfoTip label="Module and area levels">
          <p>The module level applies to all its areas. Set an area apart only where it differs — e.g. PlanningExpert views, Work calendar edits.</p>
          <p>“Same as module” follows the module when it changes later.</p>
        </InfoTip>
      </h3>
      <div className="mt-2 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Module / area</th>
              <th className="px-3 py-2 text-left font-medium">Level</th>
              <th className="px-3 py-2 text-left font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <ModuleRows key={m} module={m} d={d} setD={setD} />
            ))}
          </tbody>
        </table>
      </div>
      {modules.length < MODULES.length && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Not rented by the company: {MODULES.filter((m) => !modules.includes(m)).map((m) => MODULE_LABELS[m]).join(', ')}.
        </p>
      )}

      {group && (
        <>
          <h3 className="mt-5 text-sm font-semibold text-foreground">Members</h3>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {members.map((u) => (
              <span key={u._id} className="flex items-center gap-1 rounded-full border border-border bg-background py-0.5 pr-1 pl-0.5 text-sm">
                <Chip kind="user" className="rounded-full" />
                <button className="hover:underline" onClick={() => onSelect({ kind: 'user', id: u._id })}>
                  {u.name}
                </button>
                <button
                  className="px-1 text-destructive"
                  title={`Take ${u.name} out of ${group.name}`}
                  onClick={() => window.confirm(`Take ${u.name} out of ${group.name}?`) && setMember(u, false)}
                >
                  ×
                </button>
              </span>
            ))}
            {members.length === 0 && <span className="text-xs text-muted-foreground">No member yet.</span>}
            {others.length > 0 && (
              <select
                className={`${input} py-1 text-xs`}
                value=""
                onChange={(e) => {
                  const u = others.find((x) => x._id === e.target.value)
                  if (u) setMember(u, true)
                }}
              >
                <option value="">+ Add a member…</option>
                {others.map((u) => (
                  <option key={u._id} value={u._id}>
                    {u.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function ModuleRows({ module: m, d, setD }: { module: Module; d: GroupDraft; setD: (d: GroupDraft) => void }) {
  return (
    <>
      <tr className="border-t border-border bg-muted/40">
        <td className={`${td} font-semibold text-foreground`}>{MODULE_LABELS[m]}</td>
        <td className={td}>
          <LevelSelect value={d.modules[m]} onChange={(v) => setD({ ...d, modules: { ...d.modules, [m]: (v || 'none') as Level } })} />
        </td>
        <td className={td}>
          <LevelCell level={d.modules[m]} />
        </td>
      </tr>
      {areasOf(m).map((a) => {
        const level = draftAreaLevel(d, a.key)
        const own = d.areas[a.key]
        return (
          <tr key={a.key} className="border-t border-border">
            <td className={`${td} pl-8`}>
              <span className="block text-sm">{a.label}</span>
              <span className="block text-[11px] text-muted-foreground">{a.hint}</span>
            </td>
            <td className={td}>
              <LevelSelect
                value={own && own !== d.modules[m] ? own : ''}
                inherit={d.modules[m]}
                onChange={(v) => setD({ ...d, areas: { ...d.areas, [a.key]: v } })}
                className={own && own !== d.modules[m] ? 'border-violet-500' : ''}
              />
            </td>
            <td className={td}>
              <LevelCell level={level} />
            </td>
          </tr>
        )
      })}
    </>
  )
}

// ---- Kullanıcı -----------------------------------------------------------------

function UserPanel({
  companyId,
  company,
  modules,
  user: u,
  groups,
  onSelect,
}: {
  companyId: string
  company: CompanyRow
  modules: Module[]
  user: PeopleUser
  groups: PeopleGroup[]
  onSelect: (n: PeopleNode) => void
}) {
  const { token, name: me } = useCurrentUser()
  const { run: update, error: updateError, clearError } = useSafeMutation(api.users.update)
  const { run: remove, error: removeError } = useSafeMutation(api.users.remove)
  const { run: signOutAll, error: signOutError } = useSafeMutation(api.users.signOutEverywhere)
  const [signedOut, setSignedOut] = useState<number | null>(null)
  const setPassword = useAction(api.auth.setPasswordAsAdmin)
  const initial = { name: u.name, email: u.email ?? '', active: u.active, isCreator: u.isCreator, groupIds: [...u.groupIds].sort() }
  const [d, setD] = useState(initial)
  const [pw, setPw] = useState('')
  const [pwOpen, setPwOpen] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwDone, setPwDone] = useState(false)
  const dirty = JSON.stringify(d) !== JSON.stringify(initial)
  const preview: PeopleUser = { ...u, ...d }

  return (
    <div>
      <ErrorBanner message={updateError ?? removeError ?? signOutError ?? pwError} onDismiss={() => (clearError(), setPwError(null))} />
      <div className="flex flex-wrap items-center gap-2">
        <Chip kind={d.isCreator ? 'creator' : 'user'} className="h-6 min-w-6 text-xs" />
        <input className={`w-48 font-semibold ${input}`} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} aria-label="Name" />
        <input className={`w-56 ${input}`} placeholder="Email (optional)" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} aria-label="Email" />
        <button
          className={btn}
          disabled={!dirty || !d.name.trim()}
          onClick={() => void update({ id: u._id, name: d.name.trim(), email: d.email.trim() || undefined, active: d.active, isCreator: d.isCreator, groupIds: d.groupIds })}
        >
          Save
        </button>
        {dirty && (
          <button className="text-xs underline" onClick={() => setD(initial)}>
            Discard
          </button>
        )}
        {u.name !== me && (
          <button
            className="ml-auto text-xs text-destructive hover:underline"
            onClick={() => {
              if (window.confirm(`Delete ${u.name}? Their past entries keep their name; only the account goes.`)) {
                void remove({ id: u._id }).then((ok) => ok && onSelect({ kind: 'company' }))
              }
            }}
          >
            Delete user
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={d.active} disabled={u.name === me} onChange={(e) => setD({ ...d, active: e.target.checked })} /> Active
          <span className="text-xs text-muted-foreground">(an inactive user cannot sign in)</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={d.isCreator} onChange={(e) => setD({ ...d, isCreator: e.target.checked })} /> Creator
          <span className="text-xs text-muted-foreground">(every plant, every module, users and groups)</span>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
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
            if (window.confirm(`Sign ${u.name} out on every device?`)) void signOutAll({ id: u._id }).then((ok) => ok && setSignedOut(1))
          }}
        >
          Sign out everywhere
        </button>
        {signedOut !== null && <span className="text-xs text-emerald-700">signed out on every device</span>}
      </div>

      <div className="mt-3 text-sm">
        <span className="text-xs text-muted-foreground">Password: </span>
        {!u.hasPassword ? <span className="text-destructive">not set — cannot sign in</span> : u.mustChangePassword ? <span className="text-amber-700">temporary — changes it at the next sign-in</span> : <span>set</span>}
        {pwDone && <span className="ml-2 text-emerald-700">temporary password set</span>}
        {pwOpen ? (
          <span className="ml-2 inline-flex flex-wrap items-center gap-1">
            <input type="password" autoComplete="new-password" className={`w-44 ${input}`} placeholder="Temporary password" value={pw} onChange={(e) => setPw(e.target.value)} />
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

      {!d.isCreator && (
        <>
          <h3 className="mt-5 text-sm font-semibold text-foreground">Groups</h3>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {groups.map((g) => (
              <label key={g._id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={d.groupIds.includes(g._id)}
                  onChange={(e) => setD({ ...d, groupIds: (e.target.checked ? [...d.groupIds, g._id] : d.groupIds.filter((x) => x !== g._id)).sort() })}
                />
                <Chip kind={g.board ? 'board' : 'group'} /> {g.name}
              </label>
            ))}
            {groups.length === 0 && <span className="text-xs text-muted-foreground">No group yet.</span>}
          </div>
        </>
      )}

      <h3 className="mt-5 text-sm font-semibold text-foreground">What {d.name || 'this user'} may do{dirty ? ' (with the unsaved changes)' : ''}</h3>
      <p className="text-xs text-muted-foreground">Widest level of the user's groups, per plant and area. The server checks the same rule on every change.</p>
      <div className="mt-2 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <AreaHead modules={modules} first="Plant" />
          <tbody>
            {company.plants.map((p) => (
              <tr key={p._id} className="border-t border-border">
                <td className={`${td} sticky left-0 bg-card whitespace-nowrap`}>
                  <span className="flex items-center gap-1.5">
                    <LevelChip level="plant" /> {p.name}
                  </span>
                </td>
                <AreaCells modules={modules} row={userAreas(preview, companyId, p, company, groups)} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function NewUser({ companyId, groups, onSelect }: { companyId: string; groups: PeopleGroup[]; onSelect: (n: PeopleNode) => void }) {
  const add = useMutation(api.users.add)
  const [d, setD] = useState({ name: '', email: '', isCreator: false, groupIds: [] as string[] })
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    setError(null)
    try {
      const id = await add({ companyId, name: d.name.trim(), email: d.email.trim() || undefined, isCreator: d.isCreator, groupIds: d.groupIds })
      if (id) onSelect({ kind: 'user', id })
    } catch (e) {
      setError(friendlyError(e).message)
    }
  }
  return (
    <div>
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <div className="flex items-center gap-2">
        <Chip kind="user" className="h-6 min-w-6 text-xs" />
        <h2 className="text-lg font-semibold text-foreground">New user</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">After adding, set a temporary password; the user replaces it at the first sign-in.</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">
          Name
          <input autoFocus className={`mt-1 block w-48 ${input}`} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && d.name.trim() && void submit()} />
        </label>
        <label className="text-xs text-muted-foreground">
          Email (optional)
          <input className={`mt-1 block w-56 ${input}`} value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} />
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-sm">
          <input type="checkbox" checked={d.isCreator} onChange={(e) => setD({ ...d, isCreator: e.target.checked })} /> Creator
        </label>
      </div>
      {!d.isCreator && (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">Groups</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {groups.map((g) => (
              <label key={g._id} className="flex items-center gap-1.5">
                <input type="checkbox" checked={d.groupIds.includes(g._id)} onChange={(e) => setD({ ...d, groupIds: e.target.checked ? [...d.groupIds, g._id] : d.groupIds.filter((x) => x !== g._id) })} />
                <Chip kind={g.board ? 'board' : 'group'} /> {g.name}
              </label>
            ))}
            {groups.length === 0 && <span className="text-xs text-muted-foreground">No group yet — create one first, or add the user and put them in a group later.</span>}
          </div>
        </div>
      )}
      <button className={`${btn} mt-4`} disabled={!d.name.trim()} onClick={() => void submit()}>
        Add user
      </button>
    </div>
  )
}
