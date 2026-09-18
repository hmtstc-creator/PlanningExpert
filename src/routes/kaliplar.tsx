import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '../lib/convexTransport'
import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { ErrorBanner } from '../components/ErrorBanner'
import { useSafeMutation } from '../lib/useSafeMutation'
import { buildMoldLife, type MoldStatus } from '../lib/moldLife'
import type { ProductSpec } from '../lib/planning'

export const Route = createFileRoute('/kaliplar')({
  component: KaliplarPage,
})

const STATUS_LABEL: Record<MoldStatus, string> = {
  exceeded: 'limit exceeded',
  warning: 'near limit',
  ok: 'ok',
  unknown: 'no limit set',
}

const STATUS_STYLE: Record<MoldStatus, string> = {
  exceeded: 'rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive',
  warning: 'rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900',
  ok: 'rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800',
  unknown: 'rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground',
}

function KaliplarPage() {
  // Malzeme kartları da eksiksiz okunur: kartı görülmeyen bir malzemenin
  // göz sayısı ve kalıp limiti bilinmez, vuruş hesabı da yanlış çıkar.
  const products = useQuery(api.products.listAll)?.rows ?? []
  // Kalıp ömrü ve gerçekleşme oranı bu satırların toplamından çıkar;
  // sayfalı okumak toplamı eksik bırakır ve iki sayıyı da yanıltıcı yapar.
  const actualResult = useQuery(api.actualProduction.listAll)
  const actualRows = useMemo(() => actualResult?.rows ?? [], [actualResult])
  const actualStatus = actualResult === undefined ? 'LoadingFirstPage' : 'Exhausted'
  const actualIncomplete = actualResult !== undefined && !actualResult.complete
  const maintenance = (useQuery(api.moldMaintenance.list) ?? []) as {
    _id: string
    material: string
    date: string
    note?: string
  }[]
  const { run: addMaintenance, error: addError, clearError } = useSafeMutation(
    api.moldMaintenance.add,
  )
  const { run: removeMaintenance, error: removeError } = useSafeMutation(
    api.moldMaintenance.remove,
  )

  const [material, setMaterial] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')

  const productByCode = useMemo(() => {
    const map = new Map<string, ProductSpec>()
    for (const p of products) map.set(p.code, p as ProductSpec)
    return map
  }, [products])

  // Her malzeme için en son bakım tarihi.
  const lastMaintenance = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of maintenance) {
      const current = map.get(m.material)
      if (!current || m.date > current) map.set(m.material, m.date)
    }
    return map
  }, [maintenance])

  const actual = useMemo(
    () =>
      actualRows.map((r) => ({
        material: r.material,
        postingDate: r.postingDate,
        quantity: r.quantity,
      })),
    [actualRows],
  )

  const rows = useMemo(
    () => buildMoldLife(actual, productByCode, lastMaintenance),
    [actual, productByCode, lastMaintenance],
  )

  const exceeded = rows.filter((r) => r.status === 'exceeded').length
  const warning = rows.filter((r) => r.status === 'warning').length
  const unknown = rows.filter((r) => r.status === 'unknown').length

  async function submit() {
    const m = material.trim()
    if (!m) return
    const ok = await addMaintenance({ material: m, date, note: note || undefined })
    if (ok) {
      setMaterial('')
      setNote('')
    }
  }

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-12">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Mold Life</h1>
      <p className="mt-2 text-muted-foreground">
        The shots each mold has made since its last maintenance are calculated
        from the actual production uploaded via MB51 (quantity ÷ cavities) and
        compared with the maximum shot limit on the material's master data
        record. Recording maintenance restarts the counter from that date.
      </p>

      <ErrorBanner message={addError ?? removeError} onDismiss={clearError} />

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Limit exceeded" value={exceeded.toString()} warn={exceeded > 0} />
        <Stat label="Near limit" value={warning.toString()} warn={warning > 0} />
        <Stat label="No limit set" value={unknown.toString()} />
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-2 rounded-lg border border-border p-4">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Material</span>
          <input
            className="mt-1 w-40 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            placeholder="Material code"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Maintenance date</span>
          <input
            type="date"
            className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Note (opt.)</span>
          <input
            className="mt-1 w-56 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Cutter replaced"
          />
        </label>
        <button
          onClick={() => void submit()}
          disabled={!material.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Record maintenance
        </button>
      </div>

      {actualStatus === 'LoadingFirstPage' && (
        <p className="mt-6 text-sm text-muted-foreground">Loading actual production…</p>
      )}

      {actualIncomplete && (
        <p className="mt-6 rounded-lg border-2 border-destructive bg-destructive/10 p-3 text-sm text-foreground">
          <strong className="text-destructive">These shot counts are too low.</strong>{' '}
          There is more actual production than one query can read, so part of it
          is missing from the totals below. A mould close to its limit may look
          safe here. Upload a shorter MB51 period.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No actual production data has been uploaded, so mold shots cannot be
          calculated. Upload the MB51 report on the Actuals page.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Material</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Shots</th>
                <th className="px-3 py-2 font-medium">Limit</th>
                <th className="px-3 py-2 font-medium">Remaining</th>
                <th className="px-3 py-2 font-medium">Usage</th>
                <th className="px-3 py-2 font-medium">Last maintenance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.material} className="border-t border-border">
                  <td className="px-3 py-2 font-medium text-foreground">{r.material}</td>
                  <td className="px-3 py-2">
                    <span className={STATUS_STYLE[r.status]}>{STATUS_LABEL[r.status]}</span>
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    {r.cumulativeShots.toLocaleString('en-GB')}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.maxShots ? r.maxShots.toLocaleString('en-GB') : '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.remainingShots !== null ? r.remainingShots.toLocaleString('en-GB') : '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.usageRatio !== null ? `${(r.usageRatio * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.lastMaintenance ?? 'none'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {maintenance.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-foreground">
            Maintenance records ({maintenance.length})
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {maintenance
              .slice()
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((m) => (
                <li
                  key={m._id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                >
                  <span className="text-foreground">
                    <strong>{m.material}</strong>{' '}
                    <span className="text-muted-foreground">
                      — {m.date}
                      {m.note ? ` · ${m.note}` : ''}
                    </span>
                  </span>
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete the maintenance record for ${m.material} on ${m.date}?`,
                        )
                      ) {
                        void removeMaintenance({ id: m._id })
                      }
                    }}
                    className="text-xs text-destructive hover:underline"
                  >
                    Delete
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${warn ? 'text-destructive' : 'text-foreground'}`}>
        {value}
      </p>
    </div>
  )
}
