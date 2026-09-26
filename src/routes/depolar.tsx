import { createFileRoute } from '@tanstack/react-router'
import { usePaginatedQuery } from '../lib/convexTransport'
import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { ErrorBanner } from '../components/ErrorBanner'
import { SaveStatus } from '../components/SaveStatus'
import { UnsavedBar } from '../components/UnsavedBar'
import { countsFinished, countsProduction, countsRaw } from '../lib/stockLocations'
import { useDraftRows } from '../lib/useDraftRows'
import { useSafeMutation } from '../lib/useSafeMutation'
import { PageHeader } from '../components/PageHeader'
import { relatedPages } from '../lib/navigation'

export const Route = createFileRoute('/depolar')({
  component: DepolarPage,
})


function DepolarPage() {
  const { results: locations } = usePaginatedQuery(
    api.storageLocations.list,
    {},
    { initialNumItems: 100 },
  )
  const { results: stockRows } = usePaginatedQuery(
    api.stock.list,
    {},
    { initialNumItems: 500 },
  )
  const {
    run: upsert,
    error: upsertError,
    clearError,
  } = useSafeMutation(api.storageLocations.upsert)
  const { run: removeLocation, error: removeError } = useSafeMutation(
    api.storageLocations.remove,
  )

  const [saving, setSaving] = useState<string | null>(null)
  const [newCode, setNewCode] = useState('')

  // Kategori ve not birlikte kaydedilir: `upsert` kaydı tümüyle değiştirir,
  // bu yüzden yalnızca birini göndermek diğerini siler.
  // Tikler kayıtta boşsa varsayılan gösterilir; kaydedince açıkça yazılır.
  const rows = useDraftRows(
    locations,
    (l) => l.code,
    (l) => ({
      description: l.description ?? '',
      countFinished: countsFinished(l),
      countRaw: countsRaw(l),
      countProduction: countsProduction(l),
    }),
    (a, b) =>
      a.description === b.description &&
      a.countFinished === b.countFinished &&
      a.countRaw === b.countRaw &&
      a.countProduction === b.countProduction,
  )

  const saveLocation = (code: string) => (draft: {
    description: string
    countFinished: boolean
    countRaw: boolean
    countProduction: boolean
  }) =>
    upsert({
      code,
      description: draft.description.trim() || undefined,
      countFinished: draft.countFinished,
      countRaw: draft.countRaw,
      countProduction: draft.countProduction,
    })

  const byCode = useMemo(
    () => new Map(locations.map((l) => [l.code, l])),
    [locations],
  )

  // Only locations the user has defined. MB52 no longer seeds this list:
  // stock in an undefined location is explicitly not our concern, and the
  // upload now rejects those rows and names them in its result message.
  const allCodes = useMemo(
    () => locations.map((l) => l.code).sort(),
    [locations],
  )

  async function addManualLocation() {
    const code = newCode.trim()
    if (!code) return
    setSaving(code)
    let ok = false
    try {
      ok = await upsert({ code })
    } finally {
      setSaving(null)
    }
    // Kutu yalnızca kayıt gerçekten başarılıysa temizlenir.
    if (ok) setNewCode('')
  }

  // MB52'de görünen ama burada tanımlı olmayan depolar (hammadde kodları
  // depo süzgecinden muaf yüklendiği için burada çıkabilir).
  const undefinedInStock = useMemo(() => {
    const defined = new Set(locations.map((l) => l.code))
    const found = new Set<string>()
    for (const s of stockRows) {
      const loc = s.storageLocation?.trim()
      if (loc && !defined.has(loc)) found.add(loc)
    }
    return [...found].sort()
  }, [locations, stockRows])

  const stockByLocation = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of stockRows) {
      if (!s.storageLocation) continue
      map.set(
        s.storageLocation,
        (map.get(s.storageLocation) ?? 0) + (s.unrestricted ?? 0),
      )
    }
    return map
  }, [stockRows])

  /**
   * Deletes a storage location definition. A location that still appears in
   * MB52 stock does not disappear from the list — only its definition
   * (ticks/note) is removed and it falls back to the defaults, because the
   * stock data keeps producing that code.
   */
  async function deleteLocation(code: string) {
    const record = byCode.get(code)
    if (!record) return
    const stillInStock = stockRows.some((s) => s.storageLocation === code)
    const message = stillInStock
      ? `Delete the definition for storage location ${code}? It still appears in MB52 stock, so it will stay in the list but fall back to the default ticks.`
      : `Remove storage location ${code} from the list entirely?`
    if (!window.confirm(message)) return
    setSaving(code)
    try {
      await removeLocation({ id: record._id })
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title="Storage Locations"
        summary="Which stock do I really have? Tick what each location counts for."
        links={relatedPages('/depolar')}
        info={
          <>
            <p>
              Define the storage locations you care about and choose how each one is treated in
              planning. MB52 rows in any location that is not defined here are ignored on upload —
              stock you have not declared is not your stock.
            </p>
            <ul>
              <li>
                <b>Finished goods:</b> plan and raw material netting.
              </li>
              <li>
                <b>Raw material:</b> coils on hand for coil orders.
              </li>
              <li>
                <b>Production receipt:</b> MB51 101 movements into this location minus 102 reversals
                are the actual production (plan versus actual, performance, mould shot counters).
              </li>
            </ul>
            <p>
              Without a saved tick, 2009 and 1009 count for finished goods and raw material, and
              2009 for production receipt. Stock in an unticked location is shown but never
              netted.
            </p>
          </>
        }
      />


      <div className="mt-6 flex gap-2">
        <input
          className="w-48 rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Location code (e.g. 1009)"
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addManualLocation()
          }}
        />
        <button
          onClick={() => void addManualLocation()}
          disabled={!newCode.trim() || saving === newCode.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Add location
        </button>
      </div>

      <ErrorBanner message={upsertError ?? removeError} onDismiss={clearError} />
      <p className="mt-3 text-xs text-muted-foreground">
        Changes are saved with Save on the row, or Save all at the bottom.
      </p>

      {undefinedInStock.length > 0 && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          MB52 has stock in locations not defined here:{' '}
          {undefinedInStock.map((code, i) => (
            <span key={code}>
              {i > 0 && ', '}
              <button
                className="font-semibold underline hover:no-underline"
                onClick={() => setNewCode(code)}
                title="Put this code in the box above"
              >
                {code}
              </button>
            </span>
          ))}
          . Define them to decide whether they count.
        </p>
      )}

      {allCodes.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No storage locations defined yet. Add the codes you care about above —
          MB52 rows in any other location are ignored on upload.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Location</th>
                <th className="px-3 py-2 font-medium">Note</th>
                <th className="px-3 py-2 text-center font-medium">
                  Finished goods
                  <div className="font-normal">plan &amp; MRP netting</div>
                </th>
                <th className="px-3 py-2 text-center font-medium">
                  Raw material
                  <div className="font-normal">coil on hand (MRP)</div>
                </th>
                <th className="px-3 py-2 text-center font-medium">
                  Production receipt
                  <div className="font-normal">MB51 101 − 102</div>
                </th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {allCodes.map((code) => {
                const current = byCode.get(code)
                if (!current) return null
                const qty = stockByLocation.get(code) ?? 0
                const draft = rows.draftFor(current)
                const dirty = rows.isDirty(current)
                const busy = rows.savingKey === code || saving === code
                const saveCard = () => {
                  if (dirty && !busy) void rows.commit(code, saveLocation(code))
                }
                return (
                  <tr
                    key={code}
                    className={`border-t border-border ${dirty ? 'bg-amber-50' : ''}`}
                  >
                    <td className="px-3 py-2 align-middle">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-semibold text-foreground">{code}</span>
                        <SaveStatus
                          dirty={dirty}
                          saving={busy}
                          justSaved={!!rows.justSaved[code]}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {qty.toLocaleString('en-GB')} in stock
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className="w-full min-w-40 rounded-md border border-input bg-background px-2 py-1 text-sm"
                        placeholder="Optional note"
                        value={draft.description}
                        onChange={(e) => rows.edit(code, { description: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveCard()
                        }}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Count finished goods in ${code}`}
                        className="h-5 w-5 accent-emerald-600"
                        disabled={busy}
                        checked={draft.countFinished}
                        onChange={(e) => rows.edit(code, { countFinished: e.target.checked })}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Count raw material in ${code}`}
                        className="h-5 w-5 accent-sky-600"
                        disabled={busy}
                        checked={draft.countRaw}
                        onChange={(e) => rows.edit(code, { countRaw: e.target.checked })}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Count MB51 production receipts in ${code}`}
                        className="h-5 w-5 accent-violet-600"
                        disabled={busy}
                        checked={draft.countProduction}
                        onChange={(e) => rows.edit(code, { countProduction: e.target.checked })}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button
                        onClick={saveCard}
                        disabled={!dirty || busy}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
                      >
                        Save
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void deleteLocation(code)}
                        title="Delete this storage location definition"
                        className="ml-1 rounded-md px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
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


      <UnsavedBar
        count={rows.dirtyKeys.length}
        saving={rows.savingKey !== null}
        noun="location"
        onSaveAll={() => void rows.commitAll((code, draft) => saveLocation(code)(draft))}
        onDiscard={rows.discardAll}
      />
    </div>
  )
}
