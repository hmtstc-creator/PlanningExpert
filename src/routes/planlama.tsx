import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery } from '../lib/convexTransport'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { addDays, isoDate, isoWeekLabel, mondayOf } from '../lib/dates'
import {
  buildDemandSchedule,
  buildRawMaterialPlan,
  buildWeekBuckets,
  materialsMissingRawSpec,
  type DayBucket,
  type DemandInput,
  type ProductSpec,
} from '../lib/planning'
import {
  WeekGantt,
  type WeekGanttJob,
  type WeekGanttPress,
} from '../components/WeekGantt'
import {
  buildDayTimeline,
  productionDayOf,
  remainingCapacityMinutes,
} from '../lib/shiftTimeline'
import { diffPlans } from '../lib/planDiff'
import { schedule, type PlanOverride, type ScheduledJob } from '../lib/scheduler'

export const Route = createFileRoute('/planlama')({
  component: PlanlamaPage,
})

const COUNTED_STOCK = new Set(['finished_goods', 'production_area'])
const RAW_STOCK = new Set(['raw_material'])
const DEFAULT_HORIZON_WEEKS = 4

/**
 * Gün içi dakikayı gerçek saate çevirir. `shiftStartMinute` birinci
 * the start of the first shift (minutes from midnight, e.g. 480 = 08:00).
 * Vardiya numarası da ayrıca gösterilir.
 */
function formatClock(minute: number, shiftMinutes: number, shiftStartMinute: number): string {
  const shiftIndex = Math.floor(minute / shiftMinutes) + 1
  const absolute = (shiftStartMinute + minute) % (24 * 60)
  const h = Math.floor(absolute / 60)
  const m = Math.round(absolute % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} (shift ${shiftIndex})`
}

function PlanlamaPage() {
  // Planlama sayfalı sorgu KULLANMAZ. Sayfalı sorgu ilk sayfada durur ve
  // sınırın ötesindeki malzemeler plana hiç girmez — üstelik hiçbir uyarı
  // çıkmaz. Bu sorgular ya hepsini verir ya da eksik olduğunu söyler.
  const productsResult = useQuery(api.products.listAll)
  const demandResult = useQuery(api.demand.listAllWeekly)
  const stockResult = useQuery(api.stock.listAll)
  const products = useMemo(() => productsResult?.rows ?? [], [productsResult])
  const weeklyDemand = useMemo(() => demandResult?.rows ?? [], [demandResult])
  const stockRows = useMemo(() => stockResult?.rows ?? [], [stockResult])
  const locations = (useQuery(api.storageLocations.listAll) ?? []) as {
    code: string
    category: string
  }[]

  /** Plan girdisi eksikse hangi tablodan kaynaklandığı. */
  const truncatedInputs = [
    productsResult && !productsResult.complete ? 'master data' : null,
    demandResult && !demandResult.complete ? 'demand' : null,
    stockResult && !stockResult.complete ? 'stock' : null,
  ].filter((v): v is string => v !== null)

  const inputsLoading =
    productsResult === undefined ||
    demandResult === undefined ||
    stockResult === undefined
  const presses = (useQuery(api.presses.list) ?? []) as {
    name: string
    hall: string
    category?: string
    feedsCoil?: boolean
  }[]
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
  const plannedStops = (useQuery(api.plannedStops.list) ?? []) as {
    shiftIndex: number
    name: string
    kind: string
    startMinute: number
    durationMinutes: number
  }[]
  const overrideRows = (useQuery(api.planOverrides.list) ?? []) as {
    _id: string
    material: string
    kind: string
    press?: string
    date?: string
    note?: string
  }[]
  // Kalıp bakım kayıtları plana doğrudan girer: bakım günü o kalıp
  // çalışamaz. Kullanıcının ayrıca "exclude" yazması gerekmemeli.
  const maintenanceRows = (useQuery(api.moldMaintenance.list) ?? []) as {
    material: string
    date: string
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
  const coilSetupGapMinutes = globalSettings?.coilSetupGapMinutes ?? 30
  const shiftStartMinute = globalSettings?.shiftStartMinute ?? 420 // 07:00
  const breakMinutesPerShift = globalSettings?.breakMinutesPerShift ?? 0

  // Planned stops replace the old single break figure; capacity is reduced
  // shift by shift so a shift with a handover and a meal is worth less than
  // one with only a tea break.
  const stopMinutesByShift = useMemo(() => {
    const perShift = [0, 0, 0]
    for (const stop of plannedStops) {
      const i = stop.shiftIndex - 1
      if (i >= 0 && i < 3) perShift[i] += stop.durationMinutes
    }
    return perShift
  }, [plannedStops])
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

  // Capacity shrinks as the day passes, so the clock is part of the input.
  // Re-read once a minute rather than on every render.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  // The plan day runs from the first shift's start, not from midnight: at
  // 02:00 the shop is still on the previous day's third shift.
  const { date: todayIso, clockMinute: nowClockMinute } = productionDayOf(now, shiftStartMinute)

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
            { shiftMinutes, overtimeShiftMinutes, breakMinutesPerShift, stopMinutesByShift },
            holidays,
            workingDayKeys,
          ),
        )
      }
      // Two corrections, in order: the measured attainment rate, then the
      // hours that have already gone by. Elapsed time is measured against the
      // day's real timeline, so minutes spent in a handover or a meal break
      // are not counted as production that was lost.
      map.set(
        press.name,
        all.map((b) => {
          const adjusted =
            capacityFactor === 1 ? b.minutes : Math.floor(b.minutes * capacityFactor)
          const timeline = buildDayTimeline(
            shiftStartMinute,
            shiftMinutes,
            b.shifts,
            plannedStops,
          )
          return {
            ...b,
            minutes: remainingCapacityMinutes(
              b.date,
              todayIso,
              nowClockMinute,
              adjusted,
              timeline,
            ),
          }
        }),
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
    stopMinutesByShift,
    plannedStops,
    shiftStartMinute,
    todayIso,
    nowClockMinute,
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

  const moldBlackouts = useMemo(
    () => maintenanceRows.map((m) => ({ material: m.material, date: m.date })),
    [maintenanceRows],
  )

  const result = useMemo(
    () =>
      schedule(demand, productByCode, presses, buckets, { shiftMinutes, overtimeShiftMinutes }, {
        setupGapMinutes,
        coilSetupGapMinutes,
        concurrentSetupsPerHall,
        overrides,
        moldBlackouts,
        // Her vardiyanın kendi net dakikası verilir: devir toplantısı, çay ve
        // yemek vardiyadan vardiyaya değişir, tek bir uzunlukla bölmek 2. ve
        // 3. vardiyanın sınırını kaydırırdı.
        shiftNetMinutes: stopMinutesByShift.map((stopped) =>
          Math.max(1, shiftMinutes - stopped),
        ),
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
      coilSetupGapMinutes,
      overrides,
      moldBlackouts,
      stopMinutesByShift,
    ],
  )


  // Onaylı planla canlı planın farkı — "onayladığımdan bu yana ne değişti".
  const planDiff = useMemo(() => {
    if (!latestSnapshot) return null
    // Kırpılmış bir anlık görüntüyle karşılaştırmak yalan söyler: saklanmayan
    // işler "plandan düştü" gibi görünür. Böyle bir karşılaştırma yapmaktansa
    // hiç yapmamak doğrudur.
    if (latestSnapshot.truncated) return null
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

  // Gantt needs each press's net capacity on the shown day.
  const capacityByPressDate = useMemo(() => {
    const map = new Map<string, number>()
    for (const [pressName, list] of buckets) {
      for (const b of list) map.set(`${pressName}|${b.date}`, b.minutes)
    }
    return map
  }, [buckets])

  // How many shifts each press runs on each day — the Gantt needs this to
  // lay out the day's shift windows and place the planned stops.
  const shiftsByPressDate = useMemo(() => {
    const map = new Map<string, number>()
    for (const [pressName, list] of buckets) {
      for (const b of list) map.set(`${pressName}|${b.date}`, b.shifts)
    }
    return map
  }, [buckets])

  /**
   * The plan grouped by calendar week, with a reason for every press that has
   * no work. An idle row is ambiguous on its own — no demand, nothing it can
   * run, or no capacity are three different problems.
   */
  const weeks = useMemo(() => {
    const byWeek = new Map<string, { dates: Set<string>; jobs: typeof result.jobs }>()
    for (const [pressName, list] of buckets) {
      void pressName
      for (const b of list) {
        if (b.minutes <= 0) continue
        const weekStart = isoDate(mondayOf(new Date(`${b.date}T00:00:00`)))
        const entry = byWeek.get(weekStart) ?? { dates: new Set<string>(), jobs: [] }
        entry.dates.add(b.date)
        byWeek.set(weekStart, entry)
      }
    }
    for (const job of result.jobs) {
      // A job that does not fit before the week closes carries on into the
      // next one, so it belongs to every week its pieces actually run in —
      // otherwise the continuation would be missing from that week's chart.
      const jobDates = new Set<string>([job.date, ...job.segments.map((s) => s.date)])
      const weeksTouched = new Set<string>()
      for (const date of jobDates) {
        if (!date) continue
        weeksTouched.add(isoDate(mondayOf(new Date(`${date}T00:00:00`))))
      }
      for (const weekStart of weeksTouched) {
        const entry = byWeek.get(weekStart) ?? { dates: new Set<string>(), jobs: [] }
        for (const date of jobDates) {
          if (date && isoDate(mondayOf(new Date(`${date}T00:00:00`))) === weekStart) {
            entry.dates.add(date)
          }
        }
        entry.jobs.push(job)
        byWeek.set(weekStart, entry)
      }
    }

    const eligiblePresses = new Set<string>()
    for (const product of productByCode.values()) {
      for (const m of [
        product.mainMachine,
        product.altMachine1,
        product.altMachine2,
        product.altMachine3,
        product.altMachine4,
      ]) {
        if (m && m.trim()) eligiblePresses.add(m.trim())
      }
    }

    return Array.from(byWeek.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([weekStart, entry]) => {
        const dates = Array.from(entry.dates).sort()
        const busy = new Set(entry.jobs.map((j) => j.press))
        const idlePresses = presses
          .filter((p) => !busy.has(p.name))
          .map((p) => {
            const capacity = dates.reduce(
              (sum, d) => sum + (capacityByPressDate.get(`${p.name}|${d}`) ?? 0),
              0,
            )
            const reason =
              capacity <= 0
                ? 'no capacity'
                : !eligiblePresses.has(p.name)
                  ? 'no material lists it'
                  : 'no demand for its materials'
            return { name: p.name, reason }
          })
        return { weekStart, dates, jobs: entry.jobs, idlePresses }
      })
  }, [buckets, result, presses, productByCode, capacityByPressDate])

  const lateCount = result.jobs.filter((j) => j.late).length

  // How much of this week is actually still available. The engine already
  // works with this figure; showing it stops the plan looking short when the
  // real reason is that half the week has gone.
  const thisWeekCapacity = useMemo(() => {
    const weekEnd = isoDate(addDays(horizonMonday, 6))
    let full = 0
    let remaining = 0
    const templateByPress = new Map(templates.map((t) => [t.press, t]))
    for (const press of presses) {
      const pattern = templateByPress.get(press.name) ?? {
        workingDays: workingDaysPerWeek,
        shiftsPerDay: 1,
        overtimeShifts: 0,
      }
      for (const bucket of buildWeekBuckets(
        horizonMonday,
        pattern,
        { shiftMinutes, overtimeShiftMinutes, breakMinutesPerShift },
        holidays,
        workingDayKeys,
      )) {
        if (bucket.date > weekEnd) continue
        const adjusted =
          capacityFactor === 1 ? bucket.minutes : Math.floor(bucket.minutes * capacityFactor)
        full += adjusted
        remaining += remainingCapacityMinutes(
          bucket.date,
          todayIso,
          nowClockMinute,
          adjusted,
          buildDayTimeline(shiftStartMinute, shiftMinutes, bucket.shifts, plannedStops),
        )
      }
    }
    return { full, remaining, elapsed: full - remaining }
  }, [
    presses,
    templates,
    horizonMonday,
    shiftMinutes,
    overtimeShiftMinutes,
    breakMinutesPerShift,
    shiftStartMinute,
    holidays,
    workingDayKeys,
    workingDaysPerWeek,
    capacityFactor,
    plannedStops,
    todayIso,
    nowClockMinute,
  ])

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
    if (lateCount > 0)
      list.push(
        `${lateCount} jobs are scheduled after the week they are needed — capacity is short.`,
      )
    if (missingRawSpec.length > 0)
      list.push(
        `${missingRawSpec.length} materials have no raw material code or gross weight — the raw material check cannot run.`,
      )
    // Ufkun içindeki bakım günleri planı doğrudan değiştirdiği için
    // görünür olmalı — iş neden o güne konmadı sorusunun cevabı budur.
    const upcomingMaintenance = moldBlackouts.filter((b) => b.date >= todayIso)
    if (upcomingMaintenance.length > 0) {
      const moulds = Array.from(new Set(upcomingMaintenance.map((b) => b.material)))
      list.push(
        `${moulds.length} mould${moulds.length > 1 ? 's are' : ' is'} in maintenance on ` +
          `${upcomingMaintenance.length} day(s) and cannot run then: ` +
          `${moulds.slice(0, 6).join(', ')}${moulds.length > 6 ? '…' : ''}.`,
      )
    }
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
    lateCount,
    moldBlackouts,
    todayIso,
  ])

  const totalPlannedQty = result.jobs.reduce((s, j) => s + j.quantity, 0)
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
          endDate: j.endDate,
          reason: j.reason,
        })),
      })
      setApprovedAt(new Date().toLocaleString('en-GB'))
    } finally {
      setApproving(false)
    }
  }

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-12">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Production Plan</h1>
      <p className="mt-2 text-muted-foreground">
        The plan is generated automatically: backlog first, then the materials
        whose stock runs out soonest, and the remaining capacity is filled with
        the rest of the demand. Crane constraints, mold limits and coil
        calculations are all applied. You only review and approve. Planning
        horizon is {horizonWeeks} weeks (change it on the Work Calendar page).
      </p>

      <p className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
        <strong className="text-foreground">Minimum lot is one full coil.</strong> A coil
        that is mounted is run out, so quantities are rounded up to whole coils and the
        surplus covers the following weeks rather than triggering a second coil. Materials
        with no coil or gross weight in master data are planned to the exact requirement.
      </p>

      {thisWeekCapacity.full > 0 && (
        <p className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          This week ({isoWeekLabel(horizonMonday)}):{' '}
          <strong className="text-foreground">
            {Math.round(thisWeekCapacity.remaining / 60).toLocaleString('en-GB')} h
          </strong>{' '}
          still available of {Math.round(thisWeekCapacity.full / 60).toLocaleString('en-GB')} h —{' '}
          {Math.round(thisWeekCapacity.elapsed / 60).toLocaleString('en-GB')} h have already
          gone by. Days that have passed and the hours already elapsed today are excluded
          from the plan.
        </p>
      )}

      {capacityFactor !== 1 && (
        <p className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          Capacity is adjusted by the measured attainment rate:{' '}
          <strong className="text-foreground">%{Math.round(capacityFactor * 100)}</strong>.
          You can update this factor on the Performance page.
        </p>
      )}

      {truncatedInputs.length > 0 && (
        <div className="mt-6 rounded-lg border-2 border-destructive bg-destructive/10 p-4">
          <p className="text-sm font-semibold text-destructive">
            This plan is incomplete — do not approve it
          </p>
          <p className="mt-1 text-sm text-foreground">
            There are more rows in {truncatedInputs.join(', ')} than one query can
            read, so part of the data did not reach the planner. Everything shown
            below was planned without it. Reduce the data or split the plant before
            relying on this plan.
          </p>
        </div>
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
          disabled={
            approving ||
            result.jobs.length === 0 ||
            inputsLoading ||
            truncatedInputs.length > 0
          }
          title={
            truncatedInputs.length > 0
              ? 'Part of the data did not reach the planner'
              : inputsLoading
                ? 'Still loading the plan inputs'
                : undefined
          }
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

      {latestSnapshot?.truncated && (
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          The approved plan of{' '}
          {new Date(latestSnapshot.createdAt).toLocaleString('en-GB')} was too
          large to store in full ({latestSnapshot.jobCount} jobs), so it cannot be
          compared with the plan below — a comparison would report the jobs that
          were not stored as dropped. Approve again to get a comparable plan.
        </p>
      )}

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
                  onClick={() => {
                    if (window.confirm(`Remove the planning rule for ${o.material}?`)) {
                      void clearOverride({ material: o.material })
                    }
                  }}
                  className="text-xs text-destructive hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {inputsLoading && (
        <p className="mt-8 text-sm text-muted-foreground">Loading data…</p>
      )}

      {weeks.length === 0 && !inputsLoading && (
        <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No jobs to plan. Make sure ZPP demand, MB52 stock and{' '}
          <Link to="/makineler" className="underline">
            press definitions
          </Link>{' '}
          have been uploaded.
        </p>
      )}

      {weeks.map((week) => (
        <div key={week.weekStart} className="mt-8">
          <h2 className="text-sm font-semibold text-foreground">
            {isoWeekLabel(new Date(`${week.weekStart}T00:00:00`))}{' '}
            <span className="font-normal text-muted-foreground">
              · {new Date(`${week.dates[0]}T00:00:00`).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
              })}
              –
              {new Date(
                `${week.dates[week.dates.length - 1]}T00:00:00`,
              ).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}{' '}
              · {week.jobs.length} jobs
            </span>
          </h2>

          <div className="mt-2">
            <WeekGantt
              dates={week.dates}
              stops={plannedStops}
              shiftStartMinute={shiftStartMinute}
              shiftMinutes={shiftMinutes}
              presses={presses.map(
                (p): WeekGanttPress => ({
                  name: p.name,
                  hall: p.hall,
                  category: p.category,
                  days: week.dates.map((d) => ({
                    date: d,
                    shifts: shiftsByPressDate.get(`${p.name}|${d}`) ?? 0,
                    capacityMinutes: capacityByPressDate.get(`${p.name}|${d}`) ?? 0,
                  })),
                }),
              )}
              jobs={week.jobs.map(
                (j): WeekGanttJob => ({
                  date: j.date,
                  press: j.press,
                  material: j.material,
                  quantity: j.quantity,
                  late: j.late,
                  setupStartMinute: j.setupStartMinute,
                  endMinute: j.endMinute,
                  segments: j.segments,
                }),
              )}
            />
          </div>

          {week.idlePresses.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              <strong className="text-foreground">Idle this week:</strong>{' '}
              {week.idlePresses.map((p) => `${p.name} (${p.reason})`).join(' · ')}
            </p>
          )}

          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Show job list ({week.jobs.length})
            </summary>
            <div className="mt-2 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Day</th>
                    <th className="px-3 py-2 font-medium">Press</th>
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
                  {week.jobs.map((job, i) => (
                    <tr key={`${job.press}-${job.material}-${i}`} className="border-t border-border">
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {new Date(`${job.date}T00:00:00`).toLocaleDateString('en-GB', {
                          weekday: 'short',
                          day: '2-digit',
                        })}
                      </td>
                      <td className="px-3 py-2 font-medium text-foreground">{job.press}</td>
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
                        {job.spansDays && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (
                            {new Date(`${job.endDate}T00:00:00`).toLocaleDateString('en-GB', {
                              weekday: 'short',
                              day: '2-digit',
                            })}
                            )
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{job.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      ))}

      {rawNeeds.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-foreground">
            Raw material requirement ({rawNeeds.length} items)
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Calculated from the planned quantity × gross weight per piece, and
            compared with unrestricted stock in raw material locations.
            Co-products are not counted twice — they come out of the same grams
            as the part they fall with.
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
