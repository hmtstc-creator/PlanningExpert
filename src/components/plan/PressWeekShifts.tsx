import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

/** Bir presin bir günü: planın kullandığı normal vardiya sayısı ve mesai pencereleri. */
export interface PressShiftDay {
  shifts: number
  overtime: { start: number; end: number; name?: string }[]
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const SHIFTS = [1, 2, 3]

const mondayOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const dotted = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
const hhmm = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/**
 * Production Plan ortadaki kutu (planlamacı 2026-10-28): seçilen iş yerinin
 * haftalık çalışma takvimi — satır vardiya (1–3), sütun gün, üstte gün tarihi.
 * Hücre, planın o gün kullandığı vardiyadır (Work Calendar + istisna hafta +
 * tatil + mesai; tek kaynak `capacityModel`, plan hesabında `run.days`).
 */
export function PressWeekShifts({
  presses,
  dates,
  dayOf,
}: {
  presses: { name: string; hall?: string }[]
  /** Planın günleri (ISO, artan). */
  dates: string[]
  dayOf: (press: string, date: string) => PressShiftDay | undefined
}) {
  const names = useMemo(() => presses.map((p) => p.name).sort(), [presses])
  const weeks = useMemo(() => Array.from(new Set(dates.map(mondayOf))).sort(), [dates])
  const [press, setPress] = useState('')
  const [week, setWeek] = useState('')
  const selected = names.includes(press) ? press : (names[0] ?? '')
  const monday = weeks.includes(week) ? week : (weeks[0] ?? '')
  const days = monday ? WEEKDAYS.map((_, i) => plusDays(monday, i)) : []
  const inPlan = new Set(dates)

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-foreground">Work calendar</span>
        <select
          aria-label="Work center"
          value={selected}
          onChange={(e) => setPress(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
        >
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {weeks.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWeek(w)}
              className={`rounded-md px-2 py-1 text-xs font-medium ${w === monday ? 'bg-foreground text-background' : 'border border-input hover:bg-muted'}`}
            >
              {dotted(w).slice(0, 5)}
            </button>
          ))}
        </div>
        <Link to="/takvim" className="ml-auto text-xs text-muted-foreground underline hover:text-foreground">
          Edit on Work Calendar →
        </Link>
      </div>
      {selected === '' ? (
        <p className="mt-3 text-xs text-muted-foreground">No plan yet.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-center text-xs">
            <thead>
              <tr>
                <th className="w-8" />
                {days.map((d) => (
                  <th key={d} className="px-1 pb-0.5 font-medium text-purple-700 dark:text-purple-300">
                    {dotted(d).slice(0, 5)}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="w-8" />
                {WEEKDAYS.map((w) => (
                  <th key={w} className="border border-border bg-muted/60 px-1 py-1 font-medium text-foreground">
                    <span className="hidden xl:inline">{w}</span>
                    <span className="xl:hidden">{w.slice(0, 3)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SHIFTS.map((s) => (
                <tr key={s}>
                  <th className="border border-border bg-muted/60 font-medium text-foreground">{s}</th>
                  {days.map((d) => {
                    const day = inPlan.has(d) ? dayOf(selected, d) : undefined
                    const works = !!day && day.shifts >= s
                    return (
                      <td
                        key={d}
                        title={works ? `${selected} ${dotted(d)} shift ${s}: working` : day ? 'Not working' : 'Outside the plan'}
                        className={`h-7 border border-border ${works ? 'bg-emerald-200 dark:bg-emerald-900' : day ? 'bg-background' : 'bg-muted/40'}`}
                      >
                        {works ? '✓' : ''}
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr>
                <th className="border border-border bg-muted/60 font-medium text-foreground" title="Overtime">
                  OT
                </th>
                {days.map((d) => {
                  const ot = inPlan.has(d) ? (dayOf(selected, d)?.overtime ?? []) : []
                  return (
                    <td key={d} className={`h-7 border border-border text-[10px] ${ot.length ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100' : ''}`}>
                      {ot.map((o) => `${hhmm(o.start)}–${hhmm(o.end)}`).join(' ')}
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
