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
      <p className="text-xs text-muted-foreground">
        A type is a start time and a length (e.g. Full overtime, 07:00, 8 h). Planned stops falling
        inside it are deducted.
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
      <option value="">{definitions.length ? 'Choose type…' : 'Add an overtime type first'}</option>
      {definitions.map((d) => (
        <option key={d._id} value={d._id}>
          {d.name} · {clockText(d.startMinute)} {hours(d.durationMinutes)}
          {d.description ? ` — ${d.description}` : ''}
        </option>
      ))}
    </select>
  )
}

/** Silme düğmesi: onay sorar, hatayı gösterir. */
function DeleteOvertime({ id, label }: { id: string; label: string }) {
  const remove = useMutation(api.overtime.removePressOvertime)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <button
        type="button"
        className="rounded-md border border-destructive/40 px-2 py-0.5 text-destructive hover:bg-destructive/10"
        onClick={() => {
          if (!window.confirm(`Delete ${label}?`)) return
          setError(null)
          remove({ id }).catch((e: unknown) => setError(errorText(e)))
        }}
      >
        Delete
      </button>
      {error && <span className="ml-2 text-destructive">{error}</span>}
    </>
  )
}

/**
 * Bir presin bir haftasındaki mesailer: liste (her birinde Sil) ve yeni mesai
 * açma satırı. Work Calendar tablosu ve Capacity Dashboard aynı bileşeni ve
 * aynı kaydı kullanır.
 */
export function PressWeekDays({
  press,
  weekStart,
  pattern,
  recurring,
  holidays,
}: {
  press: string
  weekStart: Date
  /** O haftanın düzeni (istisna hafta ya da şablon); yoksa pres takvimi tanımsız. */
  pattern: WeekPattern | null
  recurring: { dayKey: string; definitionId: string }[]
  holidays: Set<string>
  shiftStartMinute?: number
  shiftMinutes?: number
}) {
  const { definitions, pressOvertime } = useOvertimeData()
  const add = useMutation(api.overtime.addPressOvertime)
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
    return { iso, i, holiday: holidays.has(iso) }
  })
  const dated = pressOvertime
    .filter((o) => o.press === press && days.some((d) => d.iso === o.date))
    .sort((a, b) => a.date.localeCompare(b.date))
  const recurringHere = days.flatMap((d) =>
    d.holiday ? [] : recurring.filter((r) => r.dayKey === WEEKDAY_KEYS[d.i]).map((r) => ({ ...r, iso: d.iso })),
  )

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
      <p className="font-medium text-foreground">Overtime this week — {press}</p>
      {dated.length === 0 && recurringHere.length === 0 ? (
        <p className="mt-1 text-muted-foreground">No overtime this week.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {dated.map((o) => {
            const def = defBy.get(o.definitionId)
            const label = `${def?.name ?? 'Overtime'} on ${dayText(o.date)} for ${press}`
            return (
              <li key={o._id} className="flex flex-wrap items-center gap-2">
                <span className="text-foreground">
                  {dayText(o.date)} · {def?.name ?? '?'}{' '}
                  {def ? `${clockText(def.startMinute)}–${clockText(def.startMinute + def.durationMinutes)}` : ''}
                </span>
                <DeleteOvertime id={o._id} label={label} />
              </li>
            )
          })}
          {recurringHere.map((r, j) => (
            <li key={`r${j}`} className="text-muted-foreground">
              {dayText(r.iso)} · {defBy.get(r.definitionId)?.name ?? '?'} — every week (change it on the press pattern)
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select className="rounded-md border border-input bg-background px-2 py-1" value={date} onChange={(e) => setDate(e.target.value)}>
          {days.map((d) => (
            <option key={d.iso} value={d.iso}>
              {dayText(d.iso)}
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
          Add overtime
        </button>
        {error && <span className="text-destructive">{error}</span>}
      </div>
    </div>
  )
}

/** "Sat 19 Sep" */
function dayText(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  })
}

/**
 * Mesai girişi — tek yer: pres, tarih, mesai türü, Ekle. Altında açık
 * mesailerin listesi, her birinde Sil. Geçmiş haftalar gizli.
 */
export function OvertimeEntryPanel({ presses }: { presses: string[] }) {
  const { definitions, pressOvertime } = useOvertimeData()
  const add = useMutation(api.overtime.addPressOvertime)
  const today = new Date().toISOString().slice(0, 10)
  const [press, setPress] = useState('')
  const [date, setDate] = useState('')
  const [definitionId, setDefinitionId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showTypes, setShowTypes] = useState(false)
  const defBy = new Map(definitions.map((d) => [d._id, d]))
  const chosenPress = press || presses[0] || ''
  const upcoming = pressOvertime
    .filter((o) => o.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.press.localeCompare(b.press))

  const submit = async () => {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      await add({ press: chosenPress, date, definitionId })
      setDone(`${defBy.get(definitionId)?.name ?? 'Overtime'} added on ${dayText(date)} for ${chosenPress}.`)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="block text-muted-foreground">Press</span>
          <select
            className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={chosenPress}
            onChange={(e) => setPress(e.target.value)}
          >
            {presses.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-muted-foreground">Date</span>
          <input
            type="date"
            className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="text-xs">
          <span className="block text-muted-foreground">Overtime type</span>
          <div className="mt-1">
            <DefinitionSelect definitions={definitions} value={definitionId} onChange={setDefinitionId} />
          </div>
        </label>
        <button
          disabled={busy || !chosenPress || !date || !definitionId}
          onClick={() => void submit()}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
        >
          Add overtime
        </button>
      </div>
      {error && <p className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {done && !error && <p className="mt-2 text-xs text-emerald-700">✓ {done}</p>}

      <div className="mt-3 overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Date</th>
              <th className="px-2 py-1.5 font-medium">Press</th>
              <th className="px-2 py-1.5 font-medium">Overtime</th>
              <th className="px-2 py-1.5 font-medium">Time</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {upcoming.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-2 text-muted-foreground">
                  No overtime from today on.
                </td>
              </tr>
            )}
            {upcoming.map((o) => {
              const def = defBy.get(o.definitionId)
              return (
                <tr key={o._id} className="border-t border-border">
                  <td className="px-2 py-1.5 font-medium text-foreground">{dayText(o.date)}</td>
                  <td className="px-2 py-1.5">{o.press}</td>
                  <td className="px-2 py-1.5">{def?.name ?? '?'}</td>
                  <td className="px-2 py-1.5 tabular-nums">
                    {def ? `${clockText(def.startMinute)}–${clockText(def.startMinute + def.durationMinutes)}` : ''}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <DeleteOvertime id={o._id} label={`${def?.name ?? 'overtime'} on ${dayText(o.date)} for ${o.press}`} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => setShowTypes((v) => !v)}
        className="mt-3 text-xs text-muted-foreground underline hover:text-foreground"
      >
        {showTypes ? 'Hide overtime types' : `Overtime types (${definitions.length}) — add or change`}
      </button>
      {showTypes && (
        <div className="mt-2">
          <OvertimeDefinitionsPanel />
        </div>
      )}
    </div>
  )
}
