import { createFileRoute, Link } from '@tanstack/react-router'
import { Fragment, useEffect, useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { useMutation, useQuery } from '../lib/convexTransport'
import { rawMrp, type RawMrpResult, type RawRequirementPlan } from '../lib/rawMrp'
import { formatPlantTime } from '../lib/sapUploads'

export const Route = createFileRoute('/hammadde')({
  component: RawMaterialCoveragePage,
})

const fmt = (n: number) => Math.round(n).toLocaleString('en-GB')
const DEFAULT_DAYS = 10
const DEFAULT_EXTRA = 500

/**
 * Hammadde ihtiyaç planlaması (MRP), plandan bağımsız. ZPP'nin son haftasına
 * kadar: talep − mamul stoğu (2009 + 1009) → brüt ağırlıkla kg → haftalık
 * stok yürütme; her hafta sonunda N günlük emniyet kalacak şekilde teslim
 * haftasına sipariş (+ standart ek). Hesap: src/lib/rawMrp.ts.
 */
function RawMaterialCoveragePage() {
  const data = useQuery(api.planRuns.latestRawCoverage) as
    | { computedAt: number; todayIso: string; rawRequirements: RawRequirementPlan | null }
    | null
    | undefined
  const settings = useQuery(api.pressCalendar.getGlobalSettings) as
    | { rawCoverageDays?: number; rawOrderExtraKg?: number }
    | null
    | undefined
  const saveSettings = useMutation(api.pressCalendar.saveRawCoverageSettings)

  const savedDays = settings?.rawCoverageDays ?? DEFAULT_DAYS
  const savedExtra = settings?.rawOrderExtraKg ?? DEFAULT_EXTRA
  const [days, setDays] = useState(String(savedDays))
  const [extra, setExtra] = useState(String(savedExtra))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [onlyOrders, setOnlyOrders] = useState(true)
  useEffect(() => setDays(String(savedDays)), [savedDays])
  useEffect(() => setExtra(String(savedExtra)), [savedExtra])
  const coverageDays = Math.max(1, Math.min(90, Math.round(Number(days) || savedDays)))
  const extraKg = Math.max(0, Math.round(Number(extra) || 0))
  const dirty = coverageDays !== savedDays || extraKg !== savedExtra

  const plan = data?.rawRequirements ?? null
  const results = useMemo<RawMrpResult[]>(
    () => (plan ? plan.items.map((item) => rawMrp(item, { coverageDays, extraKg })) : []),
    [plan, coverageDays, extraKg],
  )
  const weeks = plan?.weeks ?? []
  const shown = results
    .filter((r) => !onlyOrders || r.totalOrderKg > 0)
    .sort((a, b) => {
      const first = (r: RawMrpResult) => r.rows.findIndex((row) => row.orderKg > 0)
      const fa = first(a)
      const fb = first(b)
      return (fa < 0 ? 999 : fa) - (fb < 0 ? 999 : fb) || a.rawMaterial.localeCompare(b.rawMaterial)
    })
  const weekTotals = weeks.map((_, w) => results.reduce((a, r) => a + r.rows[w].orderKg, 0))
  const thisWeek = results.filter((r) => (r.rows[0]?.orderKg ?? 0) > 0)
  const lowCover = results.filter((r) => r.coversWeeks !== null && r.coversWeeks * 7 < coverageDays)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await saveSettings({ rawCoverageDays: coverageDays, rawOrderExtraKg: extraKg })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const downloadCsv = () => {
    const header = ['Raw material', 'Used by', 'Stock (kg)', ...weeks.map((w) => `${w.label} (${w.start})`), 'Total (kg)']
    const lines = [
      header.join(';'),
      ...shown.map((r) =>
        [r.rawMaterial, r.materials.join(' '), r.stockKg, ...r.rows.map((row) => row.orderKg || ''), r.totalOrderKg].join(';'),
      ),
      ['Total', '', '', ...weekTotals.map((t) => t || ''), weekTotals.reduce((a, b) => a + b, 0)].join(';'),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `raw-material-orders-${data?.todayIso ?? ''}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Raw Material Coverage</h1>
      <p className="mt-2 max-w-4xl text-muted-foreground">
        Steel requirement per week up to the last week in ZPP, independent of the production plan:
        demand minus finished stock (2009 + 1009, first weeks first) × gross weight per piece,
        co-products once. Coil stock is MB52 for the raw material codes in master data. An order is
        due in the week the stock would not cover that week's use plus the next{' '}
        <strong className="text-foreground">{coverageDays} days</strong>; each order gets{' '}
        <strong className="text-foreground">{fmt(extraKg)} kg</strong> extra. The plan's early
        production and whole-coil surplus are not added again — the {coverageDays}-day safety stock
        absorbs them.{' '}
        <Link to="/planlogic" hash="raw-mrp" className="underline">
          How it is calculated
        </Link>
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border p-3 text-sm">
        <label>
          <span className="block text-xs text-muted-foreground">Safety stock (days of use)</span>
          <input
            type="number"
            min={1}
            max={90}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="mt-1 w-28 rounded-md border border-input bg-background px-2 py-1.5"
          />
        </label>
        <label>
          <span className="block text-xs text-muted-foreground">Standard extra per order (kg)</span>
          <input
            type="number"
            min={0}
            step={100}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            className="mt-1 w-36 rounded-md border border-input bg-background px-2 py-1.5"
          />
        </label>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {dirty && <span className="text-xs text-amber-700">Unsaved — the table already uses these values</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}
        <span className="ml-auto text-xs text-muted-foreground">{data ? `Calculated ${formatPlantTime(data.computedAt)}` : ''}</span>
      </div>

      {data === undefined ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : !plan ? (
        <p className="mt-6 text-sm text-muted-foreground">Not calculated yet — it comes with the next plan calculation.</p>
      ) : (
        <>
          {plan.missingSpec.length > 0 && (
            <div className="mt-4 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm">
              <p className="font-semibold text-destructive">
                {plan.missingSpec.length} part(s) have demand but their steel is not in the table
              </p>
              <p className="mt-1 text-xs text-foreground">
                {plan.missingSpec
                  .slice(0, 30)
                  .map((m) => `${m.material} (${fmt(m.pieces)} pcs, ${m.reason})`)
                  .join(' · ')}
                {plan.missingSpec.length > 30 && ' …'} — add the raw material code and gross weight on{' '}
                <Link to="/referanslar" className="underline">
                  Master Data
                </Link>
                .
              </p>
            </div>
          )}
          {plan.suspectWeights.length > 0 && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Gross weight looks like a unit error (more than 50 kg or less than 1 g per piece):{' '}
              {plan.suspectWeights.map((s) => `${s.material} (${s.grossWeight} kg)`).join(', ')}.
            </p>
          )}

          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card label="Raw materials" value={fmt(results.length)} />
            <Card label={`Stock covers less than ${coverageDays} days`} value={fmt(lowCover.length)} warn={lowCover.length > 0} />
            <Card
              label={`Due this week (${weeks[0]?.label ?? ''})`}
              value={thisWeek.length > 0 ? `${thisWeek.length} · ${fmt(weekTotals[0] ?? 0)} kg` : '—'}
              warn={thisWeek.length > 0}
            />
            <Card
              label={`To order up to ${weeks[weeks.length - 1]?.label ?? ''}`}
              value={`${fmt(weekTotals.reduce((a, b) => a + b, 0))} kg`}
            />
          </dl>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">
              Orders by delivery week (kg) — {weeks.length} weeks, to the last ZPP week
            </h2>
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={onlyOrders} onChange={(e) => setOnlyOrders(e.target.checked)} />
                Only raw materials with an order
              </label>
              <button
                type="button"
                onClick={downloadCsv}
                className="rounded-md border border-border px-2.5 py-1 font-medium hover:bg-muted"
              >
                Download CSV
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Click a raw material to see need, stock and safety per week.</p>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-right text-xs tabular-nums">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium">Raw material</th>
                  <th className="px-2 py-2 font-medium">Stock</th>
                  <th className="px-2 py-2 font-medium">Covers</th>
                  {weeks.map((w) => (
                    <th key={w.start} className="whitespace-nowrap px-2 py-2 font-medium" title={`Week from ${w.start}`}>
                      {w.label.slice(-3)}
                    </th>
                  ))}
                  <th className="px-3 py-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <Fragment key={r.rawMaterial}>
                    <tr
                      onClick={() => setOpen(open === r.rawMaterial ? null : r.rawMaterial)}
                      className={`cursor-pointer border-t border-border hover:bg-muted/50 ${open === r.rawMaterial ? 'bg-muted/40' : ''}`}
                    >
                      <td className="sticky left-0 z-10 whitespace-nowrap bg-background px-3 py-1.5 text-left font-medium text-foreground">
                        {open === r.rawMaterial ? '▾ ' : '▸ '}
                        {r.rawMaterial}
                      </td>
                      <td className="px-2 py-1.5">{fmt(r.stockKg)}</td>
                      <td className={`whitespace-nowrap px-2 py-1.5 ${r.coversWeeks !== null && r.coversWeeks * 7 < coverageDays ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
                        {r.coversWeeks === null ? (r.totalNeedKg > 0 ? 'horizon' : '—') : `${r.coversWeeks} wk`}
                      </td>
                      {r.rows.map((row, w) => (
                        <td key={weeks[w].start} className={`px-2 py-1.5 ${row.orderKg > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground/40'}`}>
                          {row.orderKg > 0 ? fmt(row.orderKg) : '·'}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 font-semibold">{fmt(r.totalOrderKg)}</td>
                    </tr>
                    {open === r.rawMaterial && (
                      <>
                        <DetailRow label="Need" values={r.rows.map((x) => x.needKg)} />
                        <DetailRow label="Stock at week start" values={r.rows.map((x) => x.stockStartKg)} />
                        <DetailRow label={`Safety (${coverageDays} days)`} values={r.rows.map((x) => x.safetyKg)} />
                        <DetailRow label="Stock at week end" values={r.rows.map((x) => x.stockEndKg)} />
                        <tr className="bg-muted/20">
                          <td colSpan={weeks.length + 4} className="px-3 py-1.5 text-left text-muted-foreground">
                            Used by {r.materials.join(', ') || '—'} · need up to the last ZPP week {fmt(r.totalNeedKg)} kg
                          </td>
                        </tr>
                      </>
                    )}
                  </Fragment>
                ))}
                <tr className="border-t-2 border-border bg-muted/40 font-semibold text-foreground">
                  <td className="sticky left-0 z-10 bg-muted px-3 py-1.5 text-left">Total</td>
                  <td />
                  <td />
                  {weekTotals.map((t, w) => (
                    <td key={weeks[w].start} className="px-2 py-1.5">
                      {t > 0 ? fmt(t) : ''}
                    </td>
                  ))}
                  <td className="px-3 py-1.5">{fmt(weekTotals.reduce((a, b) => a + b, 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function DetailRow({ label, values }: { label: string; values: number[] }) {
  return (
    <tr className="bg-muted/20 text-muted-foreground">
      <td className="sticky left-0 z-10 bg-muted/60 px-3 py-1 pl-7 text-left">{label}</td>
      <td />
      <td />
      {values.map((v, i) => (
        <td key={i} className="px-2 py-1">
          {fmt(v)}
        </td>
      ))}
      <td />
    </tr>
  )
}

function Card({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold tabular-nums ${warn ? 'text-destructive' : 'text-foreground'}`}>{value}</dd>
    </div>
  )
}
