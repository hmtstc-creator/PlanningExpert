import { createFileRoute } from '@tanstack/react-router'
import { useMutation, usePaginatedQuery } from 'convex/react'
import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { ExcelUpload } from '../components/ExcelUpload'

export const Route = createFileRoute('/stoklar')({
  component: StoklarPage,
})

function num(v: unknown) {
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}
function str(v: unknown) {
  const s = String(v ?? '').trim()
  return s === '' ? undefined : s
}

function StoklarPage() {
  const { results: rows, status } = usePaginatedQuery(
    api.stock.list,
    {},
    { initialNumItems: 500 },
  )
  const replaceAll = useMutation(api.stock.replaceAll)
  const [view, setView] = useState<'summary' | 'detail'>('summary')
  const [search, setSearch] = useState('')

  const summary = useMemo(() => {
    const map = new Map<
      string,
      { material: string; unrestricted: number; quality: number; restricted: number; blocked: number; returns: number; transit: number; locations: number }
    >()
    for (const r of rows) {
      const existing = map.get(r.material) ?? {
        material: r.material,
        unrestricted: 0,
        quality: 0,
        restricted: 0,
        blocked: 0,
        returns: 0,
        transit: 0,
        locations: 0,
      }
      existing.unrestricted += r.unrestricted ?? 0
      existing.quality += r.qualityInspection ?? 0
      existing.restricted += r.restricted ?? 0
      existing.blocked += r.blocked ?? 0
      existing.returns += r.returns ?? 0
      existing.transit += r.transit ?? 0
      existing.locations += 1
      map.set(r.material, existing)
    }
    return Array.from(map.values()).sort((a, b) => a.material.localeCompare(b.material))
  }, [rows])

  const filteredSummary = summary.filter((s) => s.material.toLowerCase().includes(search.toLowerCase()))
  const filteredRows = rows.filter((r) => r.material.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <h1 className="text-3xl font-bold text-foreground">Stoklar</h1>
      <p className="mt-2 text-muted-foreground">
        SAP MB52 stok raporunu her gün buraya yükle. Sistem materyal
        bazında toplam kullanılabilir stoku hesaplar; detay görünümde depo
        yeri bazlı kırılımı görebilirsin.
      </p>

      <div className="mt-6">
        <ExcelUpload
          expectedColumns={[
            'Material',
            'Plant',
            'Storage Location',
            'Unrestricted',
            'Quality Inspection',
            'Restricted-Use Stock',
            'Blocked Stock',
            'Returns',
            'Transit and Transfer',
          ]}
          onRows={async (raw) => {
            const parsed = raw.map((row) => ({
              material: str(row['Material']) ?? '',
              plant: str(row['Plant']),
              storageLocation: str(row['Storage Location']),
              unrestricted: num(row['Unrestricted']),
              qualityInspection: num(row['Quality Inspection']),
              restricted: num(row['Restricted-Use Stock']),
              blocked: num(row['Blocked Stock']),
              returns: num(row['Returns']),
              transit: num(row['Transit and Transfer']),
            })).filter((r) => r.material)
            const result = await replaceAll({ rows: parsed })
            return { message: `${result.count} stok satırı güncellendi.` }
          }}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          <button
            onClick={() => setView('summary')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === 'summary' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
          >
            Özet (materyal bazlı)
          </button>
          <button
            onClick={() => setView('detail')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === 'detail' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
          >
            Detay (depo bazlı)
          </button>
        </div>
        <input
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          placeholder="Materyal ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {view === 'summary' ? (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Materyal</th>
                <th className="px-3 py-2 font-medium">Kullanılabilir</th>
                <th className="px-3 py-2 font-medium">Kalite Kontrolde</th>
                <th className="px-3 py-2 font-medium">Kısıtlı</th>
                <th className="px-3 py-2 font-medium">Bloke</th>
                <th className="px-3 py-2 font-medium">İade</th>
                <th className="px-3 py-2 font-medium">Transit</th>
                <th className="px-3 py-2 font-medium">Depo sayısı</th>
              </tr>
            </thead>
            <tbody>
              {status === 'LoadingFirstPage' && (
                <tr><td className="px-3 py-3 text-muted-foreground" colSpan={8}>Yükleniyor…</td></tr>
              )}
              {status !== 'LoadingFirstPage' && filteredSummary.length === 0 && (
                <tr><td className="px-3 py-3 text-muted-foreground" colSpan={8}>Henüz stok verisi yüklenmedi.</td></tr>
              )}
              {filteredSummary.map((s) => (
                <tr key={s.material} className="border-t border-border">
                  <td className="px-3 py-2 font-medium text-foreground">{s.material}</td>
                  <td className="px-3 py-2 text-foreground">{s.unrestricted}</td>
                  <td className="px-3 py-2 text-muted-foreground">{s.quality}</td>
                  <td className="px-3 py-2 text-muted-foreground">{s.restricted}</td>
                  <td className="px-3 py-2 text-muted-foreground">{s.blocked}</td>
                  <td className="px-3 py-2 text-muted-foreground">{s.returns}</td>
                  <td className="px-3 py-2 text-muted-foreground">{s.transit}</td>
                  <td className="px-3 py-2 text-muted-foreground">{s.locations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Materyal</th>
                <th className="px-3 py-2 font-medium">Fabrika</th>
                <th className="px-3 py-2 font-medium">Depo Yeri</th>
                <th className="px-3 py-2 font-medium">Kullanılabilir</th>
                <th className="px-3 py-2 font-medium">Kalite</th>
                <th className="px-3 py-2 font-medium">Kısıtlı</th>
                <th className="px-3 py-2 font-medium">Bloke</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r._id} className="border-t border-border">
                  <td className="px-3 py-2 text-foreground">{r.material}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.plant ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.storageLocation ?? '—'}</td>
                  <td className="px-3 py-2 text-foreground">{r.unrestricted ?? 0}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.qualityInspection ?? 0}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.restricted ?? 0}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.blocked ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
