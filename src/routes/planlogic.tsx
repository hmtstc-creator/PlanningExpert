import { createFileRoute, Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { api } from '../../convex/_generated/api'
import { useQuery } from '../lib/convexTransport'
import { DEFAULT_PLANT_TIME_ZONE } from '../lib/dates'
import { DEFAULT_SAFETY_STOCK_DAYS } from '../lib/planPipeline'

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

function PlanLogicPage() {
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
      }
    | null
    | undefined

  const current = {
    horizon: settings?.planningHorizonWeeks ?? 4,
    shiftStart: hhmm(settings?.shiftStartMinute ?? 420),
    shiftMinutes: settings?.shiftMinutes ?? 480,
    setupGap: settings?.setupGapMinutes ?? 10,
    plantNormal: settings?.maxSetupsPlantWideNormal ?? 1,
    plantUrgent: settings?.maxSetupsPlantWide ?? 2,
    crossShifts: settings?.setupsCrossShifts ?? true,
    pullForward: settings?.pullForwardDays ?? 10,
    cutoff: hhmm(settings?.deliveryCutoffMinute ?? 480),
    target: settings?.utilisationTarget ?? 95,
    maxScenarios: settings?.maxScenarios ?? 100,
    coilGap: settings?.coilSetupGapMinutes ?? 30,
    concurrent: settings?.concurrentSetupsPerHall ?? 1,
    factor: Math.round((settings?.capacityFactor ?? 1) * 100),
    frozen: settings?.frozenDays ?? 0,
    safety: settings?.safetyStockDays ?? DEFAULT_SAFETY_STOCK_DAYS,
    timeZone: settings?.timeZone || DEFAULT_PLANT_TIME_ZONE,
  }

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Planning Logic</h1>
      <p className="mt-2 max-w-4xl text-muted-foreground">
        Nobody places jobs by hand. The plan is calculated on the server from
        the data you maintain, in the seven steps below, every time that data
        changes. To change the plan, change its inputs — the rules here are
        applied to them the same way every time.
      </p>

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
          page.
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
              'MB52 unrestricted stock. Only storage locations 2009 and 1009 count as finished stock (2010 is ignored), in the plan and on the Capacity Dashboard; raw material locations are used for the coil check',
              '/sapdata',
            ],
            [
              'Master data',
              'Cavities, strokes per minute (SPM), setup and coil change times, quality approval time, coil and gross weight, mould shot limit, main and alternative presses, Flexible press tick, co-product, performance factor',
              '/referanslar',
            ],
            ['Presses', 'Hall (for the crane rule) and whether the press is coil-fed', '/makineler'],
            ['Work calendar', 'Shifts per press, working days, planned stops, public holidays', '/takvim'],
            ['Dies', 'Readiness (date and time), maintenance days, shot-limit alarms — from Die Follow-up', '/die-followup/maintenance'],
            ['Machines', 'Planned press maintenance hours and open breakdowns that stop a press — from Machine Follow-up', '/machine-followup/breakdowns'],
            ['Your rules', 'Exclude, pin to a press/day, or move to the front', '/planlama'],
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
            file's last day, the weekly ZPP is spread evenly over the working
            days (a partly covered week gets the rest of its weekly total on
            the uncovered days). The backlog is due today.
          </li>
          <li>
            <b>Timing — projected stock.</b> Walking day by day, the engine
            finds the day the stock — plus every lot planned before — would
            drop below zero. That is the lot's <b>stock-out day</b>.
          </li>
          <li>
            <b>Safety stock.</b> The lot may start{' '}
            <b>{current.safety} working day(s)</b> before its stock-out day, and
            not earlier, so stock does not pile up and the press stays free
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
            both quantities; press time and setup are counted once.
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
            flexible (transfer presses 106/107), a <b>Min. lot (pcs)</b> is entered
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
        <p>For every press and every day of the horizon:</p>
        <Formula>
          net minutes = shifts × shift length − planned stops (per shift) → × capacity factor
        </Formula>
        <ul>
          <li>
            Shifts come from the press's standard week, or from the <b>week exception</b>{' '}
            on the Work Calendar when there is one — overtime opened for a week (also from
            the Capacity Dashboard) is planned in that week.
          </li>
          <li>Holidays and non-working days have no capacity.</li>
          <li>
            Days that have passed are skipped, and today starts at the current
            time — nothing is planned in the past. The plan day begins with the
            first shift ({current.shiftStart}), so at 02:00 the night shift
            still belongs to the previous day.
          </li>
          <li>
            Each press is one continuous timeline: a job that does not finish
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
            <b>Press maintenance</b> takes those clock hours out of that
            press's day; jobs flow around it.
          </li>
          <li>
            <b>Machine breakdown</b> (reported in Machine Follow-up with "the
            press is stopped"): the press is closed from the breakdown until
            the expected time it is back — or, with no expected time, until
            the breakdown is solved. A fault that does not stop the press does
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
            working day at {current.cutoff}.
          </li>
          <li>
            <b>Urgent</b> — a lot whose stock falls to the safety level now: it runs
            out within {current.safety} working day(s). Due at {current.cutoff} on the
            day the stock runs out.
          </li>
          <li>
            <b>Fill</b> — every other lot: future days and weeks. It may start{' '}
            {current.safety} working day(s) before its stock runs out, or up to{' '}
            {current.pullForward} days earlier when a press would stand idle.
          </li>
        </ol>
        <p>
          Backlog always goes before urgent, even when both are due at the same
          moment. <b>One exception — the mounted die:</b> when an urgent job would
          need a setup on a press whose mounted die still has a fill lot waiting,
          that fill lot runs on first without a setup, as long as the urgent job
          is still ready by its delivery time. Otherwise the die would be taken
          off for the urgent job and mounted again later — two setups instead of
          one. If the urgent job would be late, it goes first.
        </p>
        <p>
          Within each group, the lot whose stock runs out first goes first.
          When that is equal too, the part that can run on the <b>fewest
          presses</b> goes first: a single-press part takes its slot before a
          part with alternatives, which then spreads to the presses that are
          left. Whoever is placed first gets the best slots.
        </p>
      </Step>

      <Step n={6} id="place" title="Place each job">
        <p>
          The candidates are the material's main press — plus its
          alternatives <b>only if the part is ticked Flexible press</b> in
          master data (or only the pinned press). A part that is not flexible
          always runs on its main press, even if that makes it late: its
          quality approval belongs to that press. On each candidate the engine looks for
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
          <Block tone="bg-sky-100 text-sky-900">Coil change</Block>
          <span aria-hidden>→</span>
          <Block tone="bg-emerald-100 text-emerald-900">Production (coil 2)</Block>
          <span aria-hidden>→ …</span>
        </div>
        <Formula>
          strokes = quantity ÷ cavities · job time = strokes ÷ SPM ÷ performance factor
        </Formula>
        <p className="text-xs text-muted-foreground">
          Example: 10 h of pure stroke time at a 60 % performance factor is a 16.7 h job.
          Setup, coil changes and quality approval sit inside that time.
        </p>
        <p>It has to respect every rule at once:</p>
        <ul>
          <li>
            If the same mould is already on the press, the setup is skipped.
          </li>
          <li>
            {current.crossShifts
              ? 'A setup may start near the end of a shift and be finished by the next shift; it never runs past the last working minute of the day. Production can.'
              : 'A setup or coil change never crosses the end of a shift — no crew starts a setup it cannot finish. Production can.'}
          </li>
          <li>
            <b>Setup team</b>: normally at most {current.plantNormal} mould setup(s) run at
            the same time anywhere in the plant. <b>Dynamic rule:</b> for backlog, or for a
            job that would otherwise start after its stock runs out, up to{' '}
            {current.plantUrgent} setups may overlap so production starts sooner. Once the
            urgent work is placed, setups go back to one after the other.
          </li>
          <li>
            <b>No idle press while work is waiting</b>: a lot may start up to{' '}
            {current.pullForward} day(s) before it is needed when its press would
            otherwise stand idle, so the plan fills the working days you opened on the
            Work Calendar — the same hours the Capacity Dashboard counts. If nothing is
            urgent, the die already on the press keeps running for its next lot first, so
            no extra setup is made.
          </li>
          <li>
            Every idle gap on the plan chart shows why it is there (setup team busy, die
            on another press, not allowed yet, …).
          </li>
          <li>
            <b>Crane</b>: in one hall, mould setups are at least{' '}
            {current.setupGap} min apart and at most {current.concurrent} at a
            time; coil changes are at least {current.coilGap} min apart; a mould
            setup and a coil change never overlap.
          </li>
          <li>A mould cannot be on two presses at the same time.</li>
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
          <b>The press that finishes the job earliest wins</b> — with one
          exception: when nothing is urgent, continuing the die already mounted
          (no setup) is preferred. For backlog, or a job that would otherwise
          start after its stock runs out, the engine also tries the dynamic
          setup rule and keeps whichever finishes sooner. The chosen press
          time, crane slots, setup slot and mould are then booked, and the
          next requirement is placed.
        </p>
      </Step>

      <Step n={7} id="check" title="Check and report">
        <ul>
          <li>
            A part is <b>late</b> when the quantity the customer needs is not
            ready by <b>{current.cutoff}</b> on the day it is needed — not when
            the whole lot ends. Backlog in ZPP and anything needed today are due
            the <b>next working day at {current.cutoff}</b>. How late is shown in
            hours and days. The engine does not leave it — see{' '}
            <a href="#late" className="underline">
              Late jobs are re-planned
            </a>
            .
          </li>
          <li>
            What does not fit anywhere goes to <b>Unplanned</b>, with the
            reason and a link to the fix (no master data, no eligible press, no
            free capacity…).
          </li>
          <li>
            <b>Raw material</b>: planned quantity × gross weight, compared with
            raw material stock. Co-products are not counted twice.
          </li>
          <li>
            Warnings list whatever changed the plan: moulds held out, presses
            in maintenance, missing data.
          </li>
        </ul>
      </Step>

      <section id="late" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-sm font-semibold text-amber-950">Late jobs are re-planned</h2>
        <p className="mt-1 text-sm text-amber-900">
          A job that starts after its stock runs out means the customer stops —
          your own safety stock is the only margin. So a late job is never just
          reported; the engine plans again, up to four rounds:
        </p>
        <ol className="mt-2 ml-5 list-decimal space-y-1 text-sm text-amber-900">
          <li>
            <b>Move the late lot forward</b>, ahead of everything except your own
            "move to front" rules. It then tries every eligible press again, so
            an alternative press that is free earlier is found.
          </li>
          <li>
            <b>Let its setup overlap</b>: a late-risk job may set up while
            another setup runs (at most {current.plantUrgent} at once in the
            plant), so production starts sooner.
          </li>
          <li>
            <b>Keep the best plan</b>: fewest unplanned, then fewest late jobs,
            then fewest late days, then fewest changes. If a round does not
            improve the plan, it stops.
          </li>
        </ol>
        <p className="mt-2 text-sm text-amber-900">
          <b>Coils are never cut to save a late job.</b> A mounted coil is run
          to the end; cutting it would leave a half coil, a second setup and a
          second coil mount later. If moving forward is not enough, the job stays
          late and is reported.
        </p>
        <p className="mt-2 text-sm text-amber-900">
          Whatever is still late is listed at the top of the Production Plan in
          red, <b>once per material</b>: when it is needed, how many pieces, when
          they are ready, how many hours late, and a suggestion — how many hours
          are missing on its press before the deadline, i.e. how many overtime
          shifts would cover it, or ticking Flexible press so it may use its
          alternative presses.
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
            shortest job first, longest job first, parts with the fewest presses
            first, and shuffled orders.
          </li>
          <li>
            <b>Press choice</b>: the press that finishes first (standard), the
            one that can start first, or the least loaded one.
          </li>
          <li>
            <b>Best</b> means: fewest unplanned, then fewest late parts, then
            fewest late hours, then the highest utilisation, then the fewest
            setups. Utilisation never wins over a late part.
          </li>
          <li>
            <b>Utilisation</b> = busy press hours ÷ available hours (working
            calendar minus maintenance) in the next 7 days, all presses together.
          </li>
          <li>
            <b>It stops</b> as soon as {current.target}% is reached, after{' '}
            {current.maxScenarios} scenarios, after 25 scenarios without an
            improvement, or after two minutes. The Production Plan then shows
            the level reached (e.g. "best of {current.maxScenarios} scenarios
            reaches 90%"), the utilisation of each press and the scenarios
            compared.
          </li>
        </ul>
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
            maintenance, or a press is down or in maintenance, <b className="text-foreground">and</b>{' '}
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
            equal → the part with the fewest eligible presses goes first.
          </Box>
          <Down label="take the next item from the top" />
          <Box tone="border-sky-300 bg-sky-50 text-sky-950" title="3 · Try EVERY press it is allowed on">
            Not ticked Flexible press → only the main press (quality). Ticked →
            main press and all alternatives (e.g. 104, 105, 108, 110). On each
            one, find the earliest free slot that respects all the rules: shift
            ends, crane, mould, maintenance.
          </Box>
          <Down label="each press gives a finish time" />
          <Box tone="border-emerald-300 bg-emerald-50 text-emerald-950" title="4 · Choose the press that finishes first">
            Not "the first press in the list" and not "the main press" — the
            one where the job is done soonest. When nothing is urgent, keeping
            the mounted die running (no setup) wins.
          </Box>
          <Down label="book it" />
          <Box tone="border-border bg-muted/50 text-foreground" title="5 · Book the slot">
            That press time, the crane slots and the mould are now taken for
            all the items that follow.
          </Box>
          <Down label="back to 3 with the next item, until the list is empty" />
          <Box tone="border-amber-300 bg-amber-50 text-amber-950" title="6 · Anything late? → plan again">
            A job that starts after its stock runs out stops the customer. Late
            lots are moved to the front (they try every press again) and may
            overlap their setup with another one. Coils are never cut. Up to 4
            rounds; the best plan is kept.
          </Box>
          <Down label="whatever is still late or does not fit" />
          <Box tone="border-destructive/40 bg-destructive/10 text-foreground" title="Late jobs / Unplanned">
            Shown in red on the Production Plan with the presses tried and
            what would fix it.
          </Box>
        </div>

        <div className="rounded-lg border border-border p-4">
          <p className="text-sm font-semibold text-foreground">Example — decision #12</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Part A has a backlog, is ticked Flexible press and can run on 104
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
            its main press, because 105 finishes it a shift and a half
            earlier. On the Production Plan, the job list shows exactly this
            line for every job in the <b className="text-foreground">Why this press</b>{' '}
            column:
          </p>
          <p className="mt-2 rounded bg-muted px-2 py-1 font-mono text-[11px] text-foreground">
            #12 104 Tue 11:30 · <span className="font-semibold text-emerald-700">105 ✓ Mon 23:30</span> · 108 (full until the end of the horizon)
          </p>

          <p className="mt-4 text-sm font-semibold text-foreground">What this means for your question</p>
          <ul className="mt-1 ml-5 list-disc space-y-1 text-xs text-muted-foreground">
            <li>
              A part is never written onto a press just because it is first in a
              list. Each job is compared on all of its presses at the moment
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
              flexible only on their main press, one job per press
              at a time, earliest press chosen, crane gaps, setups at once in the
              plant, whole coils only, one mould on one press, maintenance, no lot
              before its pull-forward window, nothing in the past. A broken rule
              shows in red with the job named.
            </li>
            <li>
              <b className="text-foreground">Why this press</b> (job list): pick any job
              you doubt and read its decision: its order number and the
              finish time on every eligible press.
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
              presses first when the priority is equal prevents most cases
              where a flexible part takes a single-press part's slot, but not
              every one.
            </li>
            <li>
              Items equal in everything — group, stock-out day and number of
              presses — keep the row order of the ZPP file.
            </li>
            <li>
              Because a coil is never cut, an overloaded week can end with a late
              job that a half coil would have saved. That is deliberate: the fix
              is capacity (overtime on the Capacity Dashboard) or another press.
            </li>
            <li>
              After the last day in ZPP_DAILY, only weekly totals exist, so
              those weeks are spread evenly over their working days.
            </li>
            <li>
              Re-planning to remove late jobs is a set of trials, not a full
              search: if 4 rounds cannot remove a late job, the fix is capacity
              (overtime, another press) — the plan says so.
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
          If the press is busy then, the job moves later; if it starts after{' '}
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
