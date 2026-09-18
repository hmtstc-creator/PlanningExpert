import { createFileRoute } from '@tanstack/react-router'
import { useMutation, usePaginatedQuery } from '../lib/convexTransport'
import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { ExcelUpload } from '../components/ExcelUpload'

export const Route = createFileRoute('/gerceklesen')({
  component: GerceklesenPage,
})

const str = (v: unknown) => {
  const t = String(v ?? '').trim()
  return t === '' || t === '#N/A' ? undefined : t
}

const num = (v: unknown) => {
  const t = String(v ?? '').trim().replace(/\./g, '').replace(',', '.')
  if (t === '' || t === '#N/A') return undefined
  const parsed = Number(t)
  return Number.isNaN(parsed) ? undefined : parsed
}

// MB51'de tarih hem Excel seri numarası hem de metin olarak gelebilir.
function parseDate(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = (value - 25569) * 86400 * 1000
    return new Date(ms).toISOString().slice(0, 10)
  }
  const t = String(value ?? '').trim()
  if (!t) return ''
  const dotted = t.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/)
  if (dotted) {
    const [, d, m, y] = dotted
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return iso[0]
  return ''
}

function GerceklesenPage() {
  const { results: rows, status } = usePaginatedQuery(
    api.actualProduction.list,
    {},
    { initialNumItems: 500 },
  )
  const replaceAll = useMutation(api.actualProduction.replaceAll)
  const [search, setSearch] = useState('')

  const byMaterial = useMemo(() => {
    const map = new Map<string, { qty: number; lastDate: string }>()
    for (const r of rows) {
      const current = map.get(r.material) ?? { qty: 0, lastDate: '' }
      map.set(r.material, {
        qty: current.qty + r.quantity,
        lastDate: r.postingDate > current.lastDate ? r.postingDate : current.lastDate,
      })
    }
    return Array.from(map.entries())
      .map(([material, v]) => ({ material, ...v }))
      .sort((a, b) => b.qty - a.qty)
  }, [rows])

  const filtered = byMaterial.filter((r) =>
    r.material.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <h1 className="text-3xl font-bold text-foreground">Gerçekleşen Üretim</h1>
      <p className="mt-2 text-muted-foreground">
        SAP MB51 hareket raporunu buraya yükle. Planlama, gerçekleşen üretimi
        plan ile karşılaştırmak ve preslerin gerçek performansını (OEE) ölçmek
        için bu veriyi kullanır. Her yükleme öncekinin üzerine yazar.
      </p>

      <div className="mt-6">
        <ExcelUpload
          expectedColumns={[
            'Material',
            'Posting Date',
            'Quantity',
            'Movement Type',
            'Plant',
            'Storage Location',
            'Order',
          ]}
          onRows={async (raw) => {
            const parsed = raw
              .map((row) => ({
                material:
                  str(row['Material'] ?? row['Malzeme'] ?? row['material']) ?? '',
                postingDate: parseDate(
                  row['Posting Date'] ??
                    row['Pstng Date'] ??
                    row['Kayıt Tarihi'] ??
                    row['postingDate'],
                ),
                quantity:
                  num(
                    row['Quantity'] ??
                      row['Qty in Un. of Entry'] ??
                      row['Miktar'] ??
                      row['quantity'],
                  ) ?? 0,
                plant: str(row['Plant'] ?? row['Üretim Yeri'] ?? row['plant']),
                storageLocation: str(
                  row['Storage Location'] ?? row['Depo Yeri'] ?? row['storageLocation'],
                ),
                movementType: str(
                  row['Movement Type'] ??
                    row['Movement type'] ??
                    row['Hareket Türü'] ??
                    row['movementType'],
                ),
                orderNumber: str(row['Order'] ?? row['Sipariş'] ?? row['orderNumber']),
              }))
              .filter((r) => r.material)
            const result = await replaceAll({ rows: parsed })
            return { message: `${result.count} hareket satırı yüklendi.` }
          }}
        />
      </div>

      <div className="mt-6 flex items-center gap-3">
        <input
          className="w-64 rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Materyal ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-sm text-muted-foreground">
          {byMaterial.length} materyal · {rows.length} hareket satırı
        </span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Materyal</th>
              <th className="px-3 py-2 font-medium">Toplam gerçekleşen</th>
              <th className="px-3 py-2 font-medium">Son hareket</th>
            </tr>
          </thead>
          <tbody>
            {status === 'LoadingFirstPage' && (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={3}>
                  Yükleniyor…
                </td>
              </tr>
            )}
            {status !== 'LoadingFirstPage' && filtered.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={3}>
                  Henüz MB51 verisi yüklenmedi.
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.material} className="border-t border-border">
                <td className="px-3 py-2 font-medium text-foreground">{r.material}</td>
                <td className="px-3 py-2 text-foreground">
                  {r.qty.toLocaleString('tr-TR')}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.lastDate ? new Date(r.lastDate).toLocaleDateString('tr-TR') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
