import { createFileRoute, Link } from '@tanstack/react-router'
import { Fragment, useEffect, useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { useMutation, useQuery } from '../lib/convexTransport'
import { rawMrp, type RawMrpResult, type RawRequirementPlan } from '../lib/rawMrp'
import { buildDraftEml, buildOrderWorkbook, parseAddresses, workbookBytes, XLSX_TYPE } from '../lib/rawOrderExport'
import { formatPlantTime } from '../lib/sapUploads'
import { SETTINGS_DEFAULTS } from '../lib/settingsDefaults'

export const Route = createFileRoute('/hammadde')({
  component: RawMaterialCoveragePage,
})

const fmt = (n: number) => Math.round(n).toLocaleString('en-GB')
/** kg → ton, bir ondalık. */
const tons = (kg: number) => (kg / 1000).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
/** Mamul kodları: ilk ikisi, fazlası "+n". */
const productsLabel = (codes: string[]) =>
  codes.length === 0 ? '—' : codes.length <= 2 ? codes.join(', ') : `${codes.slice(0, 2).join(', ')} +${codes.length - 2}`
// Yapışkan iki sütun: mamul kodu ve hammadde; ikincisi birincinin genişliği kadar sağda.
const PRODUCT_COL = 'sticky left-0 z-10 w-44 min-w-44 max-w-44'
const RAW_COL = 'sticky left-44 z-10'
const DEFAULT_DAYS = SETTINGS_DEFAULTS.rawCoverageDays
const DEFAULT_EXTRA = SETTINGS_DEFAULTS.rawOrderExtraKg

/**
 * Hammadde ihtiyaç planlaması (MRP), plandan bağımsız. ZPP'nin son haftasına
 * kadar: talep − mamul stoğu → brüt ağırlıkla kg → haftalık stok yürütme
 * (eldeki rulo + yoldakiler); her hafta sonunda sonraki N iş gününün
 * tüketimi kalacak şekilde teslim haftasına sipariş (+ standart ek).
 * Talep yoksa sipariş yok. Hesap: src/lib/rawMrp.ts.
 */
function RawMaterialCoveragePage() {
  const data = useQuery(api.planRuns.latestRawCoverage) as
    | { computedAt: number; todayIso: string; rawRequirements: RawRequirementPlan | null }
    | null
    | undefined
  const settings = useQuery(api.pressCalendar.getGlobalSettings) as
    | { rawCoverageDays?: number; rawOrderExtraKg?: number; rawOrderMailTo?: string[]; rawOrderMailCc?: string[] }
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
  const workingDaysPerWeek = plan?.workingDaysPerWeek ?? 5
  const results = useMemo<RawMrpResult[]>(
    () => {
      if (!plan) return []
      const workingDaysByWeek = plan.weeks.map((w) => w.workingDays ?? workingDaysPerWeek)
      return plan.items.map((item) => rawMrp(item, { coverageDays, extraKg, workingDaysPerWeek, workingDaysByWeek }))
    },
    [plan, coverageDays, extraKg, workingDaysPerWeek],
  )
  const itemByRaw = useMemo(() => new Map((plan?.items ?? []).map((i) => [i.rawMaterial, i])), [plan])
  const coverWeeks = Math.round((coverageDays / workingDaysPerWeek) * 10) / 10
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
  // Bütün hammaddelerin haftalık ihtiyacı (kg) — tablonun üstünde ton olarak.
  const weekNeed = weeks.map((_, w) => results.reduce((a, r) => a + r.rows[w].needKg, 0))
  const totalNeed = weekNeed.reduce((a, b) => a + b, 0)
  const totalStock = results.reduce((a, r) => a + r.stockKg, 0)
  const thisWeek = results.filter((r) => (r.rows[0]?.orderKg ?? 0) > 0)
  const lowCover = results.filter((r) => r.coversWeeks !== null && r.coversWeeks * workingDaysPerWeek < coverageDays)
  const transitTotal = results.reduce((a, r) => a + r.totalInTransitKg, 0)

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

  const mailTo = settings?.rawOrderMailTo ?? []
  const mailCc = settings?.rawOrderMailCc ?? []
  const fileBase = `raw-material-orders-${data?.todayIso ?? ''}`
  const excelBytes = () =>
    workbookBytes(
      buildOrderWorkbook(results, weeks, {
        computedAt: data ? formatPlantTime(data.computedAt) : '',
        coverageDays,
        extraKg,
      }),
    )
  const download = (bytes: BlobPart, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([bytes], { type }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }
  const downloadExcel = () => download(excelBytes() as Uint8Array<ArrayBuffer>, `${fileBase}.xlsx`, XLSX_TYPE)
  const prepareMail = () => {
    const total = weekTotals.reduce((a, b) => a + b, 0)
    const lines = weeks
      .map((w, i) => (weekTotals[i] > 0 ? `${w.label} (${w.start}): ${fmt(weekTotals[i])} kg` : null))
      .filter(Boolean)
    const body = [
      'Hello,',
      '',
      `Attached are the raw material orders by delivery week, calculated ${data ? formatPlantTime(data.computedAt) : ''}.`,
      `Safety stock ${coverageDays} working days of use after each week, +${fmt(extraKg)} kg per order. Stock on hand and material in transit are already deducted. Total ${fmt(total)} kg.`,
      '',
      'Totals by delivery week:',
      ...lines,
      '',
      'Best regards',
    ].join('\n')
    const eml = buildDraftEml({
      to: mailTo,
      cc: mailCc,
      subject: `Raw material orders ${weeks[0]?.label ?? ''} – ${weeks[weeks.length - 1]?.label ?? ''}`,
      body,
      attachment: { name: `${fileBase}.xlsx`, bytes: excelBytes(), contentType: XLSX_TYPE },
    })
    download(eml, `${fileBase}.eml`, 'message/rfc822')
  }

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Raw Material Coverage</h1>
      <p className="mt-2 max-w-4xl text-muted-foreground">
        Steel requirement per week up to the last week in ZPP, independent of the production plan:
        demand minus finished stock (first weeks first) × gross weight per piece, co-products once.
        Supply is the coil stock on hand in the locations ticked <em>Raw material</em> on{' '}
        <Link to="/depolar" className="underline">
          Storage Locations
        </Link>{' '}
        plus the coils in transit (SAP Data → in-transit list, booked in their ETA week). An order is
        due in the week the stock would not cover that week's use plus the next{' '}
        <strong className="text-foreground">
          {coverageDays} working days ({coverWeeks} wk)
        </strong>
        ; each order gets <strong className="text-foreground">{fmt(extraKg)} kg</strong> extra. No
        demand, no order: nothing is brought in beyond the last ZPP week.{' '}
        <Link to="/planlogic" hash="raw-mrp" className="underline">
          How it is calculated
        </Link>
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border p-3 text-sm">
        <label>
          <span className="block text-xs text-muted-foreground">Safety stock (working days after week end)</span>
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

      <RecipientsPanel
        to={mailTo}
        cc={mailCc}
        canSend={!!plan && weekTotals.some((t) => t > 0)}
        onPrepare={prepareMail}
      />

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

          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Card label="Raw materials" value={fmt(results.length)} />
            <Card label="In transit" value={transitTotal > 0 ? `${fmt(transitTotal)} kg` : '—'} />
            <Card label={`Stock + transit covers < ${coverageDays} working days`} value={fmt(lowCover.length)} warn={lowCover.length > 0} />
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
                onClick={downloadExcel}
                className="rounded-md border border-border px-2.5 py-1 font-medium hover:bg-muted"
              >
                Download Excel
              </button>
            </div>
          </div>
          <p className="mt-2 text-sm text-foreground">
            Total raw material need to {weeks[weeks.length - 1]?.label ?? ''}:{' '}
            <strong>{tons(totalNeed)} t</strong>
            <span className="text-muted-foreground">
              {' '}
              · stock {tons(totalStock)} t · in transit {tons(transitTotal)} t · to order{' '}
              {tons(weekTotals.reduce((a, b) => a + b, 0))} t
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            The first two rows are all raw materials together, in tonnes per week. Click a raw material
            to see need, stock, arrivals and safety per week (kg).
          </p>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-right text-xs tabular-nums">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className={`${PRODUCT_COL} bg-muted px-3 py-2 text-left font-medium`}>Finished product</th>
                  <th className={`${RAW_COL} bg-muted px-3 py-2 text-left font-medium`}>Raw material</th>
                  <th className="px-2 py-2 font-medium">Stock</th>
                  <th className="px-2 py-2 font-medium">In transit</th>
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
                <tr className="bg-sky-50 font-semibold text-foreground">
                  <td colSpan={2} className="sticky left-0 z-10 bg-sky-50 px-3 py-1.5 text-left">
                    Need, all raw materials (t)
                  </td>
                  <td className="px-2 py-1.5 font-normal text-muted-foreground">{tons(totalStock)}</td>
                  <td className="px-2 py-1.5 font-normal text-muted-foreground">{transitTotal > 0 ? tons(transitTotal) : '·'}</td>
                  <td />
                  {weekNeed.map((kg, w) => (
                    <td key={weeks[w].start} className="px-2 py-1.5">
                      {kg > 0 ? tons(kg) : '·'}
                    </td>
                  ))}
                  <td className="px-3 py-1.5">{tons(totalNeed)}</td>
                </tr>
                <tr className="border-b-2 border-border bg-sky-50/60 text-foreground">
                  <td colSpan={2} className="sticky left-0 z-10 bg-sky-50 px-3 py-1.5 text-left font-medium">
                    Orders, all raw materials (t)
                  </td>
                  <td />
                  <td />
                  <td />
                  {weekTotals.map((kg, w) => (
                    <td key={weeks[w].start} className="px-2 py-1.5">
                      {kg > 0 ? tons(kg) : '·'}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 font-semibold">{tons(weekTotals.reduce((a, b) => a + b, 0))}</td>
                </tr>
                {shown.map((r) => (
                  <Fragment key={r.rawMaterial}>
                    <tr
                      onClick={() => setOpen(open === r.rawMaterial ? null : r.rawMaterial)}
                      className={`cursor-pointer border-t border-border hover:bg-muted/50 ${open === r.rawMaterial ? 'bg-muted/40' : ''}`}
                    >
                      <td
                        className={`${PRODUCT_COL} truncate bg-background px-3 py-1.5 text-left text-foreground`}
                        title={r.materials.join(', ')}
                      >
                        {productsLabel(r.materials)}
                      </td>
                      <td className={`${RAW_COL} whitespace-nowrap bg-background px-3 py-1.5 text-left font-medium text-foreground`}>
                        {open === r.rawMaterial ? '▾ ' : '▸ '}
                        {r.rawMaterial}
                      </td>
                      <td className="px-2 py-1.5">{fmt(r.stockKg)}</td>
                      <td className="px-2 py-1.5 text-sky-700">{r.totalInTransitKg > 0 ? fmt(r.totalInTransitKg) : '·'}</td>
                      <td className={`whitespace-nowrap px-2 py-1.5 ${r.coversWeeks !== null && r.coversWeeks * workingDaysPerWeek < coverageDays ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
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
                        <DetailRow label="In transit arriving" values={r.rows.map((x) => x.inTransitKg)} />
                        <DetailRow label={`Safety (${coverageDays} working days)`} values={r.rows.map((x) => x.safetyKg)} />
                        <DetailRow label="Stock at week end" values={r.rows.map((x) => x.stockEndKg)} />
                        <tr className="bg-muted/20">
                          <td colSpan={weeks.length + 6} className="px-3 py-1.5 text-left text-muted-foreground">
                            Used by {r.materials.join(', ') || '—'} · need up to the last ZPP week {fmt(r.totalNeedKg)} kg
                            {(itemByRaw.get(r.rawMaterial)?.inTransit ?? []).length > 0 && (
                              <>
                                {' · In transit: '}
                                {(itemByRaw.get(r.rawMaterial)?.inTransit ?? [])
                                  .map(
                                    (l) =>
                                      `${fmt(l.quantityKg)} kg ${l.eta ? `ETA ${l.eta}` : 'no ETA (counted this week)'}` +
                                      (l.week < 0 ? ' (after the last ZPP week)' : '') +
                                      (l.poNumber ? ` PO ${l.poNumber}` : '') +
                                      (l.supplier ? ` ${l.supplier}` : ''),
                                  )
                                  .join('; ')}
                              </>
                            )}
                          </td>
                        </tr>
                      </>
                    )}
                  </Fragment>
                ))}
                <tr className="border-t-2 border-border bg-muted/40 font-semibold text-foreground">
                  <td colSpan={2} className="sticky left-0 z-10 bg-muted px-3 py-1.5 text-left">Total (kg)</td>
                  <td />
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

/**
 * Sipariş mailinin alıcıları (To) ve bilgi grubu (CC): bir kez tanımlanır,
 * herkes aynı listeyi görür. "Prepare e-mail" Outlook'ta açılan, Excel ekli,
 * gönderilmemiş bir taslak indirir — şifre ya da hesap bilgisi gerekmez.
 */
function RecipientsPanel({
  to,
  cc,
  canSend,
  onPrepare,
}: {
  to: string[]
  cc: string[]
  canSend: boolean
  onPrepare: () => void
}) {
  const saveRecipients = useMutation(api.pressCalendar.saveRawOrderRecipients)
  const [editing, setEditing] = useState(false)
  const [toText, setToText] = useState('')
  const [ccText, setCcText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const start = () => {
    setToText(to.join('\n'))
    setCcText(cc.join('\n'))
    setError(null)
    setEditing(true)
  }
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await saveRecipients({ to: parseAddresses(toText), cc: parseAddresses(ccText) })
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-4 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-foreground">Order e-mail</p>
          {to.length === 0 && cc.length === 0 ? (
            <p className="text-xs text-muted-foreground">No recipients yet — define them once with Edit recipients.</p>
          ) : (
            <p className="break-words text-xs text-muted-foreground">
              <span className="font-medium text-foreground">To:</span> {to.join(', ') || '—'}
              {cc.length > 0 && (
                <>
                  {' · '}
                  <span className="font-medium text-foreground">CC:</span> {cc.join(', ')}
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={start} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
            Edit recipients
          </button>
          <button
            type="button"
            onClick={onPrepare}
            disabled={!canSend || to.length === 0}
            title={to.length === 0 ? 'Define the recipients first' : 'Downloads an Outlook draft with the Excel attached'}
            className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
          >
            Prepare e-mail (Outlook)
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Prepare e-mail downloads a draft: open it and Outlook shows the message with the recipients,
        the subject and the Excel attached — check it and press Send. It goes from your own Outlook;
        no password is stored here.
      </p>
      {editing && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs">
            <span className="block text-muted-foreground">To (one per line, or separated by ; or ,)</span>
            <textarea
              value={toText}
              onChange={(e) => setToText(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5"
              placeholder="buyer@company.com"
            />
          </label>
          <label className="text-xs">
            <span className="block text-muted-foreground">CC</span>
            <textarea
              value={ccText}
              onChange={(e) => setCcText(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5"
              placeholder="manager@company.com"
            />
          </label>
          <div className="flex items-center gap-2 sm:col-span-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save recipients'}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
              Cancel
            </button>
            {error && <span className="text-xs text-destructive">{error}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, values }: { label: string; values: number[] }) {
  return (
    <tr className="bg-muted/20 text-muted-foreground">
      <td colSpan={2} className="sticky left-0 z-10 bg-muted/60 px-3 py-1 pl-7 text-left">{label}</td>
      <td />
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
