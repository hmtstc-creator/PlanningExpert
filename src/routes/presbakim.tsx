import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { ErrorBanner } from '../components/ErrorBanner'
import { SaveStatus } from '../components/SaveStatus'
import { UnsavedBar } from '../components/UnsavedBar'
import { useQuery } from '../lib/convexTransport'
import { useCurrentUser } from '../lib/currentUser'
import { isoDate } from '../lib/dates'
import { maintenancePerformance, type PressMaintenanceRow } from '../lib/maintenance'
import { useDraftRows } from '../lib/useDraftRows'
import { useSafeMutation } from '../lib/useSafeMutation'

export const Route = createFileRoute('/presbakim')({
  component: PressMaintenancePage,
})

type Row = PressMaintenanceRow & { _id: string; note?: string; completedBy?: string }

function clockLabel(minute: number): string {
  const h = Math.floor(minute / 60)
  const m = minute % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function parseClock(value: string): number | null {
  const [h, m] = value.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

interface Draft {
  date: string
  start: string
  end: string
  reason: string
  note: string
  status: string
}

function draftOf(row: Row): Draft {
  return {
    date: row.date,
    start: clockLabel(row.startMinute),
    end: clockLabel(row.endMinute),
    reason: row.reason,
    note: row.note ?? '',
    status: row.status,
  }
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.date === b.date &&
    a.start === b.start &&
    a.end === b.end &&
    a.reason === b.reason &&
    a.note === b.note &&
    a.status === b.status
  )
}

const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned',
  done: 'Done',
  cancelled: 'Cancelled',
}

function PressMaintenancePage() {
  const { name: currentUser } = useCurrentUser()
  const presses = (useQuery(api.presses.list) ?? []) as { name: string; hall: string }[]
  const rows = (useQuery(api.pressMaintenance.list) ?? []) as Row[]
  const lookups = (useQuery(api.lookups.list) ?? []) as { kind: string; value: string }[]

  const { run: add, error: addError, clearError } = useSafeMutation(api.pressMaintenance.add)
  const { run: update, error: updateError } = useSafeMutation(api.pressMaintenance.update)
  const { run: complete, error: completeError } = useSafeMutation(api.pressMaintenance.complete)
  const { run: remove, error: removeError } = useSafeMutation(api.pressMaintenance.remove)

  const reasons = useMemo(
    () => lookups.filter((l) => l.kind === 'maintenanceReason').map((l) => l.value),
    [lookups],
  )

  const today = isoDate(new Date())
  const [press, setPress] = useState('')
  const [date, setDate] = useState(today)
  const [start, setStart] = useState('08:00')
  const [end, setEnd] = useState('12:00')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  // Gerçekleşen saatleri girme kutusu — hangi kayıt için açık.
  const [completing, setCompleting] = useState<string | null>(null)
  const [actualDate, setActualDate] = useState(today)
  const [actualStart, setActualStart] = useState('08:00')
  const [actualEnd, setActualEnd] = useState('12:00')

  const drafts = useDraftRows(rows, (r) => r._id, draftOf, sameDraft)

  const sorted = useMemo(
    () => [...rows].sort((a, b) => (a.date === b.date ? a.startMinute - b.startMinute : b.date.localeCompare(a.date))),
    [rows],
  )
  const upcoming = sorted.filter((r) => r.status === 'planned' && r.date >= today)
  const history = sorted.filter((r) => !(r.status === 'planned' && r.date >= today))

  const performance = useMemo(() => maintenancePerformance(rows), [rows])

  async function submit() {
    const startMinute = parseClock(start)
    const endMinute = parseClock(end)
    if (startMinute === null || endMinute === null || !press || !reason.trim()) return
    setSaving(true)
    let ok = false
    try {
      ok = await add({
        press,
        date,
        startMinute,
        endMinute,
        reason: reason.trim(),
        note: note.trim() || undefined,
        createdBy: currentUser ?? undefined,
      })
    } finally {
      setSaving(false)
    }
    if (ok) setNote('')
  }

  const saveRow = (id: string) => (draft: Draft) => {
    const startMinute = parseClock(draft.start)
    const endMinute = parseClock(draft.end)
    if (startMinute === null || endMinute === null) return Promise.resolve(false)
    return update({
      id,
      date: draft.date,
      startMinute,
      endMinute,
      reason: draft.reason,
      note: draft.note.trim() || undefined,
      status: draft.status,
    })
  }

  async function submitActual(row: Row) {
    const s = parseClock(actualStart)
    const e = parseClock(actualEnd)
    if (s === null || e === null) return
    const ok = await complete({
      id: row._id,
      actualDate,
      actualStartMinute: s,
      actualEndMinute: e,
      completedBy: currentUser ?? undefined,
    })
    if (ok) setCompleting(null)
  }

  const inputClass = 'rounded-md border border-input bg-background px-2 py-1 text-sm'

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-12">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Press Maintenance</h1>
      <p className="mt-2 text-muted-foreground">
        The maintenance department books which press is down, on which day and
        between which hours. The planner does not enter this and cannot plan
        over it: the hours are taken out of that press automatically and work
        flows around them. After the job is finished, record the hours it
        actually took — the difference between planned and actual is the
        performance figure below, and every record is kept.
      </p>

      <ErrorBanner
        message={addError ?? updateError ?? completeError ?? removeError}
        onDismiss={clearError}
      />

      {presses.length === 0 && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          No presses are defined yet, so there is nothing to book maintenance
          against.
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-end gap-2 rounded-lg border border-border p-4">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Press</span>
          <select
            className={`mt-1 w-36 ${inputClass}`}
            value={press}
            onChange={(e) => setPress(e.target.value)}
          >
            <option value="">Select…</option>
            {presses.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Date</span>
          <input
            type="date"
            className={`mt-1 ${inputClass}`}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">From</span>
          <input
            type="time"
            className={`mt-1 w-28 ${inputClass}`}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">To</span>
          <input
            type="time"
            className={`mt-1 w-28 ${inputClass}`}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Reason</span>
          <input
            className={`mt-1 w-48 ${inputClass}`}
            list="maintenance-reasons"
            placeholder="Hydraulic service"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <datalist id="maintenance-reasons">
            {reasons.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Note (opt.)</span>
          <input
            className={`mt-1 w-56 ${inputClass}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button
          onClick={() => void submit()}
          disabled={!press || !reason.trim() || saving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Booking…' : 'Book maintenance'}
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Planned" value={String(performance.planned)} />
        <Stat label="Completed" value={String(performance.completed)} />
        <Stat
          label="Actual vs planned"
          value={performance.ratio === null ? '—' : `${Math.round(performance.ratio * 100)}%`}
          hint={
            performance.ratio === null
              ? 'no actual hours recorded yet'
              : `over ${performance.measured} measured jobs`
          }
          warn={performance.ratio !== null && performance.ratio > 1.1}
        />
        <Stat
          label="Overran"
          value={String(performance.overran)}
          hint="took longer than booked"
          warn={performance.overran > 0}
        />
      </div>

      <MaintenanceTable
        title={`Upcoming (${upcoming.length})`}
        rows={upcoming}
        drafts={drafts}
        saveRow={saveRow}
        remove={remove}
        completing={completing}
        setCompleting={(id, row) => {
          setCompleting(id)
          if (row) {
            setActualDate(row.date)
            setActualStart(clockLabel(row.startMinute))
            setActualEnd(clockLabel(row.endMinute))
          }
        }}
        actualDate={actualDate}
        actualStart={actualStart}
        actualEnd={actualEnd}
        setActualDate={setActualDate}
        setActualStart={setActualStart}
        setActualEnd={setActualEnd}
        submitActual={submitActual}
        emptyLabel="Nothing booked from today onwards."
      />

      <MaintenanceTable
        title={`History (${history.length})`}
        rows={history}
        drafts={drafts}
        saveRow={saveRow}
        remove={remove}
        completing={completing}
        setCompleting={(id, row) => {
          setCompleting(id)
          if (row) {
            setActualDate(row.date)
            setActualStart(clockLabel(row.startMinute))
            setActualEnd(clockLabel(row.endMinute))
          }
        }}
        actualDate={actualDate}
        actualStart={actualStart}
        actualEnd={actualEnd}
        setActualDate={setActualDate}
        setActualStart={setActualStart}
        setActualEnd={setActualEnd}
        submitActual={submitActual}
        emptyLabel="No past maintenance recorded."
      />

      <UnsavedBar
        count={drafts.dirtyKeys.length}
        saving={drafts.savingKey !== null}
        noun="record"
        onSaveAll={() => void drafts.commitAll((id, draft) => saveRow(id)(draft))}
        onDiscard={drafts.discardAll}
      />
    </div>
  )
}

interface TableProps {
  title: string
  rows: Row[]
  drafts: ReturnType<typeof useDraftRows<Row, Draft>>
  saveRow: (id: string) => (draft: Draft) => Promise<boolean>
  remove: (args: unknown) => Promise<boolean>
  completing: string | null
  setCompleting: (id: string | null, row?: Row) => void
  actualDate: string
  actualStart: string
  actualEnd: string
  setActualDate: (v: string) => void
  setActualStart: (v: string) => void
  setActualEnd: (v: string) => void
  submitActual: (row: Row) => void
  emptyLabel: string
}

function MaintenanceTable(props: TableProps) {
  const { rows, drafts } = props
  const inputClass = 'rounded-md border border-input bg-background px-2 py-1 text-sm'

  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold text-foreground">{props.title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {props.emptyLabel}
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Press</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">From</th>
                <th className="px-3 py-2 font-medium">To</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Actual</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const draft = drafts.draftFor(row)
                const dirty = drafts.isDirty(row)
                const busy = drafts.savingKey === row._id
                const save = () => {
                  if (dirty && !busy) void drafts.commit(row._id, props.saveRow(row._id))
                }
                const plannedMinutes = row.endMinute - row.startMinute
                const actualMinutes =
                  row.actualStartMinute !== undefined && row.actualEndMinute !== undefined
                    ? row.actualEndMinute - row.actualStartMinute
                    : null
                return (
                  <tr
                    key={row._id}
                    className={`border-t border-border ${dirty ? 'bg-amber-50' : ''}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') save()
                    }}
                  >
                    <td className="px-3 py-2 font-medium text-foreground">{row.press}</td>
                    <td className="px-3 py-2">
                      <input
                        type="date"
                        className={inputClass}
                        value={draft.date}
                        onChange={(e) => drafts.edit(row._id, { date: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="time"
                        className={`w-24 ${inputClass}`}
                        value={draft.start}
                        onChange={(e) => drafts.edit(row._id, { start: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="time"
                        className={`w-24 ${inputClass}`}
                        value={draft.end}
                        onChange={(e) => drafts.edit(row._id, { end: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className={`w-44 ${inputClass}`}
                        value={draft.reason}
                        onChange={(e) => drafts.edit(row._id, { reason: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className={inputClass}
                        value={draft.status}
                        onChange={(e) => drafts.edit(row._id, { status: e.target.value })}
                      >
                        {Object.entries(STATUS_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {actualMinutes !== null ? (
                        <span
                          className={
                            actualMinutes > plannedMinutes
                              ? 'font-medium text-amber-700'
                              : 'text-muted-foreground'
                          }
                        >
                          {row.actualDate} {clockLabel(row.actualStartMinute!)}–
                          {clockLabel(row.actualEndMinute!)}
                          <span className="block">
                            {actualMinutes} min vs {plannedMinutes} planned
                          </span>
                        </span>
                      ) : props.completing === row._id ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <input
                            type="date"
                            className={inputClass}
                            value={props.actualDate}
                            onChange={(e) => props.setActualDate(e.target.value)}
                          />
                          <input
                            type="time"
                            className={`w-24 ${inputClass}`}
                            value={props.actualStart}
                            onChange={(e) => props.setActualStart(e.target.value)}
                          />
                          <input
                            type="time"
                            className={`w-24 ${inputClass}`}
                            value={props.actualEnd}
                            onChange={(e) => props.setActualEnd(e.target.value)}
                          />
                          <button
                            onClick={() => props.submitActual(row)}
                            className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                          >
                            Save actual
                          </button>
                          <button
                            onClick={() => props.setCompleting(null)}
                            className="text-xs text-muted-foreground underline"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => props.setCompleting(row._id, row)}
                          className="text-xs text-foreground underline hover:no-underline"
                        >
                          Record actual hours
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <SaveStatus
                        dirty={dirty}
                        saving={busy}
                        justSaved={!!drafts.justSaved[row._id]}
                      />
                      <button
                        onClick={save}
                        disabled={!dirty || busy}
                        className="ml-2 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete the ${row.reason} maintenance on ${row.press} (${row.date})? The history is lost.`,
                            )
                          ) {
                            void props.remove({ id: row._id })
                          }
                        }}
                        className="ml-2 text-xs text-destructive hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  warn,
}: {
  label: string
  value: string
  hint?: string
  warn?: boolean
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${warn ? 'text-destructive' : 'text-foreground'}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
