import { createFileRoute, Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { api } from '../../convex/_generated/api'
import { useQuery } from '../lib/convexTransport'
import { DEFAULT_PLANT_TIME_ZONE } from '../lib/dates'

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

      <ol className="mt-6 flex flex-wrap gap-2 text-xs">
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
            <b>Urgency.</b> Days of cover = stock ÷ (average weekly demand ÷
            working days per week). Less than 14 days of cover makes the
            material <b>urgent</b>: it may be produced as early as today.
            Everything else is <b>fill</b>: never produced before its own
            week, so stock does not pile up.
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
          Within each group the earlier week goes first; in the same week, the
          material with fewer days of cover goes first. Whoever is placed first
          gets the best slots.
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
          <li>Fill items do not start before their own week.</li>
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
            A job placed after the week it is needed is marked <b>late</b>.
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
