import { createFileRoute } from '@tanstack/react-router'
import { useConvex, useQuery, useTransport } from '../lib/convexTransport'
import { useEffect, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { QueryCatcher } from '../components/QueryCatcher'
import { BUILD, REPO_URL, formatBuildTime } from '../lib/buildInfo'

export const Route = createFileRoute('/tani')({
  component: TaniPage,
})

const CONVEX_URL: string = (import.meta as any).env?.VITE_CONVEX_URL ?? ''

/** VPS'teki Convex sunucumuzun adresi (ör. planningexpert.<tailnet>.ts.net:8443). */
function deploymentName(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return '(unreadable)'
  }
}

function formatTime(ms: number | null): string {
  if (ms === null) return '—'
  return new Date(ms).toLocaleString('en-GB')
}

const TABLE_LABELS: Record<string, string> = {
  presses: 'Work centers',
  products: 'Materials',
  pressTemplates: 'Work center calendar templates',
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
  planJobLocks: 'Approved jobs (locked)',
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

  // 1) HTTPS erişimi: Convex sunucumuzun adresine hiç ulaşılabiliyor mu?
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
          but a missing build setting (docs/deployment.md). Build on the server
          with <code className="break-all">./scripts/release.sh</code> (it sets the
          address from <code>CONVEX_PUBLIC_URL</code>).
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
            traffic to <code>{deployment}</code>.
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
            <code>{deployment}</code> is reachable over HTTPS, but
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
            traffic to <code>{deployment}</code>.
          </p>
        </>
      ),
    }
  } else {
    verdict = {
      tone: 'bad',
      title: 'The database server cannot be reached at all',
      body: (
        <>
          <p>
            This device cannot reach <code>{deployment}</code> even
            over HTTPS. The domain is fully blocked or sits behind a proxy.
          </p>
          <p className="mt-2">
            <strong>Request for IT:</strong> whitelist <code>{deployment}</code>
            (HTTPS and WebSocket).
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
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Connection Diagnostics</h1>
      <p className="mt-2 text-muted-foreground">
        This page shows whether the device can actually reach the database and,
        if not, exactly where the connection is blocked.
      </p>

      <div className={`mt-6 rounded-lg border p-4 ${toneClass}`}>
        <p className="text-sm font-semibold">{verdict.title}</p>
        <div className="mt-2 text-sm">{verdict.body}</div>
      </div>

      <BuildPanel />

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
            build points at another Convex server (an old build or another
            URL). Rebuild on the server with <code>./scripts/release.sh</code>.
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

/**
 * Yayındaki sürüm: derlemede gömülen commit ve yayın zamanı. GitHub'daki en son
 * main ile karşılaştırmak için bağlantı (depo tarayıcıdan sorgulanmaz).
 */
function BuildPanel() {
  const ageDays = BUILD.builtAt ? Math.floor((Date.now() - Date.parse(BUILD.builtAt)) / 86_400_000) : null
  return (
    <div className="mt-6 rounded-lg border border-border p-4">
      <h2 className="text-sm font-semibold text-foreground">Version on this site</h2>
      {!BUILD.commit ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No version recorded — this build was not made with <code>scripts/release.sh</code> (local development, or a
          build from before 22 Oct 2026).
        </p>
      ) : (
        <>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Commit">
              <a
                href={`${REPO_URL}/commit/${BUILD.commit}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-base font-semibold text-foreground underline hover:no-underline"
              >
                {BUILD.commit}
              </a>
              {BUILD.branch && <span className="ml-2 text-xs text-muted-foreground">on {BUILD.branch}</span>}
            </Row>
            <Row label="Change">
              <span className="text-foreground">{BUILD.message || '—'}</span>
            </Row>
            <Row label="Committed">
              <span className="text-muted-foreground">{formatBuildTime(BUILD.committedAt)}</span>
            </Row>
            <Row label="Published">
              <span className="font-medium text-foreground">{formatBuildTime(BUILD.builtAt)}</span>
              {ageDays !== null && ageDays > 0 && (
                <span className="ml-2 text-xs text-muted-foreground">({ageDays} day{ageDays === 1 ? '' : 's'} ago)</span>
              )}
            </Row>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            Is it the latest? Compare the commit above with the top of{' '}
            <a href={`${REPO_URL}/commits/main`} target="_blank" rel="noreferrer" className="underline hover:no-underline">
              main on GitHub
            </a>
            . A browser refresh (Ctrl+F5) is needed after a release to load it.
          </p>
        </>
      )}
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
