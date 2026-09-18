import { createFileRoute } from '@tanstack/react-router'
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import {
  buildAdherence,
  capacityUtilisation,
  performanceFactor,
  theoreticalMinutes,
} from '../lib/performance'
import {
  buildWeekBuckets,
  type DayBucket,
  type ProductSpec,
} from '../lib/planning'

export const Route = createFileRoute('/performans')({
  component: PerformansPage,
})

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function mondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  d.setHours(0, 0, 0, 0)
  return d
}

function percent(v: number | null): string {
  if (v === null) return '—'
  return `${(v * 100).toFixed(1)}%`
}

function PerformansPage() {
  const today = useMemo(() => new Date(), [])
  const [from, setFrom] = useState(() => isoDate(addDays(mondayOf(today), -7)))
  const [to, setTo] = useState(() => isoDate(today))

  const snapshot = useQuery(api.planSnapshots.latest)
  const { results: actualRows, status: actualStatus } = usePaginatedQuery(
    api.actualProduction.list,
    {},
    { initialNumItems: 2000 },
  )
  const { results: products } = usePaginatedQuery(
    api.products.list,
    {},
    { initialNumItems: 500 },
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
  const setCapacityFactor = useMutation(api.pressCalendar.setCapacityFactor)
  const [applied, setApplied] = useState(false)

  const shiftMinutes = globalSettings?.shiftMinutes ?? 480
  const overtimeShiftMinutes = globalSettings?.overtimeShiftMinutes ?? 480
  const breakMinutesPerShift = globalSettings?.breakMinutesPerShift ?? 0

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

  // Aralıktaki açık kapasite: her presin şablon düzeni × takvim günleri.
  const availableMinutes = useMemo(() => {
    const holidays = new Set<string>((workCalendar?.holidays ?? []) as string[])
    const workingDayKeys = (workCalendar?.workingDays ?? [
      'MO',
      'TU',
      'WE',
      'TH',
      'FR',
    ]) as string[]
    const templateByPress = new Map(templates.map((t) => [t.press, t]))

    let total = 0
    for (const press of presses) {
      const pattern = templateByPress.get(press.name) ?? {
        workingDays: workingDayKeys.length,
        shiftsPerDay: 1,
        overtimeShifts: 0,
      }
      let week = mondayOf(new Date(from))
      const end = new Date(to)
      const buckets: DayBucket[] = []
      // Aralığı kapsayacak kadar hafta üret (en fazla 60 hafta güvenlik sınırı).
      for (let guard = 0; guard < 60 && week <= end; guard++) {
        buckets.push(
          ...buildWeekBuckets(
            week,
            pattern,
            { shiftMinutes, overtimeShiftMinutes, breakMinutesPerShift },
            holidays,
            workingDayKeys,
          ),
        )
        week = addDays(week, 7)
      }
      for (const b of buckets) {
        if (b.date >= from && b.date <= to) total += b.minutes
      }
    }
    return total
  }, [
    presses,
    templates,
    workCalendar,
    from,
    to,
    shiftMinutes,
    overtimeShiftMinutes,
    breakMinutesPerShift,
  ])

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
    <div className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground">Performans</h1>
      <p className="mt-2 text-muted-foreground">
        Onaylı planla MB51'den yüklenen gerçekleşen üretimi karşılaştırır.
        Çıkan performans faktörü, kapasiteyi gerçekçileştirmek için
        kullanılabilir.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Başlangıç</span>
          <input
            type="date"
            className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Bitiş</span>
          <input
            type="date"
            className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Planlanan adet" value={Math.round(totalPlanned).toLocaleString('tr-TR')} />
        <Stat label="Gerçekleşen adet" value={Math.round(totalActual).toLocaleString('tr-TR')} />
        <Stat
          label="Performans faktörü"
          value={percent(factor)}
          warn={factor !== null && factor < 0.9}
        />
        <Stat
          label="Kapasite kullanımı"
          value={percent(utilisation)}
          warn={utilisation !== null && utilisation < 0.6}
        />
      </div>

      {factor !== null && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border p-4">
          <div className="text-sm">
            <p className="text-foreground">
              Planlama kapasitesi şu an{' '}
              <strong>%{Math.round((globalSettings?.capacityFactor ?? 1) * 100)}</strong>{' '}
              katsayısıyla hesaplanıyor.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ölçülen gerçekleşme oranını kapasiteye uygularsan plan, geçmişte
              fiilen üretilebilen hıza göre kurulur.
            </p>
          </div>
          <button
            onClick={() => {
              const value = Math.min(2, Math.max(0.05, Number(factor.toFixed(3))))
              void setCapacityFactor({ capacityFactor: value }).then(() => setApplied(true))
            }}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
          >
            %{Math.round(factor * 100)} olarak uygula
          </button>
          {globalSettings?.capacityFactor !== undefined &&
            globalSettings.capacityFactor !== 1 && (
              <button
                onClick={() => void setCapacityFactor({ capacityFactor: 1 }).then(() => setApplied(true))}
                className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
              >
                Sıfırla (%100)
              </button>
            )}
          {applied && <span className="text-sm text-emerald-600">Kaydedildi ✓</span>}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-border p-4 text-sm text-muted-foreground">
        <p>
          <strong className="text-foreground">Kapasite kullanımı</strong>, gerçekleşen
          üretimin ideal hızda kaç dakika süreceğinin açık kapasiteye oranıdır
          ({Math.round(theoretical).toLocaleString('tr-TR')} dk /{' '}
          {Math.round(availableMinutes).toLocaleString('tr-TR')} dk).
        </p>
        <p className="mt-2">
          Bu <strong className="text-foreground">tam bir OEE değildir</strong>: sistemde
          duruş ve fire verisi yok, dolayısıyla kullanılabilirlik ve kalite
          bileşenleri ayrıştırılamıyor. Gerçek OEE için duruş kayıtlarının da
          yüklenmesi gerekir.
        </p>
      </div>

      {!snapshot && (
        <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Henüz onaylanmış plan yok — karşılaştırma yapılamıyor. Planlama
          sayfasından bir planı onayla.
        </p>
      )}

      {actualStatus === 'LoadingFirstPage' && (
        <p className="mt-6 text-sm text-muted-foreground">Gerçekleşen üretim yükleniyor…</p>
      )}

      {worst.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-foreground">
            Plana en çok sapan malzemeler
          </h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Malzeme</th>
                  <th className="px-3 py-2 font-medium">Planlanan</th>
                  <th className="px-3 py-2 font-medium">Gerçekleşen</th>
                  <th className="px-3 py-2 font-medium">Fark</th>
                  <th className="px-3 py-2 font-medium">Gerçekleşme</th>
                </tr>
              </thead>
              <tbody>
                {worst.map((r) => (
                  <tr key={r.material} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">{r.material}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {Math.round(r.plannedQty).toLocaleString('tr-TR')}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {Math.round(r.actualQty).toLocaleString('tr-TR')}
                    </td>
                    <td
                      className={`px-3 py-2 font-medium ${
                        r.diff < 0 ? 'text-destructive' : 'text-emerald-600'
                      }`}
                    >
                      {r.diff > 0 ? '+' : ''}
                      {Math.round(r.diff).toLocaleString('tr-TR')}
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
            Tüm kalemler ({adherence.length})
          </h2>
          <div className="mt-2 max-h-96 overflow-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Malzeme</th>
                  <th className="px-3 py-2 font-medium">Planlanan</th>
                  <th className="px-3 py-2 font-medium">Gerçekleşen</th>
                  <th className="px-3 py-2 font-medium">Fark</th>
                </tr>
              </thead>
              <tbody>
                {adherence.map((r) => (
                  <tr key={r.material} className="border-t border-border">
                    <td className="px-3 py-2 text-foreground">{r.material}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {Math.round(r.plannedQty).toLocaleString('tr-TR')}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {Math.round(r.actualQty).toLocaleString('tr-TR')}
                    </td>
                    <td
                      className={`px-3 py-2 ${
                        r.diff < 0 ? 'text-destructive' : 'text-muted-foreground'
                      }`}
                    >
                      {r.diff > 0 ? '+' : ''}
                      {Math.round(r.diff).toLocaleString('tr-TR')}
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
