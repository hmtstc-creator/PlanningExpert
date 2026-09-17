import { createFileRoute } from '@tanstack/react-router'
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/takvim')({
  component: TakvimPage,
})

const DAYS = [
  { key: 'MO', label: 'Pazartesi', short: 'Pzt' },
  { key: 'TU', label: 'Salı', short: 'Sal' },
  { key: 'WE', label: 'Çarşamba', short: 'Çar' },
  { key: 'TH', label: 'Perşembe', short: 'Per' },
  { key: 'FR', label: 'Cuma', short: 'Cum' },
  { key: 'SA', label: 'Cumartesi', short: 'Cmt' },
  { key: 'SU', label: 'Pazar', short: 'Paz' },
]

const SHIFT_PRESETS = [
  { label: '1 vardiya (8 saat)', minutes: 480 },
  { label: '2 vardiya (16 saat)', minutes: 960 },
  { label: '3 vardiya (24 saat)', minutes: 1440 },
]

const FALLBACK_COUNTRIES = [
  { countryCode: 'TR', name: 'Türkiye' },
  { countryCode: 'DE', name: 'Almanya' },
  { countryCode: 'US', name: 'ABD' },
  { countryCode: 'GB', name: 'Birleşik Krallık' },
  { countryCode: 'FR', name: 'Fransa' },
  { countryCode: 'IT', name: 'İtalya' },
  { countryCode: 'ES', name: 'İspanya' },
  { countryCode: 'NL', name: 'Hollanda' },
  { countryCode: 'PL', name: 'Polonya' },
  { countryCode: 'RO', name: 'Romanya' },
]

function TakvimPage() {
  const calendar = useQuery(api.workCalendar.get)
  const save = useMutation(api.workCalendar.save)

  const [shiftMinutes, setShiftMinutes] = useState(480)
  const [workingDays, setWorkingDays] = useState<string[]>(['MO', 'TU', 'WE', 'TH', 'FR'])
  const [holidays, setHolidays] = useState<string[]>([])
  const [newHoliday, setNewHoliday] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (calendar) {
      setShiftMinutes(calendar.shiftMinutesPerDay)
      setWorkingDays(calendar.workingDays)
      setHolidays(calendar.holidays)
    }
  }, [calendar])

  function toggleDay(key: string) {
    setWorkingDays((prev) =>
      prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key],
    )
  }

  async function handleSave() {
    await save({ shiftMinutesPerDay: shiftMinutes, workingDays, holidays })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const weeklyMinutes = shiftMinutes * workingDays.length

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground">Çalışma Takvimi</h1>
      <p className="mt-2 text-muted-foreground">
        Planlamanın gerçekçi olması için fabrikanın ne zaman ve ne kadar
        çalıştığını tanımla. Bu ayarlar plan sürelerinin gün/saate
        çevrilmesinde kullanılır.
      </p>

      <section className="mt-8 rounded-lg border border-border p-5">
        <h2 className="font-semibold text-foreground">
          Genel varsayılan (Planlama sayfasında kullanılır)
        </h2>

        <h3 className="mt-4 text-sm font-medium text-foreground">Günlük çalışma süresi</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {SHIFT_PRESETS.map((p) => (
            <button
              key={p.minutes}
              onClick={() => setShiftMinutes(p.minutes)}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                shiftMinutes === p.minutes
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70'
              }`}
            >
              {p.label}
            </button>
          ))}
          <div className="flex items-center gap-2">
            <input
              type="number"
              className="w-24 rounded-md border border-input bg-background px-2 py-2 text-sm"
              value={shiftMinutes}
              onChange={(e) => setShiftMinutes(Number(e.target.value) || 0)}
            />
            <span className="text-sm text-muted-foreground">dk/gün</span>
          </div>
        </div>

        <h3 className="mt-5 text-sm font-medium text-foreground">Çalışma günleri</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {DAYS.map((d) => {
            const active = workingDays.includes(d.key)
            return (
              <button
                key={d.key}
                onClick={() => toggleDay(d.key)}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70'
                }`}
              >
                {d.label}
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Haftalık toplam kapasite:{' '}
          <strong className="text-foreground">
            {(weeklyMinutes / 60).toFixed(0)} saat
          </strong>{' '}
          ({workingDays.length} gün × {shiftMinutes} dk)
        </p>

        <h3 className="mt-5 text-sm font-medium text-foreground">Tatiller / duruş günleri</h3>
        <div className="mt-3 flex gap-2">
          <input
            type="date"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={newHoliday}
            onChange={(e) => setNewHoliday(e.target.value)}
          />
          <button
            onClick={() => {
              if (newHoliday && !holidays.includes(newHoliday)) {
                setHolidays((prev) => [...prev, newHoliday].sort())
                setNewHoliday('')
              }
            }}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Ekle
          </button>
        </div>
        {holidays.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {holidays.map((h) => (
              <span
                key={h}
                className="flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm text-foreground"
              >
                {new Date(h).toLocaleDateString('tr-TR')}
                <button
                  className="text-destructive"
                  onClick={() => setHolidays((prev) => prev.filter((d) => d !== h))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={() => void handleSave()}
            className="rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90"
          >
            Genel Takvimi Kaydet
          </button>
          {saved && <span className="text-sm text-emerald-600">Kaydedildi ✓</span>}
        </div>
      </section>

      <PressCalendarSection />
    </div>
  )
}

// ---- Pres bazlı detaylı takvim -------------------------------------------

function mondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay() // 0 = Pazar
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
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

function formatWeekLabel(monday: Date): string {
  const sunday = addDays(monday, 6)
  const fmt = (d: Date) => d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })
  return `${fmt(monday)} – ${fmt(sunday)} ${sunday.getFullYear()}`
}

function defaultDays(weekDates: Date[], holidaySet: Set<string>) {
  return DAYS.map((d, i) => {
    const date = weekDates[i]
    const isHoliday = holidaySet.has(isoDate(date))
    const isWeekend = d.key === 'SA' || d.key === 'SU'
    return {
      key: d.key,
      shifts: isHoliday || isWeekend ? 0 : 1,
      overtimeShifts: 0,
    }
  })
}

function PressCalendarSection() {
  const { results: products } = usePaginatedQuery(
    api.products.list,
    {},
    { initialNumItems: 500 },
  )
  const settingsList = useQuery(api.pressCalendar.listSettings) ?? []
  const saveSettings = useMutation(api.pressCalendar.saveSettings)

  const discoveredPresses = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) {
      for (const m of [p.mainMachine, p.altMachine1, p.altMachine2, p.altMachine3, p.altMachine4]) {
        if (m && m.trim()) set.add(m.trim())
      }
    }
    for (const s of settingsList) set.add(s.press)
    return Array.from(set).sort()
  }, [products, settingsList])

  const [extraPresses, setExtraPresses] = useState<string[]>([])
  const [newPress, setNewPress] = useState('')
  const [press, setPress] = useState<string>('')

  const pressOptions = useMemo(
    () => Array.from(new Set([...discoveredPresses, ...extraPresses])).sort(),
    [discoveredPresses, extraPresses],
  )

  useEffect(() => {
    if (!press && pressOptions.length > 0) setPress(pressOptions[0])
  }, [press, pressOptions])

  function addPress() {
    const name = newPress.trim()
    if (!name) return
    setExtraPresses((prev) => (prev.includes(name) ? prev : [...prev, name]))
    setPress(name)
    setNewPress('')
  }

  const currentSettings = settingsList.find((s) => s.press === press)
  const [shiftMinutes, setShiftMinutes] = useState(480)
  const [overtimeShiftMinutes, setOvertimeShiftMinutes] = useState(600)
  const [country, setCountry] = useState('TR')

  useEffect(() => {
    if (currentSettings) {
      setShiftMinutes(currentSettings.shiftMinutes)
      setOvertimeShiftMinutes(currentSettings.overtimeShiftMinutes)
      setCountry(currentSettings.country ?? 'TR')
    } else {
      setShiftMinutes(480)
      setOvertimeShiftMinutes(600)
      setCountry('TR')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [press])

  async function persistSettings() {
    if (!press) return
    await saveSettings({ press, shiftMinutes, overtimeShiftMinutes, country })
  }

  // 30 haftalık pencere: bulunduğumuz haftadan 1 hafta öncesinden başlar,
  // toplam 30 hafta (her zaman ~29 hafta ileriyi gösterir).
  const weekStarts = useMemo(() => {
    const start = addDays(mondayOf(new Date()), -7)
    return Array.from({ length: 30 }, (_, i) => addDays(start, i * 7))
  }, [])

  const years = useMemo(() => {
    const set = new Set<number>()
    for (const w of weekStarts) {
      set.add(w.getFullYear())
      set.add(addDays(w, 6).getFullYear())
    }
    return Array.from(set)
  }, [weekStarts])

  const [countries, setCountries] = useState(FALLBACK_COUNTRIES)
  useEffect(() => {
    let cancelled = false
    fetch('https://date.nager.at/api/v3/AvailableCountries')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data) && data.length > 0) {
          setCountries(data)
        }
      })
      .catch(() => {
        /* varsayılan liste zaten yüklü */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const [holidays, setHolidays] = useState<{ date: string; name: string }[]>([])
  const [holidaysError, setHolidaysError] = useState(false)
  useEffect(() => {
    let cancelled = false
    setHolidaysError(false)
    Promise.all(
      years.map((y) =>
        fetch(`https://date.nager.at/api/v3/PublicHolidays/${y}/${country}`).then((r) =>
          r.ok ? r.json() : [],
        ),
      ),
    )
      .then((results) => {
        if (cancelled) return
        const all = results
          .flat()
          .map((h: any) => ({ date: h.date as string, name: h.localName as string }))
        setHolidays(all)
      })
      .catch(() => {
        if (!cancelled) setHolidaysError(true)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, years.join(',')])

  const holidaySet = useMemo(() => new Set(holidays.map((h) => h.date)), [holidays])
  const holidayNames = useMemo(() => new Map(holidays.map((h) => [h.date, h.name])), [holidays])

  type PressWeek = {
    weekStart: string
    days: { key: string; shifts: number; overtimeShifts: number }[]
  }
  const weeksData = (useQuery(
    api.pressCalendar.listWeeks,
    press ? { press } : 'skip',
  ) ?? []) as PressWeek[]
  const weeksByStart = useMemo(
    () => new Map(weeksData.map((w) => [w.weekStart, w])),
    [weeksData],
  )

  const visibleHolidays = useMemo(() => {
    const lastDate = isoDate(addDays(weekStarts[weekStarts.length - 1], 6))
    const firstDate = isoDate(weekStarts[0])
    return holidays
      .filter((h) => h.date >= firstDate && h.date <= lastDate)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [holidays, weekStarts])

  return (
    <section className="mt-6 rounded-lg border border-border p-5">
      <h2 className="font-semibold text-foreground">Pres Bazlı Detaylı Takvim</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Her pres için ayrı vardiya süresi, fazla mesai süresi ve 30 haftalık
        (bulunduğumuz haftadan 1 hafta öncesinden başlayan) çalışma takvimi
        tanımla. Resmi/dini tatiller seçtiğin ülkeye göre otomatik işaretlenir.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Pres</span>
          <select
            className="mt-1 w-48 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={press}
            onChange={(e) => setPress(e.target.value)}
          >
            {pressOptions.length === 0 && <option value="">— pres yok —</option>}
            {pressOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Yeni pres ekle</span>
            <input
              className="mt-1 w-40 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              placeholder="Pres adı"
              value={newPress}
              onChange={(e) => setNewPress(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addPress()
              }}
            />
          </label>
          <button
            onClick={addPress}
            disabled={!newPress.trim()}
            className="rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/70 disabled:opacity-50"
          >
            Ekle
          </button>
        </div>
      </div>

      {press && (
        <>
          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground">
                Normal vardiya süresi (dk)
              </span>
              <input
                type="number"
                className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                value={shiftMinutes}
                onChange={(e) => setShiftMinutes(Number(e.target.value) || 0)}
                onBlur={() => void persistSettings()}
              />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground">
                Fazla mesai vardiya süresi (dk)
              </span>
              <input
                type="number"
                className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                value={overtimeShiftMinutes}
                onChange={(e) => setOvertimeShiftMinutes(Number(e.target.value) || 0)}
                onBlur={() => void persistSettings()}
              />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground">Tatil ülkesi</span>
              <select
                className="mt-1 w-48 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value)
                  void saveSettings({
                    press,
                    shiftMinutes,
                    overtimeShiftMinutes,
                    country: e.target.value,
                  })
                }}
              >
                {countries.map((c) => (
                  <option key={c.countryCode} value={c.countryCode}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">Hafta</th>
                    {DAYS.map((d) => (
                      <th key={d.key} className="px-1 py-2 text-center font-medium">
                        {d.short}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weekStarts.map((monday) => (
                    <WeekRow
                      key={isoDate(monday)}
                      press={press}
                      monday={monday}
                      saved={weeksByStart.get(isoDate(monday))}
                      holidaySet={holidaySet}
                      holidayNames={holidayNames}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <aside className="rounded-md border border-border p-3">
              <h3 className="text-sm font-semibold text-foreground">
                {countries.find((c) => c.countryCode === country)?.name ?? country} — Resmi
                Tatiller
              </h3>
              {holidaysError && (
                <p className="mt-2 text-xs text-destructive">Tatil listesi yüklenemedi.</p>
              )}
              {!holidaysError && visibleHolidays.length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Görünen 30 haftalık aralıkta tatil bulunamadı.
                </p>
              )}
              <ul className="mt-2 space-y-1.5">
                {visibleHolidays.map((h) => (
                  <li
                    key={h.date}
                    className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-900"
                  >
                    <span className="font-medium">
                      {new Date(h.date).toLocaleDateString('tr-TR', {
                        day: '2-digit',
                        month: 'short',
                        weekday: 'short',
                      })}
                    </span>
                    <span className="block text-red-700">{h.name}</span>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </>
      )}
    </section>
  )
}

function WeekRow({
  press,
  monday,
  saved,
  holidaySet,
  holidayNames,
}: {
  press: string
  monday: Date
  saved: { days: { key: string; shifts: number; overtimeShifts: number }[] } | undefined
  holidaySet: Set<string>
  holidayNames: Map<string, string>
}) {
  const saveWeek = useMutation(api.pressCalendar.saveWeek)
  const weekStart = isoDate(monday)
  const weekDates = useMemo(() => DAYS.map((_, i) => addDays(monday, i)), [monday])

  const [days, setDays] = useState(() => saved?.days ?? defaultDays(weekDates, holidaySet))

  useEffect(() => {
    setDays(saved?.days ?? defaultDays(weekDates, holidaySet))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, weekStart])

  function updateDay(index: number, patch: Partial<{ shifts: number; overtimeShifts: number }>) {
    const next = days.map((d, i) => (i === index ? { ...d, ...patch } : d))
    setDays(next)
    void saveWeek({ press, weekStart, days: next })
  }

  const isCurrentWeek = weekStart === isoDate(mondayOf(new Date()))

  return (
    <tr className={`border-t border-border ${isCurrentWeek ? 'bg-primary/5' : ''}`}>
      <td className="whitespace-nowrap px-2 py-1.5 font-medium text-foreground">
        {formatWeekLabel(monday)}
      </td>
      {weekDates.map((date, i) => {
        const dateStr = isoDate(date)
        const isHoliday = holidaySet.has(dateStr)
        const day = days[i]
        return (
          <td
            key={dateStr}
            title={isHoliday ? holidayNames.get(dateStr) : undefined}
            className={`px-1 py-1 text-center ${
              isHoliday ? 'bg-red-100' : ''
            }`}
          >
            <div className="flex flex-col items-center gap-0.5">
              <select
                className="w-11 rounded border border-input bg-background px-0.5 py-0.5 text-[11px]"
                value={day.shifts}
                onChange={(e) => updateDay(i, { shifts: Number(e.target.value) })}
              >
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}V
                  </option>
                ))}
              </select>
              <select
                className="w-11 rounded border border-input bg-muted px-0.5 py-0.5 text-[11px] text-muted-foreground"
                value={day.overtimeShifts}
                onChange={(e) => updateDay(i, { overtimeShifts: Number(e.target.value) })}
              >
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}FM
                  </option>
                ))}
              </select>
            </div>
          </td>
        )
      })}
    </tr>
  )
}
