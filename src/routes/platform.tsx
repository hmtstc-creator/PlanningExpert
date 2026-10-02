import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { api } from '../../convex/_generated/api'
import { CompanyGroups, CompanyUsers, type GroupRow } from '../components/CompanyAdmin'
import { ErrorBanner } from '../components/ErrorBanner'
import { PageHeader } from '../components/PageHeader'
import { SaveStatus } from '../components/SaveStatus'
import { useQuery } from '../lib/convexTransport'
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
}

interface CompanyRow {
  _id: string
  name: string
  status: 'active' | 'suspended'
  modules: Module[]
  deleteAfter?: number
  plants: PlantRow[]
  userCount: number
  creators: string[]
}

interface PlantDraft {
  name: string
  code: string
  country: string
  timeZone: string
  disabledModules: Module[]
}

const plantDraft = (p: PlantRow): PlantDraft => ({
  name: p.name,
  code: p.code ?? '',
  country: p.country ?? '',
  timeZone: p.timeZone ?? '',
  disabledModules: [...(p.disabledModules ?? [])].sort(),
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
  const { run: updatePlant } = useSafeMutation(api.platform.updatePlant)
  const drafts = useDraftRows(c.plants, (p) => p._id, plantDraft, samePlant)
  const savePlant = (id: string) => (d: PlantDraft) =>
    updatePlant({ id, name: d.name, code: d.code, country: d.country, timeZone: d.timeZone, ...(isPlatform ? { disabledModules: d.disabledModules } : {}) })
  const groups = (useQuery(api.users.listGroups, open ? { companyId: c._id } : 'skip') ?? []) as GroupRow[]
  const save = (patch: Partial<Pick<CompanyRow, 'name' | 'modules' | 'status'>>) =>
    void updateCompany({ id: c._id, name: patch.name ?? c.name, modules: patch.modules ?? c.modules, status: patch.status ?? c.status })

  return (
    <section className={`rounded-lg border p-4 ${c.status === 'active' ? 'border-border' : 'border-amber-400 bg-amber-50/40'}`}>
      <ErrorBanner message={error ?? plantError} onDismiss={clearError} />
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
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Country</th>
              <th className="px-3 py-2 font-medium">Time zone</th>
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
  modules,
  isPlatform,
}: {
  draft: PlantDraft
  dirty: boolean
  saving: boolean
  justSaved: boolean
  onEdit: (patch: Partial<PlantDraft>) => void
  onSave: () => void
  modules: Module[]
  isPlatform: boolean
}) {
  const text = (key: 'name' | 'code' | 'country' | 'timeZone', w: string) => (
    <input className={`${w} ${input}`} value={d[key]} onChange={(e) => onEdit({ [key]: e.target.value })} />
  )
  return (
    <tr className={`border-t border-border ${dirty ? 'bg-amber-50' : ''}`}>
      <td className="px-3 py-2">{text('name', 'w-40')}</td>
      <td className="px-3 py-2">{text('code', 'w-20')}</td>
      <td className="px-3 py-2">{text('country', 'w-16')}</td>
      <td className="px-3 py-2">{text('timeZone', 'w-44')}</td>
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
      </td>
    </tr>
  )
}
