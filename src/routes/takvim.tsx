import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, usePaginatedQuery, useQuery } from '../lib/convexTransport'
import { useEffect, useMemo, useState } from 'react'


import { api } from '../../convex/_generated/api'
import { addDays, isoDate, mondayOf } from '../lib/dates'
import { useSyncedFields } from '../lib/useSyncedFields'
import { CapacityGrid } from '../components/CapacityGrid'
import { UnsavedBar } from '../components/UnsavedBar'
import { CollapsibleSection } from '../components/CollapsibleSection'
import { InfoTip, PageHeader } from '../components/PageHeader'
import { relatedPages } from '../lib/navigation'
import { PlannedStopsEditor, type StopRow } from '../components/PlannedStopsEditor'
import type { WeekPattern as GridPattern } from '../lib/capacityGrid'
import { SETTINGS_DEFAULTS } from '../lib/settingsDefaults'
import { capacityModel, stopMinutesByShift } from '../lib/capacityModel'
import { weekTotalMinutes } from '../lib/planning'
import { patternProblem, serverErrorText } from '../lib/pressCalendar'
import {
  OvertimeEntryPanel,
  PressWeekDays,
  RecurringOvertimePanel,
  ShiftTable,
  useOvertimeData,
} from '../components/OvertimePanels'

export const Route = createFileRoute('/takvim')({
  component: TakvimPage,
})



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
      <PageHeader
        title="Work Calendar"
        summary="When each press runs."
        links={relatedPages('/takvim')}
        info={
          <>
            <p>
              Each press has one calendar: its weekly pattern (days from Monday, shifts per day),
              exception weeks and overtime. A public holiday is a day off — open overtime if the
              press should work.
            </p>
            <p>
              Open or delete overtime at the top; every section can be shown or hidden with its
              button. Overtime opened on the <Link to="/capacity">Capacity Dashboard</Link> is the
              same record.
            </p>
          </>
        }
      />

      <PressCalendarSection />
    </div>
  )
}

// ---- Pres bazlı detaylı takvim -------------------------------------------

interface WeekPattern {
  workingDays: number
  shiftsPerDay: number
}

function formatWeekLabel(monday: Date): string {
  const sunday = addDays(monday, 6)
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  return `${fmt(monday)} – ${fmt(sunday)} ${sunday.getFullYear()}`
}

/** Normal (mesaisiz) haftalık vardiya: mesai tarihli açılır, burada sayılmaz. */
function totalShifts(p: WeekPattern) {
  return Math.min(7, p.workingDays) * p.shiftsPerDay
}

/** Net haftalık dakika — planla aynı formül: planlı duruşlar düşülür. */
function totalMinutes(p: WeekPattern, shiftMinutes: number, overtimeShiftMinutes: number, stops: number[]) {
  return weekTotalMinutes(p, { shiftMinutes, overtimeShiftMinutes, stopMinutesByShift: stops })
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
  }[]
  const plannedStops = (useQuery(api.plannedStops.list) ?? []) as StopRow[]
  const stopsByShift = useMemo(() => stopMinutesByShift(plannedStops), [plannedStops])
  const saveOverrideForGrid = useMutation(api.pressCalendar.saveOverride)
  const clearOverrideForGrid = useMutation(api.pressCalendar.clearOverride)

  // Pres listesi artık kalıcı `presses` tablosundan gelir (Makine Tanımları
  // sayfası). Referanslarda geçen ama tanımlanmamış presler de listelenir ki
  // takvim tanımlanabilsin.
  const definedPresses = (useQuery(api.presses.list) ?? []) as { name: string; hall: string }[]

  // Pres listesinin tek kaynağı Press Definitions. Master data'da ya da eski
  // takvim kayıtlarında geçen ama tanımlı olmayan presler listeye girmez;
  // aşağıda uyarı olarak gösterilir.
  const pressOptions = useMemo(() => definedPresses.map((p) => p.name).sort(), [definedPresses])
  const undefinedPresses = useMemo(() => {
    const defined = new Set(definedPresses.map((p) => p.name))
    const usedBy = new Map<string, Set<string>>()
    for (const p of products) {
      for (const m of [p.mainMachine, p.altMachine1, p.altMachine2, p.altMachine3, p.altMachine4]) {
        const name = m?.trim()
        if (!name || defined.has(name)) continue
        usedBy.set(name, (usedBy.get(name) ?? new Set()).add(p.code))
      }
    }
    for (const t of templatesList) {
      if (!defined.has(t.press) && !usedBy.has(t.press)) usedBy.set(t.press, new Set())
    }
    return Array.from(usedBy.entries())
      .map(([name, parts]) => ({ name, parts: Array.from(parts).sort() }))
      .sort((a, b) => a.name.localeCompare(b.name))
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
  const [shiftMinutes, setShiftMinutes] = useState<number>(SETTINGS_DEFAULTS.shiftMinutes)
  const [overtimeShiftMinutes, setOvertimeShiftMinutes] = useState<number>(SETTINGS_DEFAULTS.overtimeShiftMinutes)
  const [country, setCountry] = useState<string>(SETTINGS_DEFAULTS.country)
  const [setupGapMinutes, setSetupGapMinutes] = useState<number>(SETTINGS_DEFAULTS.setupGapMinutes)
  // Fabrika geneli setup sınırları ve öne çekme (planlamacıyla netleşen kurallar).
  const [maxSetupsPlantWideNormal, setMaxSetupsPlantWideNormal] = useState<number>(SETTINGS_DEFAULTS.maxSetupsPlantWideNormal)
  const [maxSetupsPlantWide, setMaxSetupsPlantWide] = useState<number>(SETTINGS_DEFAULTS.maxSetupsPlantWide)
  const [setupsCrossShifts, setSetupsCrossShifts] = useState<boolean>(SETTINGS_DEFAULTS.setupsCrossShifts)
  const [pullForwardDays, setPullForwardDays] = useState<number>(SETTINGS_DEFAULTS.pullForwardDays)
  // Teslim saati ve senaryo araması.
  const [deliveryCutoffMinute, setDeliveryCutoffMinute] = useState<number>(SETTINGS_DEFAULTS.deliveryCutoffMinute)
  const [utilisationTarget, setUtilisationTarget] = useState<number>(SETTINGS_DEFAULTS.utilisationTarget)
  const [maxScenarios, setMaxScenarios] = useState<number>(SETTINGS_DEFAULTS.maxScenarios)
  const [coilSetupGapMinutes, setCoilSetupGapMinutes] = useState<number>(SETTINGS_DEFAULTS.coilSetupGapMinutes)
  const [concurrentSetupsPerHall, setConcurrentSetupsPerHall] = useState<number>(SETTINGS_DEFAULTS.concurrentSetupsPerHall)
  const [shiftStartMinute, setShiftStartMinute] = useState<number>(SETTINGS_DEFAULTS.shiftStartMinute) // 07:00
  const [planningHorizonWeeks, setPlanningHorizonWeeks] = useState<number>(SETTINGS_DEFAULTS.planningHorizonWeeks)
  const [breakMinutesPerShift, setBreakMinutesPerShift] = useState<number>(SETTINGS_DEFAULTS.breakMinutesPerShift)
  // Planın ilk kaç günü dondurulsun — presin kendi değeri yoksa bu geçerli.
  const [frozenDays, setFrozenDays] = useState<number>(SETTINGS_DEFAULTS.frozenDays)
  // Emniyet stoğu (iş günü): sonraki lot stok bitmeden bu kadar önce başlar.
  const [safetyStockDays, setSafetyStockDays] = useState<number>(SETTINGS_DEFAULTS.safetyStockDays)
  // Acil hammadde: ilk eksik iş bu kadar iş günü içindeyse Plan sayfasında.
  const [rawUrgentDays, setRawUrgentDays] = useState<number>(SETTINGS_DEFAULTS.rawUrgentDays)
  // Sunucu değerlerini forma yalnızca sunucuda değiştiklerinde yansıt.
  // Aksi halde sorgu her tazelendiğinde kullanıcının yazdığı değer siliniyor.
  useSyncedFields(
    globalSettings
      ? {
          shiftMinutes: globalSettings.shiftMinutes,
          overtimeShiftMinutes: globalSettings.overtimeShiftMinutes,
          country: globalSettings.country,
          setupGapMinutes: globalSettings.setupGapMinutes ?? SETTINGS_DEFAULTS.setupGapMinutes,
          coilSetupGapMinutes: globalSettings.coilSetupGapMinutes ?? SETTINGS_DEFAULTS.coilSetupGapMinutes,
          concurrentSetupsPerHall: globalSettings.concurrentSetupsPerHall ?? SETTINGS_DEFAULTS.concurrentSetupsPerHall,
          shiftStartMinute: globalSettings.shiftStartMinute ?? SETTINGS_DEFAULTS.shiftStartMinute,
          planningHorizonWeeks: globalSettings.planningHorizonWeeks ?? SETTINGS_DEFAULTS.planningHorizonWeeks,
          breakMinutesPerShift: globalSettings.breakMinutesPerShift ?? SETTINGS_DEFAULTS.breakMinutesPerShift,
          frozenDays: globalSettings.frozenDays ?? SETTINGS_DEFAULTS.frozenDays,
          safetyStockDays: globalSettings.safetyStockDays ?? SETTINGS_DEFAULTS.safetyStockDays,
          maxSetupsPlantWideNormal: globalSettings.maxSetupsPlantWideNormal ?? SETTINGS_DEFAULTS.maxSetupsPlantWideNormal,
          maxSetupsPlantWide: globalSettings.maxSetupsPlantWide ?? SETTINGS_DEFAULTS.maxSetupsPlantWide,
          setupsCrossShifts: globalSettings.setupsCrossShifts ?? SETTINGS_DEFAULTS.setupsCrossShifts,
          pullForwardDays: globalSettings.pullForwardDays ?? SETTINGS_DEFAULTS.pullForwardDays,
          deliveryCutoffMinute: globalSettings.deliveryCutoffMinute ?? SETTINGS_DEFAULTS.deliveryCutoffMinute,
          utilisationTarget: globalSettings.utilisationTarget ?? SETTINGS_DEFAULTS.utilisationTarget,
          maxScenarios: globalSettings.maxScenarios ?? SETTINGS_DEFAULTS.maxScenarios,
          rawUrgentDays: globalSettings.rawUrgentDays ?? SETTINGS_DEFAULTS.rawUrgentDays,
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
      deliveryCutoffMinute: setDeliveryCutoffMinute,
      utilisationTarget: setUtilisationTarget,
      maxScenarios: setMaxScenarios,
      rawUrgentDays: setRawUrgentDays,
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
      deliveryCutoffMinute: number
      utilisationTarget: number
      maxScenarios: number
      rawUrgentDays: number
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
      deliveryCutoffMinute: next?.deliveryCutoffMinute ?? deliveryCutoffMinute,
      utilisationTarget: next?.utilisationTarget ?? utilisationTarget,
      maxScenarios: next?.maxScenarios ?? maxScenarios,
      rawUrgentDays: next?.rawUrgentDays ?? rawUrgentDays,
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
      // Vardiya süresi yalnızca vardiya ayarlarında tutulur (tek kaynak).
      workingDays: next?.workingDays ?? workingDayKeys,
      holidays: next?.holidays ?? manualHolidays,
    })
    setSavedAt(new Date().toLocaleTimeString('en-GB'))
  }


  const template = templatesList.find((t) => t.press === press)
  const defaultWorkingDays = globalCalendar?.workingDays.length ?? 5

  const [workingDays, setWorkingDays] = useState(defaultWorkingDays)
  const [shiftsPerDay, setShiftsPerDay] = useState(1)
  const [templateError, setTemplateError] = useState<string | null>(null)

  useSyncedFields(
    template
      ? {
          workingDays: template.workingDays,
          shiftsPerDay: template.shiftsPerDay,
        }
      : undefined,
    {
      workingDays: setWorkingDays,
      shiftsPerDay: setShiftsPerDay,
    },
  )

  // Kayıttan önce: günde vardiya × süre 24 saati geçemez (sunucu da reddeder).
  const templateProblem = patternProblem({ workingDays, shiftsPerDay }, shiftMinutes)

  async function saveTemplate(next?: Partial<WeekPattern>) {
    if (!press) return
    setTemplateError(null)
    try {
      await saveTemplateMutation({
        press,
        workingDays: next?.workingDays ?? workingDays,
        shiftsPerDay: next?.shiftsPerDay ?? shiftsPerDay,
      })
    } catch (e) {
      setTemplateError(serverErrorText(e))
    }
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
      (globalSettings.setupGapMinutes ?? SETTINGS_DEFAULTS.setupGapMinutes) !== setupGapMinutes ||
      (globalSettings.coilSetupGapMinutes ?? SETTINGS_DEFAULTS.coilSetupGapMinutes) !== coilSetupGapMinutes ||
      (globalSettings.concurrentSetupsPerHall ?? SETTINGS_DEFAULTS.concurrentSetupsPerHall) !== concurrentSetupsPerHall ||
      (globalSettings.shiftStartMinute ?? SETTINGS_DEFAULTS.shiftStartMinute) !== shiftStartMinute ||
      (globalSettings.planningHorizonWeeks ?? SETTINGS_DEFAULTS.planningHorizonWeeks) !== planningHorizonWeeks ||
      (globalSettings.frozenDays ?? SETTINGS_DEFAULTS.frozenDays) !== frozenDays ||
      (globalSettings.safetyStockDays ?? SETTINGS_DEFAULTS.safetyStockDays) !== safetyStockDays ||
      (globalSettings.maxSetupsPlantWideNormal ?? SETTINGS_DEFAULTS.maxSetupsPlantWideNormal) !== maxSetupsPlantWideNormal ||
      (globalSettings.maxSetupsPlantWide ?? SETTINGS_DEFAULTS.maxSetupsPlantWide) !== maxSetupsPlantWide ||
      (globalSettings.setupsCrossShifts ?? SETTINGS_DEFAULTS.setupsCrossShifts) !== setupsCrossShifts ||
      (globalSettings.pullForwardDays ?? SETTINGS_DEFAULTS.pullForwardDays) !== pullForwardDays ||
      (globalSettings.deliveryCutoffMinute ?? SETTINGS_DEFAULTS.deliveryCutoffMinute) !== deliveryCutoffMinute ||
      (globalSettings.utilisationTarget ?? SETTINGS_DEFAULTS.utilisationTarget) !== utilisationTarget ||
      (globalSettings.maxScenarios ?? SETTINGS_DEFAULTS.maxScenarios) !== maxScenarios ||
      (globalSettings.rawUrgentDays ?? SETTINGS_DEFAULTS.rawUrgentDays) !== rawUrgentDays)

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
      template.shiftsPerDay !== shiftsPerDay)

  /** Kaydedilmemiş düzenlemeleri atıp sunucudaki hâle döner. */
  function discardSharedSettings() {
    if (globalSettings) {
      setShiftMinutes(globalSettings.shiftMinutes)
      setOvertimeShiftMinutes(globalSettings.overtimeShiftMinutes)
      setCountry(globalSettings.country)
      setSetupGapMinutes(globalSettings.setupGapMinutes ?? SETTINGS_DEFAULTS.setupGapMinutes)
      setCoilSetupGapMinutes(globalSettings.coilSetupGapMinutes ?? SETTINGS_DEFAULTS.coilSetupGapMinutes)
      setConcurrentSetupsPerHall(globalSettings.concurrentSetupsPerHall ?? SETTINGS_DEFAULTS.concurrentSetupsPerHall)
      setShiftStartMinute(globalSettings.shiftStartMinute ?? SETTINGS_DEFAULTS.shiftStartMinute)
      setPlanningHorizonWeeks(globalSettings.planningHorizonWeeks ?? SETTINGS_DEFAULTS.planningHorizonWeeks)
      setFrozenDays(globalSettings.frozenDays ?? SETTINGS_DEFAULTS.frozenDays)
      setSafetyStockDays(globalSettings.safetyStockDays ?? SETTINGS_DEFAULTS.safetyStockDays)
      setMaxSetupsPlantWideNormal(globalSettings.maxSetupsPlantWideNormal ?? SETTINGS_DEFAULTS.maxSetupsPlantWideNormal)
      setMaxSetupsPlantWide(globalSettings.maxSetupsPlantWide ?? SETTINGS_DEFAULTS.maxSetupsPlantWide)
      setSetupsCrossShifts(globalSettings.setupsCrossShifts ?? SETTINGS_DEFAULTS.setupsCrossShifts)
      setPullForwardDays(globalSettings.pullForwardDays ?? SETTINGS_DEFAULTS.pullForwardDays)
      setDeliveryCutoffMinute(globalSettings.deliveryCutoffMinute ?? SETTINGS_DEFAULTS.deliveryCutoffMinute)
      setUtilisationTarget(globalSettings.utilisationTarget ?? SETTINGS_DEFAULTS.utilisationTarget)
      setMaxScenarios(globalSettings.maxScenarios ?? SETTINGS_DEFAULTS.maxScenarios)
      setRawUrgentDays(globalSettings.rawUrgentDays ?? SETTINGS_DEFAULTS.rawUrgentDays)
    }
    if (globalCalendar) {
      setWorkingDayKeys(globalCalendar.workingDays)
      setManualHolidays(globalCalendar.holidays)
    }
    if (template) {
      setWorkingDays(template.workingDays)
      setShiftsPerDay(template.shiftsPerDay)
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

  const currentTemplate: WeekPattern = { workingDays, shiftsPerDay }
  const templateTotalShifts = totalShifts(currentTemplate)
  const templateTotalHours = totalMinutes(currentTemplate, shiftMinutes, overtimeShiftMinutes, stopsByShift) / 60

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

  // Takvimin tek formülü (plan, Capacity Dashboard ve Performance ile aynı):
  // Pazartesiden sırayla gün, tatil kaybolur, tarihli ve tekrarlayan mesai.
  const { definitions: overtimeDefinitions, pressOvertime } = useOvertimeData()
  const calendarModel = useMemo(
    () =>
      capacityModel({
        shiftMinutes,
        shiftStartMinute,
        plannedStops,
        templates: templatesList,
        weekOverrides: allOverrides,
        overtimeDefinitions: overtimeDefinitions.map((d) => ({ ...d, id: d._id })),
        pressOvertime,
        holidays: new Set([...holidaySet, ...manualHolidays]),
      }),
    [shiftMinutes, shiftStartMinute, plannedStops, templatesList, allOverrides, overtimeDefinitions, pressOvertime, holidaySet, manualHolidays],
  )

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
    <div className="mt-6">
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

      <UnsavedBar
        count={(sharedDirty ? 1 : 0) + (templateDirty ? 1 : 0)}
        saving={savingAll}
        noun="section"
        onSaveAll={() => void saveEverything()}
        onDiscard={discardSharedSettings}
      />

      {undefinedPresses.length > 0 && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">
            Presses used in Master Data but not defined on{' '}
            <Link to="/makineler" className="underline">
              Press Definitions
            </Link>
            : {undefinedPresses.map((u) => u.name).join(', ')}
          </p>
          <p className="mt-1">
            They are not planned and have no calendar. Define them, or correct the main / alternative
            machine of these parts:{' '}
            {undefinedPresses
              .filter((u) => u.parts.length > 0)
              .map((u) => `${u.name} — ${u.parts.slice(0, 8).join(', ')}${u.parts.length > 8 ? ` +${u.parts.length - 8}` : ''}`)
              .join(' · ') || 'only an old calendar record remains'}
            .
          </p>
        </div>
      )}

      <CollapsibleSection id="takvim-overtime" title="Overtime" hint="open or delete overtime on a date" defaultOpen>
        <OvertimeEntryPanel presses={pressOptions} />
      </CollapsibleSection>

      <CollapsibleSection id="takvim-grid" title="Capacity overview" hint="all presses, all weeks — click a week to change it" defaultOpen>
      <div className="mt-4">
        <CapacityGrid
          presses={definedPresses}
          templates={
            new Map(
              templatesList.map((t) => [
                t.press,
                { workingDays: t.workingDays, shiftsPerDay: t.shiftsPerDay } as GridPattern,
              ]),
            )
          }
          overrides={
            new Map(
              allOverrides.map((o) => [
                `${o.press}|${o.weekStart}`,
                { workingDays: o.workingDays, shiftsPerDay: o.shiftsPerDay } as GridPattern,
              ]),
            )
          }
          weekStarts={weekStarts}
          holidays={new Set([...holidaySet, ...manualHolidays])}
          workingDayKeys={workingDayKeys}
          shiftMinutes={shiftMinutes}
          overtimeShiftMinutes={overtimeShiftMinutes}
          stopMinutesByShift={stopsByShift}
          bucketsOf={(p, ws) => calendarModel.weekBuckets(p, ws)}
          renderDays={(p, ws) => (
            <PressWeekDays
              press={p}
              weekStart={ws}
              pattern={calendarModel.patternOf(p, ws)}
              recurring={templatesList.find((t) => t.press === p)?.recurringOvertime ?? []}
              holidays={new Set([...holidaySet, ...manualHolidays])}
              shiftStartMinute={shiftStartMinute}
              shiftMinutes={shiftMinutes}
            />
          )}
          defaultPattern={{ workingDays: 0, shiftsPerDay: 0 }}
          onSaveOverride={(press, weekStart, pattern) =>
            saveOverrideForGrid({ press, weekStart, ...pattern })
          }
          onClearOverride={(press, weekStart) => clearOverrideForGrid({ press, weekStart })}
        />
      </div>

      </CollapsibleSection>

      <CollapsibleSection id="takvim-press" title="Press pattern and weeks" hint="days, shifts, recurring overtime, exception weeks" defaultOpen>
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


              <button
                onClick={() => void saveTemplate()}
                disabled={!templateDirty || !!templateProblem}
                className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-40"
              >
                Save press pattern
              </button>
              {templateDirty && (
                <span className="pb-2 text-xs font-medium text-amber-700">● Unsaved</span>
              )}
            </div>
            {(templateProblem || templateError) && (
              <p className="mt-2 text-xs font-medium text-destructive">{templateProblem ?? templateError}</p>
            )}
            <p className="mt-3 text-sm text-muted-foreground">
              Total: <strong className="text-foreground">{templateTotalShifts} shifts</strong>{' '}
              · <strong className="text-foreground">{templateTotalHours.toFixed(1)} net h</strong>
              /week without overtime ({workingDays} days from Monday × {shiftsPerDay} shifts)
            </p>
            <RecurringOvertimePanel
              press={press}
              recurring={template?.recurringOvertime ?? []}
              disabled={!template}
            />
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
                    <th className="px-2 py-2 text-center font-medium">Total shifts</th>
                    <th className="px-2 py-2 text-center font-medium" title="Planned stops (tea, meal, handover) deducted — the same hours the plan uses">Net hours</th>
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
                      holidaySet={new Set([...holidaySet, ...manualHolidays])}
                      shiftMinutes={shiftMinutes}
                      shiftStartMinute={shiftStartMinute}
                      recurring={template?.recurringOvertime ?? []}
                      hasTemplate={!!template}
                      netMinutes={calendarModel
                        .weekBuckets(press, monday)
                        .reduce((a, b) => a + b.minutes, 0)}
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
      </CollapsibleSection>

      <CollapsibleSection id="takvim-holidays" title="Manual holidays" hint={manualHolidays.length ? `${manualHolidays.length} day(s)` : 'plant shutdowns'}>
      <div className="mt-4 rounded-md border border-border p-3">
        <h3 className="text-xs font-medium text-muted-foreground">
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

      </CollapsibleSection>

      <CollapsibleSection id="takvim-stops" title="Planned stops" hint="tea, meal, handover per shift">
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

      </CollapsibleSection>

      <CollapsibleSection id="takvim-rules" title="Shifts and planning rules" hint={`${shiftMinutes / 60} h shifts from ${String(Math.floor(shiftStartMinute / 60)).padStart(2, '0')}:${String(shiftStartMinute % 60).padStart(2, '0')}`}>
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
          <span className="block text-xs text-muted-foreground">Urgent raw material (working days)</span>
          <input
            type="number"
            min={1}
            max={30}
            className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={rawUrgentDays}
            onChange={(e) => setRawUrgentDays(Math.max(1, Math.min(30, Math.round(Number(e.target.value)) || 1)))}
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
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Delivery time on the need day</span>
          <input
            type="time"
            className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={`${String(Math.floor(deliveryCutoffMinute / 60)).padStart(2, '0')}:${String(deliveryCutoffMinute % 60).padStart(2, '0')}`}
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number)
              if (Number.isFinite(h) && Number.isFinite(m)) setDeliveryCutoffMinute(h * 60 + m)
            }}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Utilisation target (%)</span>
          <input
            type="number"
            min={50}
            max={100}
            className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={utilisationTarget}
            onChange={(e) => setUtilisationTarget(Math.max(50, Math.min(100, Number(e.target.value) || 95)))}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Max scenarios to try</span>
          <input
            type="number"
            min={1}
            max={300}
            className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={maxScenarios}
            onChange={(e) => setMaxScenarios(Math.max(1, Math.min(300, Number(e.target.value) || 1)))}
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
      <div className="mt-3 rounded-md border border-border p-3">
        <ShiftTable shiftStartMinute={shiftStartMinute} shiftMinutes={shiftMinutes} />
      </div>
      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        What these settings do
        <InfoTip label="About the planning rules">
          <ul>
            <li>
              <b>Frozen days:</b> the first {frozenDays} day(s) of the plan are taken from the
              approved plan instead of being recalculated, so the shop floor's preparation is not
              disturbed. A press can override this on Press Definitions. 0 turns it off.
            </li>
            <li>
              <b>Safety stock:</b> the next lot of a part may start {safetyStockDays} working day(s)
              before its projected stock runs out — not earlier, so stock does not pile up.
            </li>
            <li>
              <b>Crane:</b> presses in the same hall run at most {concurrentSetupsPerHall} setup(s) at
              a time, at least {setupGapMinutes} min between mould setups and{' '}
              {coilSetupGapMinutes} min between coil changes. A mould setup and a coil change may
              follow each other but never overlap. Halls come from Press Definitions.
            </li>
            <li>
              <b>Plant-wide:</b> without backlog at most {maxSetupsPlantWideNormal} mould setup(s) at
              the same time; for backlog or a job that would otherwise be late up to{' '}
              {maxSetupsPlantWide} may overlap — also in the same hall.{' '}
              {setupsCrossShifts
                ? 'A setup may start near the end of a shift and be finished by the next shift.'
                : 'A setup must finish within the shift it starts in.'}
            </li>
            <li>
              <b>Pull forward:</b> when a press would stand idle, work may start up to{' '}
              {pullForwardDays} day(s) before it is needed; if nothing is urgent the mounted die
              keeps running first, so no extra setup is made.
            </li>
            <li>
              <b>Delivery:</b> on time when the quantity needed is ready by{' '}
              {`${String(Math.floor(deliveryCutoffMinute / 60)).padStart(2, '0')}:${String(deliveryCutoffMinute % 60).padStart(2, '0')}`}{' '}
              on the need day (holidays included); backlog and today's need are due the next day at
              that time.
            </li>
            <li>
              <b>Urgent raw material:</b> coils that stop a job within the next {rawUrgentDays}{' '}
              working day(s) are listed on the Production Plan.
            </li>
            <li>
              <b>Scenarios:</b> up to {maxScenarios} plan variants; stops as soon as the presses are{' '}
              {utilisationTarget}% busy in the next 7 days, otherwise reports the best level reached.
            </li>
          </ul>
        </InfoTip>
      </p>

      </CollapsibleSection>
    </div>
  )
}

function WeekRow({
  press,
  monday,
  template,
  override,
  holidaySet,
  shiftMinutes,
  shiftStartMinute,
  recurring,
  hasTemplate,
  netMinutes,
}: {
  press: string
  monday: Date
  template: WeekPattern
  override: (WeekPattern & { weekStart: string }) | undefined
  holidaySet: Set<string>
  shiftMinutes: number
  shiftStartMinute: number
  recurring: { dayKey: string; definitionId: string }[]
  hasTemplate: boolean
  /** Planla aynı formülden: normal vardiyalar + mesai, duruşlar düşülmüş. */
  netMinutes: number
}) {
  const saveOverrideMutation = useMutation(api.pressCalendar.saveOverride)
  const clearOverrideMutation = useMutation(api.pressCalendar.clearOverride)
  const weekStart = isoDate(monday)
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday])
  const weekHolidays = weekDates.filter((d) => holidaySet.has(isoDate(d)))

  const effective: WeekPattern = override ?? template
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<WeekPattern>(effective)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editing) setDraft(effective)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effective.workingDays, effective.shiftsPerDay, editing])

  const isCurrentWeek = weekStart === isoDate(mondayOf(new Date()))
  const isOverridden = !!override
  const problem = editing ? patternProblem(draft, shiftMinutes) : null

  async function handleSave() {
    setError(null)
    try {
      await saveOverrideMutation({ press, weekStart, workingDays: draft.workingDays, shiftsPerDay: draft.shiftsPerDay })
      setEditing(false)
    } catch (e) {
      setError(serverErrorText(e))
    }
  }

  async function handleRevert() {
    await clearOverrideMutation({ press, weekStart })
    setEditing(false)
  }

  const shown = editing ? draft : effective

  return (
    <>
      <tr
        className={`border-t border-border ${isCurrentWeek ? 'bg-primary/5' : ''} ${
          weekHolidays.length > 0 ? 'bg-red-50/50' : ''
        }`}
      >
        <td className="whitespace-nowrap px-2 py-1.5 font-medium text-foreground">
          {formatWeekLabel(monday)}
          {isOverridden && (
            <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
              exception week
            </span>
          )}
          {weekHolidays.length > 0 && (
            <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">
              holiday ({weekHolidays.length})
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
        <td className="px-1 py-1 text-center text-muted-foreground">{totalShifts(shown)}</td>
        <td className="px-1 py-1 text-center text-muted-foreground" title="Normal shifts and overtime, planned stops deducted — the hours the plan uses">
          {(netMinutes / 60).toFixed(1)}
        </td>
        <td className="px-2 py-1 text-right">
          {editing ? (
            <div className="flex items-center justify-end gap-1">
              {(problem || error) && <span className="text-[11px] text-destructive">{problem ?? error}</span>}
              <button
                onClick={() => void handleSave()}
                disabled={!!problem}
                className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setDraft(effective)
                  setEditing(false)
                  setError(null)
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
                title="Exception week: different days or shifts for this week only"
              >
                Edit week
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
    </>
  )
}
