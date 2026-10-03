import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { api } from '../../convex/_generated/api'
import { CompanyGroups, CompanyUsers, type GroupRow } from '../components/CompanyAdmin'
import { ErrorBanner } from '../components/ErrorBanner'
import { PageHeader } from '../components/PageHeader'
import { SaveStatus } from '../components/SaveStatus'
import { useQuery, useQueryOnce } from '../lib/convexTransport'
import { usePlant } from '../lib/plantContext'
import { useDraftRows } from '../lib/useDraftRows'
import { useSafeMutation } from '../lib/useSafeMutation'
import { MODULES, MODULE_LABELS, type Module } from '../lib/tenancy'

export const Route = createFileRoute('/platform')({
  component: PlatformPage,
})

interface PlantRow {
  _id: string
  name: string
  code?: string
  country?: string
  timeZone?: string
  disabledModules?: Module[]
  costCenters?: CostCenter[]
}

interface CostCenter {
  code: string
  name: string
}

interface CompanyRow {
  _id: string
  name: string
  status: 'active' | 'suspended'
  modules: Module[]
  deleteAfter?: number
  holdingId?: string
  plants: PlantRow[]
  userCount: number
  creators: string[]
}

interface PlantDraft {
  name: string
  country: string
  timeZone: string
  disabledModules: Module[]
  costCenters: CostCenter[]
}

const plantDraft = (p: PlantRow): PlantDraft => ({
  name: p.name,
  country: p.country ?? '',
  timeZone: p.timeZone ?? '',
  disabledModules: [...(p.disabledModules ?? [])].sort(),
  costCenters: p.costCenters ?? [],
})
const samePlant = (a: PlantDraft, b: PlantDraft) => JSON.stringify(a) === JSON.stringify(b)

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

/**
 * Şirketler ve fabrikalar (docs/plant-genisletme.md, v3).
 * General: bütün şirketler; şirket açar, askıya alır, modül (kiralama
 * paketi) açar/kapar, fabrikada modül kapatır, creator atar. Owner ayrıca
 * General ekler. Creator: kendi şirketinin fabrikalarını ekler / düzenler.
 */
function PlatformPage() {
  const { ctx, isPlatform } = usePlant()
  const companies = (useQuery(api.platform.companies) ?? []) as CompanyRow[]
  const { run: createCompany, error, clearError } = useSafeMutation(api.platform.createCompany)
  const [name, setName] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title={isPlatform ? 'Companies and plants' : 'Plants of your company'}
        summary="Every plant keeps its own data, settings and plan; two plants never see each other's data."
        info={
          <>
            <p>
              <b>General</b>: opens and suspends companies, chooses the modules a company rents, can switch a module off
              in one plant and appoints creators. Only the site owner adds Generals.
            </p>
            <p>
              <b>Creator</b>: adds and sets up the plants of the company, opens users with a temporary password and
              defines groups (plants × module permissions).
            </p>
            <p>
              <b>Suspended</b> company: everybody reads, nobody writes; the data can be deleted 90 days later.
            </p>
          </>
        }
      />
      <ErrorBanner message={error} onDismiss={clearError} />

      {isPlatform && (
        <div className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
          <label className="text-xs text-muted-foreground">
            New company
            <input className={`mt-1 block w-60 ${input}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" />
          </label>
          <button
            className={btn}
            disabled={!name.trim()}
            onClick={async () => {
              if (await createCompany({ name: name.trim(), modules: [...MODULES] })) setName('')
            }}
          >
            Add company
          </button>
        </div>
      )}

      <div className="mt-4 space-y-4">
        {companies.map((c) => (
          <CompanyCard key={c._id} company={c} isPlatform={isPlatform} open={open === c._id} onToggle={() => setOpen(open === c._id ? null : c._id)} />
        ))}
      </div>

      {isPlatform && <HoldingsSection companies={companies} />}

      {ctx?.platformRole === 'owner' && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-foreground">Generals</h2>
          <p className="mt-1 text-xs text-muted-foreground">Generals see and manage every company. Only the site owner adds or removes them.</p>
          <CompanyUsers companyId={null} groups={[]} />
        </section>
      )}
    </div>
  )
}

function CompanyCard({ company: c, isPlatform, open, onToggle }: { company: CompanyRow; isPlatform: boolean; open: boolean; onToggle: () => void }) {
  const { run: updateCompany, error, clearError } = useSafeMutation(api.platform.updateCompany)
  const { run: createPlant, error: plantError } = useSafeMutation(api.platform.createPlant)
  const [plantName, setPlantName] = useState('')
  const [plantCountry, setPlantCountry] = useState('')
  const [plantZone, setPlantZone] = useState('')
  const [companyName, setCompanyName] = useState(c.name)
  const { run: updatePlant, error: updatePlantError } = useSafeMutation(api.platform.updatePlant)
  const { run: deletePlant, error: deletePlantError } = useSafeMutation(api.platform.deletePlant)
  const drafts = useDraftRows(c.plants, (p) => p._id, plantDraft, samePlant)
  const savePlant = (id: string) => (d: PlantDraft) =>
    updatePlant({ id, name: d.name, country: d.country, timeZone: d.timeZone, costCenters: d.costCenters, ...(isPlatform ? { disabledModules: d.disabledModules } : {}) })
  const groups = (useQuery(api.users.listGroups, open ? { companyId: c._id } : 'skip') ?? []) as GroupRow[]
  const save = (patch: Partial<Pick<CompanyRow, 'name' | 'modules' | 'status'>>) =>
    void updateCompany({ id: c._id, name: patch.name ?? c.name, modules: patch.modules ?? c.modules, status: patch.status ?? c.status })

  return (
    <section className={`rounded-lg border p-4 ${c.status === 'active' ? 'border-border' : 'border-amber-400 bg-amber-50/40'}`}>
      <ErrorBanner message={error ?? plantError ?? updatePlantError ?? deletePlantError} onDismiss={clearError} />
      <div className="flex flex-wrap items-center gap-3">
        {isPlatform ? (
          <span className="flex items-center gap-1">
            <input className={`w-64 font-semibold ${input}`} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            <button className={btn} disabled={!companyName.trim() || companyName === c.name} onClick={() => save({ name: companyName.trim() })}>
              Save
            </button>
          </span>
        ) : (
          <h2 className="text-base font-semibold text-foreground">{c.name}</h2>
        )}
        <span className="text-xs text-muted-foreground">
          {c.userCount} users · creators: {c.creators.join(', ') || '—'}
        </span>
        {isPlatform && (
          <button
            className="ml-auto rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
            onClick={() => {
              const next = c.status === 'active' ? 'suspended' : 'active'
              const msg = next === 'suspended' ? `Suspend ${c.name}? Everybody reads only; data can be deleted after 90 days.` : `Reactivate ${c.name}?`
              if (window.confirm(msg)) save({ status: next })
            }}
          >
            {c.status === 'active' ? 'Suspend' : 'Reactivate'}
          </button>
        )}
      </div>
      {c.status !== 'active' && c.deleteAfter && (
        <p className="mt-1 text-xs text-amber-900">Suspended — data can be deleted after {new Date(c.deleteAfter).toISOString().slice(0, 10)}.</p>
      )}
      <CompanyDataActions company={c} isPlatform={isPlatform} />
      {isPlatform && <CompanyHoldingPick company={c} />}

      {isPlatform && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <span className="text-muted-foreground">Modules rented:</span>
          {MODULES.map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={c.modules.includes(m)}
                onChange={(e) => save({ modules: e.target.checked ? [...c.modules, m] : c.modules.filter((x) => x !== m) })}
              />
              {MODULE_LABELS[m]}
            </label>
          ))}
        </div>
      )}

      <div className="mt-3 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Plant</th>
              <th className="px-3 py-2 font-medium">Country</th>
              <th className="px-3 py-2 font-medium">Time zone</th>
              <th className="px-3 py-2 font-medium" title="All cost centers of the plant count in every calculation, screen and report of the plant">Cost centers (code — name)</th>
              {isPlatform && <th className="px-3 py-2 font-medium">Modules switched off here</th>}
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {c.plants.map((p) => (
              <PlantRowEdit
                key={p._id}
                draft={drafts.draftFor(p)}
                dirty={drafts.isDirty(p)}
                saving={drafts.savingKey === p._id}
                justSaved={!!drafts.justSaved[p._id]}
                onEdit={(patch) => drafts.edit(p._id, patch)}
                onSave={() => void drafts.commit(p._id, savePlant(p._id))}
                onDelete={
                  c.plants.length > 1
                    ? () => {
                        if (!window.confirm(`Delete the plant ${p.name} and ALL its data permanently? This cannot be undone.`)) return
                        const typed = window.prompt('Type the plant name to confirm:')
                        if (typed !== null) void deletePlant({ id: p._id, confirmName: typed })
                      }
                    : undefined
                }
                modules={c.modules}
                isPlatform={isPlatform}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <input className={`w-56 ${input}`} placeholder="New plant name" value={plantName} onChange={(e) => setPlantName(e.target.value)} />
        <input className={`w-20 ${input}`} placeholder="Country" title="Two-letter code, e.g. RO, TR" value={plantCountry} onChange={(e) => setPlantCountry(e.target.value)} />
        <input className={`w-44 ${input}`} placeholder="Time zone" title="e.g. Europe/Bucharest" value={plantZone} onChange={(e) => setPlantZone(e.target.value)} list="time-zones" />
        <datalist id="time-zones">
          {TIME_ZONES.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        <button
          className={btn}
          disabled={!plantName.trim() || !plantCountry.trim() || !plantZone.trim() || c.status !== 'active'}
          onClick={async () => {
            if (await createPlant({ companyId: c._id, name: plantName.trim(), country: plantCountry.trim(), timeZone: plantZone.trim() })) {
              setPlantName('')
              setPlantCountry('')
              setPlantZone('')
            }
          }}
        >
          Add plant
        </button>
        <span className="text-xs text-muted-foreground">A new plant starts empty: select it in the header — the portal home shows its setup checklist.</span>
      </div>

      {isPlatform && (
        <>
          <button className="mt-3 text-xs underline" onClick={onToggle}>
            {open ? 'Hide users and groups' : 'Users and groups'}
          </button>
          {open && (
            <div className="mt-2 space-y-4">
              <CompanyUsers companyId={c._id} groups={groups} />
              <CompanyGroups companyId={c._id} groups={groups} plants={c.plants} />
            </div>
          )}
        </>
      )}
    </section>
  )
}

function PlantRowEdit({
  draft: d,
  dirty,
  saving,
  justSaved,
  onEdit,
  onSave,
  onDelete,
  modules,
  isPlatform,
}: {
  draft: PlantDraft
  dirty: boolean
  saving: boolean
  justSaved: boolean
  onEdit: (patch: Partial<PlantDraft>) => void
  onSave: () => void
  /** Yoksa silinemez (şirketin son fabrikası). */
  onDelete?: () => void
  modules: Module[]
  isPlatform: boolean
}) {
  const text = (key: 'name' | 'country' | 'timeZone', w: string) => (
    <input className={`${w} ${input}`} value={d[key]} onChange={(e) => onEdit({ [key]: e.target.value })} />
  )
  return (
    <tr className={`border-t border-border ${dirty ? 'bg-amber-50' : ''}`}>
      <td className="px-3 py-2">{text('name', 'w-40')}</td>
      <td className="px-3 py-2">{text('country', 'w-16')}</td>
      <td className="px-3 py-2">{text('timeZone', 'w-44')}</td>
      <td className="px-3 py-2">
        <CostCenterEditor value={d.costCenters} onChange={(costCenters) => onEdit({ costCenters })} />
      </td>
      {isPlatform && (
        <td className="px-3 py-2 text-xs">
          <span className="flex flex-wrap gap-2">
            {modules.map((m) => (
              <label key={m} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={d.disabledModules.includes(m)}
                  onChange={(e) =>
                    onEdit({ disabledModules: (e.target.checked ? [...d.disabledModules, m] : d.disabledModules.filter((x) => x !== m)).sort() })
                  }
                />
                {MODULE_LABELS[m]}
              </label>
            ))}
          </span>
        </td>
      )}
      <td className="px-3 py-2 whitespace-nowrap">
        <SaveStatus dirty={dirty} saving={saving} justSaved={justSaved} />
      </td>
      <td className="px-3 py-2 text-right">
        <button className={btn} disabled={!dirty || saving || !d.name.trim()} onClick={onSave}>
          Save
        </button>
        {onDelete && (
          <button className="ml-2 text-xs text-destructive hover:underline" onClick={onDelete}>
            Delete
          </button>
        )}
      </td>
    </tr>
  )
}

/**
 * Fabrikanın masraf yerleri (SAP cost center): kod + ad. Tek kaynak; OEE ve
 * diğer modüller adları buradan okur.
 */
function CostCenterEditor({ value, onChange }: { value: CostCenter[]; onChange: (v: CostCenter[]) => void }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const add = () => {
    const k = code.trim()
    if (!k || value.some((x) => x.code === k)) return
    onChange([...value, { code: k, name: name.trim() || k }])
    setCode('')
    setName('')
  }
  return (
    <div className="min-w-64 space-y-1 text-xs">
      {value.map((cc, i) => (
        <div key={cc.code} className="flex items-center gap-1">
          <span className="w-20 font-mono">{cc.code}</span>
          <input
            className={`w-36 ${input}`}
            value={cc.name}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
          />
          <button
            className="text-destructive"
            title="Remove"
            onClick={() => window.confirm(`Remove cost center ${cc.code}?`) && onChange(value.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <input className={`w-20 ${input}`} placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <input className={`w-36 ${input}`} placeholder="Name (e.g. Transfer)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="underline" disabled={!code.trim()} onClick={add}>
          + Add
        </button>
      </div>
    </div>
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

interface HoldingRow {
  _id: string
  name: string
  companies: { _id: string; name: string }[]
}

/** Şirketin holding'i (General): seçince bağlanır, "—" ayırır. */
function CompanyHoldingPick({ company: c }: { company: CompanyRow }) {
  const holdings = (useQuery(api.platform.holdings) ?? []) as HoldingRow[]
  const { run: setHolding, error, clearError } = useSafeMutation(api.platform.setCompanyHolding)
  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
      <ErrorBanner message={error} onDismiss={clearError} />
      <label className="flex items-center gap-2">
        Holding
        <select
          className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
          value={c.holdingId ?? ''}
          onChange={(e) => void setHolding({ companyId: c._id, holdingId: e.target.value || null })}
        >
          <option value="">— none —</option>
          {holdings.map((h) => (
            <option key={h._id} value={h._id}>
              {h.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

/**
 * Holdingler (General): şirketleri bir araya getirir. Holding board üyeleri
 * holding'in bütün şirketlerinin ve plantlerinin özetini (Board Dashboard,
 * KPI / OEE dashboard'ları) salt okunur görür; şirket verisine yazamaz.
 */
function HoldingsSection({ companies }: { companies: CompanyRow[] }) {
  const holdings = (useQuery(api.platform.holdings) ?? []) as HoldingRow[]
  const { run: saveHolding, error, clearError } = useSafeMutation(api.platform.saveHolding)
  const { run: removeHolding } = useSafeMutation(api.platform.removeHolding)
  const [name, setName] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-foreground">Holdings</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        A holding groups companies. Its board members see every company and plant of the holding on the Board Dashboard and
        the KPI / OEE dashboards — read only. Link a company to a holding on the company card above.
      </p>
      <ErrorBanner message={error} onDismiss={clearError} />
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <input className={`w-60 ${input}`} placeholder="New holding name" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className={btn}
          disabled={!name.trim()}
          onClick={async () => {
            if (await saveHolding({ name: name.trim() })) setName('')
          }}
        >
          Add holding
        </button>
      </div>
      <div className="mt-3 space-y-3">
        {holdings.map((h) => (
          <div key={h._id} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-foreground">{h.name}</span>
              <span className="text-xs text-muted-foreground">
                Companies: {h.companies.map((c) => c.name).join(', ') || '— none yet —'}
              </span>
              <button className="ml-auto text-xs underline" onClick={() => setOpen(open === h._id ? null : h._id)}>
                {open === h._id ? 'Hide board members' : 'Board members'}
              </button>
              <button
                className="text-xs text-destructive hover:underline"
                onClick={() => window.confirm(`Delete the holding ${h.name}? Its companies stay; its board members' accounts are removed.`) && void removeHolding({ id: h._id })}
              >
                Delete
              </button>
            </div>
            {open === h._id && (
              <div className="mt-2">
                <CompanyUsers companyId={null} groups={[]} holdingId={h._id} />
              </div>
            )}
          </div>
        ))}
        {!holdings.length && <p className="text-xs text-muted-foreground">No holding yet.{companies.length > 1 ? ' Add one to see several companies together.' : ''}</p>}
      </div>
    </section>
  )
}
