import { Link, createFileRoute } from '@tanstack/react-router'
import { usePaginatedQuery, useQuery } from '../lib/convexTransport'
import { useMemo, useState } from 'react'

import { ErrorBanner } from '../components/ErrorBanner'
import { SaveStatus } from '../components/SaveStatus'
import { UnsavedBar } from '../components/UnsavedBar'
import { draftOf, pressPayload, sameDraft } from '../lib/pressDraft'
import { useDraftRows } from '../lib/useDraftRows'
import { useSafeMutation } from '../lib/useSafeMutation'
import { PageHeader } from '../components/PageHeader'
import { relatedPages } from '../lib/navigation'
import { usePlant } from '../lib/plantContext'
import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/makineler')({
  component: MakinelerPage,
})

type Press = {
  _id: string
  name: string
  hall: string
  category?: string
  feedsCoil?: boolean
  frozenDays?: number
  costCenter?: string
}

type PlantCostCenter = { code: string; name: string; department?: string }

/** Masraf yeri seçici: fabrikanın masraf yerleri, bölümlerine göre gruplu. */
function CostCenterSelect({
  value,
  costCenters,
  onChange,
  className = '',
}: {
  value: string
  costCenters: PlantCostCenter[]
  onChange: (code: string) => void
  className?: string
}) {
  const known = costCenters.some((c) => c.code === value)
  const groups = new Map<string, PlantCostCenter[]>()
  for (const c of costCenters) {
    const d = c.department || 'Without a department'
    if (!groups.has(d)) groups.set(d, [])
    groups.get(d)!.push(c)
  }
  return (
    <select
      className={`rounded-md border bg-background px-2 py-1 text-sm ${known ? 'border-input' : 'border-amber-500'} ${className}`}
      value={known ? value : ''}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{value && !known ? `${value} — not a cost center of this plant` : '— choose —'}</option>
      {[...groups].map(([d, list]) => (
        <optgroup key={d} label={d}>
          {list.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

// Suggestions only — any text is accepted, since every shop names its press
// types differently.
const CATEGORY_SUGGESTIONS = [
  'Transfer work center',
  'Progressive 800 t',
  'Progressive 500 t',
  'Progressive 400 t',
  'Single stage',
]

function MakinelerPage() {
  const presses = (useQuery(api.presses.list) ?? []) as Press[]
  const costCenters = (usePlant().ctx?.active?.costCenters ?? []) as PlantCostCenter[]
  // OEE verisinde work center'ın geldiği masraf yeri: tanımı teyit etmek için.
  const seen = (useQuery(api.presses.costCentersSeen) ?? []) as { workCenter: string; costCenter: string }[]
  const seenBy = useMemo(() => new Map(seen.map((s) => [s.workCenter, s.costCenter])), [seen])
  const ccName = (code: string) => costCenters.find((c) => c.code === code)?.name
  const {
    run: upsert,
    error: upsertError,
    clearError,
  } = useSafeMutation(api.presses.upsert)
  const { run: remove, error: removeError } = useSafeMutation(api.presses.remove)
  const { results: products } = usePaginatedQuery(
    api.products.list,
    {},
    { initialNumItems: 500 },
  )

  const [name, setName] = useState('')
  const [hall, setHall] = useState('')
  const [category, setCategory] = useState('')
  const [feedsCoil, setFeedsCoil] = useState(true)
  const [costCenter, setCostCenter] = useState('')
  const [saving, setSaving] = useState(false)

  const byName = useMemo(() => new Map(presses.map((p) => [p.name, p])), [presses])

  const rows = useDraftRows(presses, (p) => p._id, draftOf, sameDraft)

  const savePress = (id: string) => async (draft: ReturnType<typeof draftOf>) => {
    const press = presses.find((p) => p._id === id)
    if (!press) return false
    // Kayıt her zaman eksiksiz gönderilir: sunucu tarafı gelmeyen alanı
    // silinmiş sayar, bu yüzden kısmi gönderim diğer alanları uçurur.
    return upsert(pressPayload(press.name, draft))
  }

  // Referanslardaki ana/alternatif makine alanlarında geçen ama henüz
  // tanımlanmamış presler — tek tıkla eklenebilsin.
  const undefinedPresses = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) {
      for (const m of [p.mainMachine, p.altMachine1, p.altMachine2, p.altMachine3, p.altMachine4]) {
        if (m && m.trim() && !byName.has(m.trim())) set.add(m.trim())
      }
    }
    return Array.from(set).sort()
  }, [products, byName])

  const halls = useMemo(() => {
    const map = new Map<string, Press[]>()
    for (const p of presses) {
      const key = p.hall || '(no hall assigned)'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [presses])

  async function addPress() {
    const n = name.trim()
    if (!n) return
    setSaving(true)
    let ok = false
    try {
      ok = await upsert({
        name: n,
        hall: hall.trim(),
        category: category.trim() || undefined,
        feedsCoil,
        costCenter: costCenter || undefined,
      })
    } finally {
      setSaving(false)
    }
    // Girdileri yalnızca kayıt gerçekten başarılıysa temizle.
    if (ok) {
      setName('')
    }
  }

  const known = new Set(costCenters.map((c) => c.code))
  const unlinked = presses.filter((p) => !p.costCenter || !known.has(p.costCenter))
  const differs = presses.filter((p) => p.costCenter && seenBy.has(p.name) && seenBy.get(p.name) !== p.costCenter)

  const inputClass =
    'rounded-md border border-input bg-background px-2 py-1 text-sm'

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title="Work Center Definitions"
        summary="Cost center, hall, category and coil feed of every work center — the single work center list of the program."
        links={relatedPages('/makineler')}
        info={
          <>
            <p>
              <b>Cost center:</b> every work center belongs to one cost center of the plant (Plant → Department →
              Cost center → Work center). The cost centers are defined on Companies and plants; when the OEE data
              shows a work center under another cost center, the row says so.
            </p>
            <p>
              <b>Hall:</b> work centers in the same hall cannot set up at the same time — the crane
              constraint the planner relies on.
            </p>
            <p>
              <b>Category</b> groups work centers into lines: the Gantt groups by it and the Capacity
              Dashboard adds up work centers with the same category (e.g. Transfer = 106 + 107). It does
              not decide where a part runs — that comes from the main and alternative machines in
              master data.
            </p>
            <p>
              <b>Coil fed</b> marks a progressive line: the first coil goes on during setup and every
              coil after it costs a coil change. A transfer work center runs blanks, so it has a single
              setup and no coil changes — untick it there.
            </p>
            <p>
              <b>Frozen days</b> locks that work center's plan for the given number of days; leave it
              empty to use the global setting.
            </p>
            <p>
              Only work centers defined here appear on the Work Calendar, the Capacity Dashboard and the
              overtime lists. Each work center also needs a Work Calendar pattern, otherwise it has no
              capacity.
            </p>
          </>
        }
      />
      <p className="mt-2 text-xs text-muted-foreground">
        Edits are saved with Save on the row, or Save all at the bottom.
      </p>

      <ErrorBanner message={upsertError ?? removeError} onDismiss={clearError} />

      {costCenters.length === 0 ? (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          This plant has no cost center yet. Every work center belongs to a cost center — add the departments and cost
          centers on{' '}
          <Link to="/platform" className="underline">
            Companies and plants
          </Link>{' '}
          first.
        </div>
      ) : (
        (unlinked.length > 0 || differs.length > 0) && (
          <div className="mt-4 space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            {unlinked.length > 0 && (
              <p>
                <b>{unlinked.length}</b> work center{unlinked.length === 1 ? '' : 's'} without a cost center:{' '}
                {unlinked.map((p) => p.name).join(', ')} — choose one on each row and Save.
              </p>
            )}
            {differs.length > 0 && (
              <p>
                <b>{differs.length}</b> differ from the OEE data:{' '}
                {differs.map((p) => `${p.name} (here ${p.costCenter}, OEE ${seenBy.get(p.name)})`).join(', ')}.
              </p>
            )}
          </div>
        )
      )}

      <div className="mt-6 flex flex-wrap items-end gap-2 rounded-lg border border-border p-4">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Work center name</span>
          <input
            className="mt-1 w-40 rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="PRS-107"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addPress()
            }}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Hall</span>
          <input
            className="mt-1 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Hol 1"
            value={hall}
            onChange={(e) => setHall(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Category</span>
          <input
            className="mt-1 w-44 rounded-md border border-input bg-background px-3 py-2 text-sm"
            list="press-categories"
            placeholder="Progressive 800 t"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <datalist id="press-categories">
            {CATEGORY_SUGGESTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Cost center</span>
          <CostCenterSelect className="mt-1 py-2" value={costCenter} costCenters={costCenters} onChange={setCostCenter} />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={feedsCoil}
            onChange={(e) => setFeedsCoil(e.target.checked)}
          />
          <span className="text-xs text-muted-foreground">
            Coil fed
            <span className="block text-[10px]">uncheck for transfer work centers</span>
          </span>
        </label>
        <button
          onClick={() => void addPress()}
          disabled={!name.trim() || !costCenter || saving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Adding…' : 'Add work center'}
        </button>
      </div>

      {undefinedPresses.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Work centers referenced in master data but not yet defined
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {undefinedPresses.map((p) => (
              <button
                key={p}
                onClick={() =>
                  void upsert({
                    name: p,
                    hall: hall.trim(),
                    category: category.trim() || undefined,
                    feedsCoil,
                    costCenter: costCenter || undefined,
                  })
                }
                disabled={!costCenter}
                className="rounded-md bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-200 disabled:opacity-50"
              >
                + {p}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-amber-800">
            Clicking adds the work center with the hall, category, cost center and coil setting
            entered in the boxes above.
          </p>
        </div>
      )}

      {presses.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No work centers defined yet.
        </p>
      ) : (
        <div className="mt-8 space-y-6">
          {halls.map(([hallName, list]) => (
            <div key={hallName}>
              <h2 className="text-sm font-semibold text-foreground">
                {hallName}{' '}
                <span className="font-normal text-muted-foreground">
                  ({list.length} work centers — one setup at a time)
                </span>
              </h2>
              <div className="mt-2 overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Work center</th>
                      <th className="px-3 py-2 font-medium">Hall</th>
                      <th className="px-3 py-2 font-medium">Category</th>
                      <th className="px-3 py-2 font-medium" title="Every work center belongs to one cost center of the plant (Plant → Department → Cost center → Work center)">
                        Cost center
                      </th>
                      <th
                        className="px-3 py-2 font-medium"
                        title="Progressive lines are coil fed; transfer work centers run blanks and have a single setup"
                      >
                        Coil fed
                      </th>
                      <th className="px-3 py-2 font-medium" title="Days of this work center's plan that stay locked">
                        Frozen days
                      </th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {list
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((p) => {
                        const draft = rows.draftFor(p)
                        const dirty = rows.isDirty(p)
                        const busy = rows.savingKey === p._id
                        const saveThisRow = () => {
                          if (dirty && !busy) void rows.commit(p._id, savePress(p._id))
                        }
                        return (
                          <tr
                            key={p._id}
                            className={`border-t border-border ${dirty ? 'bg-amber-50' : ''}`}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveThisRow()
                            }}
                          >
                            <td className="px-3 py-2 font-medium text-foreground">{p.name}</td>
                            <td className="px-3 py-2">
                              <input
                                className={`w-32 ${inputClass}`}
                                value={draft.hall}
                                onChange={(e) => rows.edit(p._id, { hall: e.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                className={`w-40 ${inputClass}`}
                                list="press-categories"
                                placeholder="—"
                                value={draft.category}
                                onChange={(e) => rows.edit(p._id, { category: e.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <CostCenterSelect
                                value={draft.costCenter}
                                costCenters={costCenters}
                                onChange={(code) => rows.edit(p._id, { costCenter: code })}
                              />
                              {seenBy.has(p.name) && seenBy.get(p.name) !== draft.costCenter && (
                                <button
                                  className="mt-1 block text-[11px] text-amber-800 underline"
                                  title="The cost center this work center has in the latest OEE upload"
                                  onClick={() => rows.edit(p._id, { costCenter: seenBy.get(p.name)! })}
                                >
                                  OEE data: {seenBy.get(p.name)}
                                  {ccName(seenBy.get(p.name)!) ? ` — ${ccName(seenBy.get(p.name)!)}` : ''} · use
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                className="h-4 w-4"
                                checked={draft.feedsCoil}
                                onChange={(e) =>
                                  rows.edit(p._id, { feedsCoil: e.target.checked })
                                }
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min={0}
                                className={`w-20 ${inputClass}`}
                                placeholder="—"
                                value={draft.frozenDays}
                                onChange={(e) => rows.edit(p._id, { frozenDays: e.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <SaveStatus
                                dirty={dirty}
                                saving={busy}
                                justSaved={!!rows.justSaved[p._id]}
                              />
                            </td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              <button
                                onClick={saveThisRow}
                                disabled={!dirty || busy}
                                className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
                              >
                                Save
                              </button>
                              <button
                                className="ml-3 text-xs text-destructive hover:underline"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Delete work center ${p.name}? This cannot be undone.`,
                                    )
                                  ) {
                                    void remove({ id: p._id as never })
                                  }
                                }}
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
            </div>
          ))}
        </div>
      )}

      <UnsavedBar
        count={rows.dirtyKeys.length}
        saving={rows.savingKey !== null}
        noun="work center"
        onSaveAll={() => void rows.commitAll((id, draft) => savePress(id)(draft))}
        onDiscard={rows.discardAll}
      />
    </div>
  )
}
