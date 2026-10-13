import { useEffect, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { usePlant } from '../lib/plantContext'
import { calendarShifts, shiftProblems } from '../lib/shifts'
import { useSafeMutation } from '../lib/useSafeMutation'
import { ErrorBanner } from './ErrorBanner'

/**
 * Working calendar → vardiyaların MES kodları (UB61, UB64 …). Vardiyalar tek
 * yerde tanımlanır (planlamacı, 2026-10-13): saatler bu sayfanın vardiya süresi
 * ve başlangıcından, kodlar burada; OEE sayfaları vardiyaları bu kodlarla
 * numaralar. Takvimde hiç kod girilmemişse eski tanımın kodları önerilir.
 */
export function ShiftCodesEditor({
  shiftMinutes,
  shiftStartMinute,
  saved,
  canEdit,
}: {
  shiftMinutes: number
  shiftStartMinute: number
  saved: { number: number; codes: string[] }[] | undefined
  canEdit: boolean
}) {
  const legacy = usePlant().ctx?.active?.shifts ?? []
  const shifts = calendarShifts({ shiftMinutes, shiftStartMinute, shiftCodes: saved }, legacy)
  const initial = () => Object.fromEntries(shifts.map((s) => [s.number, s.codes.join(', ')])) as Record<number, string>
  const [text, setText] = useState<Record<number, string>>(initial)
  const key = JSON.stringify(shifts.map((s) => s.codes))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setText(initial()), [key])
  const { run, error, clearError, pending } = useSafeMutation(api.pressCalendar.saveShiftCodes)
  const [done, setDone] = useState(false)
  const draft = shifts.map((s) => ({ number: s.number, codes: (text[s.number] ?? '').split(/[,;\s]+/).filter(Boolean) }))
  const problems = shiftProblems(draft.map((d) => ({ ...d, name: `Shift ${d.number}` })))
  const dirty = JSON.stringify(draft.map((d) => d.codes.map((c) => c.toUpperCase()))) !== JSON.stringify(shifts.map((s) => s.codes))
  return (
    <div className="mt-3 text-xs">
      <ErrorBanner message={error} onDismiss={clearError} />
      <p className="font-medium text-foreground">MES shift codes (OEE)</p>
      <p className="text-muted-foreground">
        The codes of each shift in the uploaded OEE files (Shift Defination, e.g. UB61 and UB64 for the 1st shift). The OEE pages number the
        shifts with them; shift times and planned stops come from this page too.
      </p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
        {shifts.map((s) => (
          <label key={s.number} className="flex flex-col gap-1 text-muted-foreground">
            <span>
              <b className="text-foreground">{s.number}. shift</b> {s.start}–{s.end}
            </span>
            <input
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
              value={text[s.number] ?? ''}
              placeholder="UB61, UB64"
              disabled={!canEdit}
              onChange={(e) => (setDone(false), setText({ ...text, [s.number]: e.target.value.toUpperCase() }))}
            />
          </label>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {problems.length > 0 && <span className="text-destructive">{problems.join(' · ')}</span>}
        {done && !dirty && <span className="text-emerald-700">✓ Saved</span>}
        {canEdit && (
          <button
            type="button"
            disabled={!dirty || problems.length > 0 || pending}
            onClick={() => void run({ shiftCodes: draft }).then((ok) => ok && setDone(true))}
            className="ml-auto rounded-md bg-foreground px-3 py-1.5 font-medium text-background disabled:opacity-40"
          >
            Save shift codes
          </button>
        )}
      </div>
    </div>
  )
}
