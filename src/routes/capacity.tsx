import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

import { api } from '../../convex/_generated/api'
import { CapacityChart, CapacityLegend } from '../components/CapacityChart'
import {
  capacityRows,
  sumSeries,
  type CapacityForecast,
  type CapacityRow,
  type CapacitySeries,
  type CapacityWeek,
} from '../lib/capacityForecast'
import { useMutation, useQuery } from '../lib/convexTransport'
import { formatPlantTime } from '../lib/sapUploads'
import { stopMinutesByShift } from '../lib/capacityModel'

export const Route = createFileRoute('/capacity')({
  component: CapacityPage,
})

interface Pattern {
  workingDays: number
  shiftsPerDay: number
  overtimeShifts: number
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-GB')

/**
 * Kapasite öngörüsü: pres grubu ve pres bazında haftalık kapasite, talep,
 * fazla/boş saat ve kümülatif. Hesap sunucuda planla birlikte yapılır
 * (src/lib/capacityForecast.ts). Bir haftanın kapasitesine tıklayıp fazla
 * mesai açmak Work Calendar'daki istisna haftayla aynı kayda yazar.
 */
function CapacityPage() {
  const data = useQuery(api.planRuns.latestCapacity) as
    | { computedAt: number; todayIso: string; capacity: CapacityForecast | null }
    | null
    | undefined
  const planStatus = useQuery(api.planRuns.status) as
    | { runningSince?: number; scheduledFor?: number }
    | null
    | undefined
  const templates = (useQuery(api.pressCalendar.listTemplates) ?? []) as ({ press: string } & Pattern)[]
  const overrides = (useQuery(api.pressCalendar.listAllOverrides) ?? []) as ({
    press: string
    weekStart: string
  } & Pattern)[]
  const plannedStops = (useQuery(api.plannedStops.list) ?? []) as { shiftIndex: number; durationMinutes: number }[]
  const stopsByShift = stopMinutesByShift(plannedStops)
  const [editing, setEditing] = useState<{ press: string; week: CapacityWeek } | null>(null)
  const [selection, setSelection] = useState<string>(() => {
    try {
      return window.localStorage.getItem(SELECTION_KEY) ?? ''
    } catch {
      return ''
    }
  })

  const forecast = data?.capacity ?? null
  const options = forecast ? viewOptions(forecast) : []
  // Kayıtlı seçim artık yoksa (pres silindi vb.) ilk hat gösterilir.
  const selected = options.find((o) => o.key === selection) ?? options[0]
  function choose(key: string) {
    setSelection(key)
    setEditing(null)
    try {
      window.localStorage.setItem(SELECTION_KEY, key)
    } catch {
      // Tarayıcı saklamaya izin vermiyorsa seçim yalnızca bu oturumda kalır.
    }
  }
  const recalculating = !!planStatus?.runningSince || (planStatus?.scheduledFor ?? 0) > Date.now() - 60_000

  return (
    <div className="mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 xl:w-2/3 xl:px-0">
      <h1 className="text-2xl font-bold text-foreground">Capacity Dashboard</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Weekly capacity against demand for every press group and press. Capacity is the net
        working time from the{' '}
        <Link to="/takvim" className="underline">
          Work Calendar
        </Link>{' '}
        (holidays removed, week exceptions and overtime included, planned stops deducted and the
        capacity factor from the Performance page applied — the same hours the plan uses; this
        week counts only the hours still ahead). Demand is the ZPP requirement of the week — this week also carries
        the overdue backlog — after stock in locations{' '}
        {(forecast?.stockLocations ?? ['2009', '1009']).join(', ')} is used up, earliest
        week first. Hours = pieces ÷ cavities ÷ SPM ÷ performance factor (10 h at 60 % counts as
        16.7 h; setup and approval sit inside that time). Each part counts on its main press; a
        co-product pair counts once. <strong className="text-foreground">Cumulative</strong> adds
        up idle minus over-capacity hours: above zero you can build stock ahead, below zero the
        customer waits.
      </p>

      <p className="mt-2 text-xs text-muted-foreground">
        Planned stops deducted per shift (tea, meal, handover — Work Calendar):{' '}
        <strong className="text-foreground">
          {stopsByShift.map((m, i) => `${i + 1}. shift ${m} min`).join(' · ')}
        </strong>
        . The Gantt shows the same stops on every press.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {data ? (
          <span>Calculated with the plan · {formatPlantTime(data.computedAt)}</span>
        ) : data === null ? (
          <span>The plan has not been calculated yet.</span>
        ) : (
          <span>Loading…</span>
        )}
        {recalculating && (
          <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
            Data changed — recalculating…
          </span>
        )}
      </div>

      {data && !forecast && (
        <p className="mt-6 text-sm text-muted-foreground">
          The capacity forecast appears after the next plan calculation.
        </p>
      )}

      {forecast && (
        <>
          <GroupCards forecast={forecast} selected={selected} onSelect={choose} />
          <SelectedView
            forecast={forecast}
            selection={selected}
            onSelect={choose}
            templates={templates}
            overrides={overrides}
            editing={editing}
            onEdit={setEditing}
          />
          <Unassigned forecast={forecast} />
        </>
      )}
    </div>
  )
}

function seriesOf(forecast: CapacityForecast, presses: string[]): CapacitySeries {
  return sumSeries(
    forecast.presses.filter((p) => presses.includes(p.press)),
    forecast.weeks.length,
  )
}

const SELECTION_KEY = 'capacity-dashboard-view'

interface ViewOption {
  key: string
  label: string
  kind: 'line' | 'press'
  presses: string[]
}

/** Açılır menünün seçenekleri: önce hatlar, sonra tek tek presler. */
function viewOptions(forecast: CapacityForecast): ViewOption[] {
  const lines: ViewOption[] = forecast.groups
    .filter((g) => g.presses.length > 1)
    .map((g) => ({ key: `line:${g.name}`, label: `${g.name} (${g.presses.join(' + ')})`, kind: 'line', presses: g.presses }))
  const presses: ViewOption[] = forecast.groups
    .flatMap((g) => g.presses)
    .map((p) => ({ key: `press:${p}`, label: p, kind: 'press', presses: [p] }))
  return [...lines, ...presses]
}

function groupKey(forecast: CapacityForecast, group: { name: string; presses: string[] }) {
  return viewOptions(forecast).find(
    (o) => o.presses.length === group.presses.length && o.presses.every((p) => group.presses.includes(p)),
  )?.key
}

/** Üstteki özet: her grubun toplam fazla/boş saati ve ilk sıkışan hafta. Tıklayınca grafiği o hatta çevirir. */
function GroupCards({
  forecast,
  selected,
  onSelect,
}: {
  forecast: CapacityForecast
  selected: ViewOption | undefined
  onSelect: (key: string) => void
}) {
  return (
    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {forecast.groups.map((group) => {
        const rows = capacityRows(seriesOf(forecast, group.presses))
        const over = rows.reduce((s, r) => s + r.over, 0)
        const idle = rows.reduce((s, r) => s + r.idle, 0)
        const end = rows[rows.length - 1]?.cumulative ?? 0
        const firstShort = rows.findIndex((r) => r.cumulative < 0)
        const firstOver = rows.findIndex((r) => r.over > 0)
        const key = groupKey(forecast, group)
        const active = !!key && selected?.key === key
        return (
          <button
            key={group.name}
            type="button"
            onClick={() => key && onSelect(key)}
            aria-pressed={active}
            className={`rounded-lg border p-3 text-left hover:bg-muted/40 ${
              active ? 'border-primary ring-1 ring-primary' : 'border-border'
            }`}
          >
            <p className="text-sm font-semibold text-foreground">{group.name}</p>
            <p className="text-xs text-muted-foreground">{group.presses.join(' + ')}</p>
            <dl className="mt-2 grid grid-cols-3 gap-1 text-xs">
              <div>
                <dt className="text-muted-foreground">Over</dt>
                <dd className={`text-base font-semibold tabular-nums ${over > 0 ? 'text-destructive' : 'text-foreground'}`}>
                  {fmt(over)} h
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Idle</dt>
                <dd className="text-base font-semibold tabular-nums text-foreground">{fmt(idle)} h</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Cumul. end</dt>
                <dd className={`text-base font-semibold tabular-nums ${end < 0 ? 'text-destructive' : 'text-foreground'}`}>
                  {fmt(end)} h
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs">
              {firstShort >= 0 ? (
                <span className="font-medium text-destructive">
                  ⚠ Customer waits from {forecast.weeks[firstShort].label}
                </span>
              ) : firstOver >= 0 ? (
                <span className="text-amber-700 dark:text-amber-400">
                  ⓘ Over in {forecast.weeks[firstOver].label}, covered by earlier idle hours
                </span>
              ) : (
                <span className="text-muted-foreground">✓ Demand fits every week</span>
              )}
            </p>
          </button>
        )
      })}
    </div>
  )
}

/** Seçilen hat ya da pres: tek tablo, tek grafik. */
function SelectedView({
  forecast,
  selection,
  onSelect,
  templates,
  overrides,
  editing,
  onEdit,
}: {
  forecast: CapacityForecast
  selection: ViewOption | undefined
  onSelect: (key: string) => void
  templates: ({ press: string } & Pattern)[]
  overrides: ({ press: string; weekStart: string } & Pattern)[]
  editing: { press: string; week: CapacityWeek } | null
  onEdit: (e: { press: string; week: CapacityWeek } | null) => void
}) {
  const options = viewOptions(forecast)
  if (!selection) return null
  const rows = capacityRows(seriesOf(forecast, selection.presses))
  const press = selection.kind === 'press' ? selection.presses[0] : undefined
  const lines = options.filter((o) => o.kind === 'line')
  const presses = options.filter((o) => o.kind === 'press')

  return (
    <section className="mt-6 rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/40 px-4 py-2">
        <label htmlFor="capacity-view" className="text-sm font-medium text-muted-foreground">
          Show
        </label>
        <select
          id="capacity-view"
          value={selection.key}
          onChange={(e) => onSelect(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm font-semibold text-foreground"
        >
          {lines.length > 0 && (
            <optgroup label="Lines">
              {lines.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Presses">
            {presses.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </optgroup>
        </select>
        {selection.kind === 'line' && (
          <span className="text-xs text-muted-foreground">
            Pick a single press to change a week's shifts or overtime.
          </span>
        )}
      </div>
      <div className="p-4">
        <CapacityTable
          weeks={forecast.weeks}
          rows={rows}
          press={press}
          overrides={overrides}
          editing={editing}
          onEdit={onEdit}
        />
        {press && editing?.press === press && (
          <OvertimeEditor
            key={`${editing.press}|${editing.week.start}`}
            press={press}
            week={editing.week}
            templates={templates}
            overrides={overrides}
            onClose={() => onEdit(null)}
          />
        )}
        <div className="mt-4">
          <CapacityLegend />
        </div>
        <div className="mt-2">
          <CapacityChart weeks={forecast.weeks} rows={rows} title={selection.label} />
        </div>
      </div>
    </section>
  )
}

/**
 * Raporun tablosu: haftalar sütun. Tek presin tablosunda kapasite hücresine
 * tıklamak o haftanın vardiya/mesai düzenleyicisini açar.
 */
function CapacityTable({
  weeks,
  rows,
  press,
  overrides,
  editing,
  onEdit,
}: {
  weeks: CapacityWeek[]
  rows: CapacityRow[]
  press?: string
  overrides: { press: string; weekStart: string }[]
  editing: { press: string; week: CapacityWeek } | null
  onEdit: (e: { press: string; week: CapacityWeek } | null) => void
}) {
  const overridden = new Set(overrides.filter((o) => o.press === press).map((o) => o.weekStart))
  const line = (label: string, value: (r: CapacityRow) => number, tone?: (r: CapacityRow) => string) => (
    <tr className="border-t border-border">
      <th scope="row" className="sticky left-0 whitespace-nowrap bg-background px-2 py-1 text-left font-medium text-muted-foreground">
        {label}
      </th>
      {rows.map((r, i) => (
        <td key={weeks[i].start} className={`px-2 py-1 text-right tabular-nums ${tone?.(r) ?? 'text-foreground'}`}>
          {fmt(value(r))}
        </td>
      ))}
    </tr>
  )
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 bg-background px-2 py-1 text-left font-medium text-muted-foreground">Week</th>
            {weeks.map((w) => (
              <th
                key={w.start}
                className="px-2 py-1 text-right font-semibold text-foreground"
                title={w.holidays.length ? `${w.start} · ${w.holidays.join(', ')}` : w.start}
              >
                {w.label}
                {w.holidays.length > 0 && <span className="block text-[9px] font-normal text-amber-700 dark:text-amber-400">holiday</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-border">
            <th scope="row" className="sticky left-0 whitespace-nowrap bg-background px-2 py-1 text-left font-medium text-muted-foreground">
              Available hours
            </th>
            {rows.map((r, i) => {
              const week = weeks[i]
              const active = editing && press && editing.press === press && editing.week.start === week.start
              return (
                <td key={week.start} className="px-1 py-0.5 text-right tabular-nums">
                  {press ? (
                    <button
                      type="button"
                      onClick={() => onEdit(active ? null : { press, week })}
                      title="Change shifts or add overtime for this week"
                      className={`w-full rounded px-1 py-0.5 text-right underline decoration-dotted underline-offset-2 hover:bg-muted ${
                        active ? 'bg-primary/10 ring-1 ring-primary' : ''
                      } ${overridden.has(week.start) ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-foreground'}`}
                    >
                      {fmt(r.capacity)}
                      {overridden.has(week.start) && '*'}
                    </button>
                  ) : (
                    <span className="px-1 text-foreground">{fmt(r.capacity)}</span>
                  )}
                </td>
              )
            })}
          </tr>
          {line('Production time', (r) => r.demand)}
          {line('Over capacity', (r) => r.over, (r) => (r.over > 0 ? 'font-semibold text-destructive' : 'text-muted-foreground'))}
          {line('Idle capacity', (r) => r.idle, (r) => (r.idle > 0 ? 'text-foreground' : 'text-muted-foreground'))}
          {line('Cumulative', (r) => r.cumulative, (r) => (r.cumulative < 0 ? 'font-semibold text-destructive' : 'font-semibold text-foreground'))}
        </tbody>
      </table>
      {press && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Click an available-hours cell to change that week's shifts or add overtime. * = week
          exception from the Work Calendar.
        </p>
      )}
    </div>
  )
}

/**
 * Bir presin bir haftası: çalışma günü, vardiya ve fazla mesai. Work
 * Calendar'daki istisna haftayla aynı kayıt (pressWeekOverrides) — burada
 * açılan mesai orada da görünür ve plan da onu kullanır.
 */
function OvertimeEditor({
  press,
  week,
  templates,
  overrides,
  onClose,
}: {
  press: string
  week: CapacityWeek
  templates: ({ press: string } & Pattern)[]
  overrides: ({ press: string; weekStart: string } & Pattern)[]
  onClose: () => void
}) {
  const saveOverride = useMutation(api.pressCalendar.saveOverride)
  const clearOverride = useMutation(api.pressCalendar.clearOverride)
  const override = overrides.find((o) => o.press === press && o.weekStart === week.start)
  const template = templates.find((t) => t.press === press)
  const base: Pattern = override ??
    template ?? { workingDays: 5, shiftsPerDay: 1, overtimeShifts: 0 }
  const [draft, setDraft] = useState<Pattern>({
    workingDays: base.workingDays,
    shiftsPerDay: base.shiftsPerDay,
    overtimeShifts: base.overtimeShifts,
  })
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string }>({
    kind: 'idle',
  })

  const field = (key: keyof Pattern, label: string, max: number) => (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <input
        type="number"
        min={0}
        max={max}
        value={draft[key]}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: Math.max(0, Math.min(max, Number(e.target.value) || 0)) }))}
        className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
      />
    </label>
  )

  async function save() {
    setState({ kind: 'saving' })
    try {
      await saveOverride({ press, weekStart: week.start, ...draft })
      setState({ kind: 'saved' })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not save.' })
    }
  }

  async function backToStandard() {
    setState({ kind: 'saving' })
    try {
      await clearOverride({ press, weekStart: week.start })
      setState({ kind: 'saved' })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not save.' })
    }
  }

  return (
    <div className="mt-2 rounded-md border border-primary/40 bg-primary/5 p-3">
      <p className="text-sm font-medium text-foreground">
        {press} · {week.label} <span className="font-normal text-muted-foreground">(week from {week.start})</span>
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {override
          ? 'This week already has an exception on the Work Calendar.'
          : `Standard week: ${base.workingDays} days × ${base.shiftsPerDay} shifts + ${base.overtimeShifts} overtime.`}{' '}
        Saving writes the same week exception as the Work Calendar; the plan and this dashboard
        update a few seconds later.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        {field('workingDays', 'Working days', 7)}
        {field('shiftsPerDay', 'Shifts per day', 3)}
        {field('overtimeShifts', 'Overtime shifts', 21)}
        <button
          type="button"
          onClick={() => void save()}
          disabled={state.kind === 'saving'}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Save
        </button>
        {override && (
          <button
            type="button"
            onClick={() => void backToStandard()}
            disabled={state.kind === 'saving'}
            className="rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            Back to standard week
          </button>
        )}
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted">
          Close
        </button>
      </div>
      {state.kind === 'saved' && (
        <p className="mt-2 text-xs text-emerald-600">✓ Saved. Recalculating the plan and the dashboard…</p>
      )}
      {state.kind === 'error' && <p className="mt-2 text-xs text-destructive">{state.message}</p>}
    </div>
  )
}

function Unassigned({ forecast }: { forecast: CapacityForecast }) {
  if (forecast.unassigned.length === 0) return null
  return (
    <section className="mt-8 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
      <h2 className="font-semibold">
        ⓘ {forecast.unassigned.length} material(s) with demand are not in the hours above
      </h2>
      <p className="mt-1 text-xs">
        Fix them on{' '}
        <Link to="/referanslar" className="underline">
          Master Data
        </Link>{' '}
        (main press and SPM) so their hours count.
      </p>
      <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-0.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
        {forecast.unassigned.map((u) => (
          <li key={u.material}>
            <strong>{u.material}</strong> — {u.reason} ({fmt(u.quantity)} pcs)
          </li>
        ))}
      </ul>
    </section>
  )
}
