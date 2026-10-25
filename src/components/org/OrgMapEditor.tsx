import { useEffect, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { MODULES, type Level, type Module } from '../../lib/tenancy'
import { ErrorBanner } from '../ErrorBanner'
import { CompanyDataActions, CompanyStatusModules, type CompanyInfo } from './CompanyControls'
import { HOLDING_TARGETS_HINT, HoldingTargetsForm } from './HoldingTargets'
import { DepartmentOwnerSelect } from './DepartmentOwner'
import { nodeEdits, plantLocaleHint, type MapNode } from '../../lib/orgMap'
import { addCostCenter, addDepartment, editCostCenter, removeCostCenter, removeDepartment, renameDepartment, type OrgCompany, type OrgHolding, type OrgPlant } from '../../lib/orgTree'
import { useSafeMutation } from '../../lib/useSafeMutation'
import type { GroupRow, UserRow } from '../CompanyAdmin'

/**
 * Organization map → seçili düğümün düzenleme kutusu: ad değiştir, alt seviye
 * ekle, sil. Eski sayfaların kullandığı aynı mutation'lar çağrılır; yetki ve
 * korumalar (dolu bölüm, work center'lı masraf yeri, ad onayı) sunucudadır.
 * Hangi düğümde ne yapılabileceği `nodeEdits` (src/lib/orgMap.ts).
 * Kişiler görünümünde yeni grup hiçbir plant'i görmez ve izni yoktur (plant'e
 * sürüklenir, izin Users & permissions'ta verilir); yeni kullanıcının parolası
 * da orada verilir.
 */

const btn = 'rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40'
const input = 'w-full rounded-md border border-input bg-background px-2 py-1 text-xs'

const ADD_LABEL = { company: 'company', plant: 'plant', department: 'department', costCenter: 'cost center', group: 'group', user: 'user' } as const
const NO_PERMS = Object.fromEntries(MODULES.map((m) => [m, 'none'])) as Record<Module, Level>

type Mode = 'rename' | 'add' | null

export function OrgMapEditor({
  node,
  companies,
  holdings = [],
  isPlatform,
  view = 'structure',
  users = [],
  groups = [],
  onDone,
}: {
  node: MapNode
  companies: OrgCompany[]
  holdings?: OrgHolding[]
  isPlatform: boolean
  view?: 'structure' | 'people'
  users?: UserRow[]
  groups?: GroupRow[]
  onDone: (text: string, removed?: boolean) => void
}) {
  const edits = nodeEdits(node.ref, isPlatform, view)
  const [mode, setMode] = useState<Mode>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [country, setCountry] = useState('')
  const [zone, setZone] = useState('')

  // Başka düğüm seçilince açık form kapanır.
  useEffect(() => setMode(null), [node.id])

  const saveHolding = useSafeMutation(api.platform.saveHolding)
  const removeHolding = useSafeMutation(api.platform.removeHolding)
  const createCompany = useSafeMutation(api.platform.createCompany)
  const updateCompany = useSafeMutation(api.platform.updateCompany)
  const deleteCompany = useSafeMutation(api.platform.deleteCompany)
  const createPlant = useSafeMutation(api.platform.createPlant)
  const updatePlant = useSafeMutation(api.platform.updatePlant)
  const deletePlant = useSafeMutation(api.platform.deletePlant)
  const saveGroup = useSafeMutation(api.users.saveGroup)
  const removeGroup = useSafeMutation(api.users.removeGroup)
  const addUser = useSafeMutation(api.users.add)
  const updateUser = useSafeMutation(api.users.update)
  const removeUser = useSafeMutation(api.users.remove)
  const all = [saveHolding, removeHolding, createCompany, updateCompany, deleteCompany, createPlant, updatePlant, deletePlant, saveGroup, removeGroup, addUser, updateUser, removeUser]
  const error = all.find((m) => m.error)?.error ?? null
  const pending = all.some((m) => m.pending)

  const ref = node.ref
  const plantOf = (id: string): OrgPlant | undefined => companies.flatMap((c) => c.plants).find((p) => p._id === id)
  const companyOf = (id: string) => companies.find((c) => c._id === id)
  const savePlant = (p: OrgPlant, s: { departments: string[]; costCenters: OrgPlant['costCenters'] }) =>
    updatePlant.run({ id: p._id, name: p.name, departments: s.departments, costCenters: s.costCenters ?? [] })

  const open = (m: Mode) => {
    all.forEach((x) => x.clearError())
    setMode(m)
    setCode('')
    if (m === 'rename') setName(node.label)
    else setName('')
    if (m === 'add' && edits.add === 'plant' && ref.kind === 'company') {
      const hint = plantLocaleHint(companyOf(ref.id))
      setCountry(hint.country)
      setZone(hint.timeZone)
    }
  }

  const rename = async () => {
    const n = name.trim()
    if (!n) return
    let ok = false
    if (ref.kind === 'holding') ok = await saveHolding.run({ id: ref.id, name: n })
    if (ref.kind === 'company') {
      const c = companyOf(ref.id)
      if (c) ok = await updateCompany.run({ id: c._id, name: n, modules: c.modules, status: c.status })
    }
    if (ref.kind === 'plant') ok = await updatePlant.run({ id: ref.id, name: n })
    if (ref.kind === 'department') {
      const p = plantOf(ref.plantId)
      if (p) ok = await savePlant(p, renameDepartment(p, ref.name, n))
    }
    if (ref.kind === 'costCenter') {
      const p = plantOf(ref.plantId)
      if (p) ok = await savePlant(p, editCostCenter(p, ref.code, { name: n }))
    }
    if (ref.kind === 'group') {
      const g = groups.find((x) => x._id === ref.id)
      // areas gönderilmez: sunucu grubun alan izinlerini korur.
      if (g) ok = await saveGroup.run({ id: g._id, companyId: ref.companyId, name: n, allPlants: g.allPlants, plantIds: g.plantIds, permissions: g.permissions, board: g.board === true })
    }
    if (ref.kind === 'user') {
      const u = users.find((x) => x._id === ref.id)
      // groupIds / isCreator gönderilmez: sunucu olduğu gibi bırakır.
      if (u) ok = await updateUser.run({ id: u._id, name: n, email: u.email, active: u.active })
    }
    if (ok) {
      setMode(null)
      onDone(`Renamed to ${n}`)
    }
  }

  const add = async () => {
    const n = name.trim()
    if (!n) return
    let ok = false
    if (ref.kind === 'holding') ok = await createCompany.run({ name: n, modules: [...MODULES], holdingId: ref.id })
    if (ref.kind === 'company') ok = await createPlant.run({ companyId: ref.id, name: n, country: country.trim(), timeZone: zone.trim() })
    if (ref.kind === 'plant') {
      const p = plantOf(ref.id)
      if (p) ok = await savePlant(p, addDepartment(p, n))
    }
    if (ref.kind === 'department') {
      const p = plantOf(ref.plantId)
      if (p && code.trim()) ok = await savePlant(p, addCostCenter(p, { code: code.trim(), name: n, department: ref.name }))
    }
    if (ref.kind === 'company' && edits.add === 'group') ok = await saveGroup.run({ companyId: ref.id, name: n, allPlants: false, plantIds: [], permissions: NO_PERMS })
    if (ref.kind === 'group') ok = await addUser.run({ companyId: ref.companyId, name: n, groupIds: [ref.id] })
    if (ok) {
      setMode(null)
      onDone(`Added ${edits.add ? ADD_LABEL[edits.add] : ''} ${n}`)
    }
  }

  const remove = async () => {
    let ok = false
    if (ref.kind === 'holding') {
      if (!window.confirm(`Delete the holding ${node.label}? Its board members' accounts are removed.`)) return
      ok = await removeHolding.run({ id: ref.id })
    }
    if (ref.kind === 'company' || ref.kind === 'plant') {
      // Aynı onay eski sayfadaki gibi: adı yazmak gerekir (veri kalıcı silinir).
      const typed = window.prompt(`Delete ${ref.kind === 'company' ? 'the company' : 'the plant'} ${node.label} and all its data? Type its name to confirm.`)
      if (typed === null) return
      ok = ref.kind === 'company' ? await deleteCompany.run({ id: ref.id, confirmName: typed }) : await deletePlant.run({ id: ref.id, confirmName: typed })
    }
    if (ref.kind === 'department') {
      const p = plantOf(ref.plantId)
      if (!p || !window.confirm(`Remove the department ${ref.name}? It must have no cost centers.`)) return
      ok = await savePlant(p, removeDepartment(p, ref.name))
    }
    if (ref.kind === 'costCenter') {
      const p = plantOf(ref.plantId)
      if (!p || !window.confirm(`Remove the cost center ${ref.code}? It must have no work centers and no KPI entries.`)) return
      ok = await savePlant(p, removeCostCenter(p, ref.code))
    }
    if (ref.kind === 'group') {
      if (!window.confirm(`Delete the group ${node.label}? Its members lose its permissions.`)) return
      ok = await removeGroup.run({ id: ref.id })
    }
    if (ref.kind === 'user') {
      if (!window.confirm(`Delete the user ${node.label}? Their sessions end; their name stays in old records.`)) return
      ok = await removeUser.run({ id: ref.id })
    }
    if (ok) onDone(`Deleted ${node.label}`, true)
  }

  // Şirket düğümü: askıya alma, kiralanan modüller (General) ve dışa aktarım
  // (creator da) — Holdings & companies ile aynı bileşenler.
  const company = ref.kind === 'company' && view === 'structure' ? (companyOf(ref.id) as CompanyInfo | undefined) : undefined
  const companySettings = company && (
    <div className="mt-3 space-y-1 border-t border-border pt-2">
      {isPlatform && <CompanyStatusModules company={company} />}
      <CompanyDataActions company={company} isPlatform={isPlatform} />
    </div>
  )

  // Holding düğümü (General): grup hedefleri — Holdings & companies ile aynı form.
  const holding = ref.kind === 'holding' && isPlatform && view === 'structure' ? holdings.find((h) => h._id === ref.id) : undefined
  const holdingSettings = holding && (
    <div className="mt-3 space-y-1 border-t border-border pt-2">
      <p className="text-xs font-semibold">Group targets</p>
      <p className="text-[11px] text-muted-foreground">{HOLDING_TARGETS_HINT}</p>
      <HoldingTargetsForm key={holding._id} holding={holding} />
    </div>
  )
  // Bölüm düğümü: sorumlu — Holdings & companies ile aynı seçici.
  const deptPlant = ref.kind === 'department' && view === 'structure' ? plantOf(ref.plantId) : undefined
  const departmentSettings = deptPlant && ref.kind === 'department' && (
    <div className="mt-3 border-t border-border pt-2">
      <DepartmentOwnerSelect key={`${deptPlant._id}:${ref.name}`} plant={deptPlant} department={ref.name} compact />
    </div>
  )
  const settings = companySettings || holdingSettings || departmentSettings

  if (edits.elsewhere) return <p className="mt-2 text-[11px] text-muted-foreground">Rename, add or delete on {edits.elsewhere}.</p>
  if (!edits.rename && !edits.add && !edits.remove) return settings || null

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-1">
        {edits.rename && (
          <button className={btn} onClick={() => open(mode === 'rename' ? null : 'rename')}>
            Rename
          </button>
        )}
        {edits.add && (
          <button className={btn} onClick={() => open(mode === 'add' ? null : 'add')}>
            Add {ADD_LABEL[edits.add]}
          </button>
        )}
        {edits.remove && (
          <button className={`${btn} text-destructive`} disabled={pending} onClick={() => void remove()}>
            Delete
          </button>
        )}
      </div>

      {mode && (
        <form
          className="space-y-1.5 rounded-md border border-border p-2"
          onSubmit={(e) => {
            e.preventDefault()
            void (mode === 'rename' ? rename() : add())
          }}
        >
          {mode === 'add' && edits.add === 'costCenter' && (
            <input className={input} placeholder="Code (e.g. 171) — cannot change later" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          )}
          <input
            className={input}
            placeholder={mode === 'rename' ? 'New name' : `Name of the new ${edits.add ? ADD_LABEL[edits.add] : ''}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus={!(mode === 'add' && edits.add === 'costCenter')}
          />
          {mode === 'add' && edits.add === 'plant' && (
            <div className="flex gap-1">
              <input className={`w-16 ${input}`} placeholder="Country" title="Two-letter code, e.g. RO, TR" value={country} onChange={(e) => setCountry(e.target.value)} />
              <input className={input} placeholder="Time zone, e.g. Europe/Bucharest" value={zone} onChange={(e) => setZone(e.target.value)} />
            </div>
          )}
          {mode === 'add' && edits.add === 'group' && <p className="text-[11px] text-muted-foreground">The new group sees no plant and has no permission: drag it onto a plant, set permissions on Users & permissions.</p>}
          {mode === 'add' && edits.add === 'user' && <p className="text-[11px] text-muted-foreground">Give a temporary password on Users & permissions (Set password).</p>}
          {mode === 'rename' && ref.kind === 'costCenter' && <p className="text-[11px] text-muted-foreground">The code {ref.code} stays (data is linked to it).</p>}
          <div className="flex gap-1">
            <button
              type="submit"
              className={btn}
              disabled={pending || !name.trim() || (mode === 'add' && edits.add === 'costCenter' && !code.trim()) || (mode === 'add' && edits.add === 'plant' && (!country.trim() || !zone.trim()))}
            >
              Save
            </button>
            <button type="button" className={btn} onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {edits.more && <p className="text-[11px] text-muted-foreground">{edits.more}</p>}
      <ErrorBanner message={error} onDismiss={() => all.forEach((m) => m.clearError())} />
      {settings}
    </div>
  )
}
