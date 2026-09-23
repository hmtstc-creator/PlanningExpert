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
      }
    | null
    | undefined

  const current = {
    horizon: settings?.planningHorizonWeeks ?? 4,
    shiftStart: hhmm(settings?.shiftStartMinute ?? 420),
    shiftMinutes: settings?.shiftMinutes ?? 480,
    setupGap: settings?.setupGapMinutes ?? 60,
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
          <Setting label="Capacity factor" value={`${current.factor}%`} />
          <Setting
            label="Frozen days"
            value={current.frozen > 0 ? `${current.frozen} days` : 'off'}
          />
          <Setting label="Safety stock" value={`${current.safety} working days`} />
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
              'MB52 unrestricted stock. Only finished goods and production area locations count as stock; raw material locations are used for the coil check',
              '/sapdata',
            ],
            [
              'Master data',
              'Cavities, strokes per minute (SPM), setup and coil change times, quality approval time, coil and gross weight, mould shot limit, main and alternative presses, co-product, performance factor',
              '/referanslar',
            ],
            ['Presses', 'Hall (for the crane rule) and whether the press is coil-fed', '/makineler'],
            ['Work calendar', 'Shifts per press, working days, planned stops, public holidays', '/takvim'],
            ['Maintenance', 'Press maintenance hours, mould maintenance days, mould readiness, shot-limit alarms', '/kaliplar'],
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
            made separately. For each week, both parts get the larger of the
            two requirements.
          </li>
          <li>
            <b>Whole coils.</b> A mounted coil is run to the end, so the
            quantity is rounded up to whole coils. The surplus covers the
            following weeks and does not trigger another coil. Materials
            without a coil or gross weight are planned to the exact quantity.
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
            <b>Mould maintenance</b> days: no part of a job with that mould may
            fall on them.
          </li>
          <li>
            <b>Mould not ready</b>: with a ready date, the mould is blocked
            until then; without a date, it is held out of the plan entirely.
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
          <li>Materials you moved to the front</li>
          <li>Backlog</li>
          <li>Urgent</li>
          <li>Fill</li>
        </ol>
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
          The candidates are the material's main press and its alternatives
          (or only the pinned press). On each candidate the engine looks for
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
          strokes = quantity ÷ cavities · production minutes = strokes ÷ SPM (stretched
          by the mould's performance factor)
        </Formula>
        <p>It has to respect every rule at once:</p>
        <ul>
          <li>
            If the same mould is already on the press, the setup is skipped.
          </li>
          <li>
            A setup or coil change never crosses the end of a shift — no crew
            starts a setup it cannot finish. Production can.
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
            is split into batches, each with its own setup.
          </li>
          <li>
            A lot does not start before its safety date ({current.safety} working
            day(s) before its stock runs out).
          </li>
        </ul>
        <p>
          <b>The press that finishes the job earliest wins.</b> Its time,
          crane slots and mould are then booked, and the next requirement is
          placed.
        </p>
      </Step>

      <Step n={7} id="check" title="Check and report">
        <ul>
          <li>
            A job that starts after its stock-out day is <b>late</b>: the
            customer would stop. The engine does not leave it — see{' '}
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
            <b>Cut surplus coils in front of it.</b> Parts placed earlier on the
            same presses that press a whole coil for a small need are cut to
            the exact need for this plan — the coil is not run out, so the late
            part gets the press sooner. The job says so in its reason.
          </li>
          <li>
            <b>Keep the best plan</b>: fewest unplanned, then fewest late jobs,
            then fewest late days, then fewest changes. If a round does not
            improve the plan, it stops.
          </li>
        </ol>
        <p className="mt-2 text-sm text-amber-900">
          Whatever is still late is listed at the top of the Production Plan in
          red, with the presses that were tried and what would fix it —
          usually capacity: an overtime or weekend shift, or another press in
          the part's master data.
        </p>
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
            Demand minus stock, rounded to whole coils. Each lot gets two dates
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
          <Box tone="border-sky-300 bg-sky-50 text-sky-950" title="3 · Try EVERY press that can make it">
            Main press and all alternatives (e.g. 104, 105, 108, 110). On each
            one, find the earliest free slot that respects all the rules: shift
            ends, crane, mould, maintenance.
          </Box>
          <Down label="each press gives a finish time" />
          <Box tone="border-emerald-300 bg-emerald-50 text-emerald-950" title="4 · Choose the press that finishes first">
            Not "the first press in the list" and not "the main press" — the
            one where the job is done soonest.
          </Box>
          <Down label="book it" />
          <Box tone="border-border bg-muted/50 text-foreground" title="5 · Book the slot">
            That press time, the crane slots and the mould are now taken for
            all the items that follow.
          </Box>
          <Down label="back to 3 with the next item, until the list is empty" />
          <Box tone="border-amber-300 bg-amber-50 text-amber-950" title="6 · Anything late? → plan again">
            A job that starts after its stock runs out stops the customer. Late
            lots are moved to the front (they try every press again); if that
            is not enough, surplus coils placed before them on the same presses
            are cut to the exact need. Up to 4 rounds; the best plan is kept.
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
            Part A has a backlog and can run on 104 (main), 105 and 108. Eleven
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
              through every job again and checks each rule — one job per press
              at a time, earliest press chosen, crane gaps, one mould on one
              press, maintenance, no lot before its safety date, nothing in the past. A
              broken rule shows in red with the job named.
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
