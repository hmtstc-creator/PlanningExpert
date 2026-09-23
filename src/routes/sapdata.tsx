import { createFileRoute, Link } from '@tanstack/react-router'

import { api } from '../../convex/_generated/api'
import { ExcelUpload } from '../components/ExcelUpload'
import { useMutation } from '../lib/convexTransport'
import { parseDemandRows, parseMovementRows, parseStockRows } from '../lib/sapParsers'
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

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">SAP Data</h1>
      <p className="mt-2 max-w-4xl text-muted-foreground">
        Upload the daily SAP exports here. Each upload replaces the previous
        one entirely, so you are asked to confirm before a file is read. The
        plan is recalculated on the server a few seconds after every upload.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <UploadCard
          title="Weekly demand — ZPP"
          feeds="Net requirement per week. This is what the plan produces against."
          view={{ to: '/siparisler', label: 'View demand' }}
        >
          <ExcelUpload
            expectedColumns={['Material', 'Stock in storage', 'Overdue Requirements', '...weekly columns']}
            replaces="all weekly demand rows"
            onRows={async (raw) => {
              const result = await replaceWeekly({ rows: parseDemandRows(raw) })
              return { message: uploadMessage('weekly demand rows', result) }
            }}
          />
        </UploadCard>

        <UploadCard
          title="Daily demand — ZPP_DAILY"
          feeds="Net requirement per day, for the daily view of the demand page."
          view={{ to: '/siparisler', label: 'View demand' }}
        >
          <ExcelUpload
            expectedColumns={['Material', 'Stock in storage', 'Overdue Requirements', '...daily columns']}
            replaces="all daily demand rows"
            onRows={async (raw) => {
              const result = await replaceDaily({ rows: parseDemandRows(raw) })
              return { message: uploadMessage('daily demand rows', result) }
            }}
          />
        </UploadCard>

        <UploadCard
          title="Stock — MB52"
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
            onRows={async (raw) => {
              const result = await replaceStock({ rows: parseStockRows(raw) })
              return { message: uploadMessage('stock rows', result) }
            }}
          />
        </UploadCard>

        <UploadCard
          title="Actual production — MB51"
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
            onRows={async (raw) => {
              const result = await replaceActuals({ rows: parseMovementRows(raw) })
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

function UploadCard({
  title,
  feeds,
  view,
  children,
}: {
  title: string
  feeds: string
  view: { to: string; label: string }
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <Link to={view.to} className="shrink-0 text-xs text-muted-foreground underline hover:text-foreground">
          {view.label} →
        </Link>
      </div>
      <p className="mt-1 mb-3 text-xs text-muted-foreground">{feeds}</p>
      {children}
    </section>
  )
}
