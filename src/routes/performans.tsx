import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from '../lib/convexTransport'
import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { addDays, isoDate, mondayOf } from '../lib/dates'
import {
  buildAdherence,
  capacityUtilisation,
  performanceFactor,
  theoreticalMinutes,
} from '../lib/performance'
import { type ProductSpec } from '../lib/planning'
import { SETTINGS_DEFAULTS } from '../lib/settingsDefaults'
import { capacityModel } from '../lib/capacityModel'
import { useOvertimeData } from '../components/OvertimePanels'
import { InfoTip, PageHeader } from '../components/PageHeader'
import { relatedPages } from '../lib/navigation'

export const Route = createFileRoute('/performans')({
  component: PerformansPage,
})

function percent(v: number | null): string {
  if (v === null) return '—'
  return `${(v * 100).toFixed(1)}%`
}

function PerformansPage() {
  const today = useMemo(() => new Date(), [])
  const [from, setFrom] = useState(() => isoDate(addDays(mondayOf(today), -7)))
  const [to, setTo] = useState(() => isoDate(today))

  const snapshot = useQuery(api.planSnapshots.latest)
  // Kalıp ömrü ve gerçekleşme oranı bu satırların toplamından çıkar;
  // sayfalı okumak toplamı eksik bırakır ve iki sayıyı da yanıltıcı yapar.
  const actualResult = useQuery(api.actualProduction.listAll)
  const actualRows = useMemo(() => actualResult?.rows ?? [], [actualResult])
  const actualStatus = actualResult === undefined ? 'LoadingFirstPage' : 'Exhausted'
  const actualIncomplete = actualResult !== undefined && !actualResult.complete
  // Malzeme kartları da eksiksiz okunur: kartı görülmeyen bir malzemenin
  // göz sayısı ve kalıp limiti bilinmez, vuruş hesabı da yanlış çıkar.
  const products = useQuery(api.products.listAll)?.rows ?? []
  const presses = (useQuery(api.presses.list) ?? []) as { name: string; hall: string }[]
  const templates = (useQuery(api.pressCalendar.listTemplates) ?? []) as {
    press: string
    workingDays: number
    shiftsPerDay: number
    overtimeShifts: number
  }[]
  const globalSettings = useQuery(api.pressCalendar.getGlobalSettings)
  const workCalendar = useQuery(api.workCalendar.get)
  const setCapacityFactor = useMutation(api.pressCalendar.setCapacityFactor)
  const [applied, setApplied] = useState(false)

  const shiftMinutes = globalSettings?.shiftMinutes ?? SETTINGS_DEFAULTS.shiftMinutes
  const overtimeShiftMinutes = globalSettings?.overtimeShiftMinutes ?? SETTINGS_DEFAULTS.overtimeShiftMinutes

  const productByCode = useMemo(() => {
    const map = new Map<string, ProductSpec>()
    for (const p of products) map.set(p.code, p as ProductSpec)
    return map
  }, [products])

  const planRows = useMemo(
    () =>
      (snapshot?.jobs ?? []).map((j) => ({
        material: j.material,
        date: j.date,
        quantity: j.quantity,
      })),
    [snapshot],
  )

  const actual = useMemo(
    () =>
      actualRows.map((r) => ({
        material: r.material,
        postingDate: r.postingDate,
        quantity: r.quantity,
      })),
    [actualRows],
  )

  const adherence = useMemo(
    () => buildAdherence(planRows, actual, from, to),
    [planRows, actual, from, to],
  )
  const factor = useMemo(() => performanceFactor(adherence), [adherence])

  const actualInRange = useMemo(
    () => actual.filter((a) => a.postingDate >= from && a.postingDate <= to),
    [actual, from, to],
  )
  const theoretical = useMemo(
    () => theoreticalMinutes(actualInRange, productByCode),
    [actualInRange, productByCode],
  )

  // Aralıktaki açık kapasite — planla aynı formül (capacityModel): şablon,
  // istisna hafta (fazla mesai), resmi + elle tatiller, planlı duruşlar.
  const weekOverrides = (useQuery(api.pressCalendar.listAllOverrides) ?? []) as {
    press: string
    weekStart: string
    workingDays: number
    shiftsPerDay: number
    overtimeShifts: number
  }[]
  const plannedStops = (useQuery(api.plannedStops.list) ?? []) as {
    shiftIndex: number
    name: string
    kind: string
    startMinute: number
    durationMinutes: number
  }[]
  const { definitions: overtimeDefinitions, pressOvertime } = useOvertimeData()
  const country = globalSettings?.country ?? SETTINGS_DEFAULTS.country
  const officialHolidays = (useQuery(api.holidays.listByCountry, { country }) ?? []) as { date: string }[]
  const availableMinutes = useMemo(() => {
    const model = capacityModel({
      shiftMinutes,
      shiftStartMinute: globalSettings?.shiftStartMinute ?? SETTINGS_DEFAULTS.shiftStartMinute,
      plannedStops,
      templates,
      weekOverrides,
      overtimeDefinitions: overtimeDefinitions.map((d) => ({ ...d, id: d._id })),
      pressOvertime,
      holidays: new Set<string>([
        ...((workCalendar?.holidays ?? []) as string[]),
        ...officialHolidays.map((h) => h.date),
      ]),
    })
    let total = 0
    for (const press of presses) {
      let week = mondayOf(new Date(from))
      const end = new Date(to)
      // Aralığı kapsayacak kadar hafta (en fazla 60 hafta güvenlik sınırı).
      for (let guard = 0; guard < 60 && week <= end; guard++) {
        for (const b of model.weekBuckets(press.name, week)) {
          if (b.date >= from && b.date <= to) total += b.minutes
        }
        week = addDays(week, 7)
      }
    }
    return total
  }, [presses, templates, weekOverrides, plannedStops, overtimeDefinitions, pressOvertime, officialHolidays, workCalendar, from, to, shiftMinutes, globalSettings?.shiftStartMinute])

  const utilisation = capacityUtilisation(theoretical, availableMinutes)

  const worst = useMemo(
    () =>
      adherence
        .filter((r) => r.plannedQty > 0 && r.ratio !== null)
        .sort((a, b) => (a.ratio ?? 0) - (b.ratio ?? 0))
        .slice(0, 10),
    [adherence],
  )

  const totalPlanned = adherence.reduce((s, r) => s + r.plannedQty, 0)
  const totalActual = adherence.reduce((s, r) => s + r.actualQty, 0)

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Performance"
        summary="Approved plan versus actual production (MB51)."
        links={relatedPages('/performans')}
        info={
          <>
            <p>
              Compares the approved plan with the actual production uploaded from MB51 (101 − 102
              into the production receipt location). The resulting performance factor (measured
              attainment) can be fed back as the capacity factor to make planning capacity
              realistic.
            </p>
            <p>
              This is not the Accepted OEE of Master Data and not the Prediction OEE of the Capacity
              Dashboard.
            </p>
          </>
        }
      />

      <div className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">From</span>
          <input
            type="date"
            className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">To</span>
          <input
            type="date"
            className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Planned qty" value={Math.round(totalPlanned).toLocaleString('en-GB')} />
        <Stat label="Actual qty" value={Math.round(totalActual).toLocaleString('en-GB')} />
        <Stat
          label="Performance factor"
          value={percent(factor)}
          warn={factor !== null && factor < 0.9}
        />
        <Stat
          label="Capacity utilisation"
          value={percent(utilisation)}
          warn={utilisation !== null && utilisation < 0.6}
        />
      </div>

      {factor !== null && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border p-4">
          <div className="text-sm">
            <p className="text-foreground">
              Planning capacity currently uses a factor of{' '}
              <strong>%{Math.round((globalSettings?.capacityFactor ?? SETTINGS_DEFAULTS.capacityFactor) * 100)}</strong>{' '}
              .{' '}
              <InfoTip label="About the capacity factor">
                Applying the measured attainment rate builds the plan around the throughput actually
                achieved in the past. The per-part Accepted OEE from Master Data is already in the
                plan; this rate is measured against that plan, so it corrects on top of it and is not
                counted twice.
              </InfoTip>
            </p>
          </div>
          <button
            onClick={() => {
              const value = Math.min(2, Math.max(0.05, Number(factor.toFixed(3))))
              // Bu çarpan her presin kapasitesini ölçekler; eksik veriden
              // çıkmış bir oranı plana yazmak tüm planı bozar.
              if (
                !window.confirm(
                  `Set the capacity factor to ${Math.round(value * 100)}%? ` +
                    'This scales the available capacity of every press in the plan.',
                )
              ) {
                return
              }
              void setCapacityFactor({ capacityFactor: value }).then(() => setApplied(true))
            }}
            disabled={actualIncomplete}
            title={
              actualIncomplete
                ? 'The attainment rate is computed from incomplete data'
                : undefined
            }
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            Apply {Math.round(factor * 100)}%
          </button>
          {globalSettings?.capacityFactor !== undefined &&
            globalSettings.capacityFactor !== 1 && (
              <button
                onClick={() => void setCapacityFactor({ capacityFactor: 1 }).then(() => setApplied(true))}
                className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
              >
                Reset to 100%
              </button>
            )}
          {applied && <span className="text-sm text-emerald-600">Saved ✓</span>}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-border p-4 text-sm text-muted-foreground">
        <p>
          <strong className="text-foreground">Capacity utilisation</strong> is the
          theoretical time the actual production would take at ideal speed,
          divided by the available capacity (
          {Math.round(theoretical).toLocaleString('en-GB')} min /{' '}
          {Math.round(availableMinutes).toLocaleString('en-GB')} min).
        </p>
        <p className="mt-2">
          This is <strong className="text-foreground">not a full OEE</strong>:
          the system has no downtime or scrap data, so the availability and
          quality components cannot be separated. A true OEE would require
          downtime records as well.
        </p>
      </div>

      {!snapshot && (
        <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No plan has been approved yet, so there is nothing to compare against.
          Approve a plan on the Planning page.
        </p>
      )}

      {actualStatus === 'LoadingFirstPage' && (
        <p className="mt-6 text-sm text-muted-foreground">Loading actual production…</p>
      )}

      {actualIncomplete && (
        <p className="mt-6 rounded-lg border-2 border-destructive bg-destructive/10 p-3 text-sm text-foreground">
          <strong className="text-destructive">This attainment rate is unreliable.</strong>{' '}
          There is more actual production than one query can read, so it is
          computed from part of the data. Do not write it into the capacity
          factor — that factor scales the capacity of every press in the plan.
        </p>
      )}

      {worst.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-foreground">
            Materials deviating most from the plan
          </h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Material</th>
                  <th className="px-3 py-2 font-medium">Planned</th>
                  <th className="px-3 py-2 font-medium">Actual</th>
                  <th className="px-3 py-2 font-medium">Difference</th>
                  <th className="px-3 py-2 font-medium">Attainment</th>
                </tr>
              </thead>
              <tbody>
                {worst.map((r) => (
                  <tr key={r.material} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">{r.material}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {Math.round(r.plannedQty).toLocaleString('en-GB')}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {Math.round(r.actualQty).toLocaleString('en-GB')}
                    </td>
                    <td
                      className={`px-3 py-2 font-medium ${
                        r.diff < 0 ? 'text-destructive' : 'text-emerald-600'
                      }`}
                    >
                      {r.diff > 0 ? '+' : ''}
                      {Math.round(r.diff).toLocaleString('en-GB')}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{percent(r.ratio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {adherence.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-foreground">
            All items ({adherence.length})
          </h2>
          <div className="mt-2 max-h-96 overflow-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Material</th>
                  <th className="px-3 py-2 font-medium">Planned</th>
                  <th className="px-3 py-2 font-medium">Actual</th>
                  <th className="px-3 py-2 font-medium">Difference</th>
                </tr>
              </thead>
              <tbody>
                {adherence.map((r) => (
                  <tr key={r.material} className="border-t border-border">
                    <td className="px-3 py-2 text-foreground">{r.material}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {Math.round(r.plannedQty).toLocaleString('en-GB')}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {Math.round(r.actualQty).toLocaleString('en-GB')}
                    </td>
                    <td
                      className={`px-3 py-2 ${
                        r.diff < 0 ? 'text-destructive' : 'text-muted-foreground'
                      }`}
                    >
                      {r.diff > 0 ? '+' : ''}
                      {Math.round(r.diff).toLocaleString('en-GB')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${warn ? 'text-destructive' : 'text-foreground'}`}>
        {value}
      </p>
    </div>
  )
}
