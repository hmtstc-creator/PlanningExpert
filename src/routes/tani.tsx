import { createFileRoute } from '@tanstack/react-router'
import { useConvex, useQuery } from 'convex/react'
import { useEffect, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { QueryCatcher } from '../components/QueryCatcher'

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
  moldMaintenance: 'Kalıp bakım kayıtları',
  planOverrides: 'Plan müdahaleleri',
  officialHolidays: 'Resmi tatiller',
  machines: 'Makineler (kullanımdan kalktı)',
  machinePriorities: 'Makine öncelikleri (kullanımdan kalktı)',
  craneGroups: 'Vinç grupları (kullanımdan kalktı)',
}

const DEPRECATED = new Set(['machines', 'machinePriorities', 'craneGroups'])

type HttpsState = 'checking' | 'ok' | 'blocked' | 'no-url'

interface WsState {
  isWebSocketConnected: boolean
  hasEverConnected: boolean
  connectionRetries: number
}

function TaniPage() {
  const convex = useConvex()
  const [https, setHttps] = useState<HttpsState>(CONVEX_URL ? 'checking' : 'no-url')
  const [ws, setWs] = useState<WsState | null>(null)

  // 1) HTTPS erişimi: convex.cloud alan adına hiç ulaşılabiliyor mu?
  // no-cors ile cevabın içeriği okunamaz ama ULAŞILABİLDİĞİ anlaşılır;
  // engelliyse istek reddedilir.
  useEffect(() => {
    if (!CONVEX_URL) return
    let cancelled = false
    const timeout = setTimeout(() => {
      if (!cancelled) setHttps((s) => (s === 'checking' ? 'blocked' : s))
    }, 10_000)

    fetch(`${CONVEX_URL}/version`, { mode: 'no-cors', cache: 'no-store' })
      .then(() => {
        if (!cancelled) setHttps('ok')
      })
      .catch(() => {
        if (!cancelled) setHttps('blocked')
      })
      .finally(() => clearTimeout(timeout))

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [])

  // 2) WebSocket durumu: Convex istemcisi canlı bağlantıyı bununla kurar.
  // Kurumsal güvenlik duvarları en sık burayı keser.
  useEffect(() => {
    const read = () => {
      const state = convex.connectionState()
      setWs({
        isWebSocketConnected: state.isWebSocketConnected,
        hasEverConnected: state.hasEverConnected,
        connectionRetries: state.connectionRetries,
      })
    }
    read()
    const unsubscribe = convex.subscribeToConnectionState?.(read)
    const interval = setInterval(read, 1500)
    return () => {
      unsubscribe?.()
      clearInterval(interval)
    }
  }, [convex])

  const deployment = deploymentName(CONVEX_URL)

  // Teşhis: hangi katmanda tıkandığını söyle.
  let verdict: { tone: 'ok' | 'bad' | 'wait'; title: string; body: React.ReactNode }
  if (!CONVEX_URL) {
    verdict = {
      tone: 'bad',
      title: 'Site hiçbir veritabanına bağlı değil',
      body: (
        <>
          <code>VITE_CONVEX_URL</code> tanımsız. Bu bir ağ sorunu değil, Vercel
          build ayarı eksik. Build komutu şu olmalı:{' '}
          <code className="break-all">
            npx convex codegen &amp;&amp; npx convex deploy --cmd 'npm run build'
            --cmd-url-env-var-name VITE_CONVEX_URL
          </code>
        </>
      ),
    }
  } else if (ws?.isWebSocketConnected) {
    verdict = {
      tone: 'ok',
      title: 'Bağlantı sağlıklı',
      body: <>Bu cihaz veritabanına bağlı. Aşağıdaki kayıt sayıları canlı.</>,
    }
  } else if (https === 'checking' || ws === null) {
    verdict = { tone: 'wait', title: 'Kontrol ediliyor…', body: <>Birkaç saniye sürebilir.</> }
  } else if (https === 'ok') {
    verdict = {
      tone: 'bad',
      title: 'WebSocket engelleniyor — büyük ihtimalle şirket ağı',
      body: (
        <>
          <p>
            <code>{deployment}.convex.cloud</code> adresine HTTPS ile
            ulaşılıyor, ama <strong>WebSocket bağlantısı kurulamıyor</strong>.
            Uygulama canlı veriyi WebSocket üzerinden alır; bu yüzden sayfa
            açılıyor ama veri gelmiyor.
          </p>
          <p className="mt-2">
            Bu neredeyse kesin olarak şirket güvenlik duvarı / proxy kaynaklı.
            Telefonda mobil veriyle çalışması da bunu doğrular.
          </p>
          <p className="mt-2">
            <strong>BT'ye iletilecek talep:</strong> <code>*.convex.cloud</code>{' '}
            alan adına 443 portundan <strong>WebSocket (wss://)</strong>{' '}
            trafiğine izin verilmesi.
          </p>
        </>
      ),
    }
  } else {
    verdict = {
      tone: 'bad',
      title: 'convex.cloud adresine hiç ulaşılamıyor',
      body: (
        <>
          <p>
            Bu cihaz <code>{deployment}.convex.cloud</code> adresine HTTPS ile
            bile ulaşamıyor. Alan adı tamamen engellenmiş ya da proxy
            arkasında.
          </p>
          <p className="mt-2">
            <strong>BT'ye iletilecek talep:</strong> <code>*.convex.cloud</code>{' '}
            alan adının beyaz listeye alınması (443 portu, HTTPS ve WebSocket).
          </p>
        </>
      ),
    }
  }

  const toneClass =
    verdict.tone === 'ok'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
      : verdict.tone === 'wait'
        ? 'border-border bg-muted/40 text-muted-foreground'
        : 'border-destructive/40 bg-destructive/10 text-destructive'

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground">Bağlantı Teşhisi</h1>
      <p className="mt-2 text-muted-foreground">
        Bu sayfa, cihazın veritabanına gerçekten bağlanıp bağlanamadığını ve
        bağlanamıyorsa nerede tıkandığını gösterir.
      </p>

      <div className={`mt-6 rounded-lg border p-4 ${toneClass}`}>
        <p className="text-sm font-semibold">{verdict.title}</p>
        <div className="mt-2 text-sm">{verdict.body}</div>
      </div>

      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Bağlantı adımları</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <Row label="Deployment">
            <span className="font-mono text-base font-semibold text-foreground">
              {deployment}
            </span>
          </Row>
          <Row label="Convex URL">
            <span className="break-all font-mono text-xs">{CONVEX_URL || '(tanımsız!)'}</span>
          </Row>
          <Row label="1) HTTPS erişimi">
            {https === 'checking' ? (
              <span className="text-muted-foreground">kontrol ediliyor…</span>
            ) : https === 'ok' ? (
              <span className="text-emerald-600">ulaşılıyor ✓</span>
            ) : https === 'no-url' ? (
              <span className="text-destructive">adres tanımsız ✗</span>
            ) : (
              <span className="text-destructive">engelleniyor ✗</span>
            )}
          </Row>
          <Row label="2) WebSocket (canlı veri)">
            {ws === null ? (
              <span className="text-muted-foreground">kontrol ediliyor…</span>
            ) : ws.isWebSocketConnected ? (
              <span className="text-emerald-600">bağlı ✓</span>
            ) : (
              <span className="text-destructive">
                bağlanamıyor ✗
                {ws.connectionRetries > 0 && ` (${ws.connectionRetries} deneme)`}
              </span>
            )}
          </Row>
          <Row label="Daha önce bağlandı mı">
            <span className="text-muted-foreground">
              {ws === null ? '—' : ws.hasEverConnected ? 'evet' : 'hayır'}
            </span>
          </Row>
          <Row label="Site adresi">
            <span className="break-all font-mono text-xs">
              {typeof window !== 'undefined' ? window.location.origin : '—'}
            </span>
          </Row>
        </dl>

        <button
          onClick={() => window.location.reload()}
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
        >
          Yeniden dene
        </button>
      </div>

      <QueryCatcher label="Veritabanı kayıtları">
        <TableCounts />
      </QueryCatcher>

      <QueryCatcher label="Çift kayıt kontrolü">
        <DuplicateList />
      </QueryCatcher>

      <div className="mt-6 rounded-lg border border-border p-4 text-sm text-muted-foreground">
        <h2 className="text-sm font-semibold text-foreground">
          İki cihazda farklı sonuç çıkıyorsa
        </h2>
        <ol className="mt-2 list-inside list-decimal space-y-1">
          <li>
            Bir cihaz bağlı diğeri değilse: bağlanamayan cihazın ağı engelliyordur
            (yukarıdaki teşhis hangi katman olduğunu söylüyor).
          </li>
          <li>
            İkisi de bağlı ama <strong>Deployment</strong> adları farklıysa: Vercel'deki{' '}
            <code>CONVEX_DEPLOY_KEY</code> bir <code>preview:</code> anahtarıdır.
            Convex panelinden <code>prod:</code> anahtarını alıp değiştir.
          </li>
          <li>
            Deployment aynı ama kayıt sayıları farklıysa: tarayıcı önbelleği —
            sayfayı yenile.
          </li>
        </ol>
      </div>
    </div>
  )
}

function TableCounts() {
  const summary = useQuery(api.diagnostics.summary)

  return (
    <div className="mt-6 rounded-lg border border-border p-4">
      <h2 className="text-sm font-semibold text-foreground">Veritabanındaki kayıtlar</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        İki cihazda bu sayılar aynıysa aynı veritabanındasın.
      </p>
      {summary === undefined ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Yükleniyor… (bağlantı kurulamıyorsa bu satır kalıcı olarak kalır)
        </p>
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
                  <td
                    className={`px-3 py-2 ${
                      DEPRECATED.has(t.name) ? 'text-muted-foreground' : 'text-foreground'
                    }`}
                  >
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
  )
}

function DuplicateList() {
  const duplicates = useQuery(api.diagnostics.duplicates)
  if (!duplicates || duplicates.length === 0) return null

  return (
    <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-sm font-semibold text-amber-900">Çift kayıtlar</h2>
      <p className="mt-1 text-xs text-amber-800">
        Tekil olması gereken alanlarda birden fazla kayıt var. İlgili sayfadan
        fazlalıkları sil.
      </p>
      <ul className="mt-2 list-inside list-disc text-sm text-amber-900">
        {duplicates.map((d) => (
          <li key={`${d.table}-${d.key}`}>
            {TABLE_LABELS[d.table] ?? d.table}: <code>{d.key}</code> — {d.count} kayıt
          </li>
        ))}
      </ul>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="w-44 shrink-0 text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
