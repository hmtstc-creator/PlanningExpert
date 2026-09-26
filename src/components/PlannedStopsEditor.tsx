import { useMemo, useState } from 'react'
import { InfoTip } from './PageHeader'

import { ErrorBanner } from './ErrorBanner'
import { useDraftRows } from '../lib/useDraftRows'
import { useSafeMutation } from '../lib/useSafeMutation'
import { stopMinutesInShift, type PlannedStop } from '../lib/shiftTimeline'

/**
 * Planned stops per shift: handovers, tea and meal breaks, daily maintenance.
 *
 * These are entered as real clock times rather than offsets, because the shop
 * hands over and eats at fixed hours and the three shifts do not mirror each
 * other. Production is never planned into these intervals.
 */
// Swatches match the plan's Gantt so a stop is recognisable in both places:
// meetings and handovers yellow, tea and meals orange, the rest neutral.
const KINDS = [
  { value: 'handover', label: 'Shift handover / meeting', swatch: '#d1ad33' },
  { value: 'tea', label: 'Tea break', swatch: '#a8460f' },
  { value: 'meal', label: 'Meal break', swatch: '#a8460f' },
  { value: 'maintenance', label: 'Daily maintenance', swatch: '#64748b' },
  { value: 'other', label: 'Other', swatch: '#64748b' },
] as const

function clockLabel(minute: number): string {
  const h = Math.floor(minute / 60) % 24
  const m = minute % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function parseClock(value: string): number | null {
  const [h, m] = value.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

export interface StopRow extends PlannedStop {
  _id: string
}

interface Props {
  stops: StopRow[]
  shiftCount: number
  shiftStartMinute: number
  shiftMinutes: number
  addStop: unknown
  updateStop: unknown
  removeStop: unknown
}

export function PlannedStopsEditor({
  stops,
  shiftCount,
  shiftStartMinute,
  shiftMinutes,
  addStop,
  updateStop,
  removeStop,
}: Props) {
  const { run: add, error: addError, clearError } = useSafeMutation(addStop as never)
  const { run: update } = useSafeMutation(updateStop as never)
  const { run: remove, error: removeError } = useSafeMutation(removeStop as never)

  // Saat ve süre birlikte düzenlenir ve açıkça kaydedilir: değiştirip
  // kaydettiğini görememek bu programda bildirilen bir sorundu.
  const rows = useDraftRows(
    stops,
    (s) => s._id,
    (s) => ({ start: clockLabel(s.startMinute), duration: String(s.durationMinutes) }),
    (a, b) => a.start === b.start && a.duration === b.duration,
  )

  const saveStop = (id: string) => (draft: { start: string; duration: string }) => {
    const startMinute = parseClock(draft.start)
    if (startMinute === null) return Promise.resolve(false)
    return update({
      id,
      startMinute,
      durationMinutes: Math.max(1, Math.round(Number(draft.duration)) || 1),
    })
  }

  const [shiftIndex, setShiftIndex] = useState(1)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<string>('handover')
  const [start, setStart] = useState('08:00')
  const [duration, setDuration] = useState(15)

  const byShift = useMemo(() => {
    const map = new Map<number, StopRow[]>()
    for (const s of stops) {
      const list = map.get(s.shiftIndex) ?? []
      list.push(s)
      map.set(s.shiftIndex, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.startMinute - b.startMinute)
    return map
  }, [stops])

  async function submit() {
    const startMinute = parseClock(start)
    if (startMinute === null || !name.trim()) return
    const ok = await add({
      shiftIndex,
      name: name.trim(),
      kind,
      startMinute,
      durationMinutes: Math.max(1, Math.round(duration)),
    })
    if (ok) setName('')
  }

  return (
    <div className="rounded-md border border-border p-3">
      <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        Planned stops — production is never scheduled into these
        <InfoTip label="About planned stops">
          <p>
            Enter the real clock time of each handover, tea and meal break for every shift. They are
            the same for all presses. Capacity is reduced shift by shift, so shifts with different
            stops are worth different amounts. Stops inside overtime are deducted too.
          </p>
          <p>Changing a time or a duration marks that stop until you press Save.</p>
        </InfoTip>
      </h3>

      <ErrorBanner message={addError ?? removeError} onDismiss={clearError} />

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Shift</span>
          <select
            className="mt-1 w-24 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={shiftIndex}
            onChange={(e) => setShiftIndex(Number(e.target.value))}
          >
            {Array.from({ length: 3 }, (_, i) => i + 1).map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Type</span>
          <select
            className="mt-1 w-40 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value)
              const preset = KINDS.find((k) => k.value === e.target.value)
              if (preset && !name.trim()) setName(preset.label)
            }}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Name</span>
          <input
            className="mt-1 w-40 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            placeholder="Shift handover"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Starts</span>
          <input
            type="time"
            className="mt-1 w-28 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Minutes</span>
          <input
            type="number"
            min={1}
            className="mt-1 w-24 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </label>
        <button
          onClick={() => void submit()}
          disabled={!name.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Add stop
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => i + 1).map((shift) => {
          const list = byShift.get(shift) ?? []
          const lost = stopMinutesInShift(shift, list)
          const windowStart = shiftStartMinute + (shift - 1) * shiftMinutes
          const inUse = shift <= shiftCount
          return (
            <div
              key={shift}
              className={`rounded-md border p-2 ${
                inUse ? 'border-border' : 'border-dashed border-border/60 opacity-60'
              }`}
            >
              <p className="text-xs font-medium text-foreground">
                Shift {shift}{' '}
                <span className="font-normal text-muted-foreground">
                  {clockLabel(windowStart)}–{clockLabel(windowStart + shiftMinutes)}
                </span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                {lost} min stopped · {shiftMinutes - lost} min productive
                {!inUse && ' · not in use'}
              </p>
              {list.length === 0 ? (
                <p className="mt-2 text-[11px] text-muted-foreground">No stops defined.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {list.map((s) => {
                    const preset = KINDS.find((k) => k.value === s.kind)
                    const draft = rows.draftFor(s)
                    const dirty = rows.isDirty(s)
                    const busy = rows.savingKey === s._id
                    const saveThisStop = () => {
                      if (dirty && !busy) void rows.commit(s._id, saveStop(s._id))
                    }
                    return (
                      <li
                        key={s._id}
                        className={`flex items-center gap-1 rounded text-[11px] ${
                          dirty ? 'bg-amber-50' : ''
                        }`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveThisStop()
                        }}
                      >
                        <span className="flex items-center gap-1">
                          <span
                            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                            style={{ backgroundColor: preset?.swatch ?? '#64748b' }}
                          />
                          <span className="truncate">{s.name}</span>
                        </span>
                        <input
                          type="time"
                          className="w-[72px] rounded border border-transparent bg-background px-1 py-0.5 hover:border-input"
                          value={draft.start}
                          onChange={(e) => rows.edit(s._id, { start: e.target.value })}
                        />
                        <input
                          type="number"
                          min={1}
                          className="w-14 rounded border border-transparent bg-background px-1 py-0.5 hover:border-input"
                          value={draft.duration}
                          onChange={(e) => rows.edit(s._id, { duration: e.target.value })}
                        />
                        <button
                          onClick={saveThisStop}
                          disabled={!dirty || busy}
                          title={dirty ? 'Save this stop' : 'Saved'}
                          className={`ml-auto rounded px-1.5 py-0.5 font-medium ${
                            dirty
                              ? 'bg-primary text-primary-foreground hover:opacity-90'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {busy ? '…' : dirty ? 'Save' : '✓'}
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`Delete the planned stop "${s.name}"?`)) {
                              void remove({ id: s._id })
                            }
                          }}
                          title="Delete this stop"
                          className="text-destructive hover:underline"
                        >
                          ×
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
