import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { RawCoverageChart } from '../components/RawCoverageChart'
import { useMutation, useQuery } from '../lib/convexTransport'
import {
  coverageOf,
  DEFAULT_COVERAGE,
  type RawConsumptionPlan,
  type RawCoverage,
  type RawOrder,
} from '../lib/rawCoverage'
import { formatPlantTime } from '../lib/sapUploads'

export const Route = createFileRoute('/hammadde')({
  component: RawMaterialCoveragePage,
})

const fmt = (n: number) => Math.round(n).toLocaleString('en-GB')
const SELECTION_KEY = 'raw-coverage-selection'
const dayMonth = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })

/**
 * Hammadde yeterliliği: plan her rulonun gün gün tüketimini verir; elde her
 * zaman N günlük tüketim tutulacak şekilde sipariş takvimi çıkarılır ve her
 * siparişe standart bir ek (kg) konur. N ve ek kullanıcı ayarıdır; değişince
 * takvim anında yeniden hesaplanır, Save ile herkes için kaydedilir.
 */
function RawMaterialCoveragePage() {
  const data = useQuery(api.planRuns.latestRawCoverage) as
    | { computedAt: number; todayIso: string; rawConsumption: RawConsumptionPlan | null }
    | null
    | undefined
  const settings = useQuery(api.pressCalendar.getGlobalSettings) as
    | { rawCoverageDays?: number; rawOrderExtraKg?: number }
    | null
    | undefined
  const saveSettings = useMutation(api.pressCalendar.saveRawCoverageSettings)

  const savedDays = settings?.rawCoverageDays ?? DEFAULT_COVERAGE.coverageDays
  const savedExtra = settings?.rawOrderExtraKg ?? DEFAULT_COVERAGE.extraKg
  const [days, setDays] = useState(String(savedDays))
  const [extra, setExtra] = useState(String(savedExtra))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setDays(String(savedDays)), [savedDays])
  useEffect(() => setExtra(String(savedExtra)), [savedExtra])
  const coverageDays = Math.max(1, Math.min(90, Math.round(Number(days) || savedDays)))
  const extraKg = Math.max(0, Math.round(Number(extra) || 0))
  const dirty = coverageDays !== savedDays || extraKg !== savedExtra

  const plan = data?.rawConsumption ?? null
  const coverages = useMemo<RawCoverage[]>(
    () => (plan ? plan.items.map((item) => coverageOf(item, plan.dates, { coverageDays, extraKg })) : []),
    [plan, coverageDays, extraKg],
  )
  const [selection, setSelection] = useState<string>(() => {
    try {
      return window.localStorage.getItem(SELECTION_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const choose = (raw: string) => {
    setSelection(raw)
    try {
      window.localStorage.setItem(SELECTION_KEY, raw)
    } catch {
      // Saklama kapalıysa seçim yalnızca bu oturumda kalır.
    }
  }
  // Önce ilk siparişi en yakın olanlar, sonra kodu.
  const sorted = [...coverages].sort(
    (a, b) =>
      (a.orders[0]?.date ?? '9999').localeCompare(b.orders[0]?.date ?? '9999') ||
      a.rawMaterial.localeCompare(b.rawMaterial),
  )
  const selected = coverages.find((c) => c.rawMaterial === selection) ?? sorted[0]
  const allOrders: RawOrder[] = coverages.flatMap((c) => c.orders).sort((a, b) => a.date.localeCompare(b.date) || a.rawMaterial.localeCompare(b.rawMaterial))
  const [range, setRange] = useState<'14' | 'all'>('14')
  const today = data?.todayIso ?? ''
  const until = today ? new Date(Date.parse(`${today}T00:00:00Z`) + 13 * 86_400_000).toISOString().slice(0, 10) : ''
  const shownOrders = range === 'all' ? allOrders : allOrders.filter((o) => o.date <= until)
  const shortSoon = coverages.filter((c) => c.coversDays !== null && c.coversDays < coverageDays)
  const orderToday = allOrders.filter((o) => o.date === today)

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
    const lines = [
      'Order date;Raw material;Order (kg);Stock before (kg);Need next days (kg)',
      ...shownOrders.map((o) => [o.date, o.rawMaterial, o.kg, o.stockBeforeKg, o.targetKg].join(';')),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `raw-material-orders-${today}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Raw Material Coverage</h1>
      <p className="mt-2 max-w-4xl text-muted-foreground">
        Coil consumption per day comes from the production plan (planned quantity × gross weight
        per piece, co-products counted once). Stock is MB52 for the raw material codes in master
        data. The order calendar keeps the next <strong className="text-foreground">{coverageDays} days</strong>{' '}
        of consumption on hand at the start of every day and adds{' '}
        <strong className="text-foreground">{fmt(extraKg)} kg</strong> to every order — a need of
        3 000 kg becomes an order of {fmt(3000 + extraKg)} kg.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border p-3 text-sm">
        <label>
          <span className="block text-xs text-muted-foreground">Keep on hand (days)</span>
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
        {dirty && <span className="text-xs text-amber-700">Unsaved — the calendar below already uses these values</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}
        <span className="ml-auto text-xs text-muted-foreground">
          {data ? `Plan calculated ${formatPlantTime(data.computedAt)}` : ''}
        </span>
      </div>

      {data === undefined ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : !plan ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No coverage yet — it is calculated with the next plan. See the{' '}
          <Link to="/planlama" className="underline">
            Production Plan
          </Link>
          .
        </p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card label="Raw materials" value={fmt(coverages.length)} />
            <Card label={`Cover less than ${coverageDays} days`} value={fmt(shortSoon.length)} warn={shortSoon.length > 0} />
            <Card
              label="Order today"
              value={orderToday.length > 0 ? `${orderToday.length} · ${fmt(orderToday.reduce((a, o) => a + o.kg, 0))} kg` : '—'}
              warn={orderToday.length > 0}
            />
            <Card label={`Orders in the plan horizon (to ${plan.dates[plan.dates.length - 1] ?? ''})`} value={`${allOrders.length} · ${fmt(allOrders.reduce((a, o) => a + o.kg, 0))} kg`} />
          </dl>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="overflow-x-auto rounded-lg border border-border lg:col-span-1">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Raw material</th>
                    <th className="px-3 py-2 text-right font-medium">Stock kg</th>
                    <th className="px-3 py-2 text-right font-medium">Covers</th>
                    <th className="px-3 py-2 font-medium">Next order</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((c) => (
                    <tr
                      key={c.rawMaterial}
                      onClick={() => choose(c.rawMaterial)}
                      className={`cursor-pointer border-t border-border hover:bg-muted/60 ${
                        selected?.rawMaterial === c.rawMaterial ? 'bg-muted' : ''
                      }`}
                    >
                      <td className="px-3 py-1.5 font-medium text-foreground">{c.rawMaterial}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(c.stockKg)}</td>
                      <td
                        className={`px-3 py-1.5 text-right tabular-nums ${
                          c.coversDays !== null && c.coversDays < coverageDays ? 'font-medium text-destructive' : 'text-muted-foreground'
                        }`}
                      >
                        {c.coversDays === null ? (c.totalConsumptionKg > 0 ? 'horizon' : 'not used') : `${c.coversDays} d`}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                        {c.orders[0] ? `${dayMonth(c.orders[0].date)} · ${fmt(c.orders[0].kg)} kg` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="lg:col-span-2">
              {selected && (
                <div className="rounded-lg border border-border p-4">
                  <h2 className="text-sm font-semibold text-foreground">
                    {selected.rawMaterial}{' '}
                    <span className="font-normal text-muted-foreground">
                      · stock {fmt(selected.stockKg)} kg · {fmt(selected.totalConsumptionKg)} kg used in the plan
                      {selected.runsOutOn ? ` · without orders runs out ${dayMonth(selected.runsOutOn)}` : ''}
                    </span>
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">Used by {selected.materials.join(', ') || '—'}</p>
                  <div className="mt-3">
                    <RawCoverageChart days={selected.days} coverageDays={coverageDays} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Consumption is known only up to the end of the plan horizon, so the need for the
                    next {coverageDays} days shrinks in the last days.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">Order calendar</h2>
              <div className="flex items-center gap-2 text-xs">
                {(['14', 'all'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRange(r)}
                    className={`rounded-md border px-2.5 py-1 font-medium ${
                      range === r ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted'
                    }`}
                  >
                    {r === '14' ? 'Next 14 days' : 'Whole horizon'}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={downloadCsv}
                  disabled={shownOrders.length === 0}
                  className="rounded-md border border-border px-2.5 py-1 font-medium hover:bg-muted disabled:opacity-40"
                >
                  Download CSV
                </button>
              </div>
            </div>
            {shownOrders.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No orders needed in this period.</p>
            ) : (
              <div className="mt-2 overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Order date</th>
                      <th className="px-3 py-2 font-medium">Raw material</th>
                      <th className="px-3 py-2 text-right font-medium">Order (kg)</th>
                      <th className="px-3 py-2 text-right font-medium">Stock before (kg)</th>
                      <th className="px-3 py-2 text-right font-medium">Need, next {coverageDays} days (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownOrders.map((o) => (
                      <tr
                        key={`${o.date}|${o.rawMaterial}`}
                        onClick={() => choose(o.rawMaterial)}
                        className={`cursor-pointer border-t border-border hover:bg-muted/60 ${o.date === today ? 'bg-destructive/5' : ''}`}
                      >
                        <td className="whitespace-nowrap px-3 py-1.5">
                          {dayMonth(o.date)}
                          {o.date === today && <span className="ml-2 text-xs font-medium text-destructive">today</span>}
                        </td>
                        <td className="px-3 py-1.5 font-medium text-foreground">{o.rawMaterial}</td>
                        <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmt(o.kg)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmt(o.stockBeforeKg)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmt(o.targetKg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
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
