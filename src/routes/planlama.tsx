import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
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
import { schedule, type ScheduledJob } from '../lib/scheduler'

export const Route = createFileRoute('/planlama')({
  component: PlanlamaPage,
})

const COUNTED_STOCK = new Set(['finished_goods', 'production_area'])
const RAW_STOCK = new Set(['raw_material'])
const HORIZON_WEEKS = 4

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

function formatClock(minute: number, shiftMinutes: number): string {
  const shiftIndex = Math.floor(minute / shiftMinutes) + 1
  const within = Math.round(minute % shiftMinutes)
  const h = Math.floor(within / 60)
  const m = within % 60
  return `${shiftIndex}. vardiya ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
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

  const [approving, setApproving] = useState(false)
  const [approvedAt, setApprovedAt] = useState<string | null>(null)

  const shiftMinutes = globalSettings?.shiftMinutes ?? 480
  const overtimeShiftMinutes = globalSettings?.overtimeShiftMinutes ?? 480
  const setupGapMinutes = globalSettings?.setupGapMinutes ?? 60
  const concurrentSetupsPerHall = globalSettings?.concurrentSetupsPerHall ?? 1

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
      horizonWeeks: HORIZON_WEEKS,
      workingDaysPerWeek,
    })
  }, [weeklyDemand, stockByMaterial, workingDaysPerWeek, productByCode, horizonMonday])

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
      for (let w = 0; w < HORIZON_WEEKS; w++) {
        all.push(
          ...buildWeekBuckets(
            addDays(start, w * 7),
            pattern,
            { shiftMinutes, overtimeShiftMinutes },
            holidays,
            workingDayKeys,
          ),
        )
      }
      map.set(press.name, all)
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
  ])

  const result = useMemo(
    () =>
      schedule(demand, productByCode, presses, buckets, { shiftMinutes, overtimeShiftMinutes }, {
        setupGapMinutes,
        concurrentSetupsPerHall,
      }),
    [demand, productByCode, presses, buckets, shiftMinutes, overtimeShiftMinutes, setupGapMinutes, concurrentSetupsPerHall],
  )

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
    if (presses.length === 0) list.push('Hiç pres tanımlı değil — Makine Tanımları sayfasından ekle.')
    if (templates.length === 0)
      list.push('Hiçbir pres için çalışma takvimi tanımlanmamış — varsayılan 1 vardiya kullanılıyor.')
    if (weeklyDemand.length === 0) list.push('ZPP haftalık talep verisi yüklenmemiş.')
    if (stockRows.length === 0) list.push('MB52 stok verisi yüklenmemiş — stok düşülmeden planlanıyor.')
    const missingMaxShots = products.filter((p) => !p.maxShots).length
    if (missingMaxShots > 0)
      list.push(`${missingMaxShots} referansta kalıp max shot limiti tanımsız — limit kontrol edilmiyor.`)
    if (holidays.size === 0)
      list.push(
        'Hiç resmi tatil kayıtlı değil — Çalışma Takvimi sayfasını bir kez aç ki tatiller kaydedilsin.',
      )
    if (rawShortages.length > 0)
      list.push(
        `${rawShortages.length} hammaddede stok yetmiyor — planlanan işler için rulo tedariki gerekiyor.`,
      )
    if (missingRawSpec.length > 0)
      list.push(
        `${missingRawSpec.length} mamulde hammadde kodu veya brüt ağırlık tanımsız — hammadde kontrolü yapılamıyor.`,
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
      setApprovedAt(new Date().toLocaleString('tr-TR'))
    } finally {
      setApproving(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground">Planlama</h1>
      <p className="mt-2 text-muted-foreground">
        Plan otomatik oluşturulur: bakiyeler önce, sonra stoğu en çabuk bitecek
        (en acil) malzemeler, kalan kapasite de diğer ihtiyaçlarla doldurulur.
        Vinç kısıtı, kalıp limiti ve rulo hesabı dikkate alınır. Sen sadece
        kontrol edip onaylarsın.
      </p>

      {warnings.length > 0 && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">Kontrol edilmesi gerekenler</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-amber-800">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Planlanan iş" value={result.jobs.length.toLocaleString('tr-TR')} />
        <Stat label="Planlanan adet" value={totalPlannedQty.toLocaleString('tr-TR')} />
        <Stat
          label="Planlanamayan"
          value={result.unplanned.length.toLocaleString('tr-TR')}
          warn={result.unplanned.length > 0}
        />
        <Stat
          label="Geciken iş"
          value={lateCount.toLocaleString('tr-TR')}
          warn={lateCount > 0}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void handleApprove()}
          disabled={approving || result.jobs.length === 0}
          className="rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {approving ? 'Onaylanıyor…' : 'Planı Onayla'}
        </button>
        {approvedAt && <span className="text-sm text-emerald-600">Onaylandı ✓ {approvedAt}</span>}
        {latestSnapshot && !approvedAt && (
          <span className="text-sm text-muted-foreground">
            Son onaylı plan: {new Date(latestSnapshot.createdAt).toLocaleString('tr-TR')} ·{' '}
            {latestSnapshot.jobCount} iş
          </span>
        )}
      </div>

      {productStatus === 'LoadingFirstPage' && (
        <p className="mt-8 text-sm text-muted-foreground">Veriler yükleniyor…</p>
      )}

      {byDate.length === 0 && productStatus !== 'LoadingFirstPage' && (
        <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Planlanacak iş bulunamadı. ZPP talebi, MB52 stoğu ve{' '}
          <Link to="/makineler" className="underline">
            pres tanımlarının
          </Link>{' '}
          yüklü olduğundan emin ol.
        </p>
      )}

      <div className="mt-8 space-y-6">
        {byDate.map(([date, jobs]) => (
          <div key={date}>
            <h2 className="text-sm font-semibold text-foreground">
              {new Date(date).toLocaleDateString('tr-TR', {
                weekday: 'long',
                day: '2-digit',
                month: 'long',
              })}{' '}
              <span className="font-normal text-muted-foreground">({jobs.length} iş)</span>
            </h2>
            <div className="mt-2 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Pres</th>
                    <th className="px-3 py-2 font-medium">Hol</th>
                    <th className="px-3 py-2 font-medium">Malzeme</th>
                    <th className="px-3 py-2 font-medium">İhtiyaç</th>
                    <th className="px-3 py-2 font-medium">Adet</th>
                    <th className="px-3 py-2 font-medium">Vuruş</th>
                    <th className="px-3 py-2 font-medium">Rulo</th>
                    <th className="px-3 py-2 font-medium">Setup başlangıç</th>
                    <th className="px-3 py-2 font-medium">Bitiş</th>
                    <th className="px-3 py-2 font-medium">Gerekçe</th>
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
                        {job.quantity.toLocaleString('tr-TR')}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {job.shots.toLocaleString('tr-TR')}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{job.coilsNeeded}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatClock(job.setupStartMinute, shiftMinutes)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatClock(job.endMinute, shiftMinutes)}
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
            Hammadde ihtiyacı ({rawNeeds.length} kalem)
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Planlanan vuruşların brüt ağırlığından hesaplanır; Hammadde
            deposundaki serbest stokla karşılaştırılır.
          </p>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Hammadde</th>
                  <th className="px-3 py-2 font-medium">Gereken (kg)</th>
                  <th className="px-3 py-2 font-medium">Stok (kg)</th>
                  <th className="px-3 py-2 font-medium">Eksik (kg)</th>
                  <th className="px-3 py-2 font-medium">Kullanan mamuller</th>
                </tr>
              </thead>
              <tbody>
                {rawNeeds.map((r) => (
                  <tr key={r.rawMaterial} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">{r.rawMaterial}</td>
                    <td className="px-3 py-2 text-foreground">
                      {Math.round(r.requiredKg).toLocaleString('tr-TR')}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {Math.round(r.availableKg).toLocaleString('tr-TR')}
                    </td>
                    <td
                      className={`px-3 py-2 font-medium ${
                        r.shortageKg > 0 ? 'text-destructive' : 'text-emerald-600'
                      }`}
                    >
                      {r.shortageKg > 0
                        ? Math.round(r.shortageKg).toLocaleString('tr-TR')
                        : 'yeterli'}
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
            Planlanamayanlar ({result.unplanned.length})
          </h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-destructive/30">
            <table className="w-full text-left text-sm">
              <thead className="bg-destructive/10 text-destructive">
                <tr>
                  <th className="px-3 py-2 font-medium">Malzeme</th>
                  <th className="px-3 py-2 font-medium">Adet</th>
                  <th className="px-3 py-2 font-medium">Faz</th>
                  <th className="px-3 py-2 font-medium">İhtiyaç haftası</th>
                  <th className="px-3 py-2 font-medium">Neden</th>
                </tr>
              </thead>
              <tbody>
                {result.unplanned.map((u, i) => (
                  <tr key={`${u.material}-${i}`} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">{u.material}</td>
                    <td className="px-3 py-2 text-foreground">
                      {Math.round(u.quantity).toLocaleString('tr-TR')}
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
