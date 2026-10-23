import { X } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../../convex/_generated/api'
import type { MovedJob, MoveTarget } from '../../lib/jobMove'
import type { PlanJob } from '../../lib/planPipeline'
import { useSafeMutation } from '../../lib/useSafeMutation'
import { ErrorBanner } from '../ErrorBanner'

const pcs = (n: number) => Math.round(n).toLocaleString('en-GB')
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
const hhmm = (m: number) => {
  const w = ((Math.round(m) % 1440) + 1440) % 1440
  return `${String(Math.floor(w / 60)).padStart(2, '0')}:${String(w % 60).padStart(2, '0')}`
}

export interface MoveDraft {
  job: PlanJob
  /** İş zaten kilitliyse eski kilit (taşınınca kalkar). */
  lockId?: string
  target: MoveTarget
}

/**
 * İşi başka pres / gün / saate taşımak (Gantt'ta sürükle-bırak ya da iş
 * penceresinde "Move…"). Kaydedilince iş orada kilitlenir ve plan yeniden
 * hesaplanır; diğer işler etrafına dizilir (kullanıcı kararı 2026-10-23).
 */
export function MoveDialog({
  draft,
  presses,
  dates,
  shiftStartMinute,
  check,
  currentUser,
  onClose,
}: {
  draft: MoveDraft
  presses: { name: string; hall: string }[]
  dates: string[]
  shiftStartMinute: number
  check: (target: MoveTarget) => { moved: MovedJob } | { error: string }
  currentUser?: string
  onClose: () => void
}) {
  const { job } = draft
  const [target, setTarget] = useState<MoveTarget>(draft.target)
  const move = useSafeMutation(api.planJobLocks.move)
  const recalc = useSafeMutation(api.planRuns.requestNow)
  const pending = move.pending || recalc.pending
  const error = move.error ?? recalc.error
  const result = check(target)

  // Saat kutusu 00:00–23:59; vardiya başından önceki saat gece vardiyasıdır (aynı üretim günü).
  const setTime = (value: string) => {
    const [h, m] = value.split(':').map(Number)
    if (!Number.isFinite(h) || !Number.isFinite(m)) return
    const minute = h * 60 + m
    setTarget((t) => ({ ...t, clockMinute: minute < shiftStartMinute ? minute + 1440 : minute }))
  }

  const save = async () => {
    if (!('moved' in result)) return
    const { moved } = result
    const ok = await move.run({
      material: job.material,
      press: target.press,
      hall: presses.find((p) => p.name === target.press)?.hall ?? job.hall,
      date: moved.date,
      phase: job.phase,
      quantity: job.quantity,
      shots: job.shots,
      coilsNeeded: job.coilsNeeded,
      setupStartMinute: moved.setupStartMinute,
      endMinute: moved.endMinute,
      endDate: moved.endDate,
      segments: moved.segments,
      reason: job.reason,
      from: `${job.press} · ${job.date}`,
      createdBy: currentUser,
      ...(draft.lockId ? { fromLockId: draft.lockId } : {}),
    })
    if (ok && (await recalc.run({}))) onClose()
  }

  const field = 'mt-1 h-10 w-full rounded-lg border-2 border-input bg-background px-2 text-sm outline-none focus:border-foreground'
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:px-3">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" />
      <div className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-border bg-background p-4 text-foreground shadow-2xl sm:rounded-2xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Move job</p>
            <p className="mt-0.5 text-lg font-bold">{job.material}</p>
            <p className="text-xs text-muted-foreground">
              now {job.press} · {dayLabel(job.date)} · {pcs(job.quantity)} pcs
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mt-3">
            <ErrorBanner message={error} onDismiss={() => [move, recalc].forEach((m) => m.clearError())} />
          </div>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2">
          <label className="text-xs text-muted-foreground">
            Work center
            <select className={field} value={target.press} onChange={(e) => setTarget((t) => ({ ...t, press: e.target.value }))}>
              {presses.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Day
            <select className={field} value={target.date} onChange={(e) => setTarget((t) => ({ ...t, date: e.target.value }))}>
              {dates.map((d) => (
                <option key={d} value={d}>
                  {dayLabel(d)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Start
            <input type="time" step={300} className={field} value={hhmm(target.clockMinute)} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>

        <p
          className={`mt-3 rounded-lg border p-3 text-sm ${
            'moved' in result
              ? 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100'
              : 'border-destructive/50 bg-destructive/10 text-destructive'
          }`}
        >
          {'moved' in result
            ? `Locked on ${target.press} from ${dayLabel(result.moved.date)} ${hhmm(target.clockMinute)}, ends ${dayLabel(result.moved.endDate)}. Setup and run times are kept; the other jobs re-plan around it.`
            : result.error}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Cancel
          </button>
          <button
            type="button"
            disabled={pending || !('moved' in result)}
            onClick={() => void save()}
            className="rounded-md bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Move and lock'}
          </button>
        </div>
      </div>
    </div>
  )
}
