import { createFileRoute } from '@tanstack/react-router'
import { useConvex, useQuery } from 'convex/react'
import { useEffect, useState } from 'react'

import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/tani')({
  component: TaniPage,
})

const CONVEX_URL: string = (import.meta as any).env?.VITE_CONVEX_URL ?? ''

/** https://mutlu-kedi-123.convex.cloud → mutlu-kedi-123 */
function deploymentName(url: string): string {
  try {
    return new URL(url).hostname.split('.')[0]
  } catch {
    return '(okunamadı)'
  }
}

function formatTime(ms: number | null): string {
  if (ms === null) return '—'
  return new Date(ms).toLocaleString('tr-TR')
}

const TABLE_LABELS: Record<string, string> = {
  presses: 'Presler',
  products: 'Referanslar',
  pressTemplates: 'Pres takvim şablonları',
  pressWeekOverrides: 'Hafta istisnaları',
  globalShiftSettings: 'Vardiya ayarları',
  workCalendar: 'Çalışma takvimi',
  storageLocations: 'Depo tanımları',
  demandWeekly: 'ZPP haftalık talep',
  demandDaily: 'ZPP günlük talep',
  stock: 'MB52 stok',
  actualProduction: 'MB51 gerçekleşen',
  planSnapshots: 'Onaylı planlar',
  changeLog: 'Değişiklik kayıtları',
}

function TaniPage() {
  const convex = useConvex()
  const summary = useQuery(api.diagnostics.summary)
  const duplicates = useQuery(api.diagnostics.duplicates)
  const [connected, setConnected] = useState<boolean | null>(null)

  useEffect(() => {
    // Sunucudan cevap geldiyse bağlantı kuruludur.
    if (summary !== undefined) setConnected(true)
    const t = setTimeout(() => setConnected((c) => (c === null ? false : c)), 8000)
    return () => clearTimeout(t)
  }, [summary])

  const deployment = deploymentName(CONVEX_URL)
  const clockSkew =
    summary !== undefined ? Math.round((Date.now() - summary.serverTime) / 1000) : null

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground">Bağlantı Teşhisi</h1>
      <p className="mt-2 text-muted-foreground">
        "Telefonda girdiğim veri bilgisayarda görünmüyor" durumunun tek bir
        sebebi vardır: iki cihaz farklı veritabanlarına bakıyordur. Bu sayfayı
        <strong className="text-foreground"> hem telefonda hem bilgisayarda </strong>
        aç ve aşağıdaki <strong className="text-foreground">Deployment</strong>{' '}
        değerini karşılaştır. Farklıysa sorun budur.
      </p>

      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Bu cihazın bağlantısı</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <Row label="Deployment">
            <span className="font-mono text-base font-semibold text-foreground">
              {deployment}
            </span>
          </Row>
          <Row label="Convex URL">
            <span className="break-all font-mono text-xs">{CONVEX_URL || '(tanımsız!)'}</span>
          </Row>
          <Row label="Site adresi">
            <span className="break-all font-mono text-xs">
              {typeof window !== 'undefined' ? window.location.origin : '—'}
            </span>
          </Row>
          <Row label="Bağlantı">
            {connected === null ? (
              <span className="text-muted-foreground">deneniyor…</span>
            ) : connected ? (
              <span className="text-emerald-600">bağlı ✓</span>
            ) : (
              <span className="text-destructive">cevap yok ✗</span>
            )}
          </Row>
          {clockSkew !== null && (
            <Row label="Sunucu saat farkı">
              <span className="text-muted-foreground">{clockSkew} sn</span>
            </Row>
          )}
        </dl>

        {!CONVEX_URL && (
          <p className="mt-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            VITE_CONVEX_URL tanımsız — site hiçbir veritabanına bağlı değil.
            Vercel projesinde build komutu ve CONVEX_DEPLOY_KEY ayarlanmalı.
          </p>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Veritabanındaki kayıtlar</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          İki cihazda bu sayılar aynıysa aynı veritabanındasın.
        </p>
        {summary === undefined ? (
          <p className="mt-3 text-sm text-muted-foreground">Yükleniyor…</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Tablo</th>
                  <th className="px-3 py-2 font-medium">Kayıt</th>
                  <th className="px-3 py-2 font-medium">Son yazma</th>
                </tr>
              </thead>
              <tbody>
                {summary.tables.map((t) => (
                  <tr key={t.name} className="border-t border-border">
                    <td className="px-3 py-2 text-foreground">
                      {TABLE_LABELS[t.name] ?? t.name}
                    </td>
                    <td
                      className={`px-3 py-2 font-medium ${
                        t.count === 0 ? 'text-muted-foreground' : 'text-foreground'
                      }`}
                    >
                      {t.count.toLocaleString('tr-TR')}
                      {t.capped && '+'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatTime(t.lastWrite)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {duplicates && duplicates.length > 0 && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">Çift kayıtlar</h2>
          <p className="mt-1 text-xs text-amber-800">
            Tekil olması gereken alanlarda birden fazla kayıt var. Bunlar kayıt
            hatalarına yol açabilir; ilgili sayfadan fazlalıkları sil.
          </p>
          <ul className="mt-2 list-inside list-disc text-sm text-amber-900">
            {duplicates.map((d) => (
              <li key={`${d.table}-${d.key}`}>
                {TABLE_LABELS[d.table] ?? d.table}: <code>{d.key}</code> — {d.count} kayıt
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-border p-4 text-sm text-muted-foreground">
        <h2 className="text-sm font-semibold text-foreground">İki cihaz farklı çıktıysa</h2>
        <ol className="mt-2 list-inside list-decimal space-y-1">
          <li>
            Telefonda tarayıcıyı yenile (sayfayı kapatıp aç). Eski bir sürüm
            önbellekte kalmış olabilir.
          </li>
          <li>
            İki cihazda da <strong>aynı adresi</strong> kullan. Vercel'in
            deployment adresleri (<code>...-xyz.vercel.app</code>) her build'de
            değişir ve eski bir veritabanına bağlı olabilir.
          </li>
          <li>
            Deployment adları hâlâ farklıysa: Vercel projesindeki{' '}
            <code>CONVEX_DEPLOY_KEY</code> bir <code>preview:</code> anahtarıdır.
            Preview anahtarı her dal için ayrı ve geçici bir veritabanı
            oluşturur. Convex panelinden <code>prod:</code> ile başlayan
            production anahtarı alıp Vercel'de değiştir.
          </li>
        </ol>
        <button
          onClick={() => void convex.close().then(() => window.location.reload())}
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
        >
          Bağlantıyı yenile
        </button>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="w-40 shrink-0 text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
