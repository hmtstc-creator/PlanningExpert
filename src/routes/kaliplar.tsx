import { createFileRoute } from '@tanstack/react-router'
import { usePaginatedQuery, useQuery } from 'convex/react'
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
  exceeded: 'limit aşıldı',
  warning: 'limite yaklaştı',
  ok: 'uygun',
  unknown: 'limit tanımsız',
}

const STATUS_STYLE: Record<MoldStatus, string> = {
  exceeded: 'rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive',
  warning: 'rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900',
  ok: 'rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800',
  unknown: 'rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground',
}

function KaliplarPage() {
  const { results: products } = usePaginatedQuery(
    api.products.list,
    {},
    { initialNumItems: 500 },
  )
  const { results: actualRows, status: actualStatus } = usePaginatedQuery(
    api.actualProduction.list,
    {},
    { initialNumItems: 5000 },
  )
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
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground">Kalıp Ömrü</h1>
      <p className="mt-2 text-muted-foreground">
        Her kalıbın son bakımdan bu yana yaptığı vuruş, MB51'den yüklenen
        gerçekleşen üretimden hesaplanır (adet ÷ göz sayısı) ve referans
        kartındaki maksimum baskı limitiyle karşılaştırılır. Bakım
        kaydettiğinde sayaç o tarihten yeniden başlar.
      </p>

      <ErrorBanner message={addError ?? removeError} onDismiss={clearError} />

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Limit aşıldı" value={exceeded.toString()} warn={exceeded > 0} />
        <Stat label="Limite yaklaştı" value={warning.toString()} warn={warning > 0} />
        <Stat label="Limit tanımsız" value={unknown.toString()} />
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-2 rounded-lg border border-border p-4">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Malzeme</span>
          <input
            className="mt-1 w-40 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            placeholder="Malzeme kodu"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Bakım tarihi</span>
          <input
            type="date"
            className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Not (ops.)</span>
          <input
            className="mt-1 w-56 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Kesici değişti"
          />
        </label>
        <button
          onClick={() => void submit()}
          disabled={!material.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Bakım kaydet
        </button>
      </div>

      {actualStatus === 'LoadingFirstPage' && (
        <p className="mt-6 text-sm text-muted-foreground">Gerçekleşen üretim yükleniyor…</p>
      )}

      {rows.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Gerçekleşen üretim verisi yüklenmediği için kalıp vuruşu
          hesaplanamıyor. Gerçekleşen sayfasından MB51 raporunu yükle.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Malzeme</th>
                <th className="px-3 py-2 font-medium">Durum</th>
                <th className="px-3 py-2 font-medium">Vuruş</th>
                <th className="px-3 py-2 font-medium">Limit</th>
                <th className="px-3 py-2 font-medium">Kalan</th>
                <th className="px-3 py-2 font-medium">Kullanım</th>
                <th className="px-3 py-2 font-medium">Son bakım</th>
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
                    {r.cumulativeShots.toLocaleString('tr-TR')}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.maxShots ? r.maxShots.toLocaleString('tr-TR') : '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.remainingShots !== null ? r.remainingShots.toLocaleString('tr-TR') : '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.usageRatio !== null ? `${(r.usageRatio * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.lastMaintenance ?? 'kayıt yok'}
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
            Bakım kayıtları ({maintenance.length})
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
                    onClick={() => void removeMaintenance({ id: m._id })}
                    className="text-xs text-destructive hover:underline"
                  >
                    Sil
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
