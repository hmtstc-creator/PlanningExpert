import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, usePaginatedQuery, useQuery } from '../lib/convexTransport'
import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import {
  buildDemandSchedule,
  buildRawMaterialPlan,
  buildWeekBuckets,
  materialsMissingRawSpec,
  type DayBucket,
  type DemandInput,
  type ProductSpec,
} from '../lib/planning'
import { diffPlans } from '../lib/planDiff'
import { schedule, type PlanOverride, type ScheduledJob } from '../lib/scheduler'

export const Route = createFileRoute('/planlama')({
  component: PlanlamaPage,
})

const COUNTED_STOCK = new Set(['finished_goods', 'production_area'])
const RAW_STOCK = new Set(['raw_material'])
const DEFAULT_HORIZON_WEEKS = 4

function mondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Gün içi dakikayı gerçek saate çevirir. `shiftStartMinute` birinci
 * vardiyanın başlangıcıdır (gece yarısından dakika, ör. 480 = 08:00).
 * Vardiya numarası da ayrıca gösterilir.
 */
function formatClock(minute: number, shiftMinutes: number, shiftStartMinute: number): string {
  const shiftIndex = Math.floor(minute / shiftMinutes) + 1
  const absolute = (shiftStartMinute + minute) % (24 * 60)
  const h = Math.floor(absolute / 60)
  const m = Math.round(absolute % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} (${shiftIndex}. vardiya)`
}

function PlanlamaPage() {
  const { results: products, status: productStatus } = usePaginatedQuery(
    api.products.list,
    {},
    { initialNumItems: 500 },
  )
  const { results: weeklyDemand } = usePaginatedQuery(
    api.demand.listWeekly,
    {},
    { initialNumItems: 500 },
  )
  const { results: stockRows } = usePaginatedQuery(
    api.stock.list,
    {},
    { initialNumItems: 1000 },
  )
  const { results: locations } = usePaginatedQuery(
    api.storageLocations.list,
    {},
    { initialNumItems: 200 },
  )
  const presses = (useQuery(api.presses.list) ?? []) as { name: string; hall: string }[]
  const templates = (useQuery(api.pressCalendar.listTemplates) ?? []) as {
    press: string
    workingDays: number
    shiftsPerDay: number
    overtimeShifts: number
  }[]
  const globalSettings = useQuery(api.pressCalendar.getGlobalSettings)
  const workCalendar = useQuery(api.workCalendar.get)
  const latestSnapshot = useQuery(api.planSnapshots.latest)
  const approve = useMutation(api.planSnapshots.approve)
  const overrideRows = (useQuery(api.planOverrides.list) ?? []) as {
    _id: string
    material: string
    kind: string
    press?: string
    date?: string
    note?: string
  }[]
  const setOverride = useMutation(api.planOverrides.set)
  const clearOverride = useMutation(api.planOverrides.clear)

  const [approving, setApproving] = useState(false)
  const [approvedAt, setApprovedAt] = useState<string | null>(null)
  const [ovMaterial, setOvMaterial] = useState('')
  const [ovKind, setOvKind] = useState('priority')
  const [ovPress, setOvPress] = useState('')
  const [ovDate, setOvDate] = useState('')

  const shiftMinutes = globalSettings?.shiftMinutes ?? 480
  const overtimeShiftMinutes = globalSettings?.overtimeShiftMinutes ?? 480
  const setupGapMinutes = globalSettings?.setupGapMinutes ?? 60
  const concurrentSetupsPerHall = globalSettings?.concurrentSetupsPerHall ?? 1
  const shiftStartMinute = globalSettings?.shiftStartMinute ?? 480
  const breakMinutesPerShift = globalSettings?.breakMinutesPerShift ?? 0
  // Kapasite düzeltme katsayısı: ölçülen gerçekleşme oranı (Performans
  // sayfasından yazılır). Tanımsızsa kapasite olduğu gibi kullanılır.
  const capacityFactor = globalSettings?.capacityFactor ?? 1
  const horizonWeeks = Math.min(
    30,
    Math.max(1, globalSettings?.planningHorizonWeeks ?? DEFAULT_HORIZON_WEEKS),
  )

  const locCategory = useMemo(
    () => new Map(locations.map((l) => [l.code, l.category])),
    [locations],
  )

  const stockByMaterial = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of stockRows) {
      const cat = s.storageLocation
        ? locCategory.get(s.storageLocation) ?? 'finished_goods'
        : 'finished_goods'
      if (!COUNTED_STOCK.has(cat)) continue
      map.set(s.material, (map.get(s.material) ?? 0) + (s.unrestricted ?? 0))
    }
    return map
  }, [stockRows, locCategory])

  const rawStockByMaterial = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of stockRows) {
      const cat = s.storageLocation ? locCategory.get(s.storageLocation) : undefined
      if (!cat || !RAW_STOCK.has(cat)) continue
      map.set(s.material, (map.get(s.material) ?? 0) + (s.unrestricted ?? 0))
    }
    return map
  }, [stockRows, locCategory])

  const productByCode = useMemo(() => {
    const map = new Map<string, ProductSpec>()
    for (const p of products) map.set(p.code, p as ProductSpec)
    return map
  }, [products])

  const workingDayKeys = useMemo(
    () => (workCalendar?.workingDays ?? ['MO', 'TU', 'WE', 'TH', 'FR']) as string[],
    [workCalendar],
  )
  const workingDaysPerWeek = workingDayKeys.length || 5

  const country = globalSettings?.country ?? 'TR'
  const officialHolidays = (useQuery(api.holidays.listByCountry, { country }) ??
    []) as { date: string; name: string }[]

  // Resmi tatiller (Nager.Date'ten takvim ekranınca kaydedilir) + elle
  // girilen tatiller birlikte kapasiteyi sıfırlar.
  const holidays = useMemo(() => {
    const set = new Set<string>((workCalendar?.holidays ?? []) as string[])
    for (const h of officialHolidays) set.add(h.date)
    return set
  }, [workCalendar, officialHolidays])

  const holidayNames = useMemo(
    () => new Map(officialHolidays.map((h) => [h.date, h.name])),
    [officialHolidays],
  )

  const horizonMonday = useMemo(() => mondayOf(new Date()), [])

  const demand = useMemo(() => {
    const rows: DemandInput[] = weeklyDemand.map((d) => ({
      material: d.material,
      overdue: d.overdue ?? 0,
      periods: d.periods,
      stock: stockByMaterial.get(d.material) ?? 0,
    }))
    return buildDemandSchedule(rows, productByCode, {
      baseMonday: horizonMonday,
      horizonWeeks,
      workingDaysPerWeek,
    })
  }, [
    weeklyDemand,
    stockByMaterial,
    workingDaysPerWeek,
    productByCode,
    horizonMonday,
    horizonWeeks,
  ])

  const buckets = useMemo(() => {
    const map = new Map<string, DayBucket[]>()
    const start = horizonMonday
    const templateByPress = new Map(templates.map((t) => [t.press, t]))
    for (const press of presses) {
      const pattern = templateByPress.get(press.name) ?? {
        workingDays: workingDaysPerWeek,
        shiftsPerDay: 1,
        overtimeShifts: 0,
      }
      const all: DayBucket[] = []
      for (let w = 0; w < horizonWeeks; w++) {
        all.push(
          ...buildWeekBuckets(
            addDays(start, w * 7),
            pattern,
            { shiftMinutes, overtimeShiftMinutes, breakMinutesPerShift },
            holidays,
            workingDayKeys,
          ),
        )
      }
      // Ölçülen gerçekleşme oranıyla kapasiteyi düzelt — plan gerçekçi olsun.
      map.set(
        press.name,
        capacityFactor === 1
          ? all
          : all.map((b) => ({ ...b, minutes: Math.floor(b.minutes * capacityFactor) })),
      )
    }
    return map
  }, [
    presses,
    templates,
    shiftMinutes,
    overtimeShiftMinutes,
    holidays,
    workingDaysPerWeek,
    workingDayKeys,
    horizonMonday,
    capacityFactor,
    horizonWeeks,
    breakMinutesPerShift,
  ])

  const overrides = useMemo<PlanOverride[]>(
    () =>
      overrideRows.map((o) => ({
        material: o.material,
        kind: o.kind as PlanOverride['kind'],
        press: o.press,
        date: o.date,
      })),
    [overrideRows],
  )

  const result = useMemo(
    () =>
      schedule(demand, productByCode, presses, buckets, { shiftMinutes, overtimeShiftMinutes }, {
        setupGapMinutes,
        concurrentSetupsPerHall,
        overrides,
      }),
    [
      demand,
      productByCode,
      presses,
      buckets,
      shiftMinutes,
      overtimeShiftMinutes,
      setupGapMinutes,
      concurrentSetupsPerHall,
      overrides,
    ],
  )

  // Onaylı planla canlı planın farkı — "onayladığımdan bu yana ne değişti".
  const planDiff = useMemo(() => {
    if (!latestSnapshot) return null
    return diffPlans(latestSnapshot.jobs, result.jobs)
  }, [latestSnapshot, result])

  const rawNeeds = useMemo(
    () => buildRawMaterialPlan(result.jobs, productByCode, rawStockByMaterial),
    [result, productByCode, rawStockByMaterial],
  )
  const rawShortages = useMemo(() => rawNeeds.filter((r) => r.shortageKg > 0), [rawNeeds])
  const missingRawSpec = useMemo(
    () => materialsMissingRawSpec(result.jobs, productByCode),
    [result, productByCode],
  )

  const byDate = useMemo(() => {
    const map = new Map<string, ScheduledJob[]>()
    for (const job of result.jobs) {
      if (!map.has(job.date)) map.set(job.date, [])
      map.get(job.date)!.push(job)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.press.localeCompare(b.press) || a.setupStartMinute - b.setupStartMinute)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [result])

  const warnings = useMemo(() => {
    const list: string[] = []
    if (presses.length === 0) list.push('No presses defined — add them on the Press Definitions page.')
    if (templates.length === 0)
      list.push('No work calendar defined for any press — defaulting to 1 shift.')
    if (weeklyDemand.length === 0) list.push('No ZPP weekly demand data uploaded.')
    if (stockRows.length === 0) list.push('No MB52 stock data uploaded — planning without deducting stock.')
    const missingMaxShots = products.filter((p) => !p.maxShots).length
    if (missingMaxShots > 0)
      list.push(`${missingMaxShots} materials have no max shot limit — the limit is not enforced.`)
    if (holidays.size === 0)
      list.push(
        'No public holidays stored — open the Work Calendar page once so they are saved.',
      )
    if (rawShortages.length > 0)
      list.push(
        `${rawShortages.length} raw materials are short — coils must be sourced for the planned jobs.`,
      )
    if (missingRawSpec.length > 0)
      list.push(
        `${missingRawSpec.length} materials have no raw material code or gross weight — the raw material check cannot run.`,
      )
    return list
  }, [
    presses,
    templates,
    weeklyDemand,
    stockRows,
    products,
    holidays,
    rawShortages,
    missingRawSpec,
  ])

  const totalPlannedQty = result.jobs.reduce((s, j) => s + j.quantity, 0)
  const lateCount = result.jobs.filter((j) => j.late).length
  const horizonStart = isoDate(horizonMonday)

  async function handleApprove() {
    setApproving(true)
    try {
      await approve({
        horizonStart,
        unplannedCount: result.unplanned.length,
        jobs: result.jobs.map((j) => ({
          material: j.material,
          press: j.press,
          hall: j.hall,
          date: j.date,
          phase: j.phase,
          quantity: j.quantity,
          shots: j.shots,
          coilsNeeded: j.coilsNeeded,
          setupStartMinute: j.setupStartMinute,
          endMinute: j.endMinute,
          reason: j.reason,
        })),
      })
      setApprovedAt(new Date().toLocaleString('en-GB'))
    } finally {
      setApproving(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground">Planning</h1>
      <p className="mt-2 text-muted-foreground">
        The plan is generated automatically: backlog first, then the materials
        whose stock runs out soonest, and the remaining capacity is filled with
        the rest of the demand. Crane constraints, mold limits and coil
        calculations are all applied. You only review and approve. Planning
        horizon is {horizonWeeks} weeks (change it on the Work Calendar page).
      </p>

      {capacityFactor !== 1 && (
        <p className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          Capacity is adjusted by the measured attainment rate:{' '}
          <strong className="text-foreground">%{Math.round(capacityFactor * 100)}</strong>.
          You can update this factor on the Performance page.
        </p>
      )}

      {warnings.length > 0 && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">Needs attention</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-amber-800">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Planned jobs" value={result.jobs.length.toLocaleString('en-GB')} />
        <Stat label="Planned qty" value={totalPlannedQty.toLocaleString('en-GB')} />
        <Stat
          label="Unplanned"
          value={result.unplanned.length.toLocaleString('en-GB')}
          warn={result.unplanned.length > 0}
        />
        <Stat
          label="Late jobs"
          value={lateCount.toLocaleString('en-GB')}
          warn={lateCount > 0}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void handleApprove()}
          disabled={approving || result.jobs.length === 0}
          className="rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {approving ? 'Approving…' : 'Approve plan'}
        </button>
        {approvedAt && <span className="text-sm text-emerald-600">Approved ✓ {approvedAt}</span>}
        {latestSnapshot && !approvedAt && (
          <span className="text-sm text-muted-foreground">
            Last approved plan: {new Date(latestSnapshot.createdAt).toLocaleString('en-GB')} ·{' '}
            {latestSnapshot.jobCount} jobs
          </span>
        )}
      </div>

      {planDiff && planDiff.changes.length > 0 && (
        <div className="mt-6 rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold text-foreground">
            Changes since the approved plan
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Approved: {new Date(latestSnapshot!.createdAt).toLocaleString('en-GB')} ·{' '}
            {planDiff.addedCount} new, {planDiff.removedCount} dropped,{' '}
            {planDiff.movedCount} moved, {planDiff.quantityCount} quantity changed,{' '}
            {planDiff.sameCount} unchanged.
          </p>
          <div className="mt-2 max-h-80 overflow-auto rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Material</th>
                  <th className="px-3 py-2 font-medium">Change</th>
                  <th className="px-3 py-2 font-medium">Approved</th>
                  <th className="px-3 py-2 font-medium">Now</th>
                </tr>
              </thead>
              <tbody>
                {planDiff.changes.map((c) => (
                  <tr key={c.material} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium text-foreground">{c.material}</td>
                    <td className="px-3 py-2">
                      <span className={CHANGE_STYLE[c.kind]}>{CHANGE_LABEL[c.kind]}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {c.approvedSlots.length > 0 ? (
                        <>
                          {Math.round(c.approvedQty).toLocaleString('en-GB')} pcs
                          <br />
                          {c.approvedSlots.join(', ')}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {c.currentSlots.length > 0 ? (
                        <>
                          {Math.round(c.currentQty).toLocaleString('en-GB')} pcs
                          <br />
                          {c.currentSlots.join(', ')}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Plan overrides</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          The plan is always computed by the engine; the rules below are fed in
          as input, so your override persists but the plan still comes out of
          the engine.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Material</span>
            <input
              className="mt-1 w-40 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={ovMaterial}
              onChange={(e) => setOvMaterial(e.target.value)}
              placeholder="Material code"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Rule</span>
            <select
              className="mt-1 w-44 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={ovKind}
              onChange={(e) => setOvKind(e.target.value)}
            >
              <option value="priority">Move to front</option>
              <option value="pin">Pin to press</option>
              <option value="exclude">Exclude from planning</option>
            </select>
          </label>
          {ovKind === 'pin' && (
            <>
              <label className="text-sm">
                <span className="block text-xs text-muted-foreground">Press</span>
                <select
                  className="mt-1 w-36 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={ovPress}
                  onChange={(e) => setOvPress(e.target.value)}
                >
                  <option value="">Select…</option>
                  {presses.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs text-muted-foreground">Day (opt.)</span>
                <input
                  type="date"
                  className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={ovDate}
                  onChange={(e) => setOvDate(e.target.value)}
                />
              </label>
            </>
          )}
          <button
            onClick={() => {
              const material = ovMaterial.trim()
              if (!material) return
              void setOverride({
                material,
                kind: ovKind,
                press: ovKind === 'pin' ? ovPress || undefined : undefined,
                date: ovKind === 'pin' && ovDate ? ovDate : undefined,
              }).then(() => {
                setOvMaterial('')
                setOvDate('')
              })
            }}
            disabled={!ovMaterial.trim() || (ovKind === 'pin' && !ovPress)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Add rule
          </button>
        </div>

        {overrideRows.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {overrideRows.map((o) => (
              <li
                key={o._id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <span className="text-foreground">
                  <strong>{o.material}</strong>{' '}
                  <span className="text-muted-foreground">
                    {o.kind === 'exclude'
                      ? '— excluded from planning'
                      : o.kind === 'priority'
                        ? '— moved to front'
                        : `— pinned to ${o.press}${o.date ? ` (${o.date})` : ''}`}
                  </span>
                </span>
                <button
                  onClick={() => void clearOverride({ material: o.material })}
                  className="text-xs text-destructive hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {productStatus === 'LoadingFirstPage' && (
        <p className="mt-8 text-sm text-muted-foreground">Loading data…</p>
      )}

      {byDate.length === 0 && productStatus !== 'LoadingFirstPage' && (
        <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No jobs to plan. Make sure ZPP demand, MB52 stock and{' '}
          <Link to="/makineler" className="underline">
            press definitions
          </Link>{' '}
          have been uploaded.
        </p>
      )}

      <div className="mt-8 space-y-6">
        {byDate.map(([date, jobs]) => (
          <div key={date}>
            <h2 className="text-sm font-semibold text-foreground">
              {new Date(date).toLocaleDateString('en-GB', {
                weekday: 'long',
                day: '2-digit',
                month: 'long',
              })}{' '}
              <span className="font-normal text-muted-foreground">({jobs.length} jobs)</span>
            </h2>
            <div className="mt-2 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Press</th>
                    <th className="px-3 py-2 font-medium">Hall</th>
                    <th className="px-3 py-2 font-medium">Material</th>
                    <th className="px-3 py-2 font-medium">Required</th>
                    <th className="px-3 py-2 font-medium">Qty</th>
                    <th className="px-3 py-2 font-medium">Shots</th>
                    <th className="px-3 py-2 font-medium">Coils</th>
                    <th className="px-3 py-2 font-medium">Setup start</th>
                    <th className="px-3 py-2 font-medium">End</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job, i) => (
                    <tr key={`${job.press}-${job.material}-${i}`} className="border-t border-border">
                      <td className="px-3 py-2 font-medium text-foreground">{job.press}</td>
                      <td className="px-3 py-2 text-muted-foreground">{job.hall}</td>
                      <td className="px-3 py-2 text-foreground">
                        {job.material}
                        {job.coProduct && (
                          <span className="text-muted-foreground"> +{job.coProduct}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className={job.late ? 'text-destructive' : 'text-muted-foreground'}>
                          {job.bucketLabel}
                          {job.late && ' ⚠'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-foreground">
                        {job.quantity.toLocaleString('en-GB')}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {job.shots.toLocaleString('en-GB')}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{job.coilsNeeded}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatClock(job.setupStartMinute, shiftMinutes, shiftStartMinute)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatClock(job.endMinute, shiftMinutes, shiftStartMinute)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{job.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {rawNeeds.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-foreground">
            Raw material requirement ({rawNeeds.length} items)
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Calculated from the gross weight of the planned shots and compared
            with unrestricted stock in raw material locations.
          </p>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Raw material</th>
                  <th className="px-3 py-2 font-medium">Required (kg)</th>
                  <th className="px-3 py-2 font-medium">Stock (kg)</th>
                  <th className="px-3 py-2 font-medium">Short (kg)</th>
                  <th className="px-3 py-2 font-medium">Used by</th>
                </tr>
              </thead>
              <tbody>
                {rawNeeds.map((r) => (
                  <tr key={r.rawMaterial} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">{r.rawMaterial}</td>
                    <td className="px-3 py-2 text-foreground">
                      {Math.round(r.requiredKg).toLocaleString('en-GB')}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {Math.round(r.availableKg).toLocaleString('en-GB')}
                    </td>
                    <td
                      className={`px-3 py-2 font-medium ${
                        r.shortageKg > 0 ? 'text-destructive' : 'text-emerald-600'
                      }`}
                    >
                      {r.shortageKg > 0
                        ? Math.round(r.shortageKg).toLocaleString('en-GB')
                        : 'sufficient'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.materials.join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result.unplanned.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-destructive">
            Unplanned ({result.unplanned.length})
          </h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-destructive/30">
            <table className="w-full text-left text-sm">
              <thead className="bg-destructive/10 text-destructive">
                <tr>
                  <th className="px-3 py-2 font-medium">Material</th>
                  <th className="px-3 py-2 font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium">Phase</th>
                  <th className="px-3 py-2 font-medium">Required week</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {result.unplanned.map((u, i) => (
                  <tr key={`${u.material}-${i}`} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">{u.material}</td>
                    <td className="px-3 py-2 text-foreground">
                      {Math.round(u.quantity).toLocaleString('en-GB')}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{u.phase}</td>
                    <td className="px-3 py-2 text-muted-foreground">{u.dueDate}</td>
                    <td className="px-3 py-2 text-muted-foreground">{u.reason}</td>
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

const CHANGE_LABEL: Record<string, string> = {
  added: 'new',
  removed: 'dropped',
  moved: 'moved',
  quantity: 'qty changed',
  same: 'unchanged',
}

const CHANGE_STYLE: Record<string, string> = {
  added: 'rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800',
  removed: 'rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive',
  moved: 'rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900',
  quantity: 'rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-900',
  same: 'text-xs text-muted-foreground',
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
