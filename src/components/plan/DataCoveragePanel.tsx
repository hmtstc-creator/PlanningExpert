import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { type DataCoverage } from '../../lib/planPipeline'
import { InfoTip } from '../PageHeader'

/** Planın kullandığı verinin kapsamı (Production Plan). */
const COVERAGE_FILES: { key: keyof DataCoverage['files']; label: string }[] = [
  { key: 'weeklyDemand', label: 'ZPP (weekly demand)' },
  { key: 'dailyDemand', label: 'ZPP_DAILY (daily demand)' },
  { key: 'stock', label: 'MB52 (stock)' },
  { key: 'rawStock', label: 'MB52 (raw material coils)' },
]

/**
 * Master data ana listedir. Master data'da olup yüklenen SAP dosyalarında
 * hiç satırı gelmeyen malzeme alarm verir: ya dosya eksik çekilmiştir ya da
 * kod master data'da farklı yazılmıştır.
 */
export function DataCoveragePanel({ coverage }: { coverage: DataCoverage }) {
  const [open, setOpen] = useState(false)
  const alarm = coverage.missingEverywhereCount > 0
  const anyMissing = COVERAGE_FILES.some((f) => coverage.files[f.key].missingCount > 0)
  if (!alarm && !anyMissing) return null
  return (
    <div
      className={`mt-6 rounded-lg border p-4 ${
        alarm ? 'border-destructive bg-destructive/10' : 'border-amber-200 bg-amber-50/70'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          {alarm
            ? `Master data check — ${coverage.missingEverywhereCount} of ${coverage.materials} parts have no row in any SAP file`
            : `Master data check — some parts are missing from a SAP file`}
        </h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
        >
          {open ? 'Hide ▴' : 'Show ▾'}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        <InfoTip label="About the master data check">
          Master data is the main list: only its parts are kept from the uploaded files. A part in
          master data with no row at all means the file was pulled without it, or its code is
          written differently in master data. It is planned with no demand and no stock.
        </InfoTip>{' '}
        <Link to="/sapdata" className="underline">
          SAP Data
        </Link>{' '}
        ·{' '}
        <Link to="/referanslar" className="underline">
          Master Data
        </Link>
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {COVERAGE_FILES.map(({ key, label }) => {
          const f = coverage.files[key]
          return (
            <li key={key} className={f.missingCount > 0 ? 'text-amber-800' : 'text-emerald-700'}>
              {label}:{' '}
              {!f.uploaded ? 'not uploaded' : f.missingCount > 0 ? `${f.missingCount} parts missing` : 'all parts present'}
            </li>
          )
        })}
      </ul>
      {open && (
        <div className="mt-3 space-y-3 text-xs">
          {alarm && (
            <div>
              <p className="font-medium text-destructive">In no file at all ({coverage.missingEverywhereCount})</p>
              <p className="mt-1 break-words text-foreground">
                {coverage.missingEverywhere.join(', ')}
                {coverage.missingEverywhereCount > coverage.missingEverywhere.length && ' …'}
              </p>
            </div>
          )}
          {COVERAGE_FILES.filter(({ key }) => coverage.files[key].missingCount > 0).map(({ key, label }) => {
            const f = coverage.files[key]
            return (
              <div key={key}>
                <p className="font-medium text-amber-900">
                  Missing from {label} ({f.missingCount})
                </p>
                <p className="mt-1 break-words text-muted-foreground">
                  {f.missing.join(', ')}
                  {f.missingCount > f.missing.length && ' …'}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
