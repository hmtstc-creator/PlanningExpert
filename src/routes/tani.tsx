import { createFileRoute } from '@tanstack/react-router'
import { useConvex, useQuery, useTransport } from '../lib/convexTransport'
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
    return '(unreadable)'
  }
}

function formatTime(ms: number | null): string {
  if (ms === null) return '—'
  return new Date(ms).toLocaleString('en-GB')
}

const TABLE_LABELS: Record<string, string> = {
  presses: 'Presses',
  products: 'Materials',
  pressTemplates: 'Press calendar templates',
  pressWeekOverrides: 'Week overrides',
  globalShiftSettings: 'Shift settings',
  workCalendar: 'Work calendar',
  storageLocations: 'Storage locations',
  demandWeekly: 'ZPP weekly demand',
  demandDaily: 'ZPP daily demand',
  stock: 'MB52 stock',
  actualProduction: 'MB51 actuals',
  planSnapshots: 'Approved plans',
  changeLog: 'Change log',
  moldMaintenance: 'Mold maintenance',
  planOverrides: 'Plan overrides',
  officialHolidays: 'Public holidays',
  machines: 'Machines (deprecated)',
  machinePriorities: 'Machine priorities (deprecated)',
  craneGroups: 'Crane groups (deprecated)',
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
  const { mode } = useTransport()
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
      title: 'The site is not connected to any database',
      body: (
        <>
          <code>VITE_CONVEX_URL</code> is not set. This is not a network problem
          but a missing Vercel build setting. The build command must be:{' '}
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
      title: 'Connection healthy',
      body: <>This device has a live connection. The row counts below are current.</>,
    }
  } else if (mode === 'http' && https === 'ok') {
    verdict = {
      tone: 'wait',
      title: 'Fallback mode active — WebSocket is blocked but the app works',
      body: (
        <>
          <p>
            The live WebSocket connection could not be established, so the app
            switched to plain HTTPS. <strong>Reading and saving both work</strong>;
            the only difference is that data refreshes about every 20 seconds
            instead of instantly.
          </p>
          <p className="mt-2">
            For a permanent fix, ask IT to allow <strong>WebSocket (wss://)</strong>
            traffic to <code>*.convex.cloud</code> on port 443.
          </p>
        </>
      ),
    }
  } else if (https === 'checking' || ws === null) {
    verdict = { tone: 'wait', title: 'Checking…', body: <>This may take a few seconds.</> }
  } else if (https === 'ok') {
    verdict = {
      tone: 'bad',
      title: 'WebSocket is blocked — most likely the corporate network',
      body: (
        <>
          <p>
            <code>{deployment}.convex.cloud</code> is reachable over HTTPS, but
            the <strong>WebSocket connection cannot be established</strong>. The
            app receives live data over WebSocket, which is why the page loads
            but no data arrives.
          </p>
          <p className="mt-2">
            This is almost certainly a corporate firewall or proxy. The app
            working on a phone over mobile data confirms it.
          </p>
          <p className="mt-2">
            <strong>Request for IT:</strong> allow <strong>WebSocket (wss://)</strong>
            traffic to <code>*.convex.cloud</code> on port 443.
          </p>
        </>
      ),
    }
  } else {
    verdict = {
      tone: 'bad',
      title: 'convex.cloud cannot be reached at all',
      body: (
        <>
          <p>
            This device cannot reach <code>{deployment}.convex.cloud</code> even
            over HTTPS. The domain is fully blocked or sits behind a proxy.
          </p>
          <p className="mt-2">
            <strong>Request for IT:</strong> whitelist <code>*.convex.cloud</code>
            (port 443, HTTPS and WebSocket).
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
    <div className="w-full px-4 py-6 sm:px-6 sm:py-12">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Connection Diagnostics</h1>
      <p className="mt-2 text-muted-foreground">
        This page shows whether the device can actually reach the database and,
        if not, exactly where the connection is blocked.
      </p>

      <div className={`mt-6 rounded-lg border p-4 ${toneClass}`}>
        <p className="text-sm font-semibold">{verdict.title}</p>
        <div className="mt-2 text-sm">{verdict.body}</div>
      </div>

      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Connection steps</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <Row label="Deployment">
            <span className="font-mono text-base font-semibold text-foreground">
              {deployment}
            </span>
          </Row>
          <Row label="Convex URL">
            <span className="break-all font-mono text-xs">{CONVEX_URL || '(not set!)'}</span>
          </Row>
          <Row label="1) HTTPS reachability">
            {https === 'checking' ? (
              <span className="text-muted-foreground">checking…</span>
            ) : https === 'ok' ? (
              <span className="text-emerald-600">reachable ✓</span>
            ) : https === 'no-url' ? (
              <span className="text-destructive">no address ✗</span>
            ) : (
              <span className="text-destructive">blocked ✗</span>
            )}
          </Row>
          <Row label="Active mode">
            <span className="font-medium text-foreground">
              {mode === 'websocket'
                ? 'Live (WebSocket)'
                : mode === 'http'
                  ? 'Fallback (HTTPS — refreshes every 20 seconds)'
                  : 'determining…'}
            </span>
          </Row>
          <Row label="2) WebSocket (live data)">
            {ws === null ? (
              <span className="text-muted-foreground">checking…</span>
            ) : ws.isWebSocketConnected ? (
              <span className="text-emerald-600">connected ✓</span>
            ) : (
              <span className="text-destructive">
                cannot connect ✗
                {ws.connectionRetries > 0 && ` (${ws.connectionRetries} attempts)`}
              </span>
            )}
          </Row>
          <Row label="Ever connected">
            <span className="text-muted-foreground">
              {ws === null ? '—' : ws.hasEverConnected ? 'yes' : 'no'}
            </span>
          </Row>
          <Row label="Site address">
            <span className="break-all font-mono text-xs">
              {typeof window !== 'undefined' ? window.location.origin : '—'}
            </span>
          </Row>
        </dl>

        <button
          onClick={() => window.location.reload()}
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
        >
          Retry
        </button>
      </div>

      <QueryCatcher label="Database records">
        <TableCounts />
      </QueryCatcher>

      <QueryCatcher label="Duplicate check">
        <DuplicateList />
      </QueryCatcher>

      <div className="mt-6 rounded-lg border border-border p-4 text-sm text-muted-foreground">
        <h2 className="text-sm font-semibold text-foreground">
          If the two devices show different results
        </h2>
        <ol className="mt-2 list-inside list-decimal space-y-1">
          <li>
            One device connected and the other not: the failing device's network
            is blocking it (the diagnosis above names the layer).
          </li>
          <li>
            Both connected but the <strong>Deployment</strong> names differ: the
            <code>CONVEX_DEPLOY_KEY</code> in Vercel is a <code>preview:</code> key.
            Replace it with the <code>prod:</code> key from the Convex dashboard.
          </li>
          <li>
            Same deployment but different row counts: browser cache — reload the
            page.
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
      <h2 className="text-sm font-semibold text-foreground">Records in the database</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        If these counts match on both devices, they share the same database.
      </p>
      {summary === undefined ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Loading… (if the connection fails this line stays here)
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Table</th>
                <th className="px-3 py-2 font-medium">Rows</th>
                <th className="px-3 py-2 font-medium">Last write</th>
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
                    {t.count.toLocaleString('en-GB')}
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
      <h2 className="text-sm font-semibold text-amber-900">Duplicate rows</h2>
      <p className="mt-1 text-xs text-amber-800">
        Fields that should be unique have more than one row. Delete the extras
        on the relevant page.
      </p>
      <ul className="mt-2 list-inside list-disc text-sm text-amber-900">
        {duplicates.map((d) => (
          <li key={`${d.table}-${d.key}`}>
            {TABLE_LABELS[d.table] ?? d.table}: <code>{d.key}</code> — {d.count} rows
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
