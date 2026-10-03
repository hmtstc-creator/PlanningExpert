import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { type LateItem, type PlanRun } from '../../lib/planPipeline'
import type { PlacementDecision } from '../../lib/scheduler'
import { InfoTip } from '../PageHeader'
import { formatClock } from './format'

/** Geç işler paneli ve karar hücresi (Production Plan). */
export function LateJobs({
  run,
  jobs,
  shiftMinutes,
  shiftStartMinute,
}: {
  run: PlanRun
  jobs: PlanRun['jobs']
  shiftMinutes: number
  shiftStartMinute: number
}) {
  const repair = run.lateRepair
  const items = run.lateItems
  const fixed = repair.lateBefore - repair.lateAfter
  const dayName = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    })
  const daysLate = (start: string, due: string) =>
    Math.max(0, Math.round((Date.parse(start) - Date.parse(due)) / 86_400_000))
  // Açık/kapalı tercihi bu tarayıcıda hatırlanır; liste uzunsa sayfayı kaplamasın.
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem(LATE_OPEN_KEY) !== '0'
    } catch {
      return true
    }
  })
  const toggle = () => {
    setOpen((o) => {
      try {
        window.localStorage.setItem(LATE_OPEN_KEY, o ? '0' : '1')
      } catch {
        // Saklama kapalıysa tercih yalnızca bu oturumda kalır.
      }
      return !o
    })
  }
  return (
    <div
      className={`mt-6 rounded-lg border p-4 ${
        (items ?? jobs).length > 0 ? 'border-destructive bg-destructive/10' : 'border-emerald-200 bg-emerald-50/60'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          {items
            ? items.length > 0
              ? `Late materials — ${items.length} not ready by 08:00 on the day they are needed`
              : 'Late materials — none left'
            : jobs.length > 0
              ? `Late jobs — ${jobs.length} would stop the customer`
              : 'Late jobs — none left'}
        </h2>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
        >
          {open ? 'Hide ▴' : 'Show ▾'}
        </button>
      </div>
      {open && items && <LateItemsBody items={items} repair={repair} />}
      {open && !items && (
        <LateJobsBody
          jobs={jobs}
          repair={repair}
          fixed={fixed}
          dayName={dayName}
          daysLate={daysLate}
          shiftMinutes={shiftMinutes}
          shiftStartMinute={shiftStartMinute}
        />
      )}
    </div>
  )
}

const LATE_OPEN_KEY = 'plan-late-jobs-open'

/** Gecikme saatini "61.5 h (2.6 days)" gibi yazar. */
function lateText(hours: number): string {
  const h = Math.round(hours * 10) / 10
  return hours >= 24 ? `${h} h (${(hours / 24).toFixed(1)} days)` : `${h} h`
}

/**
 * Malzeme bazında geç liste: ihtiyaç günü sabah 08:00'e kadar gereken adet
 * hazır olmuyorsa geçtir. Bir malzeme bir kez yazılır (ilk geç lotu).
 */
function LateItemsBody({ items, repair }: { items: LateItem[]; repair: PlanRun['lateRepair'] }) {
  return (
    <>
      <p className="mt-1 text-xs text-muted-foreground">
        <InfoTip label="When is a part late?">
          A material is late when the quantity the customer needs is not ready by the delivery time
          on the requirement day (Work Calendar, default 08:00; public holidays included). Backlog
          and today's need are due the next day at that time. Stock counts in the locations ticked
          Finished goods on <Link to="/depolar">Storage Locations</Link>.
        </InfoTip>
        {repair.rounds > 0 &&
          ` The engine re-planned ${repair.rounds} time(s)${
            repair.boosted.length > 0 ? ` and moved ${repair.boosted.length} part(s) forward` : ''
          }; coils are never cut short.`}
      </p>
      {items.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-md border border-destructive/30 bg-background">
          <table className="w-full text-left text-sm">
            <thead className="bg-destructive/10 text-destructive">
              <tr>
                <th className="px-3 py-2 font-medium">Material</th>
                <th className="px-3 py-2 font-medium">Needed by</th>
                <th className="px-3 py-2 text-right font-medium">Needed qty</th>
                <th className="px-3 py-2 font-medium">Ready</th>
                <th className="px-3 py-2 font-medium">Late</th>
                <th className="px-3 py-2 font-medium">Suggestion</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.material} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-medium text-foreground">
                    {item.material}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {item.presses.join(', ')}
                      {item.lots > 1 && ` · ${item.lots} late lots`}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{item.deadline}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {item.neededQuantity.toLocaleString('en-GB')}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{item.ready}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-destructive">
                    {lateText(item.lateHours)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {item.suggestion}{' '}
                    <Link to="/takvim" className="underline">
                      Work Calendar
                    </Link>{' '}
                    ·{' '}
                    <Link to="/referanslar" className="underline">
                      master data
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function LateJobsBody({
  jobs,
  repair,
  fixed,
  dayName,
  daysLate,
  shiftMinutes,
  shiftStartMinute,
}: {
  jobs: PlanRun['jobs']
  repair: PlanRun['lateRepair']
  fixed: number
  dayName: (iso: string) => string
  daysLate: (start: string, due: string) => number
  shiftMinutes: number
  shiftStartMinute: number
}) {
  return (
    <>
      <p className="mt-1 text-xs text-muted-foreground">
        The first plan had {repair.lateBefore} job(s) starting after their stock runs
        out. The engine re-planned {repair.rounds} time(s)
        {repair.boosted.length > 0 && `: moved ${repair.boosted.length} part(s) forward`}
        . Every moved job tried all of its work centers again; coils are never cut short.{' '}
        {fixed > 0 ? `${fixed} fixed` : 'None could be fixed this way'}
        {jobs.length > 0 ? `, ${jobs.length} still late.` : '.'}
      </p>
      {jobs.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-md border border-destructive/30 bg-background">
          <table className="w-full text-left text-sm">
            <thead className="bg-destructive/10 text-destructive">
              <tr>
                <th className="px-3 py-2 font-medium">Material</th>
                <th className="px-3 py-2 font-medium">Stock runs out</th>
                <th className="px-3 py-2 font-medium">Starts</th>
                <th className="px-3 py-2 font-medium">Late</th>
                <th className="px-3 py-2 font-medium">Work centers tried (finish)</th>
                <th className="px-3 py-2 font-medium">What would fix it</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j, i) => (
                <tr key={`${j.material}-${i}`} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-medium text-foreground">{j.material}</td>
                  <td className="px-3 py-2 text-muted-foreground">{dayName(j.dueDate)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {dayName(j.date)} on {j.press}
                  </td>
                  <td className="px-3 py-2 font-medium text-destructive">
                    {daysLate(j.date, j.dueDate)} day(s)
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    <DecisionCell
                      decision={j.decision}
                      chosen={j.press}
                      shiftMinutes={shiftMinutes}
                      shiftStartMinute={shiftStartMinute}
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    Capacity on {j.press} before {dayName(j.dueDate)}: an overtime or
                    weekend shift (
                    <Link to="/takvim" className="underline">
                      Work Calendar
                    </Link>
                    ), tick Flexible work center or add another work center in its{' '}
                    <Link to="/referanslar" className="underline">
                      master data
                    </Link>
                    , or move a less urgent part off {j.press} (Plan overrides).
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/**
 * Karar izi: iş kaçıncı sırada yerleştirildi ve o an her uygun pres işi ne
 * zaman bitirirdi. Planlamacı "bu parça 105'te daha erken bitmez miydi?"
 * sorusunun cevabını burada okur.
 */
export function DecisionCell({
  decision,
  chosen,
  shiftMinutes,
  shiftStartMinute,
}: {
  decision?: PlacementDecision
  chosen?: string
  shiftMinutes: number
  shiftStartMinute: number
}) {
  if (!decision) return <span>—</span>
  return (
    <span className="whitespace-nowrap">
      <span className="mr-1 font-medium text-foreground">#{decision.step}</span>
      {decision.candidates.map((c, i) => (
        <span key={c.press}>
          {i > 0 && ' · '}
          <span className={c.press === chosen ? 'font-semibold text-emerald-700' : undefined}>
            {c.press}
            {c.press === chosen && ' ✓'}{' '}
            {c.endDate !== undefined && c.endMinute !== undefined
              ? `${new Date(`${c.endDate}T00:00:00`).toLocaleDateString('en-GB', {
                  weekday: 'short',
                  day: '2-digit',
                })} ${formatClock(c.endMinute, shiftMinutes, shiftStartMinute).split(' ')[0]}`
              : `(${c.note})`}
          </span>
        </span>
      ))}
    </span>
  )
}

/**
 * Bağımsız plan denetimi: motordan ayrı bir kod, bitmiş planın her işini
 * her kurala karşı yeniden sayar.
 */
