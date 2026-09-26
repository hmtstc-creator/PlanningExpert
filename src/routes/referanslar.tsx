import { createFileRoute } from '@tanstack/react-router'
import { useMutation, usePaginatedQuery } from '../lib/convexTransport'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { ErrorBanner } from '../components/ErrorBanner'
import { SaveStatus } from '../components/SaveStatus'
import { UnsavedBar } from '../components/UnsavedBar'
import {
  changedProductFields,
  productDraftOf,
  sameProductDraft,
  PRODUCT_FIELDS,
  type ProductDraft,
  type ProductField,
} from '../lib/productDraft'
import { useDraftRows } from '../lib/useDraftRows'
import { useSafeMutation } from '../lib/useSafeMutation'
import { lotRuleOf, piecesPerCoil, shotsPerCoil, type ProductSpec } from '../lib/planning'
import { ExcelUpload } from '../components/ExcelUpload'
import { friendlyError } from '../lib/mutationErrors'

export const Route = createFileRoute('/referanslar')({
  component: ReferanslarPage,
})

const emptyForm = {
  code: '',
  coProduct: '',
  moldCavities: '',
  spm: '',
  rawMaterialCode: '',
  coilWeight: '',
  grossWeight: '',
  minLotQty: '',
  setupMinutes: '',
  coilSetupMinutes: '',
  mainMachine: '',
  altMachine1: '',
  altMachine2: '',
  altMachine3: '',
  altMachine4: '',
  flexiblePress: '',
  maxShots: '',
  qualityApprovalMinutes: '',
  performanceFactor: '',
}

function ReferanslarPage() {
  const createProduct = useMutation(api.products.create)
  const bulkUpsert = useMutation(api.products.bulkUpsert)
  const removeProduct = useMutation(api.products.remove)
  const {
    run: updateField,
    error: updateError,
    clearError,
  } = useSafeMutation(api.products.updateField)
  const [search, setSearch] = useState('')

  const { results: products, status } = usePaginatedQuery(
    api.products.list,
    {},
    { initialNumItems: 200 },
  )

  // Excel uploads bring hundreds of rows; without a filter, correcting one
  // material means scrolling through all of them.
  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter((p) =>
      [
        p.code,
        p.coProduct,
        p.rawMaterialCode,
        p.mainMachine,
        p.altMachine1,
        p.altMachine2,
        p.altMachine3,
        p.altMachine4,
      ].some((v) => v && String(v).toLowerCase().includes(q)),
    )
  }, [products, search])

  // Satır bazlı taslak: bir hücreyi düzenlemek satırı "Unsaved" yapar ve
  // kayıt açık bir eylemdir. Alanlar tek tek yazıldığı için (updateField)
  // kısmi kayıt riski yok, ama kullanıcının kaydettiğini görmesi gerekiyor.
  const rows = useDraftRows(products, (p) => String(p._id), productDraftOf, sameProductDraft)

  const saveRow = (id: string) => async (draft: ProductDraft): Promise<boolean> => {
    const product = products.find((p) => String(p._id) === id)
    if (!product) return false
    const server = productDraftOf(product)
    for (const field of changedProductFields(draft, server)) {
      const ok = await onSaveField(updateField, id, field.name, draft[field.name], field.numeric)
      if (!ok) return false
    }
    return true
  }

  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function update<K extends keyof typeof emptyForm>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const num = (s: string) => (s.trim() === '' ? undefined : Number(s))
  const str = (s: string) => (s.trim() === '' ? undefined : s.trim())

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!form.code.trim()) {
      setError('Referans kodu (Material) zorunludur.')
      return
    }
    setSubmitting(true)
    try {
      await createProduct({
        code: form.code.trim(),
        coProduct: str(form.coProduct),
        moldCavities: num(form.moldCavities),
        spm: num(form.spm),
        rawMaterialCode: str(form.rawMaterialCode),
        coilWeight: num(form.coilWeight),
        grossWeight: num(form.grossWeight),
        minLotQty: num(form.minLotQty),
        setupMinutes: num(form.setupMinutes),
        coilSetupMinutes: num(form.coilSetupMinutes),
        mainMachine: str(form.mainMachine),
        altMachine1: str(form.altMachine1),
        altMachine2: str(form.altMachine2),
        altMachine3: str(form.altMachine3),
        altMachine4: str(form.altMachine4),
        flexiblePress: form.flexiblePress === 'yes' ? true : undefined,
        maxShots: num(form.maxShots),
        qualityApprovalMinutes: num(form.qualityApprovalMinutes),
        performanceFactor: num(form.performanceFactor),
      })
      setForm(emptyForm)
    } catch (err) {
      setError(friendlyError(err).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleExcelRows(rows: Record<string, unknown>[]) {
    const s = (v: unknown) => {
      const t = String(v ?? '').trim()
      return t === '' || t === '#N/A' ? undefined : t
    }
    const n = (v: unknown) => {
      const t = String(v ?? '').trim()
      if (t === '' || t === '#N/A') return undefined
      const parsed = Number(t)
      return Number.isNaN(parsed) ? undefined : parsed
    }
    const flag = (v: unknown) => {
      const t = String(v ?? '').trim().toLowerCase()
      if (t === '' || t === '#n/a') return undefined
      return ['x', 'yes', 'y', 'true', '1', 'evet', 'da'].includes(t)
    }
    const parsed = rows.map((row) => ({
      code: s(row['Material'] ?? row['Kod'] ?? row['code']) ?? '',
      coProduct: s(row['Co-Product'] ?? row['Eş Ürün'] ?? row['coProduct']),
      moldCavities: n(row['Cavity'] ?? row['Kalıp Gözü'] ?? row['moldCavities']),
      spm: n(row['SPM'] ?? row['Spm'] ?? row['spm']),
      rawMaterialCode: s(
        row['Raw Material Code'] ?? row['Hammadde Kodu'] ?? row['rawMaterialCode'],
      ),
      coilWeight: n(row['Coil Weight (Kg)'] ?? row['Rulo Ağırlığı'] ?? row['coilWeight']),
      grossWeight: n(
        row['Gross Weight(Kg / Shut'] ??
          row['Gross Weight (Kg/Shot)'] ??
          row['Gross Ağırlık'] ??
          row['grossWeight'],
      ),
      minLotQty: n(
        row['Min Lot (pcs)'] ??
          row['Min. Lot'] ??
          row['Min Lot'] ??
          row['Minimum Lot'] ??
          row['Min Lot Miktarı'] ??
          row['minLotQty'],
      ),
      setupMinutes: n(row['Setup Time'] ?? row['Setup Süresi'] ?? row['setupMinutes']),
      coilSetupMinutes: n(
        row['Coil Setup Time'] ?? row['Rulo Setup Süresi'] ?? row['coilSetupMinutes'],
      ),
      mainMachine: s(row['Main Machine'] ?? row['Ana Makine'] ?? row['mainMachine']),
      altMachine1: s(row['Alternative 1'] ?? row['Alternatif Makine 1'] ?? row['altMachine1']),
      altMachine2: s(row['Alternative 2'] ?? row['Alternatif Makine 2'] ?? row['altMachine2']),
      altMachine3: s(row['Alternative 3'] ?? row['Alternatif Makine 3'] ?? row['altMachine3']),
      altMachine4: s(row['Alternative 4'] ?? row['Alternatif Makine 4'] ?? row['altMachine4']),
      // Sütun yoksa undefined kalır ve mevcut işaret korunur.
      flexiblePress: flag(row['Flexible'] ?? row['Flexible Press'] ?? row['Esnek'] ?? row['flexiblePress']),
      maxShots: n(
        row['Max Shot'] ??
          row['Max Shots'] ??
          row['Kalıp Max Shot'] ??
          row['maxShots'],
      ),
      qualityApprovalMinutes: n(
        row['Quality Approval'] ??
          row['Approval Time'] ??
          row['Kalite Onay Süresi'] ??
          row['qualityApprovalMinutes'],
      ),
      performanceFactor: n(
        row['Accepted OEE'] ??
        row['Performance Factor'] ??
          row['OEE Factor'] ??
          row['Performans Çarpanı'] ??
          row['performanceFactor'],
      ),
    }))
    const validRows = parsed.filter((r) => r.code)
    const result = await bulkUpsert({ rows: validRows })
    return {
      message: `${result.inserted} materials added, ${result.updated} materials updated.`,
    }
  }

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Master Data</h1>
      <p className="mt-2 text-muted-foreground">
        Material code, co-product if any, cavities, SPM, raw material and coil
        data, setup times, mold shot limit and main/alternative machines.
        Upload an Excel file to load them in bulk, then click any cell in the
        table below to correct a value, then press Save on the row. Gross weight is per piece, so a coil yields coil weight ÷ gross
        weight pieces — that is the lot unit, shown in the Pcs/coil column. Where the coil
        quantity is flexible (transfer presses 106/107), enter <strong>Min. lot</strong>{' '}
        instead: the lot is then at least that many pieces, otherwise exactly the need, and
        the coil weight is ignored (it may stay empty). A part with neither is flagged
        and planned at exactly the need.
        Cavities do not change that number; they decide how many strokes it
        takes. A co-product comes out of the same grams, so it costs no extra
        material. The Accepted OEE
        (availability × performance, quality taken as 100%) sets each job's
        total window: setup and quality approval come out of that window and the
        rest is production time.
      </p>

      <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <strong>Flexible press.</strong> A part runs only on its <strong>main press</strong>{' '}
        unless it is ticked <strong>Flexible</strong> — quality approval is usually tied to
        one press, so the alternatives are used only for parts you mark. Ticked parts may
        go to whichever of their presses finishes them first. The Excel upload keeps the
        ticks unless the file has a Flexible column.
      </p>

      <ApplyToAll />

      <div className="mt-6">
        <ExcelUpload
          expectedColumns={[
            'Material',
            'Co-Product',
            'Cavity',
            'SPM',
            'Raw Material Code',
            'Coil Weight (Kg)',
            'Gross Weight (Kg/piece)',
            'Min Lot (pcs) (optional)',
            'Setup Time',
            'Coil Setup Time',
            'Main Machine',
            'Alternative 1-4',
            'Max Shot',
            'Quality Approval',
            'Accepted OEE',
            'Flexible (optional: x / yes)',
          ]}
          onRows={handleExcelRows}
        />
      </div>

      <details className="mt-4 rounded-lg border border-border">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">
          Or add entries manually
        </summary>
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-4 border-t border-border p-4 sm:grid-cols-3"
        >
          <Field label="Material (code)" value={form.code} onChange={(v) => update('code', v)} placeholder="M250SP001RO" />
          <Field label="Co-Product" value={form.coProduct} onChange={(v) => update('coProduct', v)} placeholder="M250SP002RO" />
          <Field label="Cavity" value={form.moldCavities} onChange={(v) => update('moldCavities', v)} type="number" placeholder="1" />
          <Field label="SPM" value={form.spm} onChange={(v) => update('spm', v)} type="number" placeholder="16" />
          <Field label="Raw Material Code" value={form.rawMaterialCode} onChange={(v) => update('rawMaterialCode', v)} placeholder="SD51-100-0976" />
          <Field label="Coil Weight (Kg)" value={form.coilWeight} onChange={(v) => update('coilWeight', v)} type="number" placeholder="8000" />
          <Field label="Gross Weight (Kg/piece)" value={form.grossWeight} onChange={(v) => update('grossWeight', v)} type="number" placeholder="1.465" />
          <Field label="Min. lot (pcs) — replaces the coil" value={form.minLotQty} onChange={(v) => update('minLotQty', v)} type="number" placeholder="2000" />
          <Field label="Setup Time (min)" value={form.setupMinutes} onChange={(v) => update('setupMinutes', v)} type="number" placeholder="30" />
          <Field label="Coil Setup Time (min)" value={form.coilSetupMinutes} onChange={(v) => update('coilSetupMinutes', v)} type="number" placeholder="15" />
          <Field label="Main Machine" value={form.mainMachine} onChange={(v) => update('mainMachine', v)} placeholder="PRS-107" />
          <Field label="Alternative 1" value={form.altMachine1} onChange={(v) => update('altMachine1', v)} placeholder="" />
          <Field label="Alternative 2" value={form.altMachine2} onChange={(v) => update('altMachine2', v)} placeholder="" />
          <Field label="Alternative 3" value={form.altMachine3} onChange={(v) => update('altMachine3', v)} placeholder="" />
          <Field label="Alternative 4" value={form.altMachine4} onChange={(v) => update('altMachine4', v)} placeholder="" />
          <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-foreground">
            <input
              type="checkbox"
              checked={form.flexiblePress === 'yes'}
              onChange={(e) => update('flexiblePress', e.target.checked ? 'yes' : '')}
            />
            Flexible press — may run on the alternatives
          </label>
          <Field label="Periodic maintenance limit (shots)" value={form.maxShots} onChange={(v) => update('maxShots', v)} type="number" placeholder="500000" />
          <Field label="Quality Approval (min)" value={form.qualityApprovalMinutes} onChange={(v) => update('qualityApprovalMinutes', v)} type="number" placeholder="10" />
          <Field label="Accepted OEE (0–1)" value={form.performanceFactor} onChange={(v) => update('performanceFactor', v)} type="number" placeholder="0.8" />

          {error && <p className="text-sm text-destructive sm:col-span-3">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 sm:col-span-3"
          >
            {submitting ? 'Adding…' : 'Add material'}
          </button>
        </form>
      </details>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <input
          className="w-72 rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Search material, machine or raw material code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">
          {visibleProducts.length} of {products.length} materials · click any cell to edit ·{' '}
          {products.filter((p) => p.flexiblePress).length} flexible
        </span>
      </div>

      <ErrorBanner message={updateError} onDismiss={clearError} />

      <div className="mt-3 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Material</th>
              <th className="px-3 py-2 font-medium">Co-Product</th>
              <th className="px-3 py-2 font-medium">Cavity</th>
              <th className="px-3 py-2 font-medium">SPM</th>
              <th className="px-3 py-2 font-medium">Raw Material</th>
              <th className="px-3 py-2 font-medium">Coil Wt</th>
              <th className="px-3 py-2 font-medium" title="Gross weight is per piece">
                Gross Wt/pc
              </th>
              <th
                className="px-3 py-2 font-medium"
                title="Minimum lot in pieces. When set, the coil is not used for lot sizing (e.g. transfer presses)"
              >
                Min. lot
              </th>
              <th
                className="px-3 py-2 font-medium"
                title="Lot rule: Min. lot if set, otherwise whole coils (coil weight ÷ gross weight)"
              >
                Pcs/coil
              </th>
              <th className="px-3 py-2 font-medium">Setup</th>
              <th className="px-3 py-2 font-medium">Coil Setup</th>
              <th className="px-3 py-2 font-medium">Main Machine</th>
              <th className="px-3 py-2 font-medium">Alternatives</th>
              <th
                className="px-3 py-2 font-medium"
                title="Ticked: the plan may use the alternative presses. Not ticked: always the main press (quality)."
              >
                Flexible
              </th>
              <th className="px-3 py-2 font-medium" title="Shots after which periodic (heavy) maintenance is due">
                    Periodic limit
                  </th>
              <th className="px-3 py-2 font-medium" title="First-piece approval after setup">Approval</th>
              <th className="px-3 py-2 font-medium" title="Availability × performance; quality assumed 100%">Accepted OEE</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {status === 'LoadingFirstPage' && (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={18}>
                  Loading…
                </td>
              </tr>
            )}
            {status !== 'LoadingFirstPage' && visibleProducts.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={18}>
                  No materials added yet.
                </td>
              </tr>
            )}
            {visibleProducts.map((p) => {
              const draft = rows.draftFor(p)
              const dirty = rows.isDirty(p)
              const rowId = String(p._id)
              const busy = rows.savingKey === rowId
              const saveThisRow = () => {
                if (dirty && !busy) void rows.commit(rowId, saveRow(rowId))
              }
              const cell = (field: ProductField, width: string) => (
                <CellInput
                  key={field.name}
                  value={draft[field.name]}
                  title={field.name}
                  className={width}
                  numeric={field.numeric}
                  onChange={(next) => rows.edit(rowId, { [field.name]: next } as Partial<ProductDraft>)}
                  onCommit={saveThisRow}
                  changed={draft[field.name] !== productDraftOf(p)[field.name]}
                />
              )
              const field = (name: ProductField['name']) =>
                PRODUCT_FIELDS.find((f) => f.name === name)!
              return (
                <tr
                  key={p._id}
                  className={`border-t border-border ${dirty ? 'bg-amber-50' : ''}`}
                >
                  <td className="px-1 py-1">{cell(field('code'), 'w-28')}</td>
                  <td className="px-1 py-1">{cell(field('coProduct'), 'w-28')}</td>
                  <td className="px-1 py-1">{cell(field('moldCavities'), 'w-20')}</td>
                  <td className="px-1 py-1">{cell(field('spm'), 'w-20')}</td>
                  <td className="px-1 py-1">{cell(field('rawMaterialCode'), 'w-28')}</td>
                  <td className="px-1 py-1">{cell(field('coilWeight'), 'w-20')}</td>
                  <td className="px-1 py-1">{cell(field('grossWeight'), 'w-20')}</td>
                  <td className="px-1 py-1">{cell(field('minLotQty'), 'w-20')}</td>
                  <td className="px-3 py-2 text-muted-foreground" title="Coil weight ÷ gross weight per piece">
                    {(() => {
                      const spec = { ...p } as unknown as ProductSpec
                      const rule = lotRuleOf(spec)
                      if (rule === 'minLot') return <span className="text-xs">min. lot</span>
                      if (rule === 'missing') {
                        return (
                          <span
                            className="text-xs font-medium text-destructive"
                            title="Neither a Min. lot nor a real coil weight — the plan uses the exact need and warns"
                          >
                            ⚠ no lot rule
                          </span>
                        )
                      }
                      const pieces = piecesPerCoil(spec)
                      const shots = shotsPerCoil(spec)
                      if (!pieces) return '—'
                      return (
                        <span>
                          {Math.round(pieces).toLocaleString('en-GB')}
                          <span className="block text-[10px]">
                            {shots ? `${Math.round(shots).toLocaleString('en-GB')} shots` : ''}
                          </span>
                        </span>
                      )
                    })()}
                  </td>
                  <td className="px-1 py-1">{cell(field('setupMinutes'), 'w-20')}</td>
                  <td className="px-1 py-1">{cell(field('coilSetupMinutes'), 'w-20')}</td>
                  <td className="px-1 py-1">{cell(field('mainMachine'), 'w-28')}</td>
                  <td className="px-1 py-1">
                    <div className="flex gap-1">
                      {(['altMachine1', 'altMachine2', 'altMachine3', 'altMachine4'] as const).map(
                        (name) => cell(field(name), 'w-20'),
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-1 text-center">
                    <input
                      type="checkbox"
                      aria-label={`Flexible press for ${p.code}`}
                      checked={draft.flexiblePress === 'yes'}
                      onChange={(e) =>
                        rows.edit(rowId, { flexiblePress: e.target.checked ? 'yes' : '' })
                      }
                      className={
                        draft.flexiblePress !== productDraftOf(p).flexiblePress
                          ? 'outline outline-2 outline-amber-400'
                          : undefined
                      }
                    />
                  </td>
                  <td className="px-1 py-1">{cell(field('maxShots'), 'w-20')}</td>
                  <td className="px-1 py-1">{cell(field('qualityApprovalMinutes'), 'w-20')}</td>
                  <td className="px-1 py-1">{cell(field('performanceFactor'), 'w-20')}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <SaveStatus
                      dirty={dirty}
                      saving={busy}
                      justSaved={!!rows.justSaved[rowId]}
                    />
                    <button
                      onClick={saveThisRow}
                      disabled={!dirty || busy}
                      className="ml-2 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
                    >
                      Save
                    </button>
                    <button
                      className="ml-2 text-xs text-destructive hover:underline"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete material ${p.code}? This cannot be undone.`,
                          )
                        ) {
                          void removeProduct({ id: p._id })
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

      <UnsavedBar
        count={rows.dirtyKeys.length}
        saving={rows.savingKey !== null}
        noun="material"
        onSaveAll={() => void rows.commitAll((id, draft) => saveRow(id)(draft))}
        onDiscard={rows.discardAll}
      />
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <input
        type={type}
        className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

/**
 * Saves one field, converting an empty box into "clear this field".
 * Numeric fields reject anything that is not a number so a typo cannot
 * silently become 0 and distort every plan.
 */
async function onSaveField(
  save: (args: unknown) => Promise<boolean>,
  id: string,
  field: string,
  raw: string,
  numeric: boolean,
): Promise<boolean> {
  const text = raw.trim()
  if (text === '') return save({ id, field, value: null })
  if (numeric) {
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) return false
    return save({ id, field, value: parsed })
  }
  return save({ id, field, value: text })
}

/**
 * Tablo hücresi. Değer satırın taslağında durur: yazmak satırı "Unsaved"
 * yapar, kayıt Save (ya da Enter) ile olur. Eskiden hücre alandan çıkınca
 * sessizce kaydediliyordu ve kullanıcı kaydettiğini göremiyordu.
 */
function CellInput({
  value,
  title,
  className = 'w-24',
  numeric = false,
  changed,
  onChange,
  onCommit,
}: {
  value: string
  title?: string
  className?: string
  numeric?: boolean
  /** Sunucudaki değerden farklı mı? */
  changed: boolean
  onChange: (next: string) => void
  onCommit: () => void
}) {
  return (
    <input
      title={title}
      value={value}
      inputMode={numeric ? 'decimal' : undefined}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit()
      }}
      className={`${className} rounded border bg-background px-1.5 py-1 text-sm transition-colors ${
        changed
          ? 'border-amber-400'
          : 'border-transparent hover:border-input focus:border-input'
      }`}
    />
  )
}

/**
 * Bütün parçalara tek seferde onay süresi ve performans çarpanı. Kapasite
 * öngörüsü bütün kalıplar için aynı varsayımla hesaplansın diye.
 */
function ApplyToAll() {
  const applyToAll = useMutation(api.products.applyToAll)
  const [approval, setApproval] = useState('3')
  const [factor, setFactor] = useState('60')
  const [state, setState] = useState<{ kind: 'idle' | 'saving' } | { kind: 'done' | 'error'; message: string }>({
    kind: 'idle',
  })

  async function apply() {
    const minutes = Number(approval)
    const percent = Number(factor)
    if (!Number.isFinite(minutes) || !Number.isFinite(percent) || percent <= 0 || percent > 100) {
      setState({ kind: 'error', message: 'Enter minutes and a percentage between 1 and 100.' })
      return
    }
    if (
      !window.confirm(
        `Set quality approval to ${minutes} min and Accepted OEE to ${percent} % for EVERY part? ` +
          'This overwrites the current values.',
      )
    ) {
      return
    }
    setState({ kind: 'saving' })
    try {
      const { updated } = await applyToAll({ qualityApprovalMinutes: minutes, performanceFactor: percent / 100 })
      setState({ kind: 'done', message: `✓ ${updated.toLocaleString('en-GB')} parts updated. The plan recalculates in a few seconds.` })
    } catch (err) {
      setState({ kind: 'error', message: friendlyError(err).message })
    }
  }

  return (
    <details className="mt-3 rounded-lg border border-border">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">
        Set approval time and Accepted OEE for all parts
      </summary>
      <div className="flex flex-wrap items-end gap-3 border-t border-border p-4 text-sm">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Quality approval (min)
          <input
            type="number"
            min={0}
            value={approval}
            onChange={(e) => setApproval(e.target.value)}
            className="w-28 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Accepted OEE (%)
          <input
            type="number"
            min={1}
            max={100}
            value={factor}
            onChange={(e) => setFactor(e.target.value)}
            className="w-28 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          />
        </label>
        <button
          type="button"
          onClick={() => void apply()}
          disabled={state.kind === 'saving'}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Apply to all parts
        </button>
        <p className="basis-full text-xs text-muted-foreground">
          Admin only. At 60 %, 10 h of pure run time counts as 16.7 h; setup, coil changes and
          approval sit inside that time.
        </p>
        {state.kind === 'done' && <p className="basis-full text-xs text-emerald-600">{state.message}</p>}
        {state.kind === 'error' && <p className="basis-full text-xs text-destructive">{state.message}</p>}
      </div>
    </details>
  )
}
