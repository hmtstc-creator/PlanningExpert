import { createFileRoute, Link } from '@tanstack/react-router'

import { api } from '../../convex/_generated/api'
import { ExcelUpload } from '../components/ExcelUpload'
import { useMutation, useQuery } from '../lib/convexTransport'
import { parseDemandRows, parseMovementRows, parseStockRows } from '../lib/sapParsers'
import {
  SAP_UPLOAD_KEYS,
  SAP_UPLOAD_LABELS,
  demandCoverage,
  formatPlantTime,
  planUsage,
  postingCoverage,
  type PlanDataSources,
  type SapUpload,
  type SapUploadKey,
} from '../lib/sapUploads'
import { uploadMessage } from '../lib/uploadMessage'

export const Route = createFileRoute('/sapdata')({
  component: SapDataPage,
})

/**
 * SAP'den gelen günlük dosyaların tek yükleme noktası.
 *
 * Yüklemeler eskiden Talep, Stok ve Gerçekleşen sayfalarına dağılmıştı;
 * sabah rutini dört sayfa gezmek demekti. Artık hepsi burada, o sayfalar
 * yalnızca veriyi gösteriyor.
 */
function SapDataPage() {
  const replaceWeekly = useMutation(api.demand.replaceWeekly)
  const replaceDaily = useMutation(api.demand.replaceDaily)
  const replaceStock = useMutation(api.stock.replaceAll)
  const replaceActuals = useMutation(api.actualProduction.replaceAll)
  const status = useQuery(api.sapUploads.status) as UploadStatus | undefined

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">SAP Data</h1>
      <p className="mt-2 max-w-4xl text-muted-foreground">
        Upload the daily SAP exports here. Choose a file, check the preview and
        press Save — the saved file replaces the previous one entirely. The plan
        is recalculated on the server a few seconds after every save.
      </p>

      <DataInUse status={status} />

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <UploadCard
          title={SAP_UPLOAD_LABELS.weeklyDemand}
          dataKey="weeklyDemand"
          status={status}
          feeds="Net requirement per week. This is what the plan produces against."
          view={{ to: '/siparisler', label: 'View demand' }}
        >
          <ExcelUpload
            expectedColumns={['Material', 'Stock in storage', 'Overdue Requirements', '...weekly columns']}
            replaces="all weekly demand rows"
            requiredColumns={['Material']}
            describe={describeDemand}
            onRows={async (raw, { fileName }) => {
              const result = await replaceWeekly({ rows: parseDemandRows(raw), fileName })
              return { message: uploadMessage('weekly demand rows', result) }
            }}
          />
        </UploadCard>

        <UploadCard
          title={SAP_UPLOAD_LABELS.dailyDemand}
          dataKey="dailyDemand"
          status={status}
          feeds="Sales day per column. The plan uses these dates for the days the file covers; the weekly ZPP only beyond them."
          view={{ to: '/siparisler', label: 'View demand' }}
        >
          <ExcelUpload
            expectedColumns={['Material', 'Stock in storage', 'Overdue Requirements', '...daily columns']}
            replaces="all daily demand rows"
            isoDateHeaders
            requiredColumns={['Material']}
            describe={describeDemand}
            onRows={async (raw, { fileName }) => {
              const result = await replaceDaily({ rows: parseDemandRows(raw), fileName })
              return { message: uploadMessage('daily demand rows', result) }
            }}
          />
        </UploadCard>

        <UploadCard
          title={SAP_UPLOAD_LABELS.stock}
          dataKey="stock"
          status={status}
          feeds="Unrestricted stock is deducted from demand; raw material stock is checked against the coils the plan needs."
          view={{ to: '/stoklar', label: 'View stock' }}
        >
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
            replaces="all stock rows"
            requiredColumns={['Material', 'Storage Location', 'Unrestricted']}
            onRows={async (raw, { fileName }) => {
              const result = await replaceStock({ rows: parseStockRows(raw), fileName })
              return { message: uploadMessage('stock rows', result) }
            }}
          />
        </UploadCard>

        <UploadCard
          title={SAP_UPLOAD_LABELS.actuals}
          dataKey="actuals"
          status={status}
          feeds="Plan versus actual, measured press performance and mould shot counters (maintenance alarms)."
          view={{ to: '/gerceklesen', label: 'View actuals' }}
        >
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
            replaces="all actual production rows"
            requiredColumns={['Material']}
            describe={describeMovements}
            onRows={async (raw, { fileName }) => {
              const result = await replaceActuals({ rows: parseMovementRows(raw), fileName })
              return { message: uploadMessage('movement rows', result) }
            }}
          />
        </UploadCard>
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Master data (cavities, SPM, weights, machines) is maintained on the{' '}
        <Link to="/referanslar" className="underline hover:no-underline">
          Master Data
        </Link>{' '}
        page.
      </p>
    </div>
  )
}

interface UploadStatus {
  uploads: SapUpload[]
  plan: { computedAt: number; dataSources?: PlanDataSources } | null
  pending: boolean
  lastError?: string
}

function describeDemand(raw: Record<string, unknown>[]) {
  const rows = parseDemandRows(raw)
  const { coversFrom, coversTo } = demandCoverage(rows)
  return `${rows.length.toLocaleString('en-GB')} materials` +
    (coversFrom ? `, periods ${coversFrom} → ${coversTo}` : '')
}

function describeMovements(raw: Record<string, unknown>[]) {
  const rows = parseMovementRows(raw)
  const { coversFrom, coversTo } = postingCoverage(rows)
  return `${rows.length.toLocaleString('en-GB')} movements` +
    (coversFrom ? `, posting dates ${coversFrom} → ${coversTo}` : '')
}

/**
 * Sayfanın en üstü: mevcut plan hangi dosyalarla hesaplandı. Yükleme
 * kaydedildi mi, plan onu gördü mü — tek bakışta.
 */
function DataInUse({ status }: { status: UploadStatus | undefined }) {
  if (status === undefined) {
    return <p className="mt-4 text-sm text-muted-foreground">Loading the upload history…</p>
  }
  return (
    <section className="mt-4 rounded-lg border border-border">
      <h2 className="border-b border-border px-4 py-2 text-sm font-semibold text-foreground">
        Data the plan is using
        <span className="ml-2 font-normal text-muted-foreground">
          {status.plan
            ? `plan calculated ${formatPlantTime(status.plan.computedAt)} (Romania time)`
            : 'no plan calculated yet'}
        </span>
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Data</th>
              <th className="px-4 py-2 font-medium">File</th>
              <th className="px-4 py-2 font-medium">Saved</th>
              <th className="px-4 py-2 font-medium">Rows</th>
              <th className="px-4 py-2 font-medium">Covers</th>
              <th className="px-4 py-2 font-medium">In the plan?</th>
            </tr>
          </thead>
          <tbody>
            {SAP_UPLOAD_KEYS.map((key) => {
              const upload = status.uploads.find((u) => u.key === key)
              return (
                <tr key={key} className="border-t border-border align-top">
                  <td className="px-4 py-2 font-medium text-foreground">{SAP_UPLOAD_LABELS[key]}</td>
                  <td className="px-4 py-2 text-foreground">{fileLabel(upload)}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                    {upload ? formatPlantTime(upload.uploadedAt) : '—'}
                    {upload?.uploadedBy && <span className="block text-xs">by {upload.uploadedBy}</span>}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-muted-foreground">{rowsLabel(upload)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{coverLabel(upload)}</td>
                  <td className="px-4 py-2">
                    <UsageBadge upload={upload} status={status} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {status.lastError && !status.pending && (
        <p className="border-t border-border px-4 py-2 text-xs text-destructive">
          The last plan calculation failed: {status.lastError}
        </p>
      )}
    </section>
  )
}

function fileLabel(upload: SapUpload | undefined) {
  if (!upload) return <span className="text-muted-foreground">Not uploaded yet</span>
  if (upload.fileName) return <span className="break-all">{upload.fileName}</span>
  return <span className="text-muted-foreground">name not recorded (older upload)</span>
}

function rowsLabel(upload: SapUpload | undefined) {
  if (!upload || upload.rowsImported === undefined) return '—'
  const skipped = (upload.skippedUnknownMaterial ?? 0) + (upload.skippedUnknownLocation ?? 0)
  return (
    <>
      {upload.rowsImported.toLocaleString('en-GB')} imported
      {skipped > 0 && (
        <span className="block text-xs">
          {skipped.toLocaleString('en-GB')} of {(upload.rowsInFile ?? 0).toLocaleString('en-GB')} skipped
        </span>
      )}
    </>
  )
}

function coverLabel(upload: SapUpload | undefined) {
  if (!upload?.coversFrom) return '—'
  return upload.coversFrom === upload.coversTo
    ? upload.coversFrom
    : `${upload.coversFrom} → ${upload.coversTo}`
}

function UsageBadge({ upload, status }: { upload: SapUpload | undefined; status: UploadStatus }) {
  const usage = planUsage(upload, status.plan, status.pending)
  switch (usage.kind) {
    case 'inPlan':
      return (
        <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
          ✓ Used by the current plan
        </span>
      )
    case 'recalculating':
      return (
        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
          Saved — plan recalculating…
        </span>
      )
    case 'notYet':
      return (
        <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
          Saved — not in the plan yet
        </span>
      )
    case 'none':
      return <span className="text-xs text-muted-foreground">—</span>
  }
}

function UploadCard({
  title,
  dataKey,
  status,
  feeds,
  view,
  children,
}: {
  title: string
  dataKey: SapUploadKey
  status: UploadStatus | undefined
  feeds: string
  view: { to: string; label: string }
  children: React.ReactNode
}) {
  const upload = status?.uploads.find((u) => u.key === dataKey)
  return (
    <section className="rounded-lg border border-border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <Link to={view.to} className="shrink-0 text-xs text-muted-foreground underline hover:text-foreground">
          {view.label} →
        </Link>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{feeds}</p>
      <p className="mt-2 mb-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Current file: </span>
        {status === undefined
          ? 'loading…'
          : upload
            ? (
                <>
                  {fileLabel(upload)} — saved {formatPlantTime(upload.uploadedAt)}
                  {upload.uploadedBy ? ` by ${upload.uploadedBy}` : ''}
                </>
              )
            : 'nothing uploaded yet'}
      </p>
      {children}
    </section>
  )
}
