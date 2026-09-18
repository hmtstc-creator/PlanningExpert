import { Fragment, useMemo, useState } from 'react'

import {
  buildGrid,
  intensityStep,
  type GridCell,
  type WeekPattern,
} from '../lib/capacityGrid'
import { addDays, isoDate } from '../lib/dates'

/**
 * Press × week capacity overview.
 *
 * Every press is a row and every week a column, so the whole horizon is
 * readable at a glance instead of one press at a time. Clicking a cell opens
 * that week for editing, which is how an exception week gets set.
 *
 * Capacity is a magnitude, so the fill is a single hue getting darker — never
 * a rainbow. An idle week gets its own empty step rather than just a pale one,
 * and an exception week carries a corner marker so "edited" is not encoded by
 * colour alone.
 */
const RAMP = ['#f1f5f9', '#cfe0f5', '#a3c5ea', '#6f9fd8', '#3b6fd4'] as const
const INK = ['#475569', '#1e3a5f', '#1e3a5f', '#ffffff', '#ffffff'] as const

export interface CapacityGridProps {
  presses: { name: string; hall: string }[]
  templates: Map<string, WeekPattern>
  overrides: Map<string, WeekPattern>
  weekStarts: Date[]
  holidays: Set<string>
  workingDayKeys: string[]
  shiftMinutes: number
  overtimeShiftMinutes: number
  defaultPattern: WeekPattern
  onSaveOverride: (press: string, weekStart: string, pattern: WeekPattern) => Promise<unknown>
  onClearOverride: (press: string, weekStart: string) => Promise<unknown>
}

function weekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00`)
  const end = addDays(d, 6)
  const sameMonth = d.getMonth() === end.getMonth()
  const fmt = (x: Date, withMonth: boolean) =>
    x.toLocaleDateString('en-GB', withMonth ? { day: '2-digit', month: 'short' } : { day: '2-digit' })
  return `${fmt(d, !sameMonth)}–${fmt(end, true)}`
}

export function CapacityGrid(props: CapacityGridProps) {
  const [editing, setEditing] = useState<{ press: string; weekStart: string } | null>(null)
  const [draft, setDraft] = useState<WeekPattern>({
    workingDays: 5,
    shiftsPerDay: 1,
    overtimeShifts: 0,
  })
  const [saving, setSaving] = useState(false)

  const cells = useMemo(() => buildGrid(props), [props])
  const byKey = useMemo(() => {
    const map = new Map<string, GridCell>()
    for (const c of cells) map.set(`${c.press}|${c.weekStart}`, c)
    return map
  }, [cells])

  const maxShifts = useMemo(
    () => cells.reduce((m, c) => Math.max(m, c.effectiveShifts), 0),
    [cells],
  )

  const thisWeek = isoDate(
    (() => {
      const d = new Date()
      const day = d.getDay()
      d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
      d.setHours(0, 0, 0, 0)
      return d
    })(),
  )

  const halls = useMemo(() => {
    const map = new Map<string, { name: string; hall: string }[]>()
    for (const p of props.presses) {
      const key = p.hall || '—'
      const list = map.get(key) ?? []
      list.push(p)
      map.set(key, list)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [props.presses])

  const editingCell = editing ? byKey.get(`${editing.press}|${editing.weekStart}`) : null

  function openCell(cell: GridCell) {
    setEditing({ press: cell.press, weekStart: cell.weekStart })
    setDraft(cell.pattern)
  }

  async function save() {
    if (!editing) return
    setSaving(true)
    try {
      await props.onSaveOverride(editing.press, editing.weekStart, draft)
      setEditing(null)
    } finally {
      setSaving(false)
    }
  }

  async function clear() {
    if (!editing) return
    setSaving(true)
    try {
      await props.onClearOverride(editing.press, editing.weekStart)
      setEditing(null)
    } finally {
      setSaving(false)
    }
  }

  if (props.presses.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No presses defined yet.
      </p>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Shifts per week</span>
          <span className="flex items-center gap-0.5">
            {RAMP.map((c, i) => (
              <span
                key={c}
                className="inline-block h-3 w-5 border border-border/60"
                style={{ backgroundColor: c }}
                title={i === 0 ? 'idle' : `level ${i}`}
              />
            ))}
          </span>
          <span>low → high</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border-2 border-amber-500" />
            Exception week
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-destructive">•</span>
            Holiday in week
          </span>
          <span>Click a cell to edit that week</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium text-muted-foreground">
                Press
              </th>
              {props.weekStarts.map((w) => {
                const iso = isoDate(w)
                return (
                  <th
                    key={iso}
                    className={`min-w-[62px] px-1 py-2 text-center font-medium ${
                      iso === thisWeek ? 'text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {iso === thisWeek && (
                      <span className="mr-0.5 text-[9px] uppercase text-primary">now</span>
                    )}
                    <span className="block text-[10px] font-normal">{weekLabel(iso)}</span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {halls.map(([hall, hallPresses]) => (
              <Fragment key={hall}>
                <tr>
                  <td
                    className="sticky left-0 z-10 bg-muted/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                    colSpan={props.weekStarts.length + 1}
                  >
                    {hall}
                  </td>
                </tr>
                {hallPresses.map((press) => (
                  <tr key={press.name}>
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-1 font-medium text-foreground">
                      {press.name}
                    </td>
                    {props.weekStarts.map((w) => {
                      const iso = isoDate(w)
                      const cell = byKey.get(`${press.name}|${iso}`)
                      if (!cell) return <td key={iso} />
                      const step = intensityStep(cell.effectiveShifts, maxShifts)
                      const isEditing =
                        editing?.press === press.name && editing?.weekStart === iso
                      return (
                        <td key={iso} className="p-0.5">
                          <button
                            onClick={() => openCell(cell)}
                            title={
                              `${press.name} · ${weekLabel(iso)}\n` +
                              `${cell.pattern.workingDays} days × ${cell.pattern.shiftsPerDay} shifts + ` +
                              `${cell.pattern.overtimeShifts} overtime\n` +
                              `${cell.effectiveShifts} shifts · ${(cell.effectiveMinutes / 60).toFixed(0)} h` +
                              (cell.holidayCount > 0 ? `\n${cell.holidayCount} holiday(s)` : '') +
                              (cell.overridden ? '\nException week' : '')
                            }
                            className={`relative flex h-8 w-full items-center justify-center rounded tabular-nums transition-all hover:ring-2 hover:ring-primary ${
                              isEditing ? 'ring-2 ring-primary' : ''
                            } ${cell.overridden ? 'border-2 border-amber-500' : 'border border-border/50'}`}
                            style={{ backgroundColor: RAMP[step], color: INK[step] }}
                          >
                            {cell.effectiveShifts}
                            {cell.holidayCount > 0 && (
                              <span className="absolute right-0.5 top-0 leading-none text-destructive">
                                •
                              </span>
                            )}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {editingCell && (
        <div className="flex flex-wrap items-end gap-3 border-t border-border bg-muted/30 px-4 py-3">
          <div className="text-sm">
            <p className="font-medium text-foreground">
              {editingCell.press} · {weekLabel(editingCell.weekStart)}
            </p>
            <p className="text-xs text-muted-foreground">
              {editingCell.overridden
                ? 'Exception week — differs from the press template.'
                : 'Currently follows the press template.'}
              {editingCell.holidayCount > 0 &&
                ` ${editingCell.holidayCount} holiday(s) in this week.`}
            </p>
          </div>

          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Normal days</span>
            <input
              type="number"
              min={0}
              max={7}
              className="mt-1 w-20 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={draft.workingDays}
              onChange={(e) => setDraft({ ...draft, workingDays: Number(e.target.value) })}
              onBlur={() =>
                setDraft((d) => ({
                  ...d,
                  workingDays: Math.min(7, Math.max(0, Math.round(d.workingDays) || 0)),
                }))
              }
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Shifts/day</span>
            <input
              type="number"
              min={0}
              max={3}
              className="mt-1 w-20 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={draft.shiftsPerDay}
              onChange={(e) => setDraft({ ...draft, shiftsPerDay: Number(e.target.value) })}
              onBlur={() =>
                setDraft((d) => ({
                  ...d,
                  shiftsPerDay: Math.min(3, Math.max(0, Math.round(d.shiftsPerDay) || 0)),
                }))
              }
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Overtime shifts</span>
            <input
              type="number"
              min={0}
              className="mt-1 w-24 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={draft.overtimeShifts}
              onChange={(e) => setDraft({ ...draft, overtimeShifts: Number(e.target.value) })}
              onBlur={() =>
                setDraft((d) => ({
                  ...d,
                  overtimeShifts: Math.max(0, Math.round(d.overtimeShifts) || 0),
                }))
              }
            />
          </label>

          <button
            onClick={() => void save()}
            disabled={saving}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save this week'}
          </button>
          {editingCell.overridden && (
            <button
              onClick={() => void clear()}
              disabled={saving}
              className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
            >
              Reset to template
            </button>
          )}
          <button
            onClick={() => setEditing(null)}
            className="rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
          >
            Close
          </button>
        </div>
      )}
    </div>
  )
}
