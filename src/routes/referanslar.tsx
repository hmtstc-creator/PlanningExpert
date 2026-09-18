import { createFileRoute } from '@tanstack/react-router'
import { useMutation, usePaginatedQuery } from '../lib/convexTransport'
import { useState } from 'react'

import { api } from '../../convex/_generated/api'
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
}

function ReferanslarPage() {
  const createProduct = useMutation(api.products.create)
  const bulkUpsert = useMutation(api.products.bulkUpsert)
  const removeProduct = useMutation(api.products.remove)
  const { results: products, status } = usePaginatedQuery(
    api.products.list,
    {},
    { initialNumItems: 200 },
  )

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
      })
      setForm(emptyForm)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bir hata oluştu.')
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
    }))
    const validRows = parsed.filter((r) => r.code)
    const result = await bulkUpsert({ rows: validRows })
    return {
      message: `${result.inserted} referans eklendi, ${result.updated} referans güncellendi.`,
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-16">
      <h1 className="text-3xl font-bold text-foreground">Referanslar</h1>
      <p className="mt-2 text-muted-foreground">
        Referans (Material), varsa eş ürünü (Co-Product), kalıp gözü, SPM,
        hammadde/rulo bilgileri, setup süreleri ve ana/alternatif makineler.
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
          ]}
          onRows={handleExcelRows}
        />
      </div>

      <details className="mt-4 rounded-lg border border-border">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">
          Ya da tek tek manuel ekle
        </summary>
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-4 border-t border-border p-4 sm:grid-cols-3"
        >
          <Field label="Material (referans kodu)" value={form.code} onChange={(v) => update('code', v)} placeholder="M250SP001RO" />
          <Field label="Co-Product (eş ürün)" value={form.coProduct} onChange={(v) => update('coProduct', v)} placeholder="M250SP002RO" />
          <Field label="Cavity (kalıp gözü)" value={form.moldCavities} onChange={(v) => update('moldCavities', v)} type="number" placeholder="1" />
          <Field label="SPM" value={form.spm} onChange={(v) => update('spm', v)} type="number" placeholder="16" />
          <Field label="Raw Material Code" value={form.rawMaterialCode} onChange={(v) => update('rawMaterialCode', v)} placeholder="SD51-100-0976" />
          <Field label="Coil Weight (Kg)" value={form.coilWeight} onChange={(v) => update('coilWeight', v)} type="number" placeholder="8000" />
          <Field label="Gross Weight (Kg/Shot)" value={form.grossWeight} onChange={(v) => update('grossWeight', v)} type="number" placeholder="1.465" />
          <Field label="Setup Time (dk)" value={form.setupMinutes} onChange={(v) => update('setupMinutes', v)} type="number" placeholder="30" />
          <Field label="Coil Setup Time (dk)" value={form.coilSetupMinutes} onChange={(v) => update('coilSetupMinutes', v)} type="number" placeholder="15" />
          <Field label="Main Machine" value={form.mainMachine} onChange={(v) => update('mainMachine', v)} placeholder="PRS-107" />
          <Field label="Alternative 1" value={form.altMachine1} onChange={(v) => update('altMachine1', v)} placeholder="" />
          <Field label="Alternative 2" value={form.altMachine2} onChange={(v) => update('altMachine2', v)} placeholder="" />
          <Field label="Alternative 3" value={form.altMachine3} onChange={(v) => update('altMachine3', v)} placeholder="" />
          <Field label="Alternative 4" value={form.altMachine4} onChange={(v) => update('altMachine4', v)} placeholder="" />
          <Field label="Kalıp Max Shot limiti" value={form.maxShots} onChange={(v) => update('maxShots', v)} type="number" placeholder="500000" />

          {error && <p className="text-sm text-destructive sm:col-span-3">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 sm:col-span-3"
          >
            {submitting ? 'Ekleniyor…' : 'Referans ekle'}
          </button>
        </form>
      </details>

      <div className="mt-8 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Material</th>
              <th className="px-3 py-2 font-medium">Co-Product</th>
              <th className="px-3 py-2 font-medium">Cavity</th>
              <th className="px-3 py-2 font-medium">SPM</th>
              <th className="px-3 py-2 font-medium">Hammadde</th>
              <th className="px-3 py-2 font-medium">Coil Wt</th>
              <th className="px-3 py-2 font-medium">Gross Wt</th>
              <th className="px-3 py-2 font-medium">Setup</th>
              <th className="px-3 py-2 font-medium">Coil Setup</th>
              <th className="px-3 py-2 font-medium">Ana Makine</th>
              <th className="px-3 py-2 font-medium">Alternatifler</th>
              <th className="px-3 py-2 font-medium">Max Shot</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {status === 'LoadingFirstPage' && (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={13}>
                  Yükleniyor…
                </td>
              </tr>
            )}
            {status !== 'LoadingFirstPage' && products.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={13}>
                  Henüz referans eklenmedi.
                </td>
              </tr>
            )}
            {products.map((p) => {
              const alternatives = [p.altMachine1, p.altMachine2, p.altMachine3, p.altMachine4]
                .filter(Boolean)
                .join(', ')
              return (
                <tr key={p._id} className="border-t border-border">
                  <td className="px-3 py-2 text-foreground">{p.code}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.coProduct ?? '—'}</td>
                  <td className="px-3 py-2 text-foreground">{p.moldCavities ?? '—'}</td>
                  <td className="px-3 py-2 text-foreground">{p.spm ?? '—'}</td>
                  <td className="px-3 py-2 text-foreground">{p.rawMaterialCode ?? '—'}</td>
                  <td className="px-3 py-2 text-foreground">{p.coilWeight ?? '—'}</td>
                  <td className="px-3 py-2 text-foreground">{p.grossWeight ?? '—'}</td>
                  <td className="px-3 py-2 text-foreground">{p.setupMinutes ?? '—'}</td>
                  <td className="px-3 py-2 text-foreground">{p.coilSetupMinutes ?? '—'}</td>
                  <td className="px-3 py-2 text-foreground">{p.mainMachine ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{alternatives || '—'}</td>
                  <td className="px-3 py-2 text-foreground">
                    {p.maxShots ? p.maxShots.toLocaleString('tr-TR') : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      className="text-xs text-destructive hover:underline"
                      onClick={() => void removeProduct({ id: p._id })}
                    >
                      Sil
                    </button>
                  </td>
                </tr>
              )
            })}
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
