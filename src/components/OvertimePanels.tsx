import { useState } from 'react'

import { api } from '../../convex/_generated/api'
import { useMutation, useQuery } from '../lib/convexTransport'
import { addDays, isoDate } from '../lib/dates'
import {
  DAY_MINUTES,
  WEEKDAY_KEYS,
  WEEKDAY_LABELS,
  clockText,
  dayOvertime,
  serverErrorText,
  type WeekPattern,
} from '../lib/pressCalendar'

// Mesai arayüzü: vardiya tablosu, mesai tanımları, tekrarlayan mesai ve bir
// presin bir haftasının gün detayı (tarihli mesai). Work Calendar ve
// Capacity Dashboard aynı bileşenleri ve aynı kayıtları kullanır.

export interface OvertimeDefinitionRow {
  _id: string
  name: string
  description?: string
  startMinute: number
  durationMinutes: number
}

export interface PressOvertimeRow {
  _id: string
  press: string
  date: string
  definitionId: string
}

export function useOvertimeData() {
  const definitions = (useQuery(api.overtime.listDefinitions) ?? []) as OvertimeDefinitionRow[]
  const pressOvertime = (useQuery(api.overtime.listPressOvertime) ?? []) as PressOvertimeRow[]
  return { definitions, pressOvertime }
}

const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} h`
const errorText = (e: unknown) => serverErrorText(e)

/** Fabrika geneli vardiya tablosu: aynı uzunlukta, art arda. */
export function ShiftTable({ shiftStartMinute, shiftMinutes }: { shiftStartMinute: number; shiftMinutes: number }) {
  const count = shiftMinutes > 0 ? Math.floor(DAY_MINUTES / shiftMinutes) : 0
  return (
    <div className="text-xs text-muted-foreground">
      <p className="font-medium text-foreground">Shift table (all presses)</p>
      <ul className="mt-1 flex flex-wrap gap-2">
        {Array.from({ length: Math.min(count, 6) }, (_, i) => {
          const start = shiftStartMinute + i * shiftMinutes
          return (
            <li key={i} className="rounded bg-muted px-2 py-1 tabular-nums">
              {i + 1}. shift {clockText(start)}–{clockText(start + shiftMinutes)}
            </li>
          )
        })}
      </ul>
      <p className="mt-1">
        At most {count} shift(s) of {hours(shiftMinutes)} fit in a day — a day never exceeds 24 hours,
        so a press week never exceeds 168 hours. A press picks how many of these shifts it runs.
      </p>
    </div>
  )
}

/** Mesai tanımları: tam mesai, yarım mesai… (ad, açıklama, başlangıç, süre). */
export function OvertimeDefinitionsPanel() {
  const { definitions } = useOvertimeData()
  const save = useMutation(api.overtime.saveDefinition)
  const remove = useMutation(api.overtime.removeDefinition)
  const [draft, setDraft] = useState({ id: '', name: '', description: '', start: '07:00', hours: '8' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const [h, m] = draft.start.split(':').map(Number)
    setBusy(true)
    setError(null)
    try {
      await save({
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name,
        description: draft.description || undefined,
        startMinute: (h || 0) * 60 + (m || 0),
        durationMinutes: Math.round(Number(draft.hours) * 60),
      })
      setDraft({ id: '', name: '', description: '', start: '07:00', hours: '8' })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-sm font-semibold text-foreground">Overtime definitions</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Overtime is always opened with one of these, on a date (or every week on a press pattern).
        Planned stops falling inside it are deducted too.
      </p>
      {definitions.length > 0 && (
        <table className="mt-2 w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Name</th>
              <th className="py-1 font-medium">Description</th>
              <th className="py-1 font-medium">From</th>
              <th className="py-1 font-medium">Duration</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {definitions.map((d) => (
              <tr key={d._id} className="border-t border-border">
                <td className="py-1 font-medium text-foreground">{d.name}</td>
                <td className="py-1 text-muted-foreground">{d.description ?? '—'}</td>
                <td className="py-1 tabular-nums">{clockText(d.startMinute)}</td>
                <td className="py-1 tabular-nums">{hours(d.durationMinutes)}</td>
                <td className="py-1 text-right">
                  <button
                    className="rounded px-2 py-0.5 hover:bg-muted"
                    onClick={() =>
                      setDraft({
                        id: d._id,
                        name: d.name,
                        description: d.description ?? '',
                        start: clockText(d.startMinute),
                        hours: String(d.durationMinutes / 60),
                      })
                    }
                  >
                    Edit
                  </button>
                  <button
                    className="rounded px-2 py-0.5 text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      if (!window.confirm(`Delete the overtime definition "${d.name}"?`)) return
                      remove({ id: d._id }).catch((e: unknown) => setError(errorText(e)))
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2 text-xs">
        <label>
          <span className="block text-muted-foreground">Name</span>
          <input
            className="mt-1 w-36 rounded-md border border-input bg-background px-2 py-1"
            placeholder="Full overtime"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          <span className="block text-muted-foreground">Description</span>
          <input
            className="mt-1 w-44 rounded-md border border-input bg-background px-2 py-1"
            placeholder="Weekend overtime"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </label>
        <label>
          <span className="block text-muted-foreground">Starts at</span>
          <input
            type="time"
            className="mt-1 w-28 rounded-md border border-input bg-background px-2 py-1"
            value={draft.start}
            onChange={(e) => setDraft({ ...draft, start: e.target.value })}
          />
        </label>
        <label>
          <span className="block text-muted-foreground">Hours</span>
          <input
            type="number"
            min={0.5}
            max={24}
            step={0.5}
            className="mt-1 w-20 rounded-md border border-input bg-background px-2 py-1"
            value={draft.hours}
            onChange={(e) => setDraft({ ...draft, hours: e.target.value })}
          />
        </label>
        <button
          disabled={busy || !draft.name.trim()}
          onClick={() => void submit()}
          className="rounded-md bg-foreground px-3 py-1.5 font-medium text-background disabled:opacity-40"
        >
          {draft.id ? 'Save changes' : 'Add definition'}
        </button>
        {draft.id && (
          <button
            className="rounded-md border border-border px-3 py-1.5"
            onClick={() => setDraft({ id: '', name: '', description: '', start: '07:00', hours: '8' })}
          >
            Cancel
          </button>
        )}
        {error && <span className="text-destructive">{error}</span>}
      </div>
    </div>
  )
}

/** Şablonda her hafta tekrarlayan mesai (iptal edilene kadar; tatilde çalışmaz). */
export function RecurringOvertimePanel({
  press,
  recurring,
  disabled,
}: {
  press: string
  recurring: { dayKey: string; definitionId: string }[]
  disabled?: boolean
}) {
  const { definitions } = useOvertimeData()
  const save = useMutation(api.overtime.setRecurringOvertime)
  const [dayKey, setDayKey] = useState('SA')
  const [definitionId, setDefinitionId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const nameOf = (id: string) => definitions.find((d) => d._id === id)?.name ?? '?'

  const update = async (items: { dayKey: string; definitionId: string }[]) => {
    setError(null)
    try {
      await save({ press, items })
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="mt-3 text-xs">
      <p className="font-medium text-foreground">Recurring overtime (every week until removed; not on public holidays)</p>
      {recurring.length === 0 ? (
        <p className="mt-1 text-muted-foreground">None.</p>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-2">
          {recurring.map((r, i) => (
            <li key={`${r.dayKey}-${r.definitionId}-${i}`} className="flex items-center gap-2 rounded-full bg-violet-100 px-3 py-1 text-violet-900">
              Every {WEEKDAY_LABELS[r.dayKey]} · {nameOf(r.definitionId)}
              <button
                className="text-destructive"
                onClick={() => {
                  if (window.confirm(`Stop the recurring ${nameOf(r.definitionId)} every ${WEEKDAY_LABELS[r.dayKey]}?`))
                    void update(recurring.filter((_, j) => j !== i))
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select className="rounded-md border border-input bg-background px-2 py-1" value={dayKey} onChange={(e) => setDayKey(e.target.value)}>
          {WEEKDAY_KEYS.map((k) => (
            <option key={k} value={k}>
              Every {WEEKDAY_LABELS[k]}
            </option>
          ))}
        </select>
        <DefinitionSelect definitions={definitions} value={definitionId} onChange={setDefinitionId} />
        <button
          disabled={disabled || !definitionId}
          onClick={() => void update([...recurring, { dayKey, definitionId }])}
          className="rounded-md bg-foreground px-3 py-1 font-medium text-background disabled:opacity-40"
          title={disabled ? 'Save the press pattern first' : undefined}
        >
          Add recurring overtime
        </button>
        {error && <span className="text-destructive">{error}</span>}
      </div>
    </div>
  )
}

function DefinitionSelect({
  definitions,
  value,
  onChange,
}: {
  definitions: OvertimeDefinitionRow[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <select className="rounded-md border border-input bg-background px-2 py-1" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{definitions.length ? 'Choose overtime…' : 'Define an overtime first'}</option>
      {definitions.map((d) => (
        <option key={d._id} value={d._id}>
          {d.name} · {clockText(d.startMinute)} {hours(d.durationMinutes)}
          {d.description ? ` — ${d.description}` : ''}
        </option>
      ))}
    </select>
  )
}

/**
 * Bir presin bir haftası, gün gün: normal vardiyalar (Pazartesiden sırayla,
 * tatilde yok) ve o güne açılan mesailer. Buradan tarihli mesai açılır ve
 * kaldırılır; kayıt Work Calendar ile ortaktır.
 */
export function PressWeekDays({
  press,
  weekStart,
  pattern,
  recurring,
  holidays,
  shiftStartMinute,
  shiftMinutes,
}: {
  press: string
  weekStart: Date
  /** O haftanın düzeni (istisna hafta ya da şablon); yoksa pres takvimi tanımsız. */
  pattern: WeekPattern | null
  recurring: { dayKey: string; definitionId: string }[]
  holidays: Set<string>
  shiftStartMinute: number
  shiftMinutes: number
}) {
  const { definitions, pressOvertime } = useOvertimeData()
  const add = useMutation(api.overtime.addPressOvertime)
  const remove = useMutation(api.overtime.removePressOvertime)
  const [date, setDate] = useState(isoDate(addDays(weekStart, 5)))
  const [definitionId, setDefinitionId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const defBy = new Map(definitions.map((d) => [d._id, d]))

  if (!pattern) {
    return (
      <p className="text-xs text-destructive">
        {press} has no Work Calendar pattern — define its days and shifts first. Until then it has no capacity.
      </p>
    )
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const iso = isoDate(addDays(weekStart, i))
    const holiday = holidays.has(iso)
    const shifts = !holiday && i < pattern.workingDays ? pattern.shiftsPerDay : 0
    const dated = pressOvertime.filter((o) => o.press === press && o.date === iso)
    const rec = holiday ? [] : recurring.filter((r) => r.dayKey === WEEKDAY_KEYS[i])
    const defs = [...dated.map((o) => defBy.get(o.definitionId)), ...rec.map((r) => defBy.get(r.definitionId))].filter(
      (d): d is OvertimeDefinitionRow => !!d,
    )
    const { windows } = dayOvertime(shifts, shiftStartMinute, shiftMinutes, defs)
    return { iso, i, holiday, shifts, dated, rec, windows }
  })

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await add({ press, date, definitionId })
      setDefinitionId('')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="text-xs">
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => (
          <div
            key={d.iso}
            className={`rounded border p-1.5 ${d.holiday ? 'border-red-200 bg-red-50' : d.windows.length ? 'border-violet-200 bg-violet-50' : 'border-border'}`}
          >
            <p className="font-medium text-foreground">
              {WEEKDAY_LABELS[WEEKDAY_KEYS[d.i]]} {d.iso.slice(8)}.{d.iso.slice(5, 7)}
            </p>
            <p className="text-muted-foreground">
              {d.holiday ? 'Holiday' : d.shifts > 0 ? `${d.shifts} shift(s)` : 'No shifts'}
            </p>
            {d.dated.map((o) => {
              const def = defBy.get(o.definitionId)
              return (
                <p key={o._id} className="mt-0.5 flex items-center justify-between gap-1 text-violet-900">
                  <span>
                    OT {def?.name ?? '?'} {def ? `${clockText(def.startMinute)} ${hours(def.durationMinutes)}` : ''}
                  </span>
                  <button
                    className="text-destructive"
                    title="Remove this overtime"
                    onClick={() => {
                      if (window.confirm(`Remove ${def?.name ?? 'this overtime'} on ${o.date} for ${press}?`)) void remove({ id: o._id })
                    }}
                  >
                    ×
                  </button>
                </p>
              )
            })}
            {d.rec.map((r, j) => (
              <p key={`r${j}`} className="mt-0.5 text-violet-700" title="Recurring overtime from the press pattern">
                OT {defBy.get(r.definitionId)?.name ?? '?'} (every week)
              </p>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Open overtime on</span>
        <select className="rounded-md border border-input bg-background px-2 py-1" value={date} onChange={(e) => setDate(e.target.value)}>
          {days.map((d) => (
            <option key={d.iso} value={d.iso}>
              {WEEKDAY_LABELS[WEEKDAY_KEYS[d.i]]} {d.iso}
              {d.holiday ? ' (holiday)' : ''}
            </option>
          ))}
        </select>
        <DefinitionSelect definitions={definitions} value={definitionId} onChange={setDefinitionId} />
        <button
          disabled={busy || !definitionId}
          onClick={() => void submit()}
          className="rounded-md bg-foreground px-3 py-1 font-medium text-background disabled:opacity-40"
        >
          Open overtime
        </button>
        {error && <span className="text-destructive">{error}</span>}
      </div>
    </div>
  )
}
