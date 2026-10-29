import { Link } from '@tanstack/react-router'
import { Fragment, useState } from 'react'
import { type LateCalc, type LateItem, type PlanRun } from '../../lib/planPipeline'
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

const pcsText = (n: number) => Math.round(n).toLocaleString('en-GB')
/** Gereken adedin teslim anında hazır olan payı: "85% (5,100 pcs)". */
function onTimeText(item: LateItem): string {
  if (item.onTimeQty === undefined || item.neededQuantity <= 0) return '—'
  return `${Math.round((item.onTimeQty / item.neededQuantity) * 100)}% (${pcsText(item.onTimeQty)} pcs)`
}
/** Gecikmeli gelen pay: "15% (900 pcs) · avg 0.8 h, last 1.5 h". */
function lateShareText(item: LateItem): string {
  const qty = item.calc?.lateQty ?? item.neededQuantity
  const pct = item.neededQuantity > 0 ? Math.round((qty / item.neededQuantity) * 100) : 100
  const avg = item.calc && item.calc.avgLateHours > 0 ? `avg ${lateText(item.calc.avgLateHours)}, ` : ''
  return `${pct}% (${pcsText(qty)} pcs) · ${avg}last ${lateText(item.lateHours)}`
}

/**
 * Malzeme bazında geç liste: ihtiyaç günü sabah 08:00'e kadar gereken adet
 * hazır olmuyorsa geçtir. Bir malzeme bir kez yazılır (ilk geç lotu). Her
 * satır NEDEN geç olduğunu ve gecikme saatinin hesabını gösterir; öneri
 * yazılmaz — planlamacı kendi kriterlerini hesaptan kontrol eder.
 */
function LateItemsBody({ items, repair }: { items: LateItem[]; repair: PlanRun['lateRepair'] }) {
  const [openRow, setOpenRow] = useState<string | null>(null)
  return (
    <>
      <p className="mt-1 text-xs text-muted-foreground">
        <InfoTip label="When is a part late?">
          A material is late when the quantity the customer needs is not ready by the delivery time
          on the requirement day (Work Calendar, default 08:00; public holidays included). Backlog
          and today's need are due the next day at that time. Stock counts in the locations ticked
          Finished goods on <Link to="/depolar">Storage Locations</Link>.{' '}
          <Link to="/planlogic" hash="late">
            How it is calculated
          </Link>
        </InfoTip>
        {repair.rounds > 0 &&
          ` The engine re-planned ${repair.rounds} time(s)${
            repair.boosted.length > 0 ? ` and moved ${repair.boosted.length} part(s) forward` : ''
          }; coils are never cut short.`}{' '}
        Tap a material to see how its late hours are calculated.
      </p>
      {items.length > 0 && (
        // Telefonda kart: tablo yana kaydığında "Why late" görünmüyordu.
        <ul className="mt-3 space-y-2 md:hidden">
          {items.map((item) => {
            const isOpen = openRow === item.material
            return (
              <li key={item.material} className="rounded-md border border-destructive/30 bg-background p-3 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-foreground">{item.material}</span>
                  <span className="whitespace-nowrap font-medium text-destructive">last {lateText(item.lateHours)} late</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {item.presses.join(', ')}
                  {item.lots > 1 && ` · ${item.lots} late lots`} · {item.neededQuantity.toLocaleString('en-GB')} pcs needed by{' '}
                  {item.deadline}
                </p>
                <p className="mt-1 text-xs text-foreground">
                  On time: <b>{onTimeText(item)}</b> · Late: <b className="text-destructive">{lateShareText(item)}</b>
                </p>
                {item.why && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-foreground">
                    {item.why.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
                {item.calc && (
                  <>
                    <button
                      type="button"
                      onClick={() => setOpenRow(isOpen ? null : item.material)}
                      className="mt-2 text-xs font-medium text-foreground underline"
                    >
                      {isOpen ? 'Hide the calculation ▴' : 'How is it calculated? ▾'}
                    </button>
                    {isOpen && (
                      <div className="mt-2 border-t border-border pt-2">
                        <LateCalcView item={item} calc={item.calc} />
                      </div>
                    )}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {items.length > 0 && (
        <div className="mt-3 hidden overflow-x-auto rounded-md border border-destructive/30 bg-background md:block">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="bg-destructive/10 text-destructive">
              <tr>
                <th className="px-3 py-2 font-medium">Material</th>
                <th className="px-3 py-2 font-medium">Needed by</th>
                <th className="px-3 py-2 text-right font-medium">Needed qty</th>
                <th className="px-3 py-2 font-medium">On time</th>
                <th className="px-3 py-2 font-medium">Late share</th>
                <th className="px-3 py-2 font-medium">Why late</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isOpen = openRow === item.material
                return (
                  <Fragment key={item.material}>
                    <tr
                      onClick={() => setOpenRow(isOpen ? null : item.material)}
                      className={`cursor-pointer border-t border-border align-top hover:bg-muted/40 ${isOpen ? 'bg-muted/30' : ''}`}
                    >
                      <td className="px-3 py-2 font-medium text-foreground">
                        {isOpen ? '▾ ' : '▸ '}
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
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{onTimeText(item)}</td>
                      <td className="px-3 py-2 font-medium text-destructive">
                        {lateShareText(item)}
                        {item.lots > 1 && item.lateQty !== undefined && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {pcsText(item.lateQty)} pcs late in all {item.lots} lots
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-foreground">
                        {item.why ? (
                          <ul className="list-disc space-y-0.5 pl-4">
                            {item.why.map((w) => (
                              <li key={w}>{w}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-muted-foreground">Recalculate the plan to see the reason.</span>
                        )}
                      </td>
                    </tr>
                    {isOpen && item.calc && (
                      <tr className="bg-muted/20">
                        <td colSpan={6} className="px-3 py-3">
                          <LateCalcView item={item} calc={item.calc} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/** Gecikme saatinin adım adım hesabı ve kontrol edilecek girdiler. */
function LateCalcView({ item, calc }: { item: LateItem; calc: LateCalc }) {
  const hours = (min: number) => `${Math.round(min / 6) / 10} h`
  const pressMinutes = calc.setupMinutes + calc.qualityMinutes + calc.runMinutes
  return (
    <div className="grid gap-4 text-xs text-muted-foreground lg:grid-cols-2">
      <div>
        <p className="font-semibold text-foreground">How {lateText(calc.lateHours)} is calculated (first late lot)</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          <li>
            Setup starts on <b className="text-foreground">{calc.press}</b> at <b className="text-foreground">{calc.setupStart}</b>
            {calc.beforeHours > 0 && ` — after ${calc.beforeHours} h of other jobs on this press`}.
          </li>
          <li>
            Setup {calc.setupMinutes} min + quality approval {calc.qualityMinutes} min + production of{' '}
            {calc.neededQuantity.toLocaleString('en-GB')} pcs at {calc.piecesPerHour.toLocaleString('en-GB')} pcs/h{' '}
            {calc.runMinutes} min = <b className="text-foreground">{hours(pressMinutes)} press time</b>.
          </li>
          {calc.pressOffHours > 0 && <li>+ {calc.pressOffHours} h with the press not working (no shift, weekend, breaks).</li>}
          <li>
            At the deadline <b className="text-foreground">{pcsText(calc.onTimeQty)} of {pcsText(calc.neededQuantity)} pcs</b> are ready
            ({calc.neededQuantity > 0 ? Math.round((calc.onTimeQty / calc.neededQuantity) * 100) : 0}% on time); the other{' '}
            {pcsText(calc.lateQty)} pcs follow while the press runs. All needed pieces ready:{' '}
            <b className="text-foreground">{calc.ready}</b>.
          </li>
          <li>
            Needed by: <b className="text-foreground">{calc.deadline}</b>.
          </li>
          <li>
            Last needed piece late = ready − needed by = <b className="text-destructive">{lateText(calc.lateHours)}</b>
            {calc.avgLateHours > 0 && <> (the late pieces are {lateText(calc.avgLateHours)} late on average)</>}.
            {item.lots > 1 && item.lateHours > calc.lateHours && ` The worst of its ${item.lots} late lots is ${lateText(item.lateHours)}.`}
          </li>
        </ol>
        <p className="mt-2">
          Plan calculated {calc.now}; {calc.hoursToDeadline > 0 ? `${calc.hoursToDeadline} h were left until the deadline.` : 'the deadline had already passed.'}
        </p>
        {calc.before.length > 0 && (
          <>
            <p className="mt-2 font-semibold text-foreground">Before it on {calc.press}</p>
            <ul className="mt-1 space-y-0.5">
              {calc.before.map((b, i) => (
                <li key={`${b.material}-${i}`}>
                  {b.material} · {b.hours} h ·{' '}
                  {b.kind === 'frozen' ? 'frozen / approved' : b.kind === 'earlier' ? `needed ${b.due} (earlier)` : <span className="text-amber-700">needed {b.due} (later)</span>}
                  {b.override && <span className="text-amber-700"> · plan override</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div>
        <p className="font-semibold text-foreground">Check the inputs — a wrong value here makes it look late</p>
        <ul className="mt-1 space-y-0.5">
          <li>
            Need: {calc.neededQuantity.toLocaleString('en-GB')} pcs by {calc.deadline} (lot {calc.lotQuantity.toLocaleString('en-GB')} pcs) — ZPP demand minus
            finished stock. Check the demand on <Link to="/sapdata" className="underline">SAP Data</Link> and the stock locations on{' '}
            <Link to="/depolar" className="underline">Storage Locations</Link>.
          </li>
          <li>
            Speed: {calc.piecesPerHour.toLocaleString('en-GB')} pcs/h
            {calc.minutesPerPiece ? ` from a cycle time of ${calc.minutesPerPiece} min/pc` : ''}
            {calc.performanceFactor ? ` × performance ${Math.round(calc.performanceFactor * 100)}%` : ''}; setup {calc.setupMinutes} min, quality approval{' '}
            {calc.qualityMinutes} min — <Link to="/referanslar" className="underline">Master Data</Link>.
          </li>
          <li>
            Shifts of {calc.press} and the delivery time (needed by) — <Link to="/takvim" className="underline">Work Calendar</Link>
            {calc.capacityFactor < 1 && `; capacity factor ${Math.round(calc.capacityFactor * 100)}%`}.
          </li>
          <li>
            Order of the jobs before it: frozen or approved jobs stay where they are (
            <Link to="/planlama" className="underline">Production Plan</Link>).
          </li>
        </ul>
      </div>
    </div>
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
          <table className="w-full min-w-[48rem] text-left text-sm">
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
