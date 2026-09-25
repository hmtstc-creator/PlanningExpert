import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, usePaginatedQuery, useQuery } from '../lib/convexTransport'
import { useEffect, useMemo, useState } from 'react'

import { DEFAULT_SAFETY_STOCK_DAYS } from '../lib/planPipeline'

import { api } from '../../convex/_generated/api'
import { addDays, isoDate, mondayOf } from '../lib/dates'
import { useSyncedFields } from '../lib/useSyncedFields'
import { CapacityGrid } from '../components/CapacityGrid'
import { UnsavedBar } from '../components/UnsavedBar'
import { PlannedStopsEditor, type StopRow } from '../components/PlannedStopsEditor'
import type { WeekPattern as GridPattern } from '../lib/capacityGrid'

export const Route = createFileRoute('/takvim')({
  component: TakvimPage,
})

const DAYS = [
  { key: 'MO', label: 'Monday', short: 'Mon' },
  { key: 'TU', label: 'Tuesday', short: 'Tue' },
  { key: 'WE', label: 'Wednesday', short: 'Wed' },
  { key: 'TH', label: 'Thursday', short: 'Thu' },
  { key: 'FR', label: 'Friday', short: 'Fri' },
  { key: 'SA', label: 'Saturday', short: 'Sat' },
  { key: 'SU', label: 'Sunday', short: 'Sun' },
]


const FALLBACK_COUNTRIES = [
  { countryCode: 'TR', name: 'Türkiye' },
  { countryCode: 'DE', name: 'Germany' },
  { countryCode: 'US', name: 'ABD' },
  { countryCode: 'GB', name: 'United Kingdom' },
  { countryCode: 'FR', name: 'France' },
  { countryCode: 'IT', name: 'Italy' },
  { countryCode: 'ES', name: 'Spain' },
  { countryCode: 'NL', name: 'Netherlands' },
  { countryCode: 'PL', name: 'Poland' },
  { countryCode: 'RO', name: 'Romania' },
]

function TakvimPage() {
  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Work Calendar</h1>
      <p className="mt-2 text-muted-foreground">
        Define when and how much the plant runs so planning stays realistic.
        Shifts run back to back from the start time — 07:00 with 8-hour shifts
        gives 07:00–15:00, 15:00–23:00 and 23:00–07:00. Shift length, working
        days and holidays are shared by all presses; each press then gets its
        own weekly pattern.
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

function formatWeekLabel(monday: Date): string {
  const sunday = addDays(monday, 6)
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
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
  const templatesQuery = useQuery(api.pressCalendar.listTemplates)
  const templatesList = templatesQuery ?? []
  const saveTemplateMutation = useMutation(api.pressCalendar.saveTemplate)
  const allOverrides = (useQuery(api.pressCalendar.listAllOverrides) ?? []) as {
    press: string
    weekStart: string
    workingDays: number
    shiftsPerDay: number
    overtimeShifts: number
  }[]
  const plannedStops = (useQuery(api.plannedStops.list) ?? []) as StopRow[]
  const saveOverrideForGrid = useMutation(api.pressCalendar.saveOverride)
  const clearOverrideForGrid = useMutation(api.pressCalendar.clearOverride)

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
  // Auto-save is silent by design, but without any feedback the user cannot
  // tell whether a setting actually reached the server.
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [savingAll, setSavingAll] = useState(false)

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
  const [country, setCountry] = useState('RO')
  const [setupGapMinutes, setSetupGapMinutes] = useState(10)
  // Fabrika geneli setup sınırları ve öne çekme (planlamacıyla netleşen kurallar).
  const [maxSetupsPlantWideNormal, setMaxSetupsPlantWideNormal] = useState(1)
  const [maxSetupsPlantWide, setMaxSetupsPlantWide] = useState(2)
  const [setupsCrossShifts, setSetupsCrossShifts] = useState(true)
  const [pullForwardDays, setPullForwardDays] = useState(10)
  const [coilSetupGapMinutes, setCoilSetupGapMinutes] = useState(30)
  const [concurrentSetupsPerHall, setConcurrentSetupsPerHall] = useState(1)
  const [shiftStartMinute, setShiftStartMinute] = useState(420) // 07:00
  const [planningHorizonWeeks, setPlanningHorizonWeeks] = useState(4)
  const [breakMinutesPerShift, setBreakMinutesPerShift] = useState(0)
  // Planın ilk kaç günü dondurulsun — presin kendi değeri yoksa bu geçerli.
  const [frozenDays, setFrozenDays] = useState(0)
  // Emniyet stoğu (iş günü): sonraki lot stok bitmeden bu kadar önce başlar.
  const [safetyStockDays, setSafetyStockDays] = useState(DEFAULT_SAFETY_STOCK_DAYS)
  // Sunucu değerlerini forma yalnızca sunucuda değiştiklerinde yansıt.
  // Aksi halde sorgu her tazelendiğinde kullanıcının yazdığı değer siliniyor.
  useSyncedFields(
    globalSettings
      ? {
          shiftMinutes: globalSettings.shiftMinutes,
          overtimeShiftMinutes: globalSettings.overtimeShiftMinutes,
          country: globalSettings.country,
          setupGapMinutes: globalSettings.setupGapMinutes ?? 10,
          coilSetupGapMinutes: globalSettings.coilSetupGapMinutes ?? 30,
          concurrentSetupsPerHall: globalSettings.concurrentSetupsPerHall ?? 1,
          shiftStartMinute: globalSettings.shiftStartMinute ?? 420,
          planningHorizonWeeks: globalSettings.planningHorizonWeeks ?? 4,
          breakMinutesPerShift: globalSettings.breakMinutesPerShift ?? 0,
          frozenDays: globalSettings.frozenDays ?? 0,
          safetyStockDays: globalSettings.safetyStockDays ?? DEFAULT_SAFETY_STOCK_DAYS,
          maxSetupsPlantWideNormal: globalSettings.maxSetupsPlantWideNormal ?? 1,
          maxSetupsPlantWide: globalSettings.maxSetupsPlantWide ?? 2,
          setupsCrossShifts: globalSettings.setupsCrossShifts ?? true,
          pullForwardDays: globalSettings.pullForwardDays ?? 10,
        }
      : undefined,
    {
      shiftMinutes: setShiftMinutes,
      overtimeShiftMinutes: setOvertimeShiftMinutes,
      country: setCountry,
      setupGapMinutes: setSetupGapMinutes,
      coilSetupGapMinutes: setCoilSetupGapMinutes,
      concurrentSetupsPerHall: setConcurrentSetupsPerHall,
      shiftStartMinute: setShiftStartMinute,
      planningHorizonWeeks: setPlanningHorizonWeeks,
      breakMinutesPerShift: setBreakMinutesPerShift,
      frozenDays: setFrozenDays,
      safetyStockDays: setSafetyStockDays,
      maxSetupsPlantWideNormal: setMaxSetupsPlantWideNormal,
      maxSetupsPlantWide: setMaxSetupsPlantWide,
      setupsCrossShifts: setSetupsCrossShifts,
      pullForwardDays: setPullForwardDays,
    },
  )

  async function persistGlobalSettings(
    next?: Partial<{
      shiftMinutes: number
      overtimeShiftMinutes: number
      country: string
      setupGapMinutes: number
      coilSetupGapMinutes: number
      concurrentSetupsPerHall: number
      shiftStartMinute: number
      planningHorizonWeeks: number
      breakMinutesPerShift: number
      frozenDays: number
      safetyStockDays: number
      maxSetupsPlantWideNormal: number
      maxSetupsPlantWide: number
      setupsCrossShifts: boolean
      pullForwardDays: number
    }>,
  ) {
    await saveGlobalSettingsMutation({
      shiftMinutes: next?.shiftMinutes ?? shiftMinutes,
      overtimeShiftMinutes: next?.overtimeShiftMinutes ?? overtimeShiftMinutes,
      country: next?.country ?? country,
      setupGapMinutes: next?.setupGapMinutes ?? setupGapMinutes,
      coilSetupGapMinutes: next?.coilSetupGapMinutes ?? coilSetupGapMinutes,
      concurrentSetupsPerHall: next?.concurrentSetupsPerHall ?? concurrentSetupsPerHall,
      shiftStartMinute: next?.shiftStartMinute ?? shiftStartMinute,
      planningHorizonWeeks: next?.planningHorizonWeeks ?? planningHorizonWeeks,
      breakMinutesPerShift: next?.breakMinutesPerShift ?? breakMinutesPerShift,
      frozenDays: next?.frozenDays ?? frozenDays,
      safetyStockDays: next?.safetyStockDays ?? safetyStockDays,
      maxSetupsPlantWideNormal: next?.maxSetupsPlantWideNormal ?? maxSetupsPlantWideNormal,
      maxSetupsPlantWide: next?.maxSetupsPlantWide ?? maxSetupsPlantWide,
      setupsCrossShifts: next?.setupsCrossShifts ?? setupsCrossShifts,
      pullForwardDays: next?.pullForwardDays ?? pullForwardDays,
      capacityFactor: globalSettings?.capacityFactor,
    })
    setSavedAt(new Date().toLocaleTimeString('en-GB'))
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
    setSavedAt(new Date().toLocaleTimeString('en-GB'))
  }

  function toggleWorkingDay(key: string) {
    const next = workingDayKeys.includes(key)
      ? workingDayKeys.filter((d) => d !== key)
      : [...workingDayKeys, key]
    // Hafta sırası korunsun ki planlama günleri doğru sırada değerlendirsin.
    const ordered = DAYS.map((d) => d.key).filter((k) => next.includes(k))
    setWorkingDayKeys(ordered)
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
  }

  // Ekrandaki değer sunucudakinden farklıysa kaydedilmemiş demektir.
  // Kullanıcı "kaydettim mi?" diye tahmin etmek zorunda kalmamalı.
  const settingsDirty =
    !!globalSettings &&
    (globalSettings.shiftMinutes !== shiftMinutes ||
      globalSettings.overtimeShiftMinutes !== overtimeShiftMinutes ||
      globalSettings.country !== country ||
      (globalSettings.setupGapMinutes ?? 10) !== setupGapMinutes ||
      (globalSettings.coilSetupGapMinutes ?? 30) !== coilSetupGapMinutes ||
      (globalSettings.concurrentSetupsPerHall ?? 1) !== concurrentSetupsPerHall ||
      (globalSettings.shiftStartMinute ?? 420) !== shiftStartMinute ||
      (globalSettings.planningHorizonWeeks ?? 4) !== planningHorizonWeeks ||
      (globalSettings.frozenDays ?? 0) !== frozenDays ||
      (globalSettings.safetyStockDays ?? DEFAULT_SAFETY_STOCK_DAYS) !== safetyStockDays ||
      (globalSettings.maxSetupsPlantWideNormal ?? 1) !== maxSetupsPlantWideNormal ||
      (globalSettings.maxSetupsPlantWide ?? 2) !== maxSetupsPlantWide ||
      (globalSettings.setupsCrossShifts ?? true) !== setupsCrossShifts ||
      (globalSettings.pullForwardDays ?? 10) !== pullForwardDays)

  const calendarDirty =
    !!globalCalendar &&
    (globalCalendar.workingDays.join(',') !== workingDayKeys.join(',') ||
      globalCalendar.holidays.join(',') !== manualHolidays.join(','))

  // `undefined` sorgunun henüz yüklenmediği, `null` kaydın hiç olmadığı
  // anlamına gelir. Yüklenirken "kaydedilmemiş" demek yanlış olur; kayıt hiç
  // yoksa gerçekten kaydedilmemiştir — Overview o zaman "no work calendar
  // defined" diyor.
  const sharedDirty =
    (globalSettings !== undefined && (globalSettings === null || settingsDirty)) ||
    (globalCalendar !== undefined && (globalCalendar === null || calendarDirty))

  const templateDirty =
    !!press &&
    templatesQuery !== undefined &&
    (!template ||
      template.workingDays !== workingDays ||
      template.shiftsPerDay !== shiftsPerDay ||
      template.overtimeShifts !== overtimeShifts)

  /** Kaydedilmemiş düzenlemeleri atıp sunucudaki hâle döner. */
  function discardSharedSettings() {
    if (globalSettings) {
      setShiftMinutes(globalSettings.shiftMinutes)
      setOvertimeShiftMinutes(globalSettings.overtimeShiftMinutes)
      setCountry(globalSettings.country)
      setSetupGapMinutes(globalSettings.setupGapMinutes ?? 10)
      setCoilSetupGapMinutes(globalSettings.coilSetupGapMinutes ?? 30)
      setConcurrentSetupsPerHall(globalSettings.concurrentSetupsPerHall ?? 1)
      setShiftStartMinute(globalSettings.shiftStartMinute ?? 420)
      setPlanningHorizonWeeks(globalSettings.planningHorizonWeeks ?? 4)
      setFrozenDays(globalSettings.frozenDays ?? 0)
      setSafetyStockDays(globalSettings.safetyStockDays ?? DEFAULT_SAFETY_STOCK_DAYS)
      setMaxSetupsPlantWideNormal(globalSettings.maxSetupsPlantWideNormal ?? 1)
      setMaxSetupsPlantWide(globalSettings.maxSetupsPlantWide ?? 2)
      setSetupsCrossShifts(globalSettings.setupsCrossShifts ?? true)
      setPullForwardDays(globalSettings.pullForwardDays ?? 10)
    }
    if (globalCalendar) {
      setWorkingDayKeys(globalCalendar.workingDays)
      setManualHolidays(globalCalendar.holidays)
    }
    if (template) {
      setWorkingDays(template.workingDays)
      setShiftsPerDay(template.shiftsPerDay)
      setOvertimeShifts(template.overtimeShifts)
    }
  }

  /**
   * Paylaşılan ayarları, çalışma takvimini ve seçili presin haftalık
   * şablonunu tek seferde yazar. Kullanıcının hiç dokunmadığı bir ayar da
   * (tipik olarak Pazartesi–Cuma çalışma günleri) böylece kaydedilir; aksi
   * halde Overview sayfası "no work calendar defined" demeye devam eder.
   */
  async function saveEverything() {
    setSavingAll(true)
    try {
      await persistGlobalSettings()
      await persistWorkCalendar()
      if (press) await saveTemplate()
    } finally {
      setSavingAll(false)
    }
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-foreground">Per-press Calendar</h2>
        <div className="flex items-center gap-3">
          {sharedDirty ? (
            <span className="text-sm font-medium text-amber-700">● Unsaved changes</span>
          ) : savedAt ? (
            <span className="text-sm text-emerald-600">Saved ✓ {savedAt}</span>
          ) : (
            <span className="text-sm text-muted-foreground">Saved</span>
          )}
          <button
            onClick={() => void saveEverything()}
            disabled={savingAll}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {savingAll ? 'Saving…' : 'Save all settings'}
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Define each press's standard weekly pattern (how many days, how many
        shifts per day, how many overtime shifts). The 30-week calendar applies
        that standard automatically and rolls forward on its own. If a specific
        week differs, edit and save just that week. Nothing in this block is
        written until you press Save — an edited field is marked Unsaved.
      </p>

      <UnsavedBar
        count={(sharedDirty ? 1 : 0) + (templateDirty ? 1 : 0)}
        saving={savingAll}
        noun="section"
        onSaveAll={() => void saveEverything()}
        onDiscard={discardSharedSettings}
      />

      <div className="mt-4">
        <PlannedStopsEditor
          stops={plannedStops}
          shiftCount={3}
          shiftStartMinute={shiftStartMinute}
          shiftMinutes={shiftMinutes}
          addStop={api.plannedStops.add}
          updateStop={api.plannedStops.update}
          removeStop={api.plannedStops.remove}
        />
      </div>

      <div className="mt-4">
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          Capacity overview — all presses, all weeks
        </h3>
        <CapacityGrid
          presses={definedPresses}
          templates={
            new Map(
              templatesList.map((t) => [
                t.press,
                {
                  workingDays: t.workingDays,
                  shiftsPerDay: t.shiftsPerDay,
                  overtimeShifts: t.overtimeShifts,
                } as GridPattern,
              ]),
            )
          }
          overrides={
            new Map(
              allOverrides.map((o) => [
                `${o.press}|${o.weekStart}`,
                {
                  workingDays: o.workingDays,
                  shiftsPerDay: o.shiftsPerDay,
                  overtimeShifts: o.overtimeShifts,
                } as GridPattern,
              ]),
            )
          }
          weekStarts={weekStarts}
          holidays={new Set([...holidaySet, ...manualHolidays])}
          workingDayKeys={workingDayKeys}
          shiftMinutes={shiftMinutes}
          overtimeShiftMinutes={overtimeShiftMinutes}
          defaultPattern={{
            workingDays: workingDayKeys.length,
            shiftsPerDay: 1,
            overtimeShifts: 0,
          }}
          onSaveOverride={(press, weekStart, pattern) =>
            saveOverrideForGrid({ press, weekStart, ...pattern })
          }
          onClearOverride={(press, weekStart) => clearOverrideForGrid({ press, weekStart })}
        />
      </div>

      <div className="mt-4 rounded-md border border-border p-3">
        <h3 className="text-xs font-medium text-muted-foreground">
          Working days — normal shifts are only placed on these days
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
          Overtime shifts may also fall outside these days (e.g. Saturday).
        </p>

        <h3 className="mt-4 text-xs font-medium text-muted-foreground">
          Manual holiday / shutdown day
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Public holidays arrive automatically from the country selected below.
          Add only plant-specific shutdowns here (e.g. annual maintenance).
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
            }}
            disabled={!newHoliday}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {manualHolidays.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {manualHolidays.map((h) => (
              <span
                key={h}
                className="flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm text-foreground"
              >
                {new Date(h).toLocaleDateString('en-GB')}
                <button
                  className="text-destructive"
                  onClick={() => {
                    setManualHolidays(manualHolidays.filter((d) => d !== h))
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
            Shift length (min) — shared by all presses
          </span>
          <input
            type="number"
            className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={shiftMinutes}
            onChange={(e) => setShiftMinutes(Number(e.target.value) || 0)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">
            Overtime shift length (min) — shared by all presses
          </span>
          <input
            type="number"
            className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={overtimeShiftMinutes}
            onChange={(e) => setOvertimeShiftMinutes(Number(e.target.value) || 0)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">
            Planning horizon (weeks)
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
              setPlanningHorizonWeeks(
                Math.min(30, Math.max(1, Math.round(planningHorizonWeeks) || 4)),
              )
            }}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">
            1st shift starts at
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
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Holiday country</span>
          <select
            className="mt-1 w-48 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={country}
            onChange={(e) => {
              setCountry(e.target.value)
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
            Min. gap between setups (min)
          </span>
          <input
            type="number"
            min={0}
            className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={setupGapMinutes}
            onChange={(e) => setSetupGapMinutes(Number(e.target.value) || 0)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">
            Min. gap between coil changes (min)
          </span>
          <input
            type="number"
            min={0}
            className="mt-1 w-28 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={coilSetupGapMinutes}
            onChange={(e) => setCoilSetupGapMinutes(Number(e.target.value))}
            onBlur={() =>
              setCoilSetupGapMinutes(Math.max(0, Math.round(coilSetupGapMinutes) || 0))
            }
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">
            Frozen days (0 = off)
          </span>
          <input
            type="number"
            min={0}
            max={14}
            className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={frozenDays}
            onChange={(e) => setFrozenDays(Number(e.target.value) || 0)}
            onBlur={() => setFrozenDays(Math.min(14, Math.max(0, Math.round(frozenDays) || 0)))}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">
            Safety stock (working days)
          </span>
          <input
            type="number"
            min={0}
            max={20}
            className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={safetyStockDays}
            onChange={(e) => setSafetyStockDays(Number(e.target.value) || 0)}
            onBlur={() =>
              setSafetyStockDays(Math.min(20, Math.max(0, Math.round(safetyStockDays) || 0)))
            }
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">
            Concurrent setups per hall
          </span>
          <input
            type="number"
            min={1}
            className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={concurrentSetupsPerHall}
            onChange={(e) => setConcurrentSetupsPerHall(Number(e.target.value) || 1)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">
            Setups at once in the plant (normal)
          </span>
          <input
            type="number"
            min={1}
            className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={maxSetupsPlantWideNormal}
            onChange={(e) => setMaxSetupsPlantWideNormal(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">
            Setups at once with backlog / late risk
          </span>
          <input
            type="number"
            min={1}
            className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={maxSetupsPlantWide}
            onChange={(e) => setMaxSetupsPlantWide(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Pull work forward (days)</span>
          <input
            type="number"
            min={0}
            max={60}
            className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={pullForwardDays}
            onChange={(e) => setPullForwardDays(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
          />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            checked={setupsCrossShifts}
            onChange={(e) => setSetupsCrossShifts(e.target.checked)}
          />
          <span className="text-xs text-muted-foreground">Setups may run over a shift change</span>
        </label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Frozen days: the first {frozenDays} day(s) of the plan are taken from
        the approved plan instead of being recalculated, so the shop floor's
        preparation is not disturbed. A press can override this on the Press
        Definitions page. 0 turns it off.{' '}
        Safety stock: the next lot of a part may start {safetyStockDays} working
        day(s) before its projected stock runs out — not earlier, so stock does
        not pile up.{' '}
        Crane constraint: presses in the same hall can run at most{' '}
        {concurrentSetupsPerHall} setup(s) at a time, with at least{' '}
        {setupGapMinutes} min between consecutive mould setups and{' '}
        {coilSetupGapMinutes} min between coil changes. A mould setup and a coil
        change can follow each other immediately but never overlap. Hall
        definitions come from the Press Definitions page.{' '}
        Plant-wide: without backlog at most {maxSetupsPlantWideNormal} mould setup(s) run at the
        same time anywhere in the plant; for backlog or a job that would otherwise be late up to{' '}
        {maxSetupsPlantWide} may overlap, so production starts sooner.{' '}
        {setupsCrossShifts
          ? 'A setup may start near the end of a shift and be finished by the next shift.'
          : 'A setup must finish within the shift it starts in.'}{' '}
        Pull forward: when a press would stand idle, work of the coming weeks may start up to{' '}
        {pullForwardDays} day(s) before it is needed; if nothing is urgent the die already
        mounted keeps running first, so no extra setup is made.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Press</span>
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
          To add presses or define halls, use{' '}
          <Link to="/makineler" className="font-medium underline">
            Press Definitions
          </Link>{' '}
          .
        </p>
      </div>

      {press && (
        <>
          <div className="mt-4 rounded-md border border-border p-3">
            <p className="text-sm font-medium text-foreground">Standard weekly pattern</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="block text-xs text-muted-foreground">Normal working days</span>
                <input
                  type="number"
                  min={0}
                  max={7}
                  className="mt-1 w-24 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  value={workingDays}
                  onChange={(e) => setWorkingDays(Number(e.target.value) || 0)}
                />
              </label>

              <div className="text-sm">
                <span className="block text-xs text-muted-foreground">
                  Shifts per normal working day
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
                  />
                </div>
              </div>

              <label className="text-sm">
                <span className="block text-xs text-muted-foreground">
                  Overtime shifts per week
                </span>
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-24 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  value={overtimeShifts}
                  onChange={(e) => setOvertimeShifts(Number(e.target.value) || 0)}
                />
              </label>

              <button
                onClick={() => void saveTemplate()}
                disabled={!templateDirty}
                className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-40"
              >
                Save press pattern
              </button>
              {templateDirty && (
                <span className="pb-2 text-xs font-medium text-amber-700">● Unsaved</span>
              )}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Total: <strong className="text-foreground">{templateTotalShifts} shifts</strong>{' '}
              · <strong className="text-foreground">{templateTotalHours.toFixed(1)} h</strong>
              /week ({workingDays} days × {shiftsPerDay} shifts + {overtimeShifts} overtime
              shifts)
            </p>
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Week-by-week detail for {press} (the grid above covers all presses)
            </summary>
          <div className="mt-2 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">Week</th>
                    <th className="px-2 py-2 text-center font-medium">Normal days</th>
                    <th className="px-2 py-2 text-center font-medium">Shifts/day</th>
                    <th className="px-2 py-2 text-center font-medium">Overtime shifts</th>
                    <th className="px-2 py-2 text-center font-medium">Total shifts</th>
                    <th className="px-2 py-2 text-center font-medium">Total hours</th>
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
                Holidays
              </h3>
              {holidaysError && (
                <p className="mt-2 text-xs text-destructive">Could not load the holiday list.</p>
              )}
              {!holidaysError && visibleHolidays.length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  No holidays found in the visible 30-week range.
                </p>
              )}
              <ul className="mt-2 space-y-1.5">
                {visibleHolidays.map((h) => (
                  <li
                    key={h.date}
                    className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-900"
                  >
                    <span className="font-medium">
                      {new Date(h.date).toLocaleDateString('en-GB', {
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
          </details>
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
            custom
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
              Save
            </button>
            <button
              onClick={() => {
                setDraft(effective)
                setEditing(false)
              }}
              className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground hover:bg-muted/70"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex justify-end gap-1">
            <button
              onClick={() => setEditing(true)}
              className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground hover:bg-muted/70"
            >
              Edit
            </button>
            {isOverridden && (
              <button
                onClick={() => void handleRevert()}
                className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground hover:bg-muted/70"
              >
                Reset to template
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}
