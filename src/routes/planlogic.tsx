import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'

import { api } from '../../convex/_generated/api'
import { useQuery } from '../lib/convexTransport'
import { DEFAULT_PLANT_TIME_ZONE } from '../lib/dates'
import { MES_SHORT_STOP_MIN, SHORT_STOPS, SPEED, UNASSIGNED, UNDEFINED_RC1 } from '../lib/oee'
import { OVER_RECORDED } from '../lib/oeeBridge'
import { SHORT_STOP_DATA_FROM } from '../lib/oeeShortStops'
import { computeRunPlan } from '../lib/planning'
import { allocateOperators, OPERATOR_EXAMPLE } from '../lib/operatorAllocation'
import { OPERATOR_SHIFTS_PER_DAY, OPERATOR_WEEKLY_EXAMPLE, operatorWeekCapacity, shiftHeadcountFromWeekly } from '../lib/operatorCapacity'
import { leadTimeLookup, type LeadTimeRow } from '../lib/rawLeadTime'
import { CYCLE_DECIMALS, CYCLE_STORE_DECIMALS, cycleMinutesFromSeconds, formatCycleInput } from '../lib/rateModel'
import { SETTINGS_DEFAULTS } from '../lib/settingsDefaults'
import { PageHeader } from '../components/PageHeader'
import { relatedPages } from '../lib/navigation'
import { PlanLogicRo } from '../components/planlogic/PlanLogicRo'
import { PlanLogicTr } from '../components/planlogic/PlanLogicTr'

export const Route = createFileRoute('/planlogic')({
  component: PlanLogicPage,
})

/**
 * Motorun nasıl plan yaptığının açıklaması.
 *
 * Kod `src/lib/planPipeline.ts`, `planning.ts` ve `scheduler.ts` içinde;
 * burası onun planlamacının dilindeki karşılığı. Kurallardan biri
 * değişirse bu sayfa da değişmeli.
 */

/** Hammadde MRP'sinin FMEA'sı: hata türü, etkisi, S, O, D, yöntemdeki önlem. */
const FMEA_ROWS: [string, string, number, number, number, string][] = [
  ['Plan and demand both counted', 'Same steel ordered twice', 8, 8, 3, 'Plan-independent: demand only; the safety stock absorbs plan timing and coil surplus'],
  ['Finished stock not deducted', 'Over-ordering', 7, 5, 4, 'Locations ticked “Finished goods” on Storage Locations deducted first-in-first-out, the same as the plan; the row breaks the need down per finished product'],
  ['Need of a part with stock read from its coil row', 'Steel seems needed while the part’s stock still covers', 5, 6, 6, 'Per-product breakdown: weeks covered by finished stock and the week steel is first needed, per part on the coil'],
  ['Coil stock on hand not deducted', 'Steel already in the plant is ordered again', 8, 6, 5, 'Coil stock in the locations ticked “Raw material” is the opening stock'],
  ['Co-product counted twice', 'Over-ordering on pairs', 6, 6, 5, 'Pair pressed once: strokes = larger need, steel on the primary part only'],
  ['Part without raw code / gross weight', 'Its steel silently missing → line stops', 10, 5, 8, 'Listed in red on the page with pieces; never silently dropped'],
  ['Gross weight in wrong unit (g / t)', 'Order 1000× off', 9, 3, 6, 'Weights above 50 kg or below 1 g per piece are flagged'],
  ['Weekly buckets: safety checked only at week start', 'Below safety at the end of the week', 7, 7, 7, 'Every week end must hold the next N working days (10 = the next 2 weeks)'],
  ['Steel ordered with no demand behind it', 'Dead stock, cash tied up', 6, 6, 5, 'No demand, no order: nothing is forecast beyond the last ZPP week (kanban comes later)'],
  ['Backlog (overdue) ignored', 'Urgent steel missing now', 8, 4, 5, 'Backlog counted in the current week'],
  ['Blocked / quality stock counted as available', 'Stock overstated', 7, 4, 6, 'Only unrestricted stock, and only in locations ticked on Storage Locations'],
  ['Scrap, coil ends, setup loss', 'Slightly too little', 5, 8, 7, 'Standard extra per order (500 kg, adjustable)'],
  ['Steel in transit unknown', 'Steel already on the way is ordered again', 7, 7, 8, 'In-transit Excel list: each quantity is a receipt in its ETA week (no ETA = this week)'],
  ['In-transit ETA wrong or missing', 'Order a week too late or too early', 6, 5, 6, 'No ETA counts as this week; each arrival shows its ETA and PO on the page to check'],
]

const STEPS = [
  { id: 'inputs', title: 'Collect the data' },
  { id: 'demand', title: 'Net the demand' },
  { id: 'capacity', title: 'Build the capacity' },
  { id: 'blocks', title: 'Block what cannot run' },
  { id: 'order', title: 'Put the work in order' },
  { id: 'place', title: 'Place each job' },
  { id: 'check', title: 'Check and report' },
]

function hhmm(minute: number): string {
  const h = Math.floor(minute / 60) % 24
  const m = minute % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const dmy = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

// Sayfanın dili: İngilizce kaynak; Türkçe ve Romence aynı sayfanın çevirisi
// (src/components/planlogic/). Mantık değişince üçü birlikte güncellenir.
const LANGS = [
  ['en', 'English'],
  ['tr', 'Türkçe'],
  ['ro', 'Română'],
] as const
type Lang = (typeof LANGS)[number][0]
const LANG_KEY = 'planlogic-lang'

function PlanLogicPage() {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const v = window.localStorage.getItem(LANG_KEY)
      return v === 'tr' || v === 'ro' ? v : 'en'
    } catch {
      return 'en'
    }
  })
  const choose = (l: Lang) => {
    setLang(l)
    try {
      window.localStorage.setItem(LANG_KEY, l)
    } catch {
      // Saklanamıyorsa yalnızca bu oturumda kalır.
    }
  }
  return (
    <>
      <div className="flex justify-end px-4 pt-4 sm:px-6" role="group" aria-label="Language">
        <div className="inline-flex overflow-hidden rounded-md border border-border text-xs">
          {LANGS.map(([code, label]) => (
            <button
              key={code}
              type="button"
              lang={code}
              onClick={() => choose(code)}
              aria-pressed={lang === code}
              className={`px-3 py-1 font-medium ${
                lang === code ? 'bg-foreground text-background' : 'bg-background text-foreground hover:bg-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div lang={lang}>{lang === 'tr' ? <PlanLogicTr /> : lang === 'ro' ? <PlanLogicRo /> : <PlanLogicEn />}</div>
    </>
  )
}

function PlanLogicEn() {
  const leadRows = useQuery(api.rawLeadTimes.list) as LeadTimeRow[] | undefined
  const settings = useQuery(api.pressCalendar.getGlobalSettings) as
    | {
        shiftMinutes: number
        setupGapMinutes?: number
        coilSetupGapMinutes?: number
        concurrentSetupsPerHall?: number
        shiftStartMinute?: number
        capacityFactor?: number
        planningHorizonWeeks?: number
        frozenDays?: number
        safetyStockDays?: number
        timeZone?: string
        maxSetupsPlantWideNormal?: number
        maxSetupsPlantWide?: number
        setupsCrossShifts?: boolean
        pullForwardDays?: number
        deliveryCutoffMinute?: number
        utilisationTarget?: number
        maxScenarios?: number
        rawCoverageDays?: number
        rawOrderExtraKg?: number
        rawUrgentDays?: number
        acceptedPerformanceRate?: number
      }
    | null
    | undefined

  // Süre örneği koddan hesaplanır; aynı sayılar src/lib/rateModel.test.ts'te.
  const cycleExample = { qty: 1200, minutes: 0.25, oee: 0.6 }
  // Punta ve pres dosyaları süreyi saniye yazar; yüklemede 60'a bölünür.
  const cycleSecondsExample = 8.22
  const cycleFromSeconds = cycleMinutesFromSeconds(cycleSecondsExample)
  // Saniyenin altında çalışan pres parçası: kayıt 5 hane olmasa süre şişerdi.
  const pressSecondsExample = 1.1111111111111112
  const pressCycle = cycleMinutesFromSeconds(pressSecondsExample)!
  const cycleRun = computeRunPlan({ code: 'X', cycleMinutes: cycleExample.minutes }, cycleExample.qty)
  const cycleRunOee = computeRunPlan(
    { code: 'X', cycleMinutes: cycleExample.minutes, performanceFactor: cycleExample.oee },
    cycleExample.qty,
  )

  const current = {
    horizon: settings?.planningHorizonWeeks ?? SETTINGS_DEFAULTS.planningHorizonWeeks,
    shiftStart: hhmm(settings?.shiftStartMinute ?? SETTINGS_DEFAULTS.shiftStartMinute),
    shiftMinutes: settings?.shiftMinutes ?? SETTINGS_DEFAULTS.shiftMinutes,
    setupGap: settings?.setupGapMinutes ?? SETTINGS_DEFAULTS.setupGapMinutes,
    plantNormal: settings?.maxSetupsPlantWideNormal ?? SETTINGS_DEFAULTS.maxSetupsPlantWideNormal,
    plantUrgent: settings?.maxSetupsPlantWide ?? SETTINGS_DEFAULTS.maxSetupsPlantWide,
    crossShifts: settings?.setupsCrossShifts ?? SETTINGS_DEFAULTS.setupsCrossShifts,
    pullForward: settings?.pullForwardDays ?? SETTINGS_DEFAULTS.pullForwardDays,
    cutoff: hhmm(settings?.deliveryCutoffMinute ?? SETTINGS_DEFAULTS.deliveryCutoffMinute),
    target: settings?.utilisationTarget ?? SETTINGS_DEFAULTS.utilisationTarget,
    maxScenarios: settings?.maxScenarios ?? SETTINGS_DEFAULTS.maxScenarios,
    coilGap: settings?.coilSetupGapMinutes ?? SETTINGS_DEFAULTS.coilSetupGapMinutes,
    concurrent: settings?.concurrentSetupsPerHall ?? SETTINGS_DEFAULTS.concurrentSetupsPerHall,
    factor: Math.round((settings?.capacityFactor ?? SETTINGS_DEFAULTS.capacityFactor) * 100),
    frozen: settings?.frozenDays ?? SETTINGS_DEFAULTS.frozenDays,
    safety: settings?.safetyStockDays ?? SETTINGS_DEFAULTS.safetyStockDays,
    timeZone: settings?.timeZone || DEFAULT_PLANT_TIME_ZONE,
    rawCoverage: settings?.rawCoverageDays ?? SETTINGS_DEFAULTS.rawCoverageDays,
    rawExtra: settings?.rawOrderExtraKg ?? SETTINGS_DEFAULTS.rawOrderExtraKg,
    rawUrgent: settings?.rawUrgentDays ?? SETTINGS_DEFAULTS.rawUrgentDays,
    rawLeadDefault: leadTimeLookup(leadRows ?? []).defaultDays,
    rawLeadEntered: (leadRows ?? []).filter((r) => r.rawMaterialCode !== '*').length,
    predictionOee: Math.round((settings?.acceptedPerformanceRate ?? SETTINGS_DEFAULTS.acceptedPerformanceRate) * 1000) / 10,
  }

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Planning Logic"
        summary="How the plan is calculated — the same rules, applied the same way every time."
        links={relatedPages('/planlogic')}
        info={
          <p>
            Nobody places jobs by hand. The plan is calculated on the server from the data you
            maintain, in the seven steps below, every time that data changes. To change the plan,
            change its inputs.
          </p>
        }
      />

      <SingleSource />

      <Synoptic safetyDays={current.safety} />

      <h2 className="mt-10 text-lg font-semibold text-foreground">The seven steps in detail</h2>
      <ol className="mt-3 flex flex-wrap gap-2 text-xs">
        {STEPS.map((step, i) => (
          <li key={step.id} className="flex items-center gap-2">
            <a
              href={`#${step.id}`}
              className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-foreground hover:bg-muted"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">
                {i + 1}
              </span>
              {step.title}
            </a>
            {i < STEPS.length - 1 && <span className="text-muted-foreground" aria-hidden>→</span>}
          </li>
        ))}
      </ol>

      <div className="mt-6 rounded-lg border border-border bg-muted/40 p-4">
        <h2 className="text-sm font-semibold text-foreground">Your current settings</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
          <Setting label="Planning horizon" value={`${current.horizon} weeks`} />
          <Setting label="First shift starts" value={`${current.shiftStart} (${current.timeZone})`} />
          <Setting label="Shift length" value={`${current.shiftMinutes} min`} />
          <Setting label="Gap between mould setups (same hall)" value={`${current.setupGap} min`} />
          <Setting label="Gap between coil changes (same hall)" value={`${current.coilGap} min`} />
          <Setting label="Setups at the same time per hall" value={String(current.concurrent)} />
          <Setting label="Setups at once in the plant (normal)" value={String(current.plantNormal)} />
          <Setting label="Setups at once with backlog / late risk" value={String(current.plantUrgent)} />
          <Setting label="Pull work forward" value={`${current.pullForward} days`} />
          <Setting label="Setup over a shift change" value={current.crossShifts ? 'allowed' : 'not allowed'} />
          <Setting label="Capacity factor" value={`${current.factor}%`} />
          <Setting
            label="Frozen days"
            value={current.frozen > 0 ? `${current.frozen} days` : 'off'}
          />
          <Setting label="Safety stock" value={`${current.safety} working days`} />
          <Setting label="Delivery time on the need day" value={current.cutoff} />
          <Setting label="Utilisation target" value={`${current.target}% (next 7 days)`} />
          <Setting label="Scenarios tried at most" value={String(current.maxScenarios)} />
          <Setting label="Raw material safety" value={`${current.rawCoverage} working days`} />
          <Setting label="Raw order extra" value={`${current.rawExtra.toLocaleString('en-GB')} kg`} />
          <Setting label="Urgent raw material" value={`${current.rawUrgent} working days`} />
          <Setting label="Prediction OEE (dashboard only)" value={`${current.predictionOee}%`} />
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Change these on the{' '}
          <Link to="/takvim" className="underline hover:no-underline">
            Work Calendar
          </Link>{' '}
          page; the capacity factor comes from the{' '}
          <Link to="/performans" className="underline hover:no-underline">
            Performance
          </Link>{' '}
          page; Prediction OEE from the{' '}
          <Link to="/capacity" className="underline hover:no-underline">
            Capacity Dashboard
          </Link>
          .
        </p>
      </div>

      <Step n={1} id="inputs" title="Collect the data">
        <p>The engine reads everything the plan depends on:</p>
        <Table
          rows={[
            ['Demand', 'ZPP weekly net requirements and the overdue quantity', '/sapdata'],
            ['Sales days', 'ZPP_DAILY: one column per day — the day each quantity is sold', '/sapdata'],
            [
              'Stock',
              'MB52 unrestricted stock, counted per cost center: a part counts the locations of its main work center\'s cost center (Storage Locations → Locations per cost center) — its production (WIP) location and its finished goods locations for the plan, the validator, Demand and the Capacity Dashboard; a raw material code counts the raw material locations of the cost centers that consume it. Example: 171 and 173 have WIP 2009, raw and finished 1009; 172 has WIP 2010, raw and finished 1009 — stock of a 172 part lying in 2009 is not counted. Intermediate parts: a code that the plant itself makes (a product card or a co-product) and another part uses as raw material — e.g. 172 makes it, 171 consumes it — counts once, as finished stock of its maker; it never counts as raw material stock, never gets a coil need and is never suggested for purchase, because 171\'s draw is already in 172\'s ZPP demand. So 1009 being raw for 171 and finished for 172 does not count the same pieces twice. MB51 production of a part is a 101/102 into its cost center\'s WIP location. A cost center without a definition (or a part without a cost center) uses the location ticks: Finished goods, Raw material, Production receipt',
              '/depolar',
            ],
            ['Coils in transit', 'In-transit Excel list: each quantity arrives in its ETA week (no ETA = this week)', '/sapdata'],
            [
              'Master data',
              'Cycle time (minutes per piece) — the speed of every part on every work center; setup and frequency stop (coil change) times, quality approval time, coil and gross weight, mould shot limit, main and alternative work centers, Flexible work center tick, co-product, Accepted OEE. A part loaded earlier with SPM and cavities but no cycle time runs 1 ÷ (SPM × cavities) min/piece; cavities, where still entered, only count strokes (mould limit)',
              '/referanslar',
            ],
            ['Work Centers', 'The single work center list: cost center, hall (crane and setup team), category (Gantt and Capacity Dashboard groups), frequency stop (coil setup, fixture setup … or none), frozen days', '/makineler'],
            ['Work calendar', 'Per work center: weekly pattern (days from Monday × shifts), exception weeks, overtime (dated or recurring, from an overtime type); planned stops; public and manual holidays; planning settings', '/takvim'],
            ['Dies', 'Readiness (date and time), maintenance days, shot-limit alarms — from Die Follow-up', '/die-followup/maintenance'],
            ['Machines', 'Planned work center maintenance hours and open breakdowns that stop a work center — from Machine Follow-up', '/machine-followup/breakdowns'],
            ['Your rules', 'Exclude, pin to a work center/day, or move to the front', '/planlama'],
            ['Approved plan', 'The last approved plan, for the frozen days', '/planlama'],
          ]}
        />
      </Step>

      <Step n={2} id="demand" title="Net the demand">
        <ul>
          <li>
            Every ZPP column is one calendar week, starting with the current
            week. Only the weeks inside the planning horizon are planned.
          </li>
          <li>
            The overdue quantity becomes a <b>backlog</b> item due this week.
          </li>
          <li>
            Stock is deducted from the earliest need first: backlog, then this
            week, then next week, and so on. What remains is what must be
            produced.
          </li>
          <li>
            <b>Sales days — ZPP_DAILY.</b> For every day the ZPP_DAILY file
            covers, demand falls on the exact date in the file: 5 000 shipped
            on Wednesday is 5 000 on Wednesday, not 1 000 a day. Beyond the
            file's last day, the weekly ZPP is spread evenly over the plant's
            working days — not a holiday and at least one work center has normal
            shifts; overtime does not make a working day (a partly covered week
            gets the rest of its weekly total on the uncovered days). The backlog
            is due today.
          </li>
          <li>
            <b>ZPP_DAILY first — weekly ZPP is long-term.</b> When ZPP_DAILY is
            loaded (and reaches today), it is SAP's commitment for the days it
            covers. Demand that comes from the weekly ZPP — the days after
            ZPP_DAILY's last day, and every part that has no ZPP_DAILY row — becomes a
            separate <b>long-term</b> lot. Long-term lots are placed only{' '}
            <b>after every daily lot</b> (backlog, urgent, fill and lots moved to the
            front), only into the capacity that is left, never in front of a daily job
            that continues its die without a setup, and they are <b>never late</b>. A
            week only partly covered by ZPP_DAILY is <b>split</b>, never mixed: the
            covered days make the daily lot, the rest is a long-term lot labelled{' '}
            <code>W38 LT</code>. Whole coils still apply: the daily lot's spare pieces
            reduce the long-term lot. Example: ZPP_DAILY up to Wednesday with 1 000
            on Monday and 1 000 on Wednesday, weekly W38 = 5 000, a coil gives 2 500
            pcs → daily lot 2 500 (one coil, checked only on Monday and Wednesday) +
            long-term lot 2 500 (3 000 on Thursday–Friday − 500 spare). Without
            ZPP_DAILY nothing is long-term and the weekly ZPP is planned as before.
          </li>
          <li>
            <b>Timing — projected stock.</b> Walking day by day, the engine
            finds the day the stock — plus every lot planned before — would
            drop below zero. That is the lot's <b>stock-out day</b>.
          </li>
          <li>
            <b>Safety stock.</b> The lot may start{' '}
            <b>{current.safety} working day(s)</b> before its stock-out day, and
            not earlier, so stock does not pile up and the work center stays free
            for parts that need it. If that day is already today or past, the
            lot is <b>urgent</b>; otherwise it is <b>fill</b>.
          </li>
          <li>
            <b>Produced but not yet in the stock file.</b> Approved jobs that
            ran after the last MB52 upload count as stock until the next
            upload. Example: 6 000 pcs pressed on Monday, stock uploaded again
            on Tuesday morning — in between, the 6 000 are not planned a
            second time. The Production Plan says when this assumption is in
            use.
          </li>
          <li>
            <b>Co-products</b> come out of the same stroke, so they cannot be
            made separately. For each week, the pair is made for the larger of
            the two requirements, and the pair is <b>one lot and one job</b> —
            on the part that names the other as its co-product. The job shows
            both quantities; work center time and setup are counted once.
          </li>
          <li>
            <b>Whole coils — always.</b> A mounted coil is run to the end, so
            every coil-fed lot is a whole number of coils (strokes per coil ×
            cavities). The surplus covers the following weeks and does not
            trigger another coil; backlog and this week's need share the same
            coil and the same setup. A coil is <b>never cut short</b> — not to
            fit a gap and not to save a late job.
          </li>
          <li>
            <b>Min. lot instead of the coil.</b> Where the coil quantity is
            flexible (transfer work centers 106/107), a <b>Min. lot (pcs)</b> is entered
            in master data. It replaces the coil: the lot is at least that many
            pieces, and above it exactly the need (need 300, min. lot 2 000 → 2 000;
            need 2 500 → 2 500). The surplus covers the following weeks. The coil
            weight is then ignored and may stay empty.
          </li>
          <li>
            <b>Neither?</b> A part with no Min. lot and no real coil weight (empty,
            or 1 kg as a placeholder) is a master data error: it is planned at
            exactly the need, and the plan and the Master Data page warn about it.
          </li>
          <li>
            <b>No coil at all</b> (nut welding, spot welding, assembly …): a part with a
            cycle time and no coil or sheet is planned at exactly the need (or its Min.
            lot) <b>without</b> a warning, and the Raw Material page does not ask for its
            steel.
          </li>
        </ul>
        <Example>
          Backlog 200 pcs, next week 2 000 pcs, no stock. One coil gives 5 000
          pcs. The backlog needs a coil, so 5 000 pcs are pressed now; the 4
          800 surplus covers next week. Result: one job, one setup — not two.
        </Example>
      </Step>

      <div className="mt-4 max-w-4xl">
        <StockExample safetyDays={2} />
      </div>

      <Step n={3} id="capacity" title="Build the capacity">
        <p>For every work center and every day of the horizon:</p>
        <Formula>
          net minutes = normal shifts × shift length + overtime windows − planned stops → × capacity factor
        </Formula>
        <ul>
          <li>
            Each work center has <b>one calendar</b>: its standard week ("N days" are filled from
            Monday: 5 = Mon–Fri, 6 = Mon–Sat; shifts per day), a <b>week exception</b> when
            there is one, and the <b>overtime</b> opened on dates (or every week on the pattern)
            with an overtime definition — start time and length. Overtime opened on the
            Capacity Dashboard is the same record.
          </li>
          <li>
            A <b>day record</b> is the final word for one work center and one day: on the Production
            Plan, <b>Work calendar</b> box, press <b>Edit</b>, then a click on a cell opens or closes
            that shift and <b>Save</b> writes the whole week at once (Cancel drops it). It wins over
            the week exception, the pattern and a holiday (order: day record → week exception →
            pattern). The shifts do not have to follow each other: only the 3rd shift (with 8 h
            shifts from 07:00: 23:00–07:00) is 480 min, 450 net with a 30 min 3rd-shift meal. A shift
            that overlaps that day's overtime is refused; ↺ removes the record. In the same Edit
            mode the OT row adds or removes that day's dated overtime; Save applies the overtime
            removals first, then the day records, then the new overtime. It reaches the plan
            on the next Calculate plan.
          </li>
          <li>
            A public holiday is a day off: its shifts are lost, never moved to another day.
            Overtime opened on the holiday is planned. Recurring overtime does not run on a
            holiday — open it on the date.
          </li>
          <li>
            Shifts have the same length and follow each other from the first shift start (e.g. 2 ×
            9 h from 07:00: 07:00–16:00, 16:00–01:00). Overtime may not overlap the normal shifts
            or another overtime.
          </li>
          <li>
            <b>Overtime is opened outside the shift grid, not inside it.</b> On a day the work
            center works, the shifts are the day's grid: a shift that is closed is reopened on the
            work calendar, not as overtime. Overtime therefore only fits between the end of the
            grid and the end of the production day. A work center with <b>8 h</b> shifts fits
            3 of them in a day, the grid covers all 24 h, and <b>no overtime can be opened on a
            working day</b> — it is opened on a day the work center does not work, normally
            <b>Saturday or Sunday</b>. A work center with <b>9 h 40</b> shifts fits 2 of them
            (06:30–16:10 and 16:10–01:50 = 19 h 20), so 01:50–06:30 is outside the grid and a
            night overtime of at most 4 h 40 is opened there. A day with no normal shift at all
            (Saturday, Sunday, a holiday) is entirely outside the normal pattern: the whole day
            takes overtime.
          </li>
          <li>
            The overtime still has to fit in time that is actually free: the production day
            (24 h from the first shift start) minus the open shifts and the overtime already
            opened. The Production Plan <b>Work calendar</b> box writes the result on the OT row of
            every day — <i>free 01:50–06:30</i>, <i>full</i> when the window is taken, or
            <i>shifts cover 24 h</i> when the grid leaves no window; an overtime that does not fit
            cannot be chosen. The whole displayed week can be edited, closed Saturday and Sunday
            included — that is how weekend work is opened, either as overtime or as a day record
            that opens the shifts themselves.
          </li>
          <li>
            A work center without a Work Calendar pattern has no capacity; the Production Plan shows
            a red alarm. A day never exceeds 24 hours (planned stops included), so a work center week
            never exceeds 168 hours — longer entries are refused when saved.
          </li>
          <li>Planned stops falling inside overtime are deducted too.</li>
          <OperatorPlanItem />
          <li>
            Days that have passed are skipped, and today starts at the current
            time — nothing is planned in the past. The plan day begins with the
            first shift ({current.shiftStart}), so at 02:00 the night shift
            still belongs to the previous day.
          </li>
          <li>
            Each work center is one continuous timeline: a job that does not finish
            before the shift or day ends simply continues in the next shift.
          </li>
        </ul>
      </Step>

      <Step n={4} id="blocks" title="Block what cannot run">
        <ul>
          <li>
            <b>Frozen days</b>: jobs from the approved plan in the first days
            are kept exactly where they are, and what they produce is deducted
            from demand. The engine plans only the free time around them.
          </li>
          <li>
            <b>Approved and moved jobs</b>: a job approved on its own (click it → Approve this job), or
            dragged on the Gantt to another work center, day or time (on a phone: hold, then drag; or
            click it → Move…), is locked there the same way — kept in place, its quantity deducted from
            that part's demand, the other jobs planned around it. A move keeps the job's setup,
            approval, production and frequency-stop minutes in order and pours them into the target
            work center's working minutes from the drop point; when a day is full it carries on the
            next working day (e.g. 120 min setup + 600 min production dropped at minute 1200 of a
            1350-minute day: setup 1200–1320, 30 min production that day, the other 570 min the next
            working day). It cannot start before now, must fit before the end of the plan, and cannot
            overlap another approved or frozen job or maintenance on that work center.
          </li>
          <li>
            <b>Jobs added by hand</b> (Plan → + Add job, e.g. a part run for stock): part, quantity, work
            center, day and start time. Clicking an idle gap on the chart (the dashed orange line) opens the
            same form with that work center, day and the gap's start time filled in. The duration is the engine's own calculation for that part and
            quantity, in the engine's order — setup (none if the die is already mounted), quality
            approval, production per coil with a coil change between coils on a coil-fed work center
            (e.g. 90 min setup + 15 min approval + coils of 200 and 150 min with a 20-min coil change =
            475 min). The job is locked at that time like a moved job: its quantity comes off the part's
            future demand, so later lots of that part shrink or disappear, and the work center's other
            jobs move behind it. Same limits as a move; a part not defined for that work center is
            allowed with a warning.
          </li>
          <li>
            <b>Deleting</b> (click a job): a job added by hand → <i>Delete job</i>, it leaves the plan and its
            quantity is no longer deducted from demand; an approved or moved job → <i>Remove approval</i>, it goes
            back to the engine, which plans it again; an engine job → <i>Delete this lot</i>, the lot is set to 0
            pieces and its demand moves to the next lots of that part (the same as typing 0 as the lot quantity).
          </li>
          <li>
            <b>Work center maintenance</b> takes those clock hours out of that
            work center's day; jobs flow around it.
          </li>
          <li>
            <b>Machine breakdown</b> (reported in Machine Follow-up with "the
            work center is stopped"): the work center is closed from the breakdown until
            the expected time it is back — or, with no expected time, until
            the breakdown is solved. Like a closed period it is a planned stop: production runs up
            to it and continues after it, the cut coil is finished and the remaining coils follow as
            a new lot (see <i>Planner's hand</i>). A fault that does not stop the work center does
            not change the plan.
          </li>
          <li>
            <b>Mould maintenance</b> days: no part of a job with that mould may
            fall on them.
          </li>
          <li>
            <b>Mould not ready</b>: with a ready date (and time), the mould is
            blocked until that moment — ready at 10:00 means that day's
            earlier hours are closed too; without a date, it is held out of
            the plan entirely.
          </li>
          <li>
            <b>Shot-limit alarm</b>: once a mould passes its periodic
            maintenance limit, it is held out of the plan until the alarm is
            closed.
          </li>
          <li>
            <b>Excluded</b> materials (your rule) are not planned.
          </li>
        </ul>
      </Step>

      <Step n={5} id="order" title="Put the work in order">
        <p>The requirements are planned one by one, in this order:</p>
        <ol className="list-decimal">
          <li>Materials you moved to the front (and lots moved forward so they are not late)</li>
          <li>
            <b>Backlog</b> — the ZPP overdue quantity left after stock. Due the next
            day at {current.cutoff}.
          </li>
          <li>
            <b>Urgent</b> — a lot whose stock falls to the safety level now: it runs
            out within {current.safety} working day(s). Due at {current.cutoff} on the
            day the stock runs out.
          </li>
          <li>
            <b>Fill</b> — every other lot: future days and weeks. It may start{' '}
            {current.safety} working day(s) before its stock runs out, or up to{' '}
            {current.pullForward} days earlier when a work center would stand idle.
          </li>
          <li>
            <b>Long-term</b> (only when ZPP_DAILY is loaded) — lots from the weekly
            ZPP. They come after all of the above, even after materials moved to the
            front, and only fill the free capacity that is left. Example: one work
            center, one shift; part D needs 7 000 pcs on Wednesday in ZPP_DAILY
            (700 min + 30 min setup), part L has only a weekly 4 000. D runs first
            on Monday and is on time; L follows on Tuesday as a long-term lot and is
            not late. Had L gone first, D would have been ready too late.
          </li>
        </ol>
        <p>
          Backlog always goes before urgent, even when both are due at the same
          moment. <b>One exception — the mounted die:</b> when an urgent job would
          need a setup on a work center whose mounted die still has a fill lot waiting,
          that fill lot runs on first without a setup, as long as the urgent job
          is still ready by its delivery time. Otherwise the die would be taken
          off for the urgent job and mounted again later — two setups instead of
          one. If the urgent job would be late, it goes first.
        </p>
        <p>
          Within each group, the lot whose stock runs out first goes first.
          When that is equal too, the part that can run on the <b>fewest
          work centers</b> goes first: a single-work center part takes its slot before a
          part with alternatives, which then spreads to the work centers that are
          left. Whoever is placed first gets the best slots.
        </p>
      </Step>

      <Step n={6} id="place" title="Place each job">
        <p>
          The candidates are the material's main work center — plus its
          alternatives <b>only if the part is ticked Flexible work center</b> in
          master data (or only the pinned work center). A part that is not flexible
          always runs on its main work center, even if that makes it late: its
          quality approval belongs to that work center. On each candidate the engine looks for
          the earliest free time — also in gaps left earlier — and builds the
          job:
        </p>
        <div className="my-3 flex flex-wrap items-center gap-2 text-xs">
          <Block tone="bg-slate-200 text-slate-900">Mould setup</Block>
          <span aria-hidden>→</span>
          <Block tone="bg-amber-100 text-amber-900">Quality approval</Block>
          <span aria-hidden>→</span>
          <Block tone="bg-emerald-100 text-emerald-900">Production (coil 1)</Block>
          <span aria-hidden>→</span>
          <Block tone="bg-sky-100 text-sky-900">Frequency stop (e.g. coil change)</Block>
          <span aria-hidden>→</span>
          <Block tone="bg-emerald-100 text-emerald-900">Production (coil 2)</Block>
          <span aria-hidden>→ …</span>
        </div>
        <Formula>
          pure time = pieces × cycle time (min/piece) · job time = max(pure time ÷ Accepted OEE, pure time + setup +
          frequency stops + approval)
        </Formula>
        <p className="text-xs text-muted-foreground">
          Every part on every work center — press, nut welding, spot welding, assembly — is timed this way;
          no work center is left out of the plan. Example: {cycleExample.qty.toLocaleString('en-GB')} pieces ×{' '}
          {cycleExample.minutes.toFixed(CYCLE_DECIMALS)} min = {Math.round(cycleRun.theoreticalRunMinutes)} min of pure time; at a{' '}
          {Math.round(cycleExample.oee * 100)} % Accepted OEE the job is {Math.round(cycleRunOee.totalMinutes)} min.
          A part without a cycle time but with the old SPM and cavities runs 1 ÷ (SPM × cavities) min/piece — its
          time is exactly what it was (strokes ÷ SPM). With neither, the part has no speed and the plan check flags
          it (“no cycle time in master data”). A master data file may give the time in seconds instead — the
          presses, spot welding and assembly lines are all measured that way (a <b>Saturasyon</b> or{' '}
          <b>Birim süre saniye</b> column) — and the upload divides it by 60:{' '}
          {cycleSecondsExample} s = {cycleFromSeconds?.toFixed(CYCLE_DECIMALS)} min/piece. Cycle times are
          kept to {CYCLE_STORE_DECIMALS} decimals and shown with {CYCLE_DECIMALS}, because a press part can
          run under a second: {pressSecondsExample.toFixed(CYCLE_DECIMALS)} s is{' '}
          {formatCycleInput(pressCycle)} min/piece, and at {CYCLE_DECIMALS} decimals it would be{' '}
          {pressCycle.toFixed(CYCLE_DECIMALS)} — 2.6 % more time on every job of that part
          ({(10_000 * pressCycle).toFixed(1)} min for 10,000 pieces against{' '}
          {(10_000 * Number(pressCycle.toFixed(CYCLE_DECIMALS))).toFixed(1)} min).
          Strokes = ⌈pieces ÷ cavities⌉ (= pieces when no cavities are
          entered) count only for the mould shot limit and strokes per coil.
          Setup, frequency stops (coil changes …) and quality approval sit inside that time; when they do not fit, the job is the pure
          time plus those stops. Frequency stops = coils − 1 (coils = ⌈quantity ÷ pieces per coil⌉, pieces per coil = ⌊coil weight ÷
          gross weight⌋); a work center whose frequency stop is — none — never stops for it. A co-product comes from the same strokes:
          strokes × its own cavities.
        </p>
        <p>It has to respect every rule at once:</p>
        <ul>
          <li>
            If the same mould is already on the work center, the setup is skipped.
          </li>
          <li>
            {current.crossShifts
              ? 'A setup may start near the end of a shift and be finished by the next shift; it never runs past the last working minute of the day. Production can.'
              : 'A setup or coil change never crosses the end of a shift — no crew starts a setup it cannot finish. Production can.'}
          </li>
          <li>
            <b>Setups run on through tea and meal breaks.</b> The setup team is
            indirect and takes its break after the setup. A 30-minute setup that
            meets a 15-minute tea break after 15 minutes still takes 30 minutes;
            production starts right after the break, and the break costs the work center
            nothing. Shift handover and maintenance stops do pause a setup.
          </li>
          <li>
            <b>Setup team</b>: normally at most {current.plantNormal} mould setup(s) run at
            the same time anywhere in the plant. <b>Dynamic rule:</b> for backlog, or for a
            job that would otherwise start after its stock runs out, up to{' '}
            {current.plantUrgent} setups may overlap so production starts sooner. Once the
            urgent work is placed, setups go back to one after the other.
          </li>
          <li>
            <b>No idle work center while work is waiting</b>: a lot may start up to{' '}
            {current.pullForward} day(s) before it is needed when its work center would
            otherwise stand idle, so the plan fills the working days you opened on the
            Work Calendar — the same hours the Capacity Dashboard counts. If nothing is
            urgent, the die already on the work center keeps running for its next lot first, so
            no extra setup is made.
          </li>
          <li>
            Every idle gap on the plan chart shows why it is there (setup team busy, die
            on another work center, not allowed yet, …).
          </li>
          <li>
            <b>Crane</b>: in one hall, mould setups are at least{' '}
            {current.setupGap} min apart and at most {current.concurrent} at a
            time; coil changes are at least {current.coilGap} min apart; a mould
            setup and a coil change never overlap.
          </li>
          <li>A mould cannot be on two work centers at the same time.</li>
          <li>
            If the quantity needs more strokes than the mould's shot limit, it
            is split into batches at <b>whole coils</b> — a coil is never split
            between batches. If one coil alone is larger than the limit, the
            batch is that coil and the job is flagged.
          </li>
          <li>
            A lot does not start before its safety date ({current.safety} working
            day(s) before its stock runs out) minus the pull-forward window of{' '}
            {current.pullForward} day(s).
          </li>
        </ul>
        <p>
          <b>The work center that finishes the job earliest wins</b> — with one
          exception: when nothing is urgent, continuing the die already mounted
          (no setup) is preferred. For backlog, or a job that would otherwise
          start after its stock runs out, the engine also tries the dynamic
          setup rule and keeps whichever finishes sooner. The chosen work center
          time, crane slots, setup slot and mould are then booked, and the
          next requirement is placed.
        </p>
      </Step>

      <Step n={7} id="check" title="Check and report">
        <ul>
          <li>
            A part is <b>late</b> when the quantity the customer needs is not
            ready by <b>{current.cutoff}</b> on the day it is needed — not when
            the whole lot ends. Every day a lot covers is checked, not only the
            first one. Backlog in ZPP and anything needed today are due
            the <b>next day at {current.cutoff}</b>. Public holidays are not skipped: a customer
            may want parts on a holiday. How late is shown in
            hours and days. The engine does not leave it — see{' '}
            <a href="#late" className="underline">
              Late jobs are re-planned
            </a>
            .
          </li>
          <li>
            The <b>job window</b> (click a bar) shows the same check per job: the
            <b> Req dates</b> the job covers and their quantity, start and end time,
            and a <b>Status</b> per need day — how many pieces are ready how many
            hours <b>before</b> or <b>late</b> against {current.cutoff} on that day.
            What the lot makes beyond the need (rounding up to whole coils or the
            Min. lot) is <b>overstock</b>. Example: 3,000 pcs of backlog, one coil
            makes 6,000 → &ldquo;3,000 pcs (2 hours late) and 3,000 pcs
            (overstock)&rdquo;. A job whose stock lasts the whole horizon has no
            need day: all of it is overstock (stock build).
          </li>
          <li>
            What does not fit anywhere goes to <b>Unplanned</b>, with the
            reason and a link to the fix (no master data, no eligible work center, no
            free capacity…).
          </li>
          <li>
            <b>Urgent raw material</b>: planned quantity × gross weight, walked in
            the order the steel is <b>needed</b> against coil stock plus coils in
            transit from their arrival day. A coil is urgent when the steel is
            needed within the next {current.rawUrgent} working day(s); those are
            listed on Overview. The need day of a job is its planned day — except a
            job <b>pulled forward</b> only so its work center is not idle: while the
            finished stock still covers the demand, its steel is needed on the day
            the lot may start (stock runs out − safety stock days), not on the
            pulled-forward day. Such a job can wait for the coil, so it shows as
            &ldquo;runs short later&rdquo;, with the planned day and the day the steel is
            needed. Co-products are not counted twice. The weekly requirement is
            separate — see{' '}
            <a href="#raw-mrp" className="underline">
              Raw material requirement
            </a>
            .
          </li>
          <li>
            Warnings list whatever changed the plan: moulds held out, work centers
            in maintenance, missing data.
          </li>
        </ul>
      </Step>

      <section id="late" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-sm font-semibold text-amber-950">Late jobs are re-planned</h2>
        <p className="mt-1 text-sm text-amber-900">
          A job that starts after its stock runs out means the customer stops —
          your own safety stock is the only margin. So a late job is never just
          reported; the engine plans again, up to six rounds:
        </p>
        <ol className="mt-2 ml-5 list-decimal space-y-1 text-sm text-amber-900">
          <li>
            <b>Move the late lot forward</b> within its own group: a late fill lot
            goes to the head of the fill lots, never ahead of backlog. It then
            tries every eligible work center again, so an alternative work center that is
            free earlier is found.
          </li>
          <li>
            <b>Let its setup overlap</b>: a late-risk job may set up while
            another setup runs — also in the same hall — at most{' '}
            {current.plantUrgent} at once in the whole plant, so production starts
            sooner. As soon as no backlog or late-risk job is left, setups no
            longer overlap (one per hall, {current.plantNormal} in the plant). Coil
            changes never overlap.
          </li>
          <li>
            <b>Keep the best plan</b>: fewest unplanned (daily lots), then fewest late
            <b>parts</b> (three late lots of one part are one customer stop), then
            fewest late hours, and only then the fewest unplanned long-term lots.
            Long-term lots are never late and never moved forward. A round that does not improve does not stop the
            search — the next round may — but the best plan so far is kept.
          </li>
        </ol>
        <p className="mt-2 text-sm text-amber-900">
          <b>Coils are never cut to save a late job.</b> A mounted coil is run
          to the end; cutting it would leave a half coil, a second setup and a
          second coil mount later. If moving forward is not enough, the job stays
          late and is reported.
        </p>
        <p className="mt-2 text-sm text-amber-900">
          Whatever is still late is listed on the Overview in red, <b>once per
          material</b> (its first late lot). <b>Late is a share, not a whole
          order.</b> The ZPP daily need is the guide: every need day is a delivery
          point, due at the delivery time ({current.cutoff}) with everything needed
          up to that day (ZPP_DAILY on its own date; beyond it the weekly ZPP spread over
          the working days; backlog and today's need are due the next day). At that moment
          the engine counts what has already been pressed:
        </p>
        <ul className="mt-1 ml-5 list-disc space-y-1 text-sm text-amber-900">
          <li>
            <b>Needed qty</b> — what the customer needs by the first missed delivery point
            (cumulative ZPP need, not the lot size: a 40 000 pcs lot that covers 8 days owes
            only the first day's need at the first point).
          </li>
          <li>
            <b>On time</b> — the share of it already ready at the delivery time. Pieces come
            out evenly while the press runs (setup and approval give none), so a job that
            started before the deadline has delivered part of the need.
          </li>
          <li>
            <b>Late share</b> — the rest, with the <b>average</b> and the <b>last piece's</b>{' '}
            delay: "15% (900 pcs) · avg 0.8 h, last 1.5 h". The last piece's delay is{' '}
            <i>ready − delivery time</i>: if production starts 6 h after the delivery time and
            takes j h, the whole need is complete 6 + j h late. The customer is fed from the
            first pieces, so the average is closer to how long the line really waits.
          </li>
        </ul>
        <p className="mt-2 text-sm text-amber-900">
          The independent plan check (below) replays the same ZPP need hour by hour and reports
          the same shortfall and recovery time, so the two always agree.
        </p>
        <p className="mt-2 text-sm text-amber-900">
          <b>Why late</b> gives the reasons found in the plan itself, the
          strongest first:
        </p>
        <ul className="mt-1 ml-5 list-disc space-y-1 text-sm text-amber-900">
          <li>already due when the plan was calculated (backlog, or the stock did not cover today);</li>
          <li>
            cannot be ready even if started now — the job alone needs more press time
            (setup + approval + production) than is left until the deadline;
          </li>
          <li>
            the work center is busy before it: how many jobs and hours, split into needed
            earlier, frozen / approved and needed later, and which were placed first by a
            plan override;
          </li>
          <li>the press waited before the setup (setup crew, mould on another press…);</li>
          <li>hours between setup start and ready when the press does not work (no shift, weekend, breaks);</li>
          <li>a capacity factor below 100%.</li>
        </ul>
        <p className="mt-2 text-sm text-amber-900">
          <b>How the hours are calculated</b> (tap the row): setup start → setup +
          quality approval + production of the needed pieces at the part's speed
          (pieces per hour = 60 ÷ cycle time × performance) → pieces ready at the
          delivery time (on time share) → ready time of the last needed piece. Last
          piece late = ready − needed by (delivery time on the need day). When the press
          cannot make it, <i>Why late</i> compares the production time the press has between
          the setup start and the deadline with the time the needed pieces take. Next to it are the inputs that decide it — demand and finished
          stock, speed, setup and approval minutes, the shifts and delivery time —
          with links to where they are set. If one of them is wrong (e.g. a setup
          of 600 min instead of 60, a missing shift), the part only <i>looks</i> late:
          correct it there and recalculate.
        </p>
      </section>

      <section id="scenarios" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Scenarios — trying other plans</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          One order of placing jobs is not always the best. After the plan above
          is built, the engine builds it again with other variations and keeps
          the best one:
        </p>
        <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>
            <b>Order</b> within the same urgency: stock-out day (standard),
            shortest job first, longest job first, parts with the fewest work centers
            first, and shuffled orders.
          </li>
          <li>
            <b>Work center choice</b>: the work center that finishes first (standard), the
            one that can start first, or the least loaded one.
          </li>
          <li>
            <b>Best</b> means: fewest unplanned daily lots, then fewest late parts, then
            fewest late hours, then the fewest unplanned long-term lots, then the highest production time (setups do not
            count as production), then the fewest setups. Utilisation never wins
            over a late part.
          </li>
          <li>
            <b>Utilisation</b> = busy work center hours ÷ available hours (working
            calendar minus maintenance) in the next 7 days, all work centers together.
          </li>
          <li>
            <b>It stops</b> as soon as {current.target}% is reached with nothing
            late, after{' '}
            {current.maxScenarios} scenarios, after 25 scenarios without an
            improvement, or after two minutes. The Production Plan then shows
            the level reached (e.g. "best of {current.maxScenarios} scenarios
            reaches 90%"), the utilisation of each work center and the scenarios
            compared.
          </li>
          <li>
            <b>Local search</b> then works on each late part directly: move it
            1, 2 or 4 days forward in its group, switch its "moved forward" mark,
            or move a non-late part that runs before it on the same work center 2 days
            back. Each move rebuilds the whole plan and is kept only if the plan
            gets better (at most 150 moves or one minute).
          </li>
          <li>
            <b>Lot split</b> (also local search): a long lot that runs before a late
            part on the same work center — say 30,000 pcs — is cut in 2 or 3 parts so the late part
            runs <i>between</i> them: 15,000, the late part, then the other 15,000.
            Parts are always whole coils (a mounted coil is never cut), the first part covers
            what is needed first (rounded up to whole coils), and a lot is not split if a part would
            fall below the Min. lot. The part that covers no need is only coil surplus and
            is planned as fill, so it no longer holds up urgent parts. The second part needs another
            setup, so a split is kept only when it saves a late part; the plan marks the jobs{' '}
            <i>"lot split 1/2"</i> and the plan check lists the lots that were split. A quantity
            change on the chart applies to the whole lot.
          </li>
        </ul>
      </section>

      <section id="press-start" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Planner's hand — closed periods and delays</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Unless you say otherwise every work center is planned from now. At the top left of the
          Production Plan (<b>Plan settings</b>) you can set, per work center, before recalculating:
        </p>
        <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>
            <b>Closed from – to</b> (date and time) with a reason — no operator, no raw material…
            The work center takes no work between the two moments; the closed hours show on the
            chart. Leave <i>from</i> empty to close it from now until <i>to</i>. Example: closed
            Monday 07:30 – 10:00 on a 07:00 shift — a 60-minute job does not fit in the first half
            hour, so it starts at 10:00; a job before a later closed period (12:00 – 14:00) is not
            moved. Approved jobs that touch the closed period are released and planned again.
          </li>
          <li>
            <b>A closed period — and an open breakdown that stops the press — is a planned stop, not a
            wall.</b> Production runs up to it, the press
            stops with the coil still in it and continues after it — like a shift that is not
            worked. Setup, quality approval and coil changes do not cross it; if the stop comes right
            after the setup (no stroke yet) the job starts after the stop instead. When the stop cuts
            a coil, the job ends when that coil is finished; the remaining coils become a new lot
            that is planned next (the die is still mounted, so no setup). Example: 1,000 pcs per
            coil, 100 min per coil, 3 coils, stop 09:00 – 10:00 on a 07:00 shift: setup 07:00 – 07:30,
            first coil 07:30 – 09:00 and 10:00 – 10:10 → a 1,000-piece job; the other 2,000 follow at
            10:10. If the die should come off instead, cancel that lot by hand.
          </li>
          <li>
            <b>Behind / ahead</b> (hours): the line did not keep to the approved plan. +3 h moves
            the approved (frozen and running) jobs 3 hours later and closes the first 3 hours as
            "Behind plan"; −2 h brings them forward, never before now. "All work centers" sets it for
            the whole line at once.
          </li>
        </ul>
        <p className="mt-2 text-sm text-muted-foreground">
          Work that is not approved needs no correction: every Calculate plan rebuilds the plan from
          the current moment.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Next to it, <b>Work calendar</b> shows the chosen work center week by week: shifts 1–3 per
          day as the plan uses them (Work Calendar, week exceptions, holidays, day records) and
          overtime hours. It is read-only until you press <b>Edit</b>: then a click on a cell opens
          or closes that shift — a day record (see <a href="#capacity">Build the capacity</a>) — and
          the OT row adds or removes that day's overtime. Every day of the week can be edited,
          including a Saturday or Sunday that is closed and therefore absent from the plan's days;
          the OT row only offers the overtime that fits that day's free window and writes
          <i>full (24 h)</i> when the day already works 24 hours. Nothing is written until
          <b>Save</b>; a dashed cell is not in the plan until the next Calculate plan.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          On the chart a job is drawn as <b>one bar per working stretch</b>. Planned stops do not
          break the bar — they are small dots inside it — but a <b>closed shift does</b>: with the
          1st and 3rd shift open and the 2nd closed, the work is drawn as 07:00–15:00 and
          23:00–07:00 with 15:00–23:00 left empty, because the work center does not run then.
        </p>
      </section>

      <section id="org-filter" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Department, cost center and work center filter — a view, not a rule</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Three pages carry the same filter: <Link to="/planlama" className="underline">Production Plan</Link>,{' '}
          <Link to="/referanslar" className="underline">Master Data</Link> and{' '}
          <Link to="/capacity" className="underline">Capacity Dashboard</Link>. You pick a{' '}
          <b>department</b>, then one or more of its <b>cost centers</b>, then — on Master Data and
          the Capacity Dashboard — one or more <b>work centers</b>. Each level narrows the next, so
          the work centers you can pick are exactly those of the cost centers of that department.
          Each page remembers its own selection for the next time you open it.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          What each page narrows: on Production Plan the chart, the work center lists, the part list
          of <b>Add job</b>, the <b>Pin to work center</b> list and the late-job count; on Master
          Data the part list — a part stays while its main work center <i>or one of its
          alternatives</i> is among the chosen ones, and a part with no work center at all belongs
          to no department and shows only with the filter off; on the Capacity Dashboard the cards,
          the chart and the work center list.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          <b>It does not change the plan or the numbers.</b> The plan and the capacity forecast are
          always calculated for the whole plant — capacity, cranes, setup teams and mould limits are
          only correct when every work center is seen at once — so filtering never moves a job,
          never changes an hour on the Capacity Dashboard, and two planners looking at different
          departments see the same plan. Nothing is hidden from the engine; it is hidden from the
          screen.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          <b>Calculate plan</b> therefore always calculates every work center together — presses and
          operator-plan lines (nut welding, spot welding…) in one run, whatever the filter shows. The
          calendar box follows the filter: work centers of a <i>Shift</i> cost center show the{' '}
          <b>Work calendar</b> (shifts and overtime per work center), an <i>Operator</i> cost center
          shows <b>Operators per shift</b> (people per day and shift); both appear only when the
          selection holds both kinds. <b>Not yet linked:</b> a part made on a press and used on a
          welding line is planned on each line on its own — the welding job does not wait for the
          press job that makes its part. The independent check warns when it does not fit (see{' '}
          <a href="#component-ready" className="underline">intermediate part not ready</a>).
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          The link comes from the definitions: work center → cost center (
          <Link to="/makineler" className="underline">Work Center Definitions</Link>) and cost center
          → department (Company settings). A work center without a cost center is listed under{' '}
          <i>Without a department</i> so it cannot get lost. Each option shows how many work centers
          it holds. Every work center is in the plan — presses as well as nut welding, spot welding,
          robot and assembly lines — because every part is timed by its cycle time (see{' '}
          <a href="#inputs" className="underline">Collect the data</a>); there is no “not planned” work
          center.
        </p>
      </section>

      <section id="capacity-dashboard" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Capacity Dashboard — Prediction OEE and Accepted OEE</h2>
        <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>
            <b>Capacity</b> is the same net hours the plan uses (step 3): one formula for the plan,
            the Work Calendar, the Capacity Dashboard and Performance.
          </li>
          <li>
            <b>Demand hours</b> = pieces × cycle time ÷ 60 ÷ OEE, after finished stock, earliest week
            first; this week carries the backlog. Groups are the work center <b>categories</b>.
          </li>
          <li>
            <b>A) Prediction OEE</b> — one rate for every part ({current.predictionOee}%), set on the
            dashboard. It is a what-if for that view only and never changes the plan.
          </li>
          <li>
            <b>B) Accepted OEE</b> — each part's value from Master Data, the same as the plan.
          </li>
          <li>
            Both use the same method: available hours as they are, production time = ideal time ÷
            OEE. The <b>capacity factor</b> (Performance page) is a third, separate number: the
            measured attainment against the approved plan, applied to the plan's capacity.
          </li>
        </ul>
      </section>

      <section id="oee-short-stops" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">OEE — availability and performance, short stops</h2>
        <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>
            Times are added first, then divided — never an average of percentages. <b>Availability</b> = Production ÷ Loading,{' '}
            <b>Performance</b> = Operation ÷ Production, <b>Quality</b> = Good ÷ (Good + Scrap + Reject), <b>OEE</b> = A × P × Q.
            Loading already leaves out the planned stops (breaks, no work, try-out: Reason Code 1 set as a break in OEE Settings).
          </li>
          <li>
            <b>Short stops</b>: an unplanned stop shorter than {MES_SHORT_STOP_MIN} min is a <b>performance</b> (speed) loss; one of{' '}
            {MES_SHORT_STOP_MIN} min or longer is an <b>availability</b> loss. The MES already works this way: its production time only
            deducts the stops of {MES_SHORT_STOP_MIN} min and longer, so A and P are the MES values on every OEE page (Dashboard, trends,
            weekly / monthly, Daily Report, Board, KPI).
          </li>
          <li>
            The loss pages split the same reason code by the length of each stop. The Loss Bridge shows only the long stops (e.g.
            “Machine”); the short ones are <b>not a bridge step</b> — they stay inside Speed loss = Production − Operation (the step
            note gives their minutes) and are analysed in the duration buckets of MTTR &amp; MTBF. They never touch the availability
            step: A, the availability loss and “Not explained” are the same with or without them. Losses Trend keeps a “Short
            stops” column (Speed = Production − Operation − short stops). The totals and the OEE never change.
          </li>
          <li>
            The limit is set in OEE Settings → Numbers (default {MES_SHORT_STOP_MIN} min, whole minutes). Another value changes only the
            loss split; A and P stay as in the MES and the bridge shows the difference.
          </li>
          <li>
            Stop durations are stored from {dmy(SHORT_STOP_DATA_FROM)}; before that the stops are not split (all availability) and the
            page says “duration split not available before {dmy(SHORT_STOP_DATA_FROM)}”.
          </li>
          <li>
            <b>MTTR / MTBF</b> count only the stops of the limit and longer by default (breakdowns and setups are availability losses);
            the short stops are the first duration bucket. Agent Report, Agent Insights and Open Topics read the long stops for die and
            machine (availability) notes and the short stops for the micro-stop / speed notes.
          </li>
          <li>
            Example (test): on 21.09 at PRS-105 shift 3, Loading − Production is 140.6 min = the stops of 2 min and longer; the 21.6
            min of shorter stops are inside Production − Operation.
          </li>
          <li>
            <b>Undefined stops</b>: Reason Code 1 or Reason Code 2 “{UNDEFINED_RC1}” (or an empty Reason Code 2) means the operator did
            not define the stop. Reason Code 1 “{UNDEFINED_RC1}” is always a <b>loss</b> (even when it is not ticked as a loss in OEE
            Settings → Reason Code 1) and never a planned break; Reason Code 2 “{UNDEFINED_RC1}” is a loss when its Reason Code 1 is. On
            every OEE page (Losses Trend, Loss Bridge and Level 3, Asakai, Daily Report, Agent Report, Agent Insights, Open Topics) these
            stops sit under <b>{UNASSIGNED}</b>; a “{UNDEFINED_RC1}” row in OEE Settings → Loss groups is not used. The short-stop split
            works the same way: stops shorter than the limit go to Short stops (speed), the longer ones to {UNASSIGNED} (availability).
            Planned breaks are not affected.
          </li>
          <li>
            Example (test): Reason Code 1 “{UNDEFINED_RC1}”, Reason Code 2 STP (Setup), 30 min → {UNASSIGNED} 30 min, Setup 0 min.
          </li>
          <li>
            <b>Column order</b> is the same on every page: the loss groups in their OEE Settings order (↑ ↓ buttons), then{' '}
            {SHORT_STOPS} (where shown), then {SPEED}, and last {UNASSIGNED}. Example (test): groups KLP, STP, ARZ → KLP, STP, ARZ,{' '}
            {SHORT_STOPS}, {SPEED}, {UNASSIGNED}.
          </li>
          <li>
            <b>Asakai pages</b> (Asakai weekly, Asakai detail) do not show <b>today</b>, the system&apos;s working day: the day is not
            over, so the part-day data uploaded during it would make OEE and the loss shares wrong. The latest day on both pages is
            yesterday (the date box cannot go further), and the running week and month are the sum of the days before today — an
            uploaded Weekly / Monthly KPI row that covers today is not used. Each page also shows <b>every work center of the cost
            center</b> (Machines → cost center), even one without data on the selected day or week: its row stays empty.
          </li>
          <li>
            A loss share can pass 100 % of Loading when the MES Loading of a shift is shorter than shift time − planned stops (e.g.
            21.09 PRS-104 shift 1: Loading 185.7 + planned 209.3 = 395 of 480 min, recorded unplanned stops 191.5 min = 103 %). The
            stops are counted as recorded; the Loss Bridge shows the surplus as “{OVER_RECORDED}”.
          </li>
        </ul>
      </section>

      <section id="raw-mrp" className="mt-8 max-w-5xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Raw material requirement (MRP) — independent of the plan</h2>
        <ol className="mt-2 ml-5 list-decimal space-y-1 text-sm text-muted-foreground">
          <li>Demand: ZPP up to its last week; backlog goes into this week.</li>
          <li>
            Finished stock (locations ticked <i>Finished goods</i> on Storage Locations) is deducted
            per part, earliest weeks first. What is left must be pressed: a part whose stock covers 3
            weeks needs no steel in those 3 weeks.
          </li>
          <li>
            Steel: pieces × gross weight per piece. A co-product pair is pressed once — strokes are the
            larger of the two needs — and only the primary part's weight counts.
          </li>
          <li>
            The production plan is <b>not added</b>: its early production and whole-coil surplus are the
            same demand, timed and rounded differently. Adding them would order the same steel twice.
            The safety stock absorbs the difference.
          </li>
          <li>
            Supply: coil stock on hand in the locations ticked <i>Raw material</i>
            plus the in-transit list, each quantity in its ETA week (no ETA or a past ETA = this week).
          </li>
          <li>
            Week by week: stock at the start of the week + arrivals + an order must cover that week's
            use <b>and</b> the use of the N <b>working days</b> after the week ends — with 10 days every
            week end holds the next 2 weeks. Otherwise an order is due that week: the shortfall + the
            standard extra (500 kg by default).
          </li>
          <li>No demand, no order: after the last ZPP week the need is zero; nothing is forecast (kanban comes later).</li>
          <li>
            One row is one <b>coil</b>, not one part: every part pressed from it adds its need, and a
            co-product pair needs steel when either side does. Open a row to see it <b>by finished
            product</b> — each part's finished stock, the weeks it covers and the week its steel is first
            needed — and why the first order falls in its week. An order in a week with no use of its own
            is the safety window: the use of the next N working days (a holiday week reaches further).
          </li>
          <li>
            <b>Order by</b>: an order must be in by the Monday of its delivery week, so it is placed at
            the latest on that Monday − the coil's <b>lead time in calendar days</b> (weekends and
            holidays count — the supplier quotes calendar days). Each coil has its own lead time on Raw
            Material Coverage → Lead times; a coil without one uses the default and is marked{' '}
            <i>not entered</i>. A date already passed is <b>late</b> (red), a date in this week is
            amber. The lead time only dates the order: it does not move the delivery week, the safety
            stock or the production plan.
          </li>
          <li>
            Now: N = {current.rawCoverage} working days, extra = {current.rawExtra.toLocaleString('en-GB')} kg, default
            lead time {current.rawLeadDefault} calendar days ({current.rawLeadEntered} coil(s) with their own). Working
            days are the plant's working days (not a holiday, at least one work center with normal shifts).
          </li>
        </ol>
        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">FMEA — what can go wrong and how the method guards it</h3>
        <div className="mt-2 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Failure mode</th>
                <th className="px-2 py-1.5 font-medium">Effect</th>
                <th className="px-2 py-1.5 font-medium">S</th>
                <th className="px-2 py-1.5 font-medium">O</th>
                <th className="px-2 py-1.5 font-medium">D</th>
                <th className="px-2 py-1.5 font-medium">RPN</th>
                <th className="px-2 py-1.5 font-medium">Guard in the method</th>
              </tr>
            </thead>
            <tbody>
              {FMEA_ROWS.map((r) => (
                <tr key={r[0]} className="border-t border-border align-top">
                  <td className="px-2 py-1.5 font-medium text-foreground">{r[0]}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{r[1]}</td>
                  <td className="px-2 py-1.5">{r[2]}</td>
                  <td className="px-2 py-1.5">{r[3]}</td>
                  <td className="px-2 py-1.5">{r[4]}</td>
                  <td className="px-2 py-1.5 font-medium">{(r[2] as number) * (r[3] as number) * (r[4] as number)}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{r[5]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          S = severity, O = occurrence, D = detection (1–10); the ratings are those before the guard.
          Steel already ordered but not yet shipped is only known when it is on the in-transit list;
          keep that list up to date.
        </p>
      </section>

      <section id="check" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-sky-200 bg-sky-50/60 p-4">
        <h2 className="text-sm font-semibold text-foreground">Independent check — is the plan really right?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The plan check above re-counts the engine's own numbers. The{' '}
          <b>independent check</b> is separate code that shares nothing with the
          planner. After every calculation it:
        </p>
        <ol className="mt-2 ml-5 list-decimal space-y-1 text-sm text-muted-foreground">
          <li>
            <b>Replays stock hour by hour</b> from the SAP files (ZPP, ZPP_DAILY,
            MB52 in the Finished goods locations) and the planned jobs: every need day is due at{' '}
            {current.cutoff}, production arrives as it is pressed. Every moment
            stock goes below zero is a real customer stop. The late list must
            match it exactly — a part the engine missed, or a false alarm, is
            shown. Its own rule for ZPP_DAILY: when only weekly-ZPP (long-term)
            quantity is short, it is counted as a long-term shortage, not a
            customer stop.
          </li>
          <li>
            <b>Asks "could any plan have avoided it?"</b> for each short part: is
            there enough work center time before the deadline on its work centers, even
            alone? Can the setup team and hall cranes do all setups needed by
            then? The answer is "No" (proven by capacity), "Yes" (a free slot
            existed) or "not proven". It also gives the proven minimum number of
            short parts that no plan can go below.
          </li>
          <li>
            <b>Re-checks every rule</b> on the real clock: two jobs on one work center,
            one die on two work centers (also overnight), two setups in one hall (also
            across 07:00), plant-wide setups, eligible work center, working time and
            maintenance, whole coils / Min. lot, pull-forward window, a die change
            without a setup, backlog before urgent, and on an operator-plan cost center that
            the crews of the running lines fit the operators entered for that shift.
          </li>
          <li id="component-ready">
            <b>Warns when an intermediate part is not ready</b> (advisory — not a broken rule, the
            plan stays “OK”): when a part&apos;s <i>raw material</i> code is another part&apos;s code
            (nut welding ← the stamped part it welds on), that stamped part is its component, 1 pc per
            pc. At the end of each run of the nut welding job the component&apos;s stock (all
            locations) plus what is produced by then must cover what has been used by then. Example:
            100 in stock, 100 pressed by 09:00, nut welding uses 300 by 11:00 → “needs 300 pcs, 200
            available”. The engine does <b>not</b> plan this link: each line is still planned on its
            own and the component&apos;s own customer demand is not part of this count.
          </li>
          <li>
            <b>Measures efficiency</b>: setups against the minimum possible,
            production time against the maximum possible, and where idle time
            comes from — no work, not yet allowed, or waiting for the setup team.
          </li>
          <li>
            <b>Flags data to check</b> for short parts: stock in other locations
            (not ticked Finished goods), positive values in ZPP, backlog smaller than stock, an old
            stock file, missing master data.
          </li>
        </ol>
      </section>

      <section id="alarms" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Alarms — dies and machines</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Die and machine follow-up live in their own modules. PlanningExpert
          keeps only what matters to the plan, on the{' '}
          <Link to="/alarms" className="underline">
            Alarms
          </Link>{' '}
          page, in two lists:
        </p>
        <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>
            <b className="text-foreground">Holding up the plan</b> — a die is not
            ready, has no ready date, has a shot-limit alarm or is in
            maintenance, or a work center is down or in maintenance, <b className="text-foreground">and</b>{' '}
            a part's stock runs out before it is available (or its job is late
            or cannot be planned). Example: die ready the day after tomorrow at
            10:00, 1 000 parts to ship tomorrow.
          </li>
          <li>
            <b className="text-foreground">For information</b> — not available,
            but the stock lasts until it is back, or there is no demand in the
            horizon. The planner should know; nothing is late.
          </li>
        </ul>
      </section>

      <section className="mt-8 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">When is it recalculated?</h2>
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted-foreground">
          <li>A few seconds after any change to its data (an upload, a setting, a rule).</li>
          <li>Every hour, because the hours that pass come off today's capacity.</li>
          <li>
            Whenever you press <b>Recalculate now</b> on the{' '}
            <Link to="/planlama" className="underline hover:no-underline">
              Production Plan
            </Link>
            .
          </li>
        </ul>
        <p className="mt-2 text-sm text-muted-foreground">
          <b className="text-foreground">Approve plan</b> stores the plan as it is.
          The approved plan is the basis for the frozen days and for the
          "changes since the approved plan" list.
        </p>
      </section>
    </div>
  )
}

// ---- Tek kaynak: her bilgi nerede tanımlanır -------------------------------

const SOURCES: [string, string, string, string][] = [
  ['Work centers, halls, categories', 'Work Center Definitions', '/makineler', 'Work Calendar, Capacity Dashboard, overtime, Gantt, setup and crane rules'],
  ['Work center calendar and overtime', 'Work Calendar', '/takvim', 'Plan, Capacity Dashboard (same record), Performance'],
  ['Planned stops, holidays, settings', 'Work Calendar', '/takvim', 'Plan, capacity, raw material working days'],
  ['Parts, work centers per part, Accepted OEE', 'Master Data', '/referanslar', 'Plan, Capacity Dashboard B, raw material'],
  ['Which stock counts', 'Storage Locations', '/depolar', 'Plan, raw material, Capacity Dashboard, MB51 production'],
  ['Demand, stock, movements, in transit', 'SAP Data', '/sapdata', 'Plan, raw material, Actuals, Performance'],
  ['Prediction OEE', 'Capacity Dashboard', '/capacity', 'That dashboard view only'],
  ['Capacity factor', 'Performance', '/performans', 'Plan capacity'],
  ['Die readiness and maintenance', 'Die Follow-up', '/die-followup/maintenance', 'Plan, Alarms'],
  ['Breakdowns and work center maintenance', 'Machine Follow-up', '/machine-followup/breakdowns', 'Plan, Alarms'],
]

function SingleSource() {
  return (
    <section className="mt-6 max-w-5xl rounded-lg border border-border p-4">
      <h2 className="text-sm font-semibold text-foreground">One source for every input</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Each value is entered in one place only; every page and the plan read that same record, so
        the same number never differs between pages. Nothing is hard-coded — groups, for example,
        come from the work center category.
      </p>
      <div className="mt-2 overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">What</th>
              <th className="px-2 py-1.5 font-medium">Defined on</th>
              <th className="px-2 py-1.5 font-medium">Used by</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map(([what, page, to, used]) => (
              <tr key={what} className="border-t border-border align-top">
                <td className="px-2 py-1.5 font-medium text-foreground">{what}</td>
                <td className="px-2 py-1.5">
                  <Link to={to} className="underline hover:no-underline">
                    {page}
                  </Link>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{used}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ---- Sinoptik: algoritmanın tek bakışta resmi ------------------------------

function Box({ tone, title, children }: { tone: string; title: string; children?: ReactNode }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${tone}`}>
      <p className="text-sm font-semibold">{title}</p>
      {children && <div className="mt-0.5 text-xs opacity-90">{children}</div>}
    </div>
  )
}

function Down({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-1 pl-6 text-xs text-muted-foreground">
      <span aria-hidden className="text-base leading-none">↓</span>
      {label}
    </div>
  )
}

/** Bir pres şeridi: dolu kısım gri, adayın işi renkli. */
function Lane({
  press,
  busy,
  job,
  finish,
  chosen,
  note,
}: {
  press: string
  busy: number
  job?: number
  finish?: string
  chosen?: boolean
  note?: string
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-10 shrink-0 font-medium text-foreground">{press}</span>
      <div className="relative h-5 flex-1 rounded bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-l bg-slate-400/70"
          style={{ width: `${busy}%` }}
        />
        {job !== undefined && (
          <div
            className={`absolute inset-y-0 rounded border-2 ${
              chosen ? 'border-emerald-600 bg-emerald-200' : 'border-dashed border-amber-500 bg-amber-100'
            }`}
            style={{ left: `${busy}%`, width: `${job}%` }}
          />
        )}
      </div>
      <span
        className={`w-44 shrink-0 ${chosen ? 'font-semibold text-emerald-700' : 'text-muted-foreground'}`}
      >
        {note ?? `would finish ${finish}`}
        {chosen && ' ✓ chosen'}
      </span>
    </div>
  )
}

function Synoptic({ safetyDays }: { safetyDays: number }) {
  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold text-foreground">Planning algorithm — at a glance</h2>
      <div className="mt-3 grid gap-6 lg:grid-cols-2">
        <div>
          <Box tone="border-border bg-muted/50 text-foreground" title="1 · One list of every lot to produce">
            Demand minus stock, rounded to whole coils (or up to the Min. lot, when
            one is set; never less); a co-product
            pair is one lot. Each lot gets two dates
            from the projected stock: the day the stock would run out, and{' '}
            {safetyDays} working day(s) before it — the earliest it may start.
          </Box>
          <Down label="sorted once" />
          <Box tone="border-border bg-muted/50 text-foreground" title="2 · Sort the list">
            Moved to front → Backlog → Urgent (already below safety stock) →
            Fill. Same group: the stock that runs out first goes first. Still
            equal → the part with the fewest eligible work centers goes first.
          </Box>
          <Down label="take the next item from the top" />
          <Box tone="border-sky-300 bg-sky-50 text-sky-950" title="3 · Try EVERY work center it is allowed on">
            Not ticked Flexible work center → only the main work center (quality). Ticked →
            main work center and all alternatives (e.g. 104, 105, 108, 110). On each
            one, find the earliest free slot that respects all the rules: shift
            ends, crane, mould, maintenance.
          </Box>
          <Down label="each work center gives a finish time" />
          <Box tone="border-emerald-300 bg-emerald-50 text-emerald-950" title="4 · Choose the work center that finishes first">
            Not "the first work center in the list" and not "the main work center" — the
            one where the job is done soonest. When nothing is urgent, keeping
            the mounted die running (no setup) wins.
          </Box>
          <Down label="book it" />
          <Box tone="border-border bg-muted/50 text-foreground" title="5 · Book the slot">
            That work center time, the crane slots and the mould are now taken for
            all the items that follow.
          </Box>
          <Down label="back to 3 with the next item, until the list is empty" />
          <Box tone="border-amber-300 bg-amber-50 text-amber-950" title="6 · Anything late? → plan again">
            A job that starts after its stock runs out stops the customer. Late
            lots are moved to the front (they try every work center again) and may
            overlap their setup with another one. Coils are never cut. Up to 6
            rounds; the best plan is kept.
          </Box>
          <Down label="whatever is still late or does not fit" />
          <Box tone="border-destructive/40 bg-destructive/10 text-foreground" title="Late jobs / Unplanned">
            Shown in red on the Production Plan with the work centers tried and
            what would fix it.
          </Box>
        </div>

        <div className="rounded-lg border border-border p-4">
          <p className="text-sm font-semibold text-foreground">Example — decision #12</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Part A has a backlog, is ticked Flexible work center and can run on 104
            (main), 105 and 108. Eleven
            jobs are already booked. Grey = already booked, coloured = where A
            would go.
          </p>
          <div className="mt-3 space-y-2">
            <Lane press="104" busy={58} job={22} finish="Tue 11:30" />
            <Lane press="105" busy={30} job={22} finish="Mon 23:30" chosen />
            <Lane press="108" busy={100} note="full until the end of the horizon" />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            A goes to <b className="text-foreground">105</b>, even though 104 is
            its main work center, because 105 finishes it a shift and a half
            earlier. On the Production Plan, the job list shows exactly this
            line for every job in the <b className="text-foreground">Why this work center</b>{' '}
            column:
          </p>
          <p className="mt-2 rounded bg-muted px-2 py-1 font-mono text-[11px] text-foreground">
            #12 104 Tue 11:30 · <span className="font-semibold text-emerald-700">105 ✓ Mon 23:30</span> · 108 (full until the end of the horizon)
          </p>

          <p className="mt-4 text-sm font-semibold text-foreground">What this means for your question</p>
          <ul className="mt-1 ml-5 list-disc space-y-1 text-xs text-muted-foreground">
            <li>
              A part is never written onto a work center just because it is first in a
              list. Each job is compared on all of its work centers at the moment
              it is placed.
            </li>
            <li>
              A backlog part can only end up 4th on 104 if at that moment 105,
              108 and 110 could not finish it earlier. The job's line proves
              it.
            </li>
            <li>
              The engine decides one job at a time and never moves a job it has
              already booked. Two consequences are listed below under{' '}
              <a href="#limits" className="underline">
                Known limits
              </a>
              .
            </li>
          </ul>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">How to check the plan without recounting it</h3>
          <ol className="mt-2 ml-5 list-decimal space-y-1 text-xs text-muted-foreground">
            <li>
              <b className="text-foreground">Plan check</b> (Production Plan page): after
              every calculation, checking code that is separate from the engine goes
              through every job again and checks each rule — parts that are not
              flexible only on their main work center, one job per work center
              at a time, earliest work center chosen, crane gaps, setups at once in the
              plant, whole coils only, one mould on one work center, maintenance, no lot
              before its pull-forward window, nothing in the past. A broken rule
              shows in red with the job named.
            </li>
            <li>
              <b className="text-foreground">Why this work center</b> (job list): pick any job
              you doubt and read its decision: its order number and the
              finish time on every eligible work center.
            </li>
            <li>
              <b className="text-foreground">Automatic tests</b>: before any change goes live,
              the engine plans 40 randomly generated plants (progressive and
              transfer halls, single and shared parts, maintenance, stops) and
              the same checks must find zero broken rules. Your 104/105 case and
              your 1 000 / 2 000 / 6 000 coil case, the Wednesday sales day and
              the late-job repairs are tests too.
            </li>
          </ol>
        </div>

        <div id="limits" className="scroll-mt-20 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-950">Known limits</h3>
          <p className="mt-1 text-xs text-amber-900">
            The engine places jobs one after the other. That makes every decision
            explainable, but it is not a search over every possible plan:
          </p>
          <ul className="mt-2 ml-5 list-disc space-y-1 text-xs text-amber-900">
            <li>
              A booked job is never moved. Placing parts with fewer eligible
              work centers first when the priority is equal prevents most cases
              where a flexible part takes a single-work center part's slot, but not
              every one.
            </li>
            <li>
              Items equal in everything — group, stock-out day and number of
              work centers — keep the row order of the ZPP file.
            </li>
            <li>
              Because a coil is never cut, an overloaded week can end with a late
              job that a half coil would have saved. That is deliberate: the fix
              is capacity (overtime on the Capacity Dashboard) or another work center.
            </li>
            <li>
              After the last day in ZPP_DAILY, only weekly totals exist, so
              those weeks are spread evenly over the plant's working days (not a holiday and at
              least one work center has normal shifts). With ZPP_DAILY loaded they are
              long-term lots: if the capacity is used up by daily lots they stay
              unplanned rather than delay a daily lot.
            </li>
            <li>
              Re-planning to remove late jobs is a set of trials, not a full
              search: if 6 rounds cannot remove a late job, the fix is capacity
              (overtime, another work center) — the plan says so.
            </li>
            <li>
              Between an approved plan and the next MB52 upload, the engine
              assumes the approved jobs were produced as planned.
            </li>
          </ul>
        </div>
      </div>
    </section>
  )
}

/** Kullanıcının örneği: öngörülen stok gün gün, ve sonraki rulonun yeri. */
function StockExample({ safetyDays }: { safetyDays: number }) {
  // 1000 bakiye, haftada 2000 (günde 400), Pazartesi 6000'lik rulo.
  const days: { label: string; stock: number }[] = []
  let stock = 6000 - 1000
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  for (let w = 0; w < 3; w++) {
    for (let d = 0; d < 5; d++) {
      stock -= 400
      days.push({ label: `${names[d]} ${14 + w * 7 + d > 30 ? 14 + w * 7 + d - 30 : 14 + w * 7 + d}`, stock })
    }
  }
  const stockout = days.findIndex((d) => d.stock < 0)
  const start = Math.max(0, stockout - safetyDays)
  const max = 4600
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-sm font-semibold text-foreground">
        Example — when is the next coil made?
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Backlog 1 000, 2 000 per week, no stock, one coil = 6 000 pcs. The
        first coil is pressed on Monday 14 September. Bars = projected stock at
        the end of each day.
      </p>
      <div className="mt-3 flex h-28 items-end gap-1">
        {days.map((d, i) => (
          <div key={d.label} className="flex h-full flex-1 flex-col justify-end">
            <div
              className={`rounded-t ${
                i === stockout
                  ? 'bg-destructive'
                  : i >= start && i < stockout
                    ? 'bg-amber-400'
                    : 'bg-slate-400/70'
              }`}
              style={{ height: `${Math.max(3, (Math.max(0, d.stock) / max) * 100)}%` }}
              title={`${d.stock} pcs`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] text-muted-foreground">
        {days.map((d) => (
          <span key={d.label} className="flex-1 text-center">
            {d.label}
          </span>
        ))}
      </div>
      <ul className="mt-3 ml-5 list-disc space-y-1 text-xs text-muted-foreground">
        <li>
          The first coil covers the backlog, this week, next week and 1 000 of
          the week after.
        </li>
        <li>
          The stock runs out on <b className="text-destructive">{days[stockout].label}</b>{' '}
          (red). With {safetyDays} day(s) of safety stock the next coil may start
          from <b className="text-amber-700">{days[start].label}</b> (amber) — not
          straight after the first coil, and not after the stock is gone.
        </li>
        <li>
          If the work center is busy then, the job moves later; if it starts after{' '}
          {days[stockout].label} it is marked late.
        </li>
      </ul>
    </div>
  )
}

function Step({
  n,
  id,
  title,
  children,
}: {
  n: number
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section id={id} className="mt-8 scroll-mt-20 max-w-4xl">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-xs text-background">
          {n}
        </span>
        {title}
      </h2>
      <div className="mt-2 space-y-2 text-sm text-muted-foreground [&_b]:text-foreground [&_ol]:ml-5 [&_ol]:space-y-1 [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1">
        {children}
      </div>
    </section>
  )
}

function Setting({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  )
}

function Formula({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">{children}</p>
  )
}

function Example({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-emerald-900">
      <b className="!text-emerald-900">Example. </b>
      {children}
    </p>
  )
}

function Block({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`rounded px-2 py-1 font-medium ${tone}`}>{children}</span>
}

function Table({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <tbody>
          {rows.map(([what, detail, to]) => (
            <tr key={what} className="border-t border-border first:border-t-0 align-top">
              <td className="whitespace-nowrap px-3 py-2 font-medium text-foreground">
                <Link to={to} className="hover:underline">
                  {what}
                </Link>
              </td>
              <td className="px-3 py-2">{detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Operatör planı (src/lib/operatorAllocation.ts). Örnek, testteki örnekle
 * aynıdır: sayılar koddan (OPERATOR_EXAMPLE + allocateOperators) okunur.
 */
function OperatorPlanItem() {
  const ex = OPERATOR_EXAMPLE
  const decision = allocateOperators(ex).decisions[0]
  const lines = ex.costCenters[0].lines.map((l) => l.press)
  const minutesOf = (press: string) => ex.workload.filter((w) => w.press === press).reduce((x, w) => x + w.minutes, 0)
  const noWork = lines.filter((l) => minutesOf(l) === 0)
  const closed = lines.filter((l) => !decision.open.includes(l) && !noWork.includes(l))
  const weekly = {
    machines: OPERATOR_WEEKLY_EXAMPLE.crewSizes.length,
    avgCrew: OPERATOR_WEEKLY_EXAMPLE.crewSizes.reduce<number>((x, c) => x + c, 0) / OPERATOR_WEEKLY_EXAMPLE.crewSizes.length,
    cap: operatorWeekCapacity(OPERATOR_WEEKLY_EXAMPLE),
  }
  return (
    <li>
      <b>Operator plan</b> (a second planning model per cost center, e.g. APR, spot and nut welding
      lines; chosen on Company settings → cost center → <b>Planning model</b>). The lines of such a
      cost center are not run by their calendar alone: on the Production Plan, <b>Operators per
      shift</b> takes how many operators work each day and shift, and each line has a <b>crew</b>{' '}
      (operators it needs to run one shift, 1 if not set; entered on the Work Calendar → Capacity
      overview, not on the Production Plan). Before the capacity is built, for every
      day and shift in turn the lines that still have work due this week (up to Sunday) are sorted
      by the <b>earliest due date</b> (equal: the larger remaining minutes first) and opened while
      their crew fits the operators left. Work = net lot quantity × minutes per piece on the
      part's main work center, the same lots the engine plans. Every shift that runs (opened or
      from the calendar) takes its net minutes off the line's work, so a line whose work is done —
      or whose remaining work is only for next week — gets no operator. A day and shift without
      an operator count keeps the calendar; a holiday keeps the calendar; a <b>day record set by
      hand always wins</b> and its crew is taken from the operator count first. The result goes to
      the engine as day records, so sequencing, setups and late-job rules are unchanged. Example:{' '}
      {decision.operators} operators, {lines.length} lines with a crew of 1, {noWork.join(', ')}{' '}
      without work: {decision.open.join(', ')} run ({ex.workload.find((w) => w.press === decision.open[1])?.minutes} and{' '}
      {ex.workload.find((w) => w.press === decision.open[2])?.minutes} min are due the same day, so the larger goes first),{' '}
      {closed.join(', ')} waits (no operator left) and {noWork.join(', ')} stays closed.
      <br />
      <b>Machines count {OPERATOR_SHIFTS_PER_DAY} shifts every working day.</b> For a line of an
      operator-plan cost center the work center template and exception weeks are not read: every
      working day of the Work Calendar is {OPERATOR_SHIFTS_PER_DAY} shifts (plan, Work Calendar,
      Capacity dashboard, Performance and plan check alike); the operators decide which lines run.
      Day records and dated overtime still apply.
      <br />
      <b>Operators per week</b> (Work Calendar → Capacity overview, pick the cost center): how many
      people work in the week, not per shift. On a working day with no per-shift operator count the
      plan uses ⌊weekly ÷ {OPERATOR_SHIFTS_PER_DAY}⌋ operators on each of the{' '}
      {OPERATOR_SHIFTS_PER_DAY} shifts (the per-shift grid, for the first two weeks, always wins).
      The Capacity dashboard caps the week at min(machines × {OPERATOR_SHIFTS_PER_DAY} × working
      days, weekly operators ÷ average crew × working days) shifts; without a weekly count it is
      machines × {OPERATOR_SHIFTS_PER_DAY} × working days. Example: {weekly.machines} lines with crews{' '}
      {OPERATOR_WEEKLY_EXAMPLE.crewSizes.join(', ')} (average {weekly.avgCrew}),{' '}
      {OPERATOR_WEEKLY_EXAMPLE.workingDays} working days, {OPERATOR_WEEKLY_EXAMPLE.weeklyOperators} operators:
      machine limit {weekly.cap.machineShifts}, operator limit {weekly.cap.operatorShifts} → capacity{' '}
      {weekly.cap.shifts} shifts; on a day without a per-shift count{' '}
      {shiftHeadcountFromWeekly(OPERATOR_WEEKLY_EXAMPLE.weeklyOperators)} operators per shift.
    </li>
  )
}
