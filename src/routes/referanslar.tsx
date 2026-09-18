import { createFileRoute } from '@tanstack/react-router'
import { useMutation, usePaginatedQuery } from '../lib/convexTransport'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { ErrorBanner } from '../components/ErrorBanner'
import { useSafeMutation } from '../lib/useSafeMutation'
import { piecesPerCoil, shotsPerCoil, type ProductSpec } from '../lib/planning'
import { ExcelUpload } from '../components/ExcelUpload'

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
  setupMinutes: '',
  coilSetupMinutes: '',
  mainMachine: '',
  altMachine1: '',
  altMachine2: '',
  altMachine3: '',
  altMachine4: '',
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
        setupMinutes: num(form.setupMinutes),
        coilSetupMinutes: num(form.coilSetupMinutes),
        mainMachine: str(form.mainMachine),
        altMachine1: str(form.altMachine1),
        altMachine2: str(form.altMachine2),
        altMachine3: str(form.altMachine3),
        altMachine4: str(form.altMachine4),
        maxShots: num(form.maxShots),
        qualityApprovalMinutes: num(form.qualityApprovalMinutes),
        performanceFactor: num(form.performanceFactor),
      })
      setForm(emptyForm)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
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
      setupMinutes: n(row['Setup Time'] ?? row['Setup Süresi'] ?? row['setupMinutes']),
      coilSetupMinutes: n(
        row['Coil Setup Time'] ?? row['Rulo Setup Süresi'] ?? row['coilSetupMinutes'],
      ),
      mainMachine: s(row['Main Machine'] ?? row['Ana Makine'] ?? row['mainMachine']),
      altMachine1: s(row['Alternative 1'] ?? row['Alternatif Makine 1'] ?? row['altMachine1']),
      altMachine2: s(row['Alternative 2'] ?? row['Alternatif Makine 2'] ?? row['altMachine2']),
      altMachine3: s(row['Alternative 3'] ?? row['Alternatif Makine 3'] ?? row['altMachine3']),
      altMachine4: s(row['Alternative 4'] ?? row['Alternatif Makine 4'] ?? row['altMachine4']),
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
    <div className="w-full px-6 py-16">
      <h1 className="text-3xl font-bold text-foreground">Master Data</h1>
      <p className="mt-2 text-muted-foreground">
        Material code, co-product if any, cavities, SPM, raw material and coil
        data, setup times, mold shot limit and main/alternative machines.
        Upload an Excel file to load them in bulk, then click any cell in the
        table below to correct a value — changes save as soon as you leave the
        cell. Gross weight is per shot, not per piece, so a coil yields
        coil weight ÷ gross weight shots and that many × cavities pieces — the
        Pcs/coil column shows the resulting minimum lot. The performance factor
        (availability × performance, quality taken as 100%) sets each job's
        total window: setup and quality approval come out of that window and the
        rest is production time.
      </p>

      <div className="mt-6">
        <ExcelUpload
          expectedColumns={[
            'Material',
            'Co-Product',
            'Cavity',
            'SPM',
            'Raw Material Code',
            'Coil Weight (Kg)',
            'Gross Weight (Kg/Shot)',
            'Setup Time',
            'Coil Setup Time',
            'Main Machine',
            'Alternative 1-4',
            'Max Shot',
            'Quality Approval',
            'Performance Factor',
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
          <Field label="Gross Weight (Kg/Shot)" value={form.grossWeight} onChange={(v) => update('grossWeight', v)} type="number" placeholder="1.465" />
          <Field label="Setup Time (min)" value={form.setupMinutes} onChange={(v) => update('setupMinutes', v)} type="number" placeholder="30" />
          <Field label="Coil Setup Time (min)" value={form.coilSetupMinutes} onChange={(v) => update('coilSetupMinutes', v)} type="number" placeholder="15" />
          <Field label="Main Machine" value={form.mainMachine} onChange={(v) => update('mainMachine', v)} placeholder="PRS-107" />
          <Field label="Alternative 1" value={form.altMachine1} onChange={(v) => update('altMachine1', v)} placeholder="" />
          <Field label="Alternative 2" value={form.altMachine2} onChange={(v) => update('altMachine2', v)} placeholder="" />
          <Field label="Alternative 3" value={form.altMachine3} onChange={(v) => update('altMachine3', v)} placeholder="" />
          <Field label="Alternative 4" value={form.altMachine4} onChange={(v) => update('altMachine4', v)} placeholder="" />
          <Field label="Max Shot limit" value={form.maxShots} onChange={(v) => update('maxShots', v)} type="number" placeholder="500000" />
          <Field label="Quality Approval (min)" value={form.qualityApprovalMinutes} onChange={(v) => update('qualityApprovalMinutes', v)} type="number" placeholder="10" />
          <Field label="Performance factor (0–1)" value={form.performanceFactor} onChange={(v) => update('performanceFactor', v)} type="number" placeholder="0.8" />

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
          {visibleProducts.length} of {products.length} materials · click any cell to edit
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
              <th className="px-3 py-2 font-medium" title="Gross weight is per shot, not per piece">
                Gross Wt/shot
              </th>
              <th
                className="px-3 py-2 font-medium"
                title="Minimum production lot: shots per coil × cavities"
              >
                Pcs/coil
              </th>
              <th className="px-3 py-2 font-medium">Setup</th>
              <th className="px-3 py-2 font-medium">Coil Setup</th>
              <th className="px-3 py-2 font-medium">Main Machine</th>
              <th className="px-3 py-2 font-medium">Alternatives</th>
              <th className="px-3 py-2 font-medium">Max Shot</th>
              <th className="px-3 py-2 font-medium" title="Setup sonrası ilk parça onayı">Approval</th>
              <th className="px-3 py-2 font-medium" title="Availability × performance; quality assumed 100%">Perf.</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {status === 'LoadingFirstPage' && (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={16}>
                  Loading…
                </td>
              </tr>
            )}
            {status !== 'LoadingFirstPage' && visibleProducts.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={16}>
                  No materials added yet.
                </td>
              </tr>
            )}
            {visibleProducts.map((p) => (
              <tr key={p._id} className="border-t border-border">
                <EditableCell product={p} field="code" value={p.code} onSave={updateField} />
                <EditableCell product={p} field="coProduct" value={p.coProduct} onSave={updateField} />
                <EditableCell product={p} field="moldCavities" value={p.moldCavities} numeric onSave={updateField} />
                <EditableCell product={p} field="spm" value={p.spm} numeric onSave={updateField} />
                <EditableCell product={p} field="rawMaterialCode" value={p.rawMaterialCode} onSave={updateField} />
                <EditableCell product={p} field="coilWeight" value={p.coilWeight} numeric onSave={updateField} />
                <EditableCell product={p} field="grossWeight" value={p.grossWeight} numeric onSave={updateField} />
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {piecesPerCoil(p as ProductSpec) > 0 ? (
                    <span title={`${shotsPerCoil(p as ProductSpec).toLocaleString('en-GB')} shots per coil`}>
                      {piecesPerCoil(p as ProductSpec).toLocaleString('en-GB')}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <EditableCell product={p} field="setupMinutes" value={p.setupMinutes} numeric onSave={updateField} />
                <EditableCell product={p} field="coilSetupMinutes" value={p.coilSetupMinutes} numeric onSave={updateField} />
                <EditableCell product={p} field="mainMachine" value={p.mainMachine} onSave={updateField} />
                <td className="px-1 py-1">
                  <div className="flex gap-1">
                    {(['altMachine1', 'altMachine2', 'altMachine3', 'altMachine4'] as const).map(
                      (field) => (
                        <CellInput
                          key={field}
                          value={p[field]}
                          title={field}
                          className="w-20"
                          onSave={(next) => onSaveField(updateField, p._id, field, next, false)}
                        />
                      ),
                    )}
                  </div>
                </td>
                <EditableCell product={p} field="maxShots" value={p.maxShots} numeric onSave={updateField} />
                <EditableCell product={p} field="qualityApprovalMinutes" value={p.qualityApprovalMinutes} numeric onSave={updateField} />
                <EditableCell product={p} field="performanceFactor" value={p.performanceFactor} numeric onSave={updateField} />
                <td className="px-3 py-2 text-right">
                  <button
                    className="text-xs text-destructive hover:underline"
                    onClick={() => void removeProduct({ id: p._id })}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

/** A table cell that turns into an input on click and saves on blur. */
function CellInput({
  value,
  title,
  className = 'w-24',
  numeric = false,
  onSave,
}: {
  value: string | number | undefined
  title?: string
  className?: string
  numeric?: boolean
  onSave: (next: string) => Promise<boolean>
}) {
  const initial = value === undefined || value === null ? '' : String(value)
  const [draft, setDraft] = useState(initial)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)

  // Keep in step with the server unless the user is mid-edit.
  useEffect(() => {
    if (!dirty) setDraft(initial)
  }, [initial, dirty])

  return (
    <input
      title={title}
      value={draft}
      inputMode={numeric ? 'decimal' : undefined}
      onChange={(e) => {
        setDraft(e.target.value)
        setDirty(true)
        setSaved(false)
      }}
      onBlur={async () => {
        if (!dirty) return
        const ok = await onSave(draft)
        setDirty(false)
        if (ok) {
          setSaved(true)
          setTimeout(() => setSaved(false), 1200)
        } else {
          setDraft(initial)
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setDraft(initial)
          setDirty(false)
        }
      }}
      className={`${className} rounded border bg-background px-1.5 py-1 text-sm transition-colors ${
        saved
          ? 'border-emerald-400 bg-emerald-50'
          : dirty
            ? 'border-amber-400'
            : 'border-transparent hover:border-input focus:border-input'
      }`}
    />
  )
}

function EditableCell({
  product,
  field,
  value,
  numeric = false,
  onSave,
}: {
  product: { _id: string }
  field: string
  value: string | number | undefined
  numeric?: boolean
  onSave: (args: unknown) => Promise<boolean>
}) {
  return (
    <td className="px-1 py-1">
      <CellInput
        value={value}
        title={field}
        numeric={numeric}
        className={numeric ? 'w-20' : 'w-28'}
        onSave={(next) => onSaveField(onSave, product._id, field, next, numeric)}
      />
    </td>
  )
}
