import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { api } from '../../convex/_generated/api'
import { CompanyGroups, CompanyUsers, type GroupRow, type UserRow } from '../components/CompanyAdmin'
import { ErrorBanner } from '../components/ErrorBanner'
import { LevelChip, LevelLegend, OrgTree, type Level } from '../components/OrgTree'
import { PageHeader } from '../components/PageHeader'
import { SaveStatus } from '../components/SaveStatus'
import { UnsavedBar } from '../components/UnsavedBar'
import { useQuery, useQueryOnce } from '../lib/convexTransport'
import {
  accessSummary,
  addCostCenter,
  addDepartment,
  companiesOf,
  countsOf,
  departmentsOf,
  editCostCenter,
  plantAccessRows,
  removeCostCenter,
  removeDepartment,
  renameDepartment,
  structureIssues,
  unassignedOf,
  type OrgCompany,
  type OrgCostCenter,
  type OrgGroup,
  type OrgHolding,
  type OrgNode,
  type OrgPlant,
  type OrgUser,
  type PlantStructure,
} from '../lib/orgTree'
import { usePlant } from '../lib/plantContext'
import { useDraftRows } from '../lib/useDraftRows'
import { useSafeMutation } from '../lib/useSafeMutation'
import { MODULES, MODULE_LABELS, type Level as AccessLevel, type Module } from '../lib/tenancy'

export const Route = createFileRoute('/platform')({
  component: PlatformPage,
})

interface CompanyRow extends OrgCompany {
  modules: Module[]
  deleteAfter?: number
  holdingName: string | null
  userCount: number
  creators: string[]
}

/** Tarayıcının bildiği saat dilimleri (öneri listesi). */
const TIME_ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  } catch {
    return []
  }
})()

const input = 'rounded-md border border-input bg-background px-2 py-1.5 text-sm'
const btn = 'rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40'
const ghost = 'rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40'

/**
 * Şirketler ve fabrikalar — organizasyon ağacı (docs/board.md → Organizasyon
 * ağacı): Holding → Company → Plant → Department → Cost center, tepeden aşağı
 * kurulur. Solda ağaç (diyagram), sağda (telefonda altta) seçili düğümün
 * paneli: ayarları ve o seviyenin kullanıcıları.
 * General: holding, şirket, modüller, askıya alma, board üyeleri. Creator:
 * kendi şirketinin plant / bölüm / masraf yerleri, kullanıcıları ve grupları.
 */
function PlatformPage() {
  const { ctx, isPlatform } = usePlant()
  const companies = (useQuery(api.platform.companies) ?? []) as CompanyRow[]
  const platformHoldings = (useQuery(api.platform.holdings, isPlatform ? {} : 'skip') ?? []) as OrgHolding[]
  // Creator holding listesini okuyamaz: kendi şirketinin holding'i yeter.
  const holdings: OrgHolding[] = isPlatform
    ? platformHoldings
    : companies.filter((c) => c.holdingId && c.holdingName).map((c) => ({ _id: c.holdingId!, name: c.holdingName! }))
  const [picked, setPicked] = useState<OrgNode | null>(null)
  // Yeni açılan holding liste güncellenince adıyla bulunup seçilir.
  const [newHolding, setNewHolding] = useState<string | null>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = newHolding && holdings.find((x) => x.name === newHolding)
    if (h) {
      setPicked({ kind: 'holding', id: h._id })
      setNewHolding(null)
    }
  }, [newHolding, holdings])

  const exists = (n: OrgNode | null): n is OrgNode => {
    if (!n) return false
    if (n.kind === 'holding') return holdings.some((h) => h._id === n.id)
    if (n.kind === 'company') return companies.some((c) => c._id === n.id)
    const plant = companies.flatMap((c) => c.plants).find((p) => p._id === (n.kind === 'plant' ? n.id : n.plantId))
    if (!plant || n.kind === 'plant') return !!plant
    return n.department === null ? unassignedOf(plant).length > 0 : (plant.departments ?? []).includes(n.department)
  }
  const fallback: OrgNode | null = holdings[0] ? { kind: 'holding', id: holdings[0]._id } : companies[0] ? { kind: 'company', id: companies[0]._id } : null
  const selected = exists(picked) ? picked : fallback

  const select = (n: OrgNode) => {
    setPicked(n)
    // Telefonda panel ağacın altında: seçince oraya kaydır.
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }

  const issues = structureIssues(holdings, companies)

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title={isPlatform ? 'Companies and plants' : 'Plants of your company'}
        summary="Built from the top down: every company sits in a holding, every cost center in a department of a plant."
        info={
          <>
            <p>
              <b>Holding</b> → <b>Company</b> → <b>Plant</b> → <b>Department</b> → <b>Cost center</b>. A holding comes first;
              a company is opened inside a holding, a plant inside a company, a department inside a plant and a cost center
              inside a department.
            </p>
            <p>Every plant keeps its own data, settings and plan; two plants never see each other's data.</p>
            <p>
              <b>General</b>: opens holdings and companies, chooses the modules a company rents, suspends a company and
              appoints creators and holding board members. Only the site owner adds Generals.
            </p>
            <p>
              <b>Creator</b>: sets up the plants, departments and cost centers of the company, opens users with a
              temporary password and defines groups (plants × module permissions).
            </p>
            <p>
              <b>Suspended</b> company: everybody reads, nobody writes; the data can be deleted 90 days later.
            </p>
          </>
        }
      />
      <div className="mt-3">
        <LevelLegend />
      </div>

      {issues.length > 0 && <IssueList issues={issues} onSelect={select} />}

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <aside className="rounded-lg border border-border bg-card p-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Structure</h2>
          {isPlatform && <AddHolding onAdded={setNewHolding} />}
          {holdings.length === 0 && companies.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {isPlatform ? 'Start with a holding — everything else is built under it.' : 'No company yet.'}
            </p>
          ) : (
            <OrgTree holdings={holdings} companies={companies} selected={selected} onSelect={select} canLink={isPlatform} />
          )}
        </aside>

        <main ref={detailRef} className="min-w-0 scroll-mt-4">
          {selected && <Breadcrumb node={selected} holdings={holdings} companies={companies} onSelect={select} />}
          {selected && (
            <Detail key={JSON.stringify(selected)} node={selected} holdings={holdings} companies={companies} isPlatform={isPlatform} onSelect={select} />
          )}
        </main>
      </div>

      {ctx?.platformRole === 'owner' && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-foreground">Generals</h2>
          <p className="mt-1 text-xs text-muted-foreground">Generals see and manage every holding and company. Only the site owner adds or removes them.</p>
          <CompanyUsers companyId={null} groups={[]} />
        </section>
      )}
    </div>
  )
}

function AddHolding({ onAdded }: { onAdded: (name: string) => void }) {
  const { run: saveHolding, error, clearError } = useSafeMutation(api.platform.saveHolding)
  const [name, setName] = useState('')
  return (
    <div className="mb-3">
      <ErrorBanner message={error} onDismiss={clearError} />
      <div className="flex gap-1.5">
        <input className={`min-w-0 flex-1 ${input}`} placeholder="New holding name" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className={btn}
          disabled={!name.trim()}
          onClick={async () => {
            const n = name.trim()
            if (await saveHolding({ name: n })) {
              setName('')
              onAdded(n)
            }
          }}
        >
          Add holding
        </button>
      </div>
    </div>
  )
}

function IssueList({ issues, onSelect }: { issues: { text: string; node: OrgNode }[]; onSelect: (n: OrgNode) => void }) {
  const [open, setOpen] = useState(false)
  const shown = open ? issues : issues.slice(0, 3)
  return (
    <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50/70 p-3 text-xs text-amber-950">
      <p className="font-medium">
        {issues.length} thing{issues.length === 1 ? '' : 's'} to finish in the structure
      </p>
      <ul className="mt-1 space-y-0.5">
        {shown.map((i) => (
          <li key={i.text}>
            <button className="text-left underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700" onClick={() => onSelect(i.node)}>
              {i.text}
            </button>
          </li>
        ))}
      </ul>
      {issues.length > 3 && (
        <button className="mt-1 font-medium underline" onClick={() => setOpen(!open)}>
          {open ? 'Show less' : `Show all ${issues.length}`}
        </button>
      )}
    </div>
  )
}

/** Seçili düğümün yolu: Holding › Company › Plant › Department (tıklanır). */
function Breadcrumb({ node, holdings, companies, onSelect }: { node: OrgNode; holdings: OrgHolding[]; companies: CompanyRow[]; onSelect: (n: OrgNode) => void }) {
  const crumbs: { level: Level; label: string; node: OrgNode }[] = []
  const plantId = node.kind === 'plant' ? node.id : node.kind === 'department' ? node.plantId : null
  const company = node.kind === 'company' ? companies.find((c) => c._id === node.id) : plantId ? companies.find((c) => c.plants.some((p) => p._id === plantId)) : undefined
  const holding = node.kind === 'holding' ? holdings.find((h) => h._id === node.id) : holdings.find((h) => h._id === company?.holdingId)
  if (holding) crumbs.push({ level: 'holding', label: holding.name, node: { kind: 'holding', id: holding._id } })
  if (company) crumbs.push({ level: 'company', label: company.name, node: { kind: 'company', id: company._id } })
  const plant = company?.plants.find((p) => p._id === plantId)
  if (plant) crumbs.push({ level: 'plant', label: plant.name, node: { kind: 'plant', id: plant._id } })
  if (node.kind === 'department') crumbs.push({ level: 'department', label: node.department ?? 'Without a department', node })
  return (
    <nav aria-label="Path" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden>›</span>}
          <button className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted hover:text-foreground" onClick={() => onSelect(c.node)}>
            <LevelChip level={c.level} />
            {c.label}
          </button>
        </span>
      ))}
    </nav>
  )
}

function Detail({ node, holdings, companies, isPlatform, onSelect }: { node: OrgNode; holdings: OrgHolding[]; companies: CompanyRow[]; isPlatform: boolean; onSelect: (n: OrgNode) => void }) {
  if (node.kind === 'holding') {
    const h = holdings.find((x) => x._id === node.id)
    return h ? <HoldingPanel holding={h} companies={companies} isPlatform={isPlatform} onSelect={onSelect} /> : null
  }
  if (node.kind === 'company') {
    const c = companies.find((x) => x._id === node.id)
    return c ? <CompanyPanel company={c} holdings={holdings} isPlatform={isPlatform} onSelect={onSelect} /> : null
  }
  const plantId = node.kind === 'plant' ? node.id : node.plantId
  const company = companies.find((c) => c.plants.some((p) => p._id === plantId))
  const plant = company?.plants.find((p) => p._id === plantId)
  if (!company || !plant) return null
  if (node.kind === 'plant') return <PlantPanel plant={plant} company={company} isPlatform={isPlatform} onSelect={onSelect} />
  return <DepartmentPanel plant={plant} department={node.department} onSelect={onSelect} />
}

// ---- Ortak parçalar ---------------------------------------------------------------

function Panel({ level, title, badge, actions, children }: { level: Level; title: ReactNode; badge?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <LevelChip level={level} className="h-6 min-w-6 text-xs" />
        <div className="min-w-0 flex-1">{title}</div>
        {badge}
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

function Block({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  )
}

function Stats({ items }: { items: { label: string; value: number; level?: Level }[] }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      {items.map((s) => (
        <div key={s.label} className="rounded-md border border-border bg-background px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {s.level && <LevelChip level={s.level} />}
            {s.label}
          </div>
          <div className="mt-0.5 text-lg font-semibold text-foreground tabular-nums">{s.value}</div>
        </div>
      ))}
    </div>
  )
}

/** Ad düzenleme: değişince Save açılır. */
function NameEditor({ value, onSave, disabled, className = 'w-64' }: { value: string; onSave: (v: string) => Promise<boolean> | void; disabled?: boolean; className?: string }) {
  const [v, setV] = useState(value)
  if (disabled) return <h2 className="truncate text-lg font-semibold text-foreground">{value}</h2>
  return (
    <span className="flex max-w-full items-center gap-1.5">
      <input className={`min-w-0 font-semibold ${className} ${input}`} value={v} onChange={(e) => setV(e.target.value)} aria-label="Name" />
      <button className={btn} disabled={!v.trim() || v.trim() === value} onClick={() => void onSave(v.trim())}>
        Save
      </button>
    </span>
  )
}

function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: string | false }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted text-xs text-muted-foreground">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty && <p className="px-3 py-3 text-xs text-muted-foreground">{empty}</p>}
    </div>
  )
}

const td = 'px-3 py-2 align-middle'

function OpenButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="text-xs font-medium whitespace-nowrap text-primary hover:underline" onClick={onClick}>
      open ›
    </button>
  )
}

const MODULE_SHORT: Record<Module, string> = { planning: 'Plan', oee: 'OEE', die: 'Die', machine: 'Mach', kpi: 'KPI' }

/** Modül izni rozeti: düzenler = dolu, görür = çerçeve. */
function AccessBadges({ access }: { access: Record<Module, AccessLevel> }) {
  const list = accessSummary(access)
  if (!list.length) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <span className="flex flex-wrap gap-1">
      {list.map(({ module, level }) => (
        <span
          key={module}
          title={`${MODULE_LABELS[module]}: ${level === 'edit' ? 'edits' : 'views'}`}
          className={`rounded px-1 py-px text-[10px] font-semibold ${level === 'edit' ? 'bg-emerald-600 text-white' : 'border border-emerald-600 text-emerald-700'}`}
        >
          {MODULE_SHORT[module]}
        </span>
      ))}
    </span>
  )
}

function AccessLegend() {
  return (
    <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
      <span className="rounded bg-emerald-600 px-1 py-px text-[10px] font-semibold text-white">KPI</span> edits
      <span className="rounded border border-emerald-600 px-1 py-px text-[10px] font-semibold text-emerald-700">KPI</span> views
    </p>
  )
}

/** Şirketin kullanıcıları ve grupları (creator ya da General). */
function useCompanyPeople(companyId: string) {
  const users = (useQuery(api.users.list, { companyId }) ?? []) as UserRow[]
  const groups = (useQuery(api.users.listGroups, { companyId }) ?? []) as GroupRow[]
  const orgUsers: OrgUser[] = users.filter((u) => !u.platformRole).map((u) => ({ _id: u._id, name: u.name, active: u.active, isCreator: u.isCreator, groupIds: u.groupIds }))
  const orgGroups: OrgGroup[] = groups.map((g) => ({ ...g, companyId }))
  return { users, groups, orgUsers, orgGroups }
}

// ---- Holding ----------------------------------------------------------------------

function HoldingPanel({ holding: h, companies, isPlatform, onSelect }: { holding: OrgHolding; companies: CompanyRow[]; isPlatform: boolean; onSelect: (n: OrgNode) => void }) {
  const list = companiesOf(h._id, companies) as CompanyRow[]
  const counts = countsOf(list)
  const { run: saveHolding, error, clearError } = useSafeMutation(api.platform.saveHolding)
  const { run: removeHolding, error: removeError } = useSafeMutation(api.platform.removeHolding)
  const { run: createCompany, error: createError } = useSafeMutation(api.platform.createCompany)
  const [name, setName] = useState('')
  return (
    <Panel
      level="holding"
      title={<NameEditor value={h.name} disabled={!isPlatform} onSave={(n) => saveHolding({ id: h._id, name: n })} />}
      actions={
        isPlatform && (
          <button
            className="text-xs text-destructive hover:underline disabled:opacity-40 disabled:hover:no-underline"
            disabled={list.length > 0}
            title={list.length ? 'Move its companies to another holding first' : undefined}
            onClick={() => window.confirm(`Delete the holding ${h.name}? Its board members' accounts are removed.`) && void removeHolding({ id: h._id })}
          >
            Delete
          </button>
        )
      }
    >
      <ErrorBanner message={error ?? removeError ?? createError} onDismiss={clearError} />
      <Stats
        items={[
          { label: 'Companies', value: counts.companies, level: 'company' },
          { label: 'Plants', value: counts.plants, level: 'plant' },
          { label: 'Departments', value: counts.departments, level: 'department' },
          { label: 'Cost centers', value: counts.costCenters, level: 'costCenter' },
          { label: 'Users', value: list.reduce((n, c) => n + c.userCount, 0) },
        ]}
      />

      <Block title="Companies" hint="A company rents modules and has its own users; its plants never share data.">
        <Table head={['Company', 'Plants', 'Departments', 'Cost centers', 'Users', 'Creators', '']} empty={!list.length && 'No company yet — add the first one below.'}>
          {list.map((c) => {
            const k = countsOf([c])
            return (
              <tr key={c._id} className="border-t border-border">
                <td className={`${td} font-medium`}>
                  {c.name}
                  {c.status !== 'active' && <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] text-amber-900">suspended</span>}
                </td>
                <td className={`${td} tabular-nums`}>{k.plants}</td>
                <td className={`${td} tabular-nums`}>{k.departments}</td>
                <td className={`${td} tabular-nums`}>{k.costCenters}</td>
                <td className={`${td} tabular-nums`}>{c.userCount}</td>
                <td className={`${td} text-xs text-muted-foreground`}>{c.creators.join(', ') || '—'}</td>
                <td className={`${td} text-right`}>
                  <OpenButton onClick={() => onSelect({ kind: 'company', id: c._id })} />
                </td>
              </tr>
            )
          })}
        </Table>
        {isPlatform && (
          <div className="mt-2 flex flex-wrap gap-2">
            <input className={`w-64 ${input}`} placeholder={`New company in ${h.name}`} value={name} onChange={(e) => setName(e.target.value)} />
            <button
              className={btn}
              disabled={!name.trim()}
              onClick={async () => {
                if (await createCompany({ name: name.trim(), modules: [...MODULES], holdingId: h._id })) setName('')
              }}
            >
              Add company
            </button>
          </div>
        )}
      </Block>

      {isPlatform && (
        <Block title="Board members of the holding" hint="They see every company and plant of the holding on the Board Dashboard and the KPI / OEE dashboards — read only.">
          <CompanyUsers companyId={null} groups={[]} holdingId={h._id} />
        </Block>
      )}
    </Panel>
  )
}

// ---- Company ----------------------------------------------------------------------

type CompanyTab = 'plants' | 'users' | 'groups'

function CompanyPanel({ company: c, holdings, isPlatform, onSelect }: { company: CompanyRow; holdings: OrgHolding[]; isPlatform: boolean; onSelect: (n: OrgNode) => void }) {
  const { run: updateCompany, error, clearError } = useSafeMutation(api.platform.updateCompany)
  const { run: setHolding, error: holdingError } = useSafeMutation(api.platform.setCompanyHolding)
  const [tab, setTab] = useState<CompanyTab>('plants')
  const people = useCompanyPeople(c._id)
  const save = (patch: Partial<Pick<CompanyRow, 'name' | 'modules' | 'status'>>) =>
    updateCompany({ id: c._id, name: patch.name ?? c.name, modules: patch.modules ?? c.modules, status: patch.status ?? c.status })
  const counts = countsOf([c])

  return (
    <Panel
      level="company"
      title={<NameEditor value={c.name} disabled={!isPlatform} onSave={(name) => save({ name })} />}
      badge={c.status !== 'active' && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">suspended</span>}
      actions={
        isPlatform && (
          <button
            className={ghost}
            onClick={() => {
              const next = c.status === 'active' ? 'suspended' : 'active'
              const msg = next === 'suspended' ? `Suspend ${c.name}? Everybody reads only; data can be deleted after 90 days.` : `Reactivate ${c.name}?`
              if (window.confirm(msg)) void save({ status: next })
            }}
          >
            {c.status === 'active' ? 'Suspend' : 'Reactivate'}
          </button>
        )
      }
    >
      <ErrorBanner message={error ?? holdingError} onDismiss={clearError} />
      {c.status !== 'active' && c.deleteAfter && (
        <p className="mt-1 text-xs text-amber-900">Suspended — data can be deleted after {new Date(c.deleteAfter).toISOString().slice(0, 10)}.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        {isPlatform ? (
          <label className={`flex items-center gap-2 ${c.holdingId ? 'text-muted-foreground' : 'font-medium text-amber-900'}`}>
            <LevelChip level="holding" />
            Holding
            <select
              className={`rounded-md border bg-background px-2 py-1 text-xs text-foreground ${c.holdingId ? 'border-input' : 'border-amber-500'}`}
              value={c.holdingId ?? ''}
              onChange={(e) => e.target.value && void setHolding({ companyId: c._id, holdingId: e.target.value })}
            >
              {!c.holdingId && <option value="">— choose a holding —</option>}
              {holdings.map((h) => (
                <option key={h._id} value={h._id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          c.holdingName && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <LevelChip level="holding" /> {c.holdingName}
            </span>
          )
        )}
        <CompanyDataActions company={c} isPlatform={isPlatform} />
      </div>

      {isPlatform && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span className="text-muted-foreground">Modules rented:</span>
          {MODULES.map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={c.modules.includes(m)}
                onChange={(e) => void save({ modules: e.target.checked ? [...c.modules, m] : c.modules.filter((x) => x !== m) })}
              />
              {MODULE_LABELS[m]}
            </label>
          ))}
        </div>
      )}

      <Stats
        items={[
          { label: 'Plants', value: counts.plants, level: 'plant' },
          { label: 'Departments', value: counts.departments, level: 'department' },
          { label: 'Cost centers', value: counts.costCenters, level: 'costCenter' },
          { label: 'Users', value: c.userCount },
          { label: 'Groups', value: people.groups.length },
        ]}
      />

      <div className="mt-5 flex gap-1 border-b border-border text-sm" role="tablist">
        {(
          [
            ['plants', 'Plants'],
            ['users', 'Users & access'],
            ['groups', 'Groups'],
          ] as [CompanyTab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={`-mb-px border-b-2 px-3 py-1.5 font-medium ${tab === k ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'plants' && <CompanyPlants company={c} people={people} onSelect={onSelect} />}
      {tab === 'users' && (
        <div className="mt-3">
          <AccessMatrix company={c} users={people.orgUsers} groups={people.orgGroups} onSelect={onSelect} />
          <h3 className="mt-5 text-sm font-semibold text-foreground">Accounts</h3>
          <CompanyUsers companyId={c._id} groups={people.groups} />
        </div>
      )}
      {tab === 'groups' && (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">A group gives its members plants × module permissions; a user can be in several groups.</p>
          <CompanyGroups companyId={c._id} groups={people.groups} plants={c.plants} />
        </div>
      )}
    </Panel>
  )
}

function CompanyPlants({ company: c, people, onSelect }: { company: CompanyRow; people: ReturnType<typeof useCompanyPeople>; onSelect: (n: OrgNode) => void }) {
  const { run: createPlant, error, clearError } = useSafeMutation(api.platform.createPlant)
  const [name, setName] = useState('')
  const [country, setCountry] = useState('')
  const [zone, setZone] = useState('')
  return (
    <div className="mt-3">
      <ErrorBanner message={error} onDismiss={clearError} />
      <Table head={['Plant', 'Country', 'Time zone', 'Departments', 'Cost centers', 'Users', '']} empty={!c.plants.length && 'No plant yet.'}>
        {c.plants.map((p) => {
          const loose = unassignedOf(p).length
          return (
            <tr key={p._id} className="border-t border-border">
              <td className={`${td} font-medium`}>{p.name}</td>
              <td className={td}>{p.country || '—'}</td>
              <td className={`${td} text-xs`}>{p.timeZone || '—'}</td>
              <td className={td}>
                <span className="flex flex-wrap gap-1">
                  {(p.departments ?? []).map((d) => (
                    <span key={d} className="rounded bg-amber-100 px-1.5 py-px text-xs text-amber-950">
                      {d}
                    </span>
                  ))}
                  {!(p.departments ?? []).length && <span className="text-xs text-amber-800">none yet</span>}
                </span>
              </td>
              <td className={`${td} tabular-nums`}>
                {p.costCenters?.length ?? 0}
                {loose > 0 && <span className="ml-1 text-xs text-amber-800">({loose} without dept.)</span>}
              </td>
              <td className={`${td} tabular-nums`}>{plantAccessRows(p, c, people.orgUsers, people.orgGroups).length}</td>
              <td className={`${td} text-right`}>
                <OpenButton onClick={() => onSelect({ kind: 'plant', id: p._id })} />
              </td>
            </tr>
          )
        })}
      </Table>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <input className={`w-48 ${input}`} placeholder="New plant name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={`w-20 ${input}`} placeholder="Country" title="Two-letter code, e.g. RO, TR" value={country} onChange={(e) => setCountry(e.target.value)} />
        <input className={`w-44 ${input}`} placeholder="Time zone" title="e.g. Europe/Bucharest" value={zone} onChange={(e) => setZone(e.target.value)} list="time-zones" />
        <TimeZoneList />
        <button
          className={btn}
          disabled={!name.trim() || !country.trim() || !zone.trim() || c.status !== 'active'}
          onClick={async () => {
            if (await createPlant({ companyId: c._id, name: name.trim(), country: country.trim(), timeZone: zone.trim() })) {
              setName('')
              setCountry('')
              setZone('')
            }
          }}
        >
          Add plant
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">A new plant starts empty: add its departments, then select it in the header — the portal home shows its setup checklist.</p>
    </div>
  )
}

function TimeZoneList() {
  return (
    <datalist id="time-zones">
      {TIME_ZONES.map((z) => (
        <option key={z} value={z} />
      ))}
    </datalist>
  )
}

/** Kullanıcı × plant tablosu: kim hangi plant'te hangi modülü görür / düzenler. */
function AccessMatrix({ company: c, users, groups, onSelect }: { company: CompanyRow; users: OrgUser[]; groups: OrgGroup[]; onSelect: (n: OrgNode) => void }) {
  const byPlant = new Map(c.plants.map((p) => [p._id, new Map(plantAccessRows(p, c, users, groups).map((r) => [r.user._id, r]))]))
  const sorted = [...users].sort((a, b) => Number(b.isCreator) - Number(a.isCreator) || a.name.localeCompare(b.name))
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">Who sees which plant</h3>
      <AccessLegend />
      <div className="mt-2">
        <Table
          head={[
            'User',
            'Via',
            ...c.plants.map((p) => (
              <button key={p._id} className="flex items-center gap-1 hover:text-foreground" onClick={() => onSelect({ kind: 'plant', id: p._id })}>
                <LevelChip level="plant" /> {p.name}
              </button>
            )),
          ]}
          empty={!users.length && 'No user yet — add one under Accounts.'}
        >
          {sorted.map((u) => (
            <tr key={u._id} className={`border-t border-border ${u.active ? '' : 'opacity-50'}`}>
              <td className={`${td} font-medium whitespace-nowrap`}>{u.name}</td>
              <td className={`${td} text-xs text-muted-foreground`}>
                {u.isCreator ? 'Creator' : groups.filter((g) => u.groupIds.includes(g._id)).map((g) => g.name).join(', ') || <span className="text-amber-800">no group</span>}
              </td>
              {c.plants.map((p) => {
                const r = byPlant.get(p._id)?.get(u._id)
                return (
                  <td key={p._id} className={td}>
                    {r ? <AccessBadges access={r.access} /> : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </Table>
      </div>
    </div>
  )
}

// ---- Plant ------------------------------------------------------------------------

/** Plant'in bölüm / masraf yeri yapısını kaydeder (sunucu kuralı denetler). */
function useSaveStructure(plant: OrgPlant) {
  const { run, error, clearError, pending } = useSafeMutation(api.platform.updatePlant)
  const save = (s: PlantStructure) => run({ id: plant._id, name: plant.name, departments: s.departments, costCenters: s.costCenters })
  return { save, error, clearError, pending }
}

function PlantPanel({ plant: p, company: c, isPlatform, onSelect }: { plant: OrgPlant; company: CompanyRow; isPlatform: boolean; onSelect: (n: OrgNode) => void }) {
  const { run: updatePlant, error, clearError } = useSafeMutation(api.platform.updatePlant)
  const { run: deletePlant, error: deleteError } = useSafeMutation(api.platform.deletePlant)
  const structure = useSaveStructure(p)
  const people = useCompanyPeople(c._id)
  const [form, setForm] = useState({ name: p.name, country: p.country ?? '', timeZone: p.timeZone ?? '' })
  const [dept, setDept] = useState('')
  const dirty = form.name !== p.name || form.country !== (p.country ?? '') || form.timeZone !== (p.timeZone ?? '')
  const depts = departmentsOf(p)
  const loose = unassignedOf(p)
  const access = plantAccessRows(p, c, people.orgUsers, people.orgGroups)
  const disabled = p.disabledModules ?? []

  return (
    <Panel
      level="plant"
      title={<h2 className="truncate text-lg font-semibold text-foreground">{p.name}</h2>}
      actions={
        c.plants.length > 1 && (
          <button
            className="text-xs text-destructive hover:underline"
            onClick={() => {
              if (!window.confirm(`Delete the plant ${p.name} and ALL its data permanently? This cannot be undone.`)) return
              const typed = window.prompt('Type the plant name to confirm:')
              if (typed !== null) void deletePlant({ id: p._id, confirmName: typed })
            }}
          >
            Delete plant
          </button>
        )
      }
    >
      <ErrorBanner message={error ?? deleteError ?? structure.error} onDismiss={() => (clearError(), structure.clearError())} />
      <div className={`mt-3 flex flex-wrap items-end gap-2 rounded-md p-2 ${dirty ? 'bg-amber-50' : ''}`}>
        <label className="text-xs text-muted-foreground">
          Name
          <input className={`mt-1 block w-48 ${input}`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="text-xs text-muted-foreground">
          Country
          <input className={`mt-1 block w-16 ${input}`} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
        </label>
        <label className="text-xs text-muted-foreground">
          Time zone
          <input className={`mt-1 block w-48 ${input}`} value={form.timeZone} list="time-zones" onChange={(e) => setForm({ ...form, timeZone: e.target.value })} />
        </label>
        <TimeZoneList />
        <button className={btn} disabled={!dirty || !form.name.trim()} onClick={() => void updatePlant({ id: p._id, ...form })}>
          Save
        </button>
      </div>

      {isPlatform && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span className="text-muted-foreground">Modules switched off here:</span>
          {c.modules.map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={disabled.includes(m)}
                onChange={(e) => void updatePlant({ id: p._id, name: p.name, disabledModules: (e.target.checked ? [...disabled, m] : disabled.filter((x) => x !== m)).sort() })}
              />
              {MODULE_LABELS[m]}
            </label>
          ))}
        </div>
      )}

      <Stats
        items={[
          { label: 'Departments', value: depts.length, level: 'department' },
          { label: 'Cost centers', value: p.costCenters?.length ?? 0, level: 'costCenter' },
          { label: 'Users with access', value: access.length },
        ]}
      />

      <Block title="Departments" hint="Every cost center belongs to one department. Open a department to add its cost centers.">
        <div className="grid gap-2 sm:grid-cols-2">
          {depts.map((d) => (
            <button
              key={d.name}
              className="rounded-md border border-border bg-background p-3 text-left hover:border-amber-400 hover:bg-amber-50/40"
              onClick={() => onSelect({ kind: 'department', plantId: p._id, department: d.name })}
            >
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <LevelChip level="department" /> {d.name}
                <span className="ml-auto text-xs font-normal text-muted-foreground">{d.costCenters.length} CC ›</span>
              </span>
              <span className="mt-1.5 flex flex-wrap gap-1">
                {d.costCenters.slice(0, 6).map((cc) => (
                  <span key={cc.code} className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground" title={cc.name}>
                    {cc.code}
                  </span>
                ))}
                {d.costCenters.length > 6 && <span className="text-[10px] text-muted-foreground">+{d.costCenters.length - 6}</span>}
                {!d.costCenters.length && <span className="text-[11px] text-amber-800">no cost center yet</span>}
              </span>
            </button>
          ))}
          {loose.length > 0 && (
            <button
              className="rounded-md border border-dashed border-amber-400 bg-amber-50/60 p-3 text-left"
              onClick={() => onSelect({ kind: 'department', plantId: p._id, department: null })}
            >
              <span className="flex items-center gap-1.5 font-medium text-amber-950">
                <LevelChip level="department" className="opacity-60" /> Without a department
                <span className="ml-auto text-xs font-normal">{loose.length} CC ›</span>
              </span>
              <span className="mt-1 block text-[11px] text-amber-900">Cost centers from before departments — give each one its department.</span>
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            className={`w-56 ${input}`}
            placeholder="New department, e.g. Stamping"
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && dept.trim() && (await structure.save(addDepartment(p, dept)))) setDept('')
            }}
          />
          <button
            className={btn}
            disabled={!dept.trim() || structure.pending}
            onClick={async () => {
              if (await structure.save(addDepartment(p, dept))) setDept('')
            }}
          >
            Add department
          </button>
        </div>
      </Block>

      <Block
        title="Users with access to this plant"
        hint={
          <>
            Creators see every plant; other users through their groups.{' '}
            <button className="underline" onClick={() => onSelect({ kind: 'company', id: c._id })}>
              Manage users and groups on {c.name}
            </button>
          </>
        }
      >
        <AccessLegend />
        <div className="mt-2">
          <Table head={['User', 'Via', 'Modules']} empty={!access.length && 'Nobody has access to this plant yet.'}>
            {access.map((r) => (
              <tr key={r.user._id} className={`border-t border-border ${r.user.active ? '' : 'opacity-50'}`}>
                <td className={`${td} font-medium whitespace-nowrap`}>{r.user.name}</td>
                <td className={`${td} text-xs text-muted-foreground`}>{r.via.join(', ')}</td>
                <td className={td}>
                  <AccessBadges access={r.access} />
                </td>
              </tr>
            ))}
          </Table>
        </div>
      </Block>
    </Panel>
  )
}

// ---- Department -------------------------------------------------------------------

function DepartmentPanel({ plant: p, department, onSelect }: { plant: OrgPlant; department: string | null; onSelect: (n: OrgNode) => void }) {
  const structure = useSaveStructure(p)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const list: OrgCostCenter[] = department === null ? unassignedOf(p) : (p.costCenters ?? []).filter((c) => c.department === department)
  const departments = p.departments ?? []
  // Ad düzenleme taslakları; Save all hepsini tek kayıtta gönderir.
  const drafts = useDraftRows(list, (c) => c.code, ccDraft, sameCc)
  const named = (s: PlantStructure, code: string, name: string) => ({ ...s, costCenters: s.costCenters.map((c) => (c.code === code ? { ...c, name: name.trim() || code } : c)) })
  const saveAllNames = () => {
    let s: PlantStructure = { departments, costCenters: p.costCenters ?? [] }
    for (const code of drafts.dirtyKeys) {
      const cc = list.find((c) => c.code === code)
      if (cc) s = named(s, code, drafts.draftFor(cc).name)
    }
    return structure.save(s)
  }

  const add = async () => {
    const k = code.trim()
    if (!k || department === null) return
    if (await structure.save(addCostCenter(p, { code: k, name, department }))) {
      setCode('')
      setName('')
    }
  }

  return (
    <Panel
      level="department"
      title={
        department === null ? (
          <h2 className="text-lg font-semibold text-amber-950">Without a department</h2>
        ) : (
          <NameEditor
            value={department}
            className="w-56"
            onSave={async (n) => {
              const ok = await structure.save(renameDepartment(p, department, n))
              if (ok) onSelect({ kind: 'department', plantId: p._id, department: n })
              return ok
            }}
          />
        )
      }
      actions={
        department !== null && (
          <button
            className="text-xs text-destructive hover:underline disabled:opacity-40 disabled:hover:no-underline"
            disabled={list.length > 0}
            title={list.length ? 'Move or remove its cost centers first' : undefined}
            onClick={async () => {
              if (window.confirm(`Delete the department ${department}?`) && (await structure.save(removeDepartment(p, department)))) onSelect({ kind: 'plant', id: p._id })
            }}
          >
            Delete department
          </button>
        )
      }
    >
      <ErrorBanner message={structure.error} onDismiss={structure.clearError} />
      <p className="mt-2 text-xs text-muted-foreground">
        {department === null
          ? 'These cost centers were defined before departments. Choose a department for each one — the code and all its data stay.'
          : `Cost centers of ${department} in ${p.name}. The code is the SAP cost center; OEE uploads and KPI entries are matched by it.`}
      </p>

      <div className="mt-3">
        <Table head={[<LevelChip key="c" level="costCenter" />, 'Code', 'Name', 'Department', '']} empty={!list.length && (department === null ? 'Nothing left here.' : 'No cost center yet — add the first one below.')}>
          {list.map((cc) => (
            <CostCenterRow
              key={cc.code}
              cc={cc}
              name={drafts.draftFor(cc).name}
              dirty={drafts.isDirty(cc)}
              saving={drafts.savingKey === cc.code}
              justSaved={!!drafts.justSaved[cc.code]}
              departments={departments}
              busy={structure.pending}
              onEdit={(name) => drafts.edit(cc.code, { name })}
              onSave={() => void drafts.commit(cc.code, (d) => structure.save(editCostCenter(p, cc.code, { name: d.name.trim() || cc.code })))}
              onMove={(d) => structure.save(editCostCenter(p, cc.code, { department: d }))}
              onRemove={() => window.confirm(`Remove cost center ${cc.code} from ${p.name}? Its uploaded data stays but no longer counts.`) && void structure.save(removeCostCenter(p, cc.code))}
            />
          ))}
        </Table>
      </div>

      <UnsavedBar count={drafts.dirtyKeys.length} saving={structure.pending} noun="cost center" onSaveAll={() => void saveAllNames()} onDiscard={drafts.discardAll} />

      {department !== null && (
        <div className="mt-2 flex flex-wrap gap-2">
          <input className={`w-28 ${input}`} placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
          <input className={`w-56 ${input}`} placeholder="Name (e.g. Transfer press)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
          <button className={btn} disabled={!code.trim() || structure.pending} onClick={() => void add()}>
            Add cost center
          </button>
        </div>
      )}
    </Panel>
  )
}

const ccDraft = (c: OrgCostCenter) => ({ name: c.name })
const sameCc = (a: { name: string }, b: { name: string }) => a.name.trim() === b.name.trim()

function CostCenterRow({
  cc,
  name,
  dirty,
  saving,
  justSaved,
  departments,
  busy,
  onEdit,
  onSave,
  onMove,
  onRemove,
}: {
  cc: OrgCostCenter
  name: string
  dirty: boolean
  saving: boolean
  justSaved: boolean
  departments: string[]
  busy: boolean
  onEdit: (name: string) => void
  onSave: () => void
  onMove: (department: string) => void
  onRemove: () => void
}) {
  const assigned = !!cc.department && departments.includes(cc.department)
  return (
    <tr className={`border-t border-border ${dirty ? 'bg-amber-50' : ''}`}>
      <td className={td}>
        <LevelChip level="costCenter" />
      </td>
      <td className={`${td} font-mono text-xs`}>{cc.code}</td>
      <td className={td}>
        <span className="flex items-center gap-1.5">
          <input className={`w-44 ${input}`} value={name} onChange={(e) => onEdit(e.target.value)} />
          <button className={btn} disabled={!dirty || busy} onClick={onSave}>
            Save
          </button>
          <SaveStatus dirty={dirty} saving={saving} justSaved={justSaved} />
        </span>
      </td>
      <td className={td}>
        <select
          className={`rounded-md border bg-background px-2 py-1 text-xs ${assigned ? 'border-input' : 'border-amber-500'}`}
          value={assigned ? cc.department : ''}
          disabled={busy}
          onChange={(e) => e.target.value && onMove(e.target.value)}
        >
          {!assigned && <option value="">— choose —</option>}
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </td>
      <td className={`${td} text-right`}>
        <button className="text-xs text-destructive hover:underline" onClick={onRemove}>
          Remove
        </button>
      </td>
    </tr>
  )
}

/**
 * Dışa aktarım (creator ya da General): şirketin bütün fabrika verisi tek
 * JSON dosyası. Kalıcı silme (General): askıdan 90 gün sonra, şirket adı
 * yazılarak; geri alınamaz.
 */
function CompanyDataActions({ company: c, isPlatform }: { company: CompanyRow; isPlatform: boolean }) {
  const tablesOf = useQueryOnce(api.platform.exportTables)
  const pageOf = useQueryOnce(api.platform.exportPage)
  const { run: deleteCompany, error, clearError } = useSafeMutation(api.platform.deleteCompany)
  const [progress, setProgress] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const canDelete = isPlatform && c.status === 'suspended' && !!c.deleteAfter && Date.now() >= c.deleteAfter

  const exportAll = async () => {
    setFailed(null)
    try {
      const tables = (await tablesOf({ companyId: c._id })) as string[]
      const plants: Record<string, { name: string; tables: Record<string, unknown[]> }> = {}
      for (const p of c.plants) {
        plants[p._id] = { name: p.name, tables: {} }
        for (const table of tables) {
          const rows: unknown[] = []
          let cursor: string | null = null
          for (;;) {
            setProgress(`${p.name} · ${table} · ${rows.length}`)
            const r = (await pageOf({ companyId: c._id, plantId: p._id, table, cursor })) as { page: unknown[]; isDone: boolean; continueCursor: string }
            rows.push(...r.page)
            if (r.isDone) break
            cursor = r.continueCursor
          }
          if (rows.length) plants[p._id].tables[table] = rows
        }
      }
      const file = { company: { name: c.name, modules: c.modules, status: c.status }, exportedAt: new Date().toISOString(), plants }
      const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${c.name.replace(/[^\w-]+/g, '_')}_export_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e))
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
      <ErrorBanner message={error ?? failed} onDismiss={() => (clearError(), setFailed(null))} />
      <button className="rounded-md border border-border px-2 py-1 hover:bg-muted disabled:opacity-50" disabled={!!progress} onClick={() => void exportAll()}>
        {progress ? `Exporting… ${progress}` : 'Export data (JSON)'}
      </button>
      {canDelete && (
        <button
          className="rounded-md border border-destructive px-2 py-1 text-destructive hover:bg-destructive/10"
          onClick={() => {
            // İki adım: onay, sonra şirket adını yazma (sunucu da adı denetler).
            if (!window.confirm(`Delete ${c.name} and ALL its plant data permanently? This cannot be undone — export first.`)) return
            const typed = window.prompt('Type the company name to confirm:')
            if (typed !== null) void deleteCompany({ id: c._id, confirmName: typed })
          }}
        >
          Delete permanently
        </button>
      )}
    </div>
  )
}
