import { Link } from '@tanstack/react-router'
import { useMutation, useQuery } from '../../lib/convexTransport'
import { useMemo, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { maxShiftsPerDay, serverErrorText } from '../../lib/pressCalendar'
import { activeShiftList } from '../../lib/shiftTimeline'

/** Bir presin bir günü: planın kullandığı normal vardiyalar ve mesai pencereleri. */
export interface PressShiftDay {
  shifts: number
  /** Çalışan vardiya numaraları; yalnız 1'den art arda değilse (gün kaydı). */
  activeShifts?: number[]
  overtime: { start: number; end: number; name?: string }[]
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const sameList = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i])

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
 *
 * "Nihai karar ekranı" (slayt 4): hücreye tıklamak o pres × gün × vardiyayı
 * açar / kapatır — gün kaydı (`pressDayShifts`) yazılır, istisna hafta ve
 * şablonun önüne geçer. Plan yeniden hesaplanınca uygulanır; o zamana kadar
 * hücre kesik çizgiyle "bekliyor" gösterilir.
 */
export function PressWeekShifts({
  presses,
  dates,
  dayOf,
  shiftMinutes,
}: {
  presses: { name: string; hall?: string }[]
  /** Planın günleri (ISO, artan). */
  dates: string[]
  dayOf: (press: string, date: string) => PressShiftDay | undefined
  /** Vardiya süresi (dk): günde kaç vardiya satırı gösterileceği. */
  shiftMinutes?: number
}) {
  const records = useQuery(api.dayShifts.list)
  const setDay = useMutation(api.dayShifts.setDay)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recordOf = useMemo(() => {
    const m = new Map<string, number[]>()
    for (const r of records ?? []) m.set(`${r.press}|${r.date}`, [...r.shifts].sort((a, b) => a - b))
    return m
  }, [records])
  const shiftRows = useMemo(
    () => Array.from({ length: shiftMinutes ? maxShiftsPerDay(shiftMinutes) : 3 }, (_, i) => i + 1),
    [shiftMinutes],
  )
  const names = useMemo(() => presses.map((p) => p.name).sort(), [presses])
  const weeks = useMemo(() => Array.from(new Set(dates.map(mondayOf))).sort(), [dates])
  const [press, setPress] = useState('')
  const [week, setWeek] = useState('')
  const selected = names.includes(press) ? press : (names[0] ?? '')
  const monday = weeks.includes(week) ? week : (weeks[0] ?? '')
  const days = monday ? WEEKDAYS.map((_, i) => plusDays(monday, i)) : []
  const inPlan = new Set(dates)
  /** Planın o gün kullandığı vardiyalar (plan hesabı). */
  const plannedOf = (d: string) => {
    const day = dayOf(selected, d)
    return day ? activeShiftList(day) : []
  }
  /** Gösterilen vardiyalar: gün kaydı varsa o (plan henüz görmemiş olabilir), yoksa plan. */
  const shownOf = (d: string) => recordOf.get(`${selected}|${d}`) ?? plannedOf(d)
  const write = async (d: string, shifts: number[] | null) => {
    setBusy(true)
    setError(null)
    try {
      await setDay({ press: selected, date: d, shifts })
    } catch (e) {
      setError(serverErrorText(e))
    } finally {
      setBusy(false)
    }
  }
  const toggle = (d: string, s: number) => {
    const now = shownOf(d)
    void write(d, now.includes(s) ? now.filter((x) => x !== s) : [...now, s].sort((a, b) => a - b))
  }

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
                    {recordOf.has(`${selected}|${d}`) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void write(d, null)}
                        title="Set by hand on this screen — click to go back to the Work Calendar pattern"
                        className="ml-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        ↺
                      </button>
                    )}
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
              {shiftRows.map((s) => (
                <tr key={s}>
                  <th className="border border-border bg-muted/60 font-medium text-foreground">{s}</th>
                  {days.map((d) => {
                    if (!inPlan.has(d)) {
                      return <td key={d} title="Outside the plan" className="h-7 border border-border bg-muted/40" />
                    }
                    const shown = shownOf(d)
                    const works = shown.includes(s)
                    // Gün kaydı plana henüz girmedi: yeniden hesaplanınca uygulanır.
                    const pending = recordOf.has(`${selected}|${d}`) && !sameList(shown, plannedOf(d))
                    return (
                      <td key={d} className="h-7 border border-border p-0">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => toggle(d, s)}
                          title={`${selected} ${dotted(d)} shift ${s}: ${works ? 'working' : 'not working'}${pending ? ' (applies when the plan is recalculated)' : ''} — click to ${works ? 'close' : 'open'}`}
                          className={`h-full w-full disabled:cursor-wait ${works ? 'bg-emerald-200 hover:bg-emerald-300 dark:bg-emerald-900 dark:hover:bg-emerald-800' : 'bg-background hover:bg-muted'} ${pending ? 'outline-dashed outline-2 -outline-offset-2 outline-amber-500' : ''}`}
                        >
                          {works ? '✓' : ''}
                        </button>
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
          <p className="mt-1 text-[11px] text-muted-foreground">
            Click a cell to open or close that shift for this work center and day (↺ goes back to the pattern).
            A dashed cell is not in the plan yet — press Calculate plan.
          </p>
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  )
}
