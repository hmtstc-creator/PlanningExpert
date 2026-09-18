import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, usePaginatedQuery, useQuery } from '../lib/convexTransport'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { useSyncedFields } from '../lib/useSyncedFields'

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
  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground">Çalışma Takvimi</h1>
      <p className="mt-2 text-muted-foreground">
        Planlamanın gerçekçi olması için fabrikanın ne zaman ve ne kadar
        çalıştığını tanımla. Vardiya süresi, çalışma günleri ve tatiller tüm
        presler için ortaktır; her presin haftalık düzeni ayrıca tanımlanır.
      </p>

      <PressCalendarSection />
    </div>
  )
}

// ---- Pres bazlı detaylı takvim -------------------------------------------

interface WeekPattern {
  workingDays: number
  shiftsPerDay: number
  overtimeShifts: number
}

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

function totalShifts(p: WeekPattern) {
  return p.workingDays * p.shiftsPerDay + p.overtimeShifts
}

function totalMinutes(p: WeekPattern, shiftMinutes: number, overtimeShiftMinutes: number) {
  return p.workingDays * p.shiftsPerDay * shiftMinutes + p.overtimeShifts * overtimeShiftMinutes
}

function PressCalendarSection() {
  const { results: products } = usePaginatedQuery(
    api.products.list,
    {},
    { initialNumItems: 500 },
  )
  const globalCalendar = useQuery(api.workCalendar.get)
  const saveWorkCalendar = useMutation(api.workCalendar.save)
  const globalSettings = useQuery(api.pressCalendar.getGlobalSettings)
  const saveGlobalSettingsMutation = useMutation(api.pressCalendar.saveGlobalSettings)
  const templatesList = useQuery(api.pressCalendar.listTemplates) ?? []
  const saveTemplateMutation = useMutation(api.pressCalendar.saveTemplate)

  // Pres listesi artık kalıcı `presses` tablosundan gelir (Makine Tanımları
  // sayfası). Referanslarda geçen ama tanımlanmamış presler de listelenir ki
  // takvim tanımlanabilsin.
  const definedPresses = (useQuery(api.presses.list) ?? []) as { name: string; hall: string }[]

  const pressOptions = useMemo(() => {
    const set = new Set<string>()
    for (const p of definedPresses) set.add(p.name)
    for (const p of products) {
      for (const m of [p.mainMachine, p.altMachine1, p.altMachine2, p.altMachine3, p.altMachine4]) {
        if (m && m.trim()) set.add(m.trim())
      }
    }
    for (const t of templatesList) set.add(t.press)
    return Array.from(set).sort()
  }, [definedPresses, products, templatesList])

  // Çalışma günleri ve elle girilen tatiller planlama motorunun doğrudan
  // okuduğu ayarlardır: hangi günlere normal vardiya konabileceğini ve
  // hangi günlerin kapasitesinin sıfırlanacağını belirler.
  const [workingDayKeys, setWorkingDayKeys] = useState<string[]>([
    'MO',
    'TU',
    'WE',
    'TH',
    'FR',
  ])
  const [manualHolidays, setManualHolidays] = useState<string[]>([])
  const [newHoliday, setNewHoliday] = useState('')

  const [press, setPress] = useState('')

  useEffect(() => {
    if (!press && pressOptions.length > 0) setPress(pressOptions[0])
  }, [press, pressOptions])

  const hallOfPress = useMemo(
    () => new Map(definedPresses.map((p) => [p.name, p.hall])),
    [definedPresses],
  )

  // Vardiya süresi (dk) tüm presler için ortaktır.
  const [shiftMinutes, setShiftMinutes] = useState(480)
  const [overtimeShiftMinutes, setOvertimeShiftMinutes] = useState(480)
  const [country, setCountry] = useState('TR')
  const [setupGapMinutes, setSetupGapMinutes] = useState(60)
  const [concurrentSetupsPerHall, setConcurrentSetupsPerHall] = useState(1)
  const [shiftStartMinute, setShiftStartMinute] = useState(480)
  const [planningHorizonWeeks, setPlanningHorizonWeeks] = useState(4)
  const [breakMinutesPerShift, setBreakMinutesPerShift] = useState(0)
  // Sunucu değerlerini forma yalnızca sunucuda değiştiklerinde yansıt.
  // Aksi halde sorgu her tazelendiğinde kullanıcının yazdığı değer siliniyor.
  useSyncedFields(
    globalSettings
      ? {
          shiftMinutes: globalSettings.shiftMinutes,
          overtimeShiftMinutes: globalSettings.overtimeShiftMinutes,
          country: globalSettings.country,
          setupGapMinutes: globalSettings.setupGapMinutes ?? 60,
          concurrentSetupsPerHall: globalSettings.concurrentSetupsPerHall ?? 1,
          shiftStartMinute: globalSettings.shiftStartMinute ?? 480,
          planningHorizonWeeks: globalSettings.planningHorizonWeeks ?? 4,
          breakMinutesPerShift: globalSettings.breakMinutesPerShift ?? 0,
        }
      : undefined,
    {
      shiftMinutes: setShiftMinutes,
      overtimeShiftMinutes: setOvertimeShiftMinutes,
      country: setCountry,
      setupGapMinutes: setSetupGapMinutes,
      concurrentSetupsPerHall: setConcurrentSetupsPerHall,
      shiftStartMinute: setShiftStartMinute,
      planningHorizonWeeks: setPlanningHorizonWeeks,
      breakMinutesPerShift: setBreakMinutesPerShift,
    },
  )

  async function persistGlobalSettings(
    next?: Partial<{
      shiftMinutes: number
      overtimeShiftMinutes: number
      country: string
      setupGapMinutes: number
      concurrentSetupsPerHall: number
      shiftStartMinute: number
      planningHorizonWeeks: number
      breakMinutesPerShift: number
    }>,
  ) {
    await saveGlobalSettingsMutation({
      shiftMinutes: next?.shiftMinutes ?? shiftMinutes,
      overtimeShiftMinutes: next?.overtimeShiftMinutes ?? overtimeShiftMinutes,
      country: next?.country ?? country,
      setupGapMinutes: next?.setupGapMinutes ?? setupGapMinutes,
      concurrentSetupsPerHall: next?.concurrentSetupsPerHall ?? concurrentSetupsPerHall,
      shiftStartMinute: next?.shiftStartMinute ?? shiftStartMinute,
      planningHorizonWeeks: next?.planningHorizonWeeks ?? planningHorizonWeeks,
      breakMinutesPerShift: next?.breakMinutesPerShift ?? breakMinutesPerShift,
      capacityFactor: globalSettings?.capacityFactor,
    })
  }

  useSyncedFields(
    globalCalendar
      ? {
          workingDays: globalCalendar.workingDays.join(','),
          holidays: globalCalendar.holidays.join(','),
        }
      : undefined,
    {
      workingDays: (v: string) => setWorkingDayKeys(v === '' ? [] : v.split(',')),
      holidays: (v: string) => setManualHolidays(v === '' ? [] : v.split(',')),
    },
  )

  async function persistWorkCalendar(next?: {
    workingDays?: string[]
    holidays?: string[]
  }) {
    await saveWorkCalendar({
      // Günlük süre artık vardiya ayarlarından gelir; kayıt tutarlı kalsın
      // diye aynı değer yazılır.
      shiftMinutesPerDay: shiftMinutes,
      workingDays: next?.workingDays ?? workingDayKeys,
      holidays: next?.holidays ?? manualHolidays,
    })
  }

  function toggleWorkingDay(key: string) {
    const next = workingDayKeys.includes(key)
      ? workingDayKeys.filter((d) => d !== key)
      : [...workingDayKeys, key]
    // Hafta sırası korunsun ki planlama günleri doğru sırada değerlendirsin.
    const ordered = DAYS.map((d) => d.key).filter((k) => next.includes(k))
    setWorkingDayKeys(ordered)
    void persistWorkCalendar({ workingDays: ordered })
  }

  const template = templatesList.find((t) => t.press === press)
  const defaultWorkingDays = globalCalendar?.workingDays.length ?? 5

  const [workingDays, setWorkingDays] = useState(defaultWorkingDays)
  const [shiftsPerDay, setShiftsPerDay] = useState(1)
  const [overtimeShifts, setOvertimeShifts] = useState(0)

  useSyncedFields(
    template
      ? {
          workingDays: template.workingDays,
          shiftsPerDay: template.shiftsPerDay,
          overtimeShifts: template.overtimeShifts,
        }
      : undefined,
    {
      workingDays: setWorkingDays,
      shiftsPerDay: setShiftsPerDay,
      overtimeShifts: setOvertimeShifts,
    },
  )

  async function saveTemplate(next?: Partial<WeekPattern>) {
    if (!press) return
    await saveTemplateMutation({
      press,
      workingDays: next?.workingDays ?? workingDays,
      shiftsPerDay: next?.shiftsPerDay ?? shiftsPerDay,
      overtimeShifts: next?.overtimeShifts ?? overtimeShifts,
    })
  }

  function pickShiftsPerDay(n: number) {
    setShiftsPerDay(n)
    void saveTemplate({ shiftsPerDay: n })
  }

  const currentTemplate: WeekPattern = { workingDays, shiftsPerDay, overtimeShifts }
  const templateTotalShifts = totalShifts(currentTemplate)
  const templateTotalHours = totalMinutes(currentTemplate, shiftMinutes, overtimeShiftMinutes) / 60

  // 30 haftalık pencere: bulunduğumuz haftadan 1 hafta öncesinden başlar,
  // toplam 30 hafta. Her sayfa yüklendiğinde bugüne göre yeniden
  // hesaplanır, yani hafta ilerledikçe otomatik kayar.
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
  const replaceHolidayYear = useMutation(api.holidays.replaceYear)
  // Kayıtlı tatiller: internet erişimi olmasa da planlama bunları kullanır.
  const storedHolidays = (useQuery(api.holidays.listByCountry, { country }) ??
    []) as { date: string; name: string; year: number }[]

  useEffect(() => {
    let cancelled = false
    setHolidaysError(false)
    Promise.all(
      years.map((y) =>
        fetch(`https://date.nager.at/api/v3/PublicHolidays/${y}/${country}`)
          .then((r) => (r.ok ? r.json() : []))
          .then((data: any[]) => ({
            year: y,
            days: (Array.isArray(data) ? data : []).map((h: any) => ({
              date: h.date as string,
              name: h.localName as string,
            })),
          })),
      ),
    )
      .then(async (results) => {
        if (cancelled) return
        setHolidays(results.flatMap((r) => r.days))
        // Tatilleri veritabanına yaz — planlama motoru oradan okuyor.
        for (const r of results) {
          if (r.days.length === 0) continue
          await replaceHolidayYear({ country, year: r.year, days: r.days })
        }
      })
      .catch(() => {
        if (!cancelled) setHolidaysError(true)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, years.join(',')])

  // İnternetten çekilemediyse kayıtlı tatillerle devam et.
  useEffect(() => {
    if (holidays.length === 0 && storedHolidays.length > 0) {
      setHolidays(storedHolidays.map((h) => ({ date: h.date, name: h.name })))
    }
  }, [holidays.length, storedHolidays])

  const holidaySet = useMemo(() => new Set(holidays.map((h) => h.date)), [holidays])

  const visibleHolidays = useMemo(() => {
    const lastDate = isoDate(addDays(weekStarts[weekStarts.length - 1], 6))
    const firstDate = isoDate(weekStarts[0])
    return holidays
      .filter((h) => h.date >= firstDate && h.date <= lastDate)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [holidays, weekStarts])

  type Override = WeekPattern & { weekStart: string }
  const overridesList = (useQuery(
    api.pressCalendar.listOverrides,
    press ? { press } : 'skip',
  ) ?? []) as Override[]
  const overridesByWeek = useMemo(
    () => new Map(overridesList.map((o) => [o.weekStart, o])),
    [overridesList],
  )

  return (
    <section className="mt-6 rounded-lg border border-border p-5">
      <h2 className="font-semibold text-foreground">Pres Bazlı Detaylı Takvim</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Vardiya süresi tüm presler için ortaktır. Her pres için haftalık
        standart çalışma düzenini (kaç gün, gün başına kaç vardiya, kaç fazla
        mesai vardiyası) tanımla — 30 haftalık takvim bu standardı otomatik
        uygular, hafta ilerledikçe elle yeniden girmen gerekmez. Belirli bir
        haftada plan değişirse o haftayı ayrıca düzenleyip kaydedebilirsin.
      </p>

      <div className="mt-4 rounded-md border border-border p-3">
        <h3 className="text-xs font-medium text-muted-foreground">
          Çalışma günleri — normal vardiyalar yalnızca bu günlere yerleşir
        </h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {DAYS.map((d) => {
            const active = workingDayKeys.includes(d.key)
            return (
              <button
                key={d.key}
                onClick={() => toggleWorkingDay(d.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
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
        <p className="mt-2 text-xs text-muted-foreground">
          Mesai vardiyaları bu günlerin dışına da yerleşebilir (ör. Cumartesi).
        </p>

        <h3 className="mt-4 text-xs font-medium text-muted-foreground">
          Elle tatil / duruş günü
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Resmi tatiller yukarıdaki ülke seçimine göre otomatik gelir. Buraya
          yalnızca fabrikaya özel duruşları ekle (ör. yıllık bakım kapanışı).
        </p>
        <div className="mt-2 flex gap-2">
          <input
            type="date"
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            value={newHoliday}
            onChange={(e) => setNewHoliday(e.target.value)}
          />
          <button
            onClick={() => {
              if (!newHoliday || manualHolidays.includes(newHoliday)) return
              const next = [...manualHolidays, newHoliday].sort()
              setManualHolidays(next)
              setNewHoliday('')
              void persistWorkCalendar({ holidays: next })
            }}
            disabled={!newHoliday}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Ekle
          </button>
        </div>
        {manualHolidays.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {manualHolidays.map((h) => (
              <span
                key={h}
                className="flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm text-foreground"
              >
                {new Date(h).toLocaleDateString('tr-TR')}
                <button
                  className="text-destructive"
                  onClick={() => {
                    const next = manualHolidays.filter((d) => d !== h)
                    setManualHolidays(next)
                    void persistWorkCalendar({ holidays: next })
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">
            Vardiya süresi (dk) — tüm presler için ortak
          </span>
          <input
            type="number"
            className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={shiftMinutes}
            onChange={(e) => setShiftMinutes(Number(e.target.value) || 0)}
            onBlur={() => void persistGlobalSettings()}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">
            Fazla mesai vardiya süresi (dk) — tüm presler için ortak
          </span>
          <input
            type="number"
            className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={overtimeShiftMinutes}
            onChange={(e) => setOvertimeShiftMinutes(Number(e.target.value) || 0)}
            onBlur={() => void persistGlobalSettings()}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">
            Vardiya başına mola/duruş (dk)
          </span>
          <input
            type="number"
            min={0}
            className="mt-1 w-28 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={breakMinutesPerShift}
            onChange={(e) => setBreakMinutesPerShift(Number(e.target.value))}
            onBlur={() => {
              const clamped = Math.max(0, Math.round(breakMinutesPerShift) || 0)
              setBreakMinutesPerShift(clamped)
              void persistGlobalSettings({ breakMinutesPerShift: clamped })
            }}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">
            Plan ufku (hafta)
          </span>
          <input
            type="number"
            min={1}
            max={30}
            className="mt-1 w-28 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={planningHorizonWeeks}
            onChange={(e) => setPlanningHorizonWeeks(Number(e.target.value))}
            onBlur={() => {
              // Kırpma yazarken değil, alandan çıkınca yapılır; aksi halde
              // kutuyu silip yeni sayı yazmak imkânsız hale geliyor.
              const clamped = Math.min(30, Math.max(1, Math.round(planningHorizonWeeks) || 4))
              setPlanningHorizonWeeks(clamped)
              void persistGlobalSettings({ planningHorizonWeeks: clamped })
            }}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">
            1. vardiya başlangıcı
          </span>
          <input
            type="time"
            className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={`${String(Math.floor(shiftStartMinute / 60)).padStart(2, '0')}:${String(
              shiftStartMinute % 60,
            ).padStart(2, '0')}`}
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number)
              if (Number.isFinite(h) && Number.isFinite(m)) {
                setShiftStartMinute(h * 60 + m)
              }
            }}
            onBlur={() => void persistGlobalSettings({ shiftStartMinute })}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Tatil ülkesi</span>
          <select
            className="mt-1 w-48 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={country}
            onChange={(e) => {
              setCountry(e.target.value)
              void persistGlobalSettings({ country: e.target.value })
            }}
          >
            {countries.map((c) => (
              <option key={c.countryCode} value={c.countryCode}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">
            Setuplar arası min. ara (dk)
          </span>
          <input
            type="number"
            min={0}
            className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={setupGapMinutes}
            onChange={(e) => setSetupGapMinutes(Number(e.target.value) || 0)}
            onBlur={() => void persistGlobalSettings()}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">
            Hol başına eşzamanlı setup
          </span>
          <input
            type="number"
            min={1}
            className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={concurrentSetupsPerHall}
            onChange={(e) => setConcurrentSetupsPerHall(Number(e.target.value) || 1)}
            onBlur={() => void persistGlobalSettings()}
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Vinç kısıtı: aynı holdeki presler aynı anda en fazla{' '}
        {concurrentSetupsPerHall} setup yapabilir ve ardışık setuplar arasında en
        az {setupGapMinutes} dk olmalıdır. Hol tanımları Makine Tanımları
        sayfasından gelir.
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
                {hallOfPress.get(p) ? ` · ${hallOfPress.get(p)}` : ''}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          Pres eklemek/hol tanımlamak için{' '}
          <Link to="/makineler" className="font-medium underline">
            Makine Tanımları
          </Link>{' '}
          sayfasını kullan.
        </p>
      </div>

      {press && (
        <>
          <div className="mt-4 rounded-md border border-border p-3">
            <p className="text-sm font-medium text-foreground">Standart haftalık düzen</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="block text-xs text-muted-foreground">Normal çalışma günü</span>
                <input
                  type="number"
                  min={0}
                  max={7}
                  className="mt-1 w-24 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  value={workingDays}
                  onChange={(e) => setWorkingDays(Number(e.target.value) || 0)}
                  onBlur={() => void saveTemplate()}
                />
              </label>

              <div className="text-sm">
                <span className="block text-xs text-muted-foreground">
                  Normal çalışma günü vardiya sayısı
                </span>
                <div className="mt-1 flex items-center gap-1">
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      onClick={() => pickShiftsPerDay(n)}
                      className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                        shiftsPerDay === n
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-muted/70'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <input
                    type="number"
                    min={0}
                    className="w-16 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    value={shiftsPerDay}
                    onChange={(e) => setShiftsPerDay(Number(e.target.value) || 0)}
                    onBlur={() => void saveTemplate()}
                  />
                </div>
              </div>

              <label className="text-sm">
                <span className="block text-xs text-muted-foreground">
                  Fazla mesai vardiya sayısı
                </span>
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-24 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  value={overtimeShifts}
                  onChange={(e) => setOvertimeShifts(Number(e.target.value) || 0)}
                  onBlur={() => void saveTemplate()}
                />
              </label>

              <button
                onClick={() => void saveTemplate()}
                className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
              >
                Pres Kaydet
              </button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Toplam: <strong className="text-foreground">{templateTotalShifts} vardiya</strong>{' '}
              · <strong className="text-foreground">{templateTotalHours.toFixed(1)} saat</strong>
              /hafta ({workingDays} gün × {shiftsPerDay} vardiya + {overtimeShifts} fazla mesai
              vardiyası)
            </p>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">Hafta</th>
                    <th className="px-2 py-2 text-center font-medium">Normal gün</th>
                    <th className="px-2 py-2 text-center font-medium">Vardiya/gün</th>
                    <th className="px-2 py-2 text-center font-medium">Fazla mesai vardiya</th>
                    <th className="px-2 py-2 text-center font-medium">Toplam vardiya</th>
                    <th className="px-2 py-2 text-center font-medium">Toplam saat</th>
                    <th className="px-2 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {weekStarts.map((monday) => (
                    <WeekRow
                      key={isoDate(monday)}
                      press={press}
                      monday={monday}
                      template={currentTemplate}
                      override={overridesByWeek.get(isoDate(monday))}
                      holidaySet={holidaySet}
                      shiftMinutes={shiftMinutes}
                      overtimeShiftMinutes={overtimeShiftMinutes}
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
  template,
  override,
  holidaySet,
  shiftMinutes,
  overtimeShiftMinutes,
}: {
  press: string
  monday: Date
  template: WeekPattern
  override: (WeekPattern & { weekStart: string }) | undefined
  holidaySet: Set<string>
  shiftMinutes: number
  overtimeShiftMinutes: number
}) {
  const saveOverrideMutation = useMutation(api.pressCalendar.saveOverride)
  const clearOverrideMutation = useMutation(api.pressCalendar.clearOverride)
  const weekStart = isoDate(monday)
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday])
  const weekHolidays = weekDates.filter((d) => holidaySet.has(isoDate(d)))

  const effective: WeekPattern = override ?? template
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<WeekPattern>(effective)

  useEffect(() => {
    if (!editing) setDraft(effective)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effective.workingDays, effective.shiftsPerDay, effective.overtimeShifts, editing])

  const isCurrentWeek = weekStart === isoDate(mondayOf(new Date()))
  const isOverridden = !!override

  async function handleSave() {
    await saveOverrideMutation({ press, weekStart, ...draft })
    setEditing(false)
  }

  async function handleRevert() {
    await clearOverrideMutation({ press, weekStart })
    setEditing(false)
  }

  const shown = editing ? draft : effective

  return (
    <tr
      className={`border-t border-border ${isCurrentWeek ? 'bg-primary/5' : ''} ${
        weekHolidays.length > 0 ? 'bg-red-50/50' : ''
      }`}
    >
      <td className="whitespace-nowrap px-2 py-1.5 font-medium text-foreground">
        {formatWeekLabel(monday)}
        {isOverridden && (
          <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
            özel
          </span>
        )}
        {weekHolidays.length > 0 && (
          <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">
            tatil ({weekHolidays.length})
          </span>
        )}
      </td>
      <td className="px-1 py-1 text-center">
        {editing ? (
          <input
            type="number"
            min={0}
            max={7}
            className="w-14 rounded border border-input bg-background px-1 py-0.5 text-center text-xs"
            value={draft.workingDays}
            onChange={(e) => setDraft((d) => ({ ...d, workingDays: Number(e.target.value) || 0 }))}
          />
        ) : (
          shown.workingDays
        )}
      </td>
      <td className="px-1 py-1 text-center">
        {editing ? (
          <input
            type="number"
            min={0}
            className="w-14 rounded border border-input bg-background px-1 py-0.5 text-center text-xs"
            value={draft.shiftsPerDay}
            onChange={(e) => setDraft((d) => ({ ...d, shiftsPerDay: Number(e.target.value) || 0 }))}
          />
        ) : (
          shown.shiftsPerDay
        )}
      </td>
      <td className="px-1 py-1 text-center">
        {editing ? (
          <input
            type="number"
            min={0}
            className="w-14 rounded border border-input bg-background px-1 py-0.5 text-center text-xs"
            value={draft.overtimeShifts}
            onChange={(e) => setDraft((d) => ({ ...d, overtimeShifts: Number(e.target.value) || 0 }))}
          />
        ) : (
          shown.overtimeShifts
        )}
      </td>
      <td className="px-1 py-1 text-center text-muted-foreground">{totalShifts(shown)}</td>
      <td className="px-1 py-1 text-center text-muted-foreground">
        {(totalMinutes(shown, shiftMinutes, overtimeShiftMinutes) / 60).toFixed(1)}
      </td>
      <td className="px-2 py-1 text-right">
        {editing ? (
          <div className="flex justify-end gap-1">
            <button
              onClick={() => void handleSave()}
              className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Kaydet
            </button>
            <button
              onClick={() => {
                setDraft(effective)
                setEditing(false)
              }}
              className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground hover:bg-muted/70"
            >
              Vazgeç
            </button>
          </div>
        ) : (
          <div className="flex justify-end gap-1">
            <button
              onClick={() => setEditing(true)}
              className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground hover:bg-muted/70"
            >
              Düzenle
            </button>
            {isOverridden && (
              <button
                onClick={() => void handleRevert()}
                className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground hover:bg-muted/70"
              >
                Şablona dön
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}
