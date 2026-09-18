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
        kontrol edip onaylarsın. Plan ufku {horizonWeeks} hafta (Çalışma
        Takvimi sayfasından değiştirilebilir).
      </p>

      {capacityFactor !== 1 && (
        <p className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          Kapasite, ölçülen gerçekleşme oranıyla düzeltiliyor:{' '}
          <strong className="text-foreground">%{Math.round(capacityFactor * 100)}</strong>.
          Bu oranı Performans sayfasından güncelleyebilirsin.
        </p>
      )}

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

      {planDiff && planDiff.changes.length > 0 && (
        <div className="mt-6 rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold text-foreground">
            Onaylı plana göre değişenler
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Son onay: {new Date(latestSnapshot!.createdAt).toLocaleString('tr-TR')} ·{' '}
            {planDiff.addedCount} yeni, {planDiff.removedCount} düşen,{' '}
            {planDiff.movedCount} yer değiştiren, {planDiff.quantityCount} miktarı değişen,{' '}
            {planDiff.sameCount} aynı.
          </p>
          <div className="mt-2 max-h-80 overflow-auto rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Malzeme</th>
                  <th className="px-3 py-2 font-medium">Değişim</th>
                  <th className="px-3 py-2 font-medium">Onaylı</th>
                  <th className="px-3 py-2 font-medium">Şimdi</th>
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
                          {Math.round(c.approvedQty).toLocaleString('tr-TR')} adet
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
                          {Math.round(c.currentQty).toLocaleString('tr-TR')} adet
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
        <h2 className="text-sm font-semibold text-foreground">Plana müdahale</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Plan otomatik hesaplanır; buradaki kurallar hesaba girdi olarak
          katılır, yani müdahalen kalıcıdır ama plan yine motordan çıkar.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Malzeme</span>
            <input
              className="mt-1 w-40 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={ovMaterial}
              onChange={(e) => setOvMaterial(e.target.value)}
              placeholder="Malzeme kodu"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Kural</span>
            <select
              className="mt-1 w-44 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={ovKind}
              onChange={(e) => setOvKind(e.target.value)}
            >
              <option value="priority">Öne al</option>
              <option value="pin">Prese sabitle</option>
              <option value="exclude">Planlama dışı bırak</option>
            </select>
          </label>
          {ovKind === 'pin' && (
            <>
              <label className="text-sm">
                <span className="block text-xs text-muted-foreground">Pres</span>
                <select
                  className="mt-1 w-36 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={ovPress}
                  onChange={(e) => setOvPress(e.target.value)}
                >
                  <option value="">Seç…</option>
                  {presses.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs text-muted-foreground">Gün (ops.)</span>
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
            Kuralı ekle
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
                      ? '— planlama dışı'
                      : o.kind === 'priority'
                        ? '— öne alındı'
                        : `— ${o.press} presine sabit${o.date ? ` (${o.date})` : ''}`}
                  </span>
                </span>
                <button
                  onClick={() => void clearOverride({ material: o.material })}
                  className="text-xs text-destructive hover:underline"
                >
                  Kaldır
                </button>
              </li>
            ))}
          </ul>
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

const CHANGE_LABEL: Record<string, string> = {
  added: 'yeni',
  removed: 'düştü',
  moved: 'yer değişti',
  quantity: 'miktar değişti',
  same: 'aynı',
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
