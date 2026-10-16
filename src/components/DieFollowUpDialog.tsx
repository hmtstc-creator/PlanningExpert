import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { useQuery } from '../lib/convexTransport'
import { useCurrentUser } from '../lib/currentUser'
import { useSafeMutation } from '../lib/useSafeMutation'
import { ErrorBanner } from './ErrorBanner'
import { hours } from './OeeBridgeCharts'

export interface FollowUpDraft {
  material: string
  press: string
  /** Kayıp kalemi (ör. STP, Speed loss). */
  loss: string
  minutes: number
  /** O parçanın o presteki duruşları, gün gün (dönem içinde). */
  days: { date: string; minutes: number }[]
  period: string
  /** Neden ve vardiya (ör. "MOLD PART BREAKAGE · Shift 2"). */
  detail?: string
  /** Hangi sayfadan (açıklamanın başı); yoksa OEE Loss Bridge. */
  source?: string
}

/** Tıklanınca Die Follow-up penceresini açan süre (saat) düğmesi — Loss Bridge ve Daily Report'ta aynı görünüm. */
export function FollowUpTime({ minutes, onClick, className = '' }: { minutes: number; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Add to Die Follow-up with an action"
      className={`rounded-md border border-[var(--viz-1)]/40 bg-[var(--viz-1)]/10 px-1.5 py-0.5 text-right font-semibold text-foreground tabular-nums hover:bg-[var(--viz-1)]/20 print:border-0 print:bg-transparent ${className}`}
    >
      {hours(minutes)}
    </button>
  )
}

/** Operasyon bilinmiyorsa (OEE verisinde operasyon yok). */
const NO_OPERATION = '—'

const dm = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

/**
 * OEE Loss Bridge ve Daily Report'tan Die Follow-up'a takip konusu (planlamacı, 2026-10-13 / 10-16):
 * parça, pres, duruş tarihi ve süresi hazır gelir; kullanıcı aksiyonu yazıp
 * kaydeder. Kayıt Die Problems'ta açık problem olarak görünür.
 */
export function DieFollowUpDialog({ draft, onClose }: { draft: FollowUpDraft; onClose: () => void }) {
  const { name: currentUser } = useCurrentUser()
  const lookups = (useQuery(api.lookups.list) ?? []) as { kind: string; value: string }[]
  const operations = useMemo(() => lookups.filter((l) => l.kind === 'operation').map((l) => l.value), [lookups])
  const types = useMemo(() => {
    const list = lookups.filter((l) => l.kind === 'problemType').map((l) => l.value)
    return list.includes(draft.loss) ? list : [draft.loss, ...list]
  }, [lookups, draft.loss])
  // Varsayılan tarih: en çok duruşun olduğu gün.
  const busiest = [...draft.days].sort((a, b) => b.minutes - a.minutes)[0]?.date ?? ''
  const [date, setDate] = useState(busiest)
  const [minutes, setMinutes] = useState(String(Math.round(draft.minutes)))
  const [operation, setOperation] = useState(NO_OPERATION)
  const [problemType, setProblemType] = useState(draft.loss)
  const [description, setDescription] = useState(
    `${draft.source ?? 'OEE Loss Bridge'}: ${draft.loss}${draft.detail ? ` (${draft.detail})` : ''} — ${Math.round(draft.minutes)} min${draft.press ? ` on ${draft.press}` : ''} (${draft.period}).`,
  )
  const [action, setAction] = useState('')
  const [saved, setSaved] = useState(false)
  const { run, error, clearError, pending } = useSafeMutation(api.moldProblems.report)

  const save = async () => {
    const done = await run({
      material: draft.material,
      operation,
      problemType,
      occurredAt: date,
      description: description.trim() || undefined,
      downtimeMinutes: minutes.trim() === '' ? undefined : Math.max(0, Math.round(Number(minutes))),
      reportedBy: currentUser ?? undefined,
      press: draft.press || undefined,
      action: action.trim(),
    })
    if (done) setSaved(true)
  }

  const input = 'mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground'
  const ok = !!action.trim() && /^\d{4}-\d{2}-\d{2}$/.test(date) && !!problemType && !pending
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:px-3"
      role="dialog"
      aria-modal="true"
      aria-label="Add to Die Follow-up"
    >
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" />
      <div className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-background p-4 text-foreground shadow-2xl sm:rounded-2xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Add to Die Follow-up</p>
            <p className="mt-0.5 text-lg font-bold">{draft.material}</p>
            <p className="text-xs text-muted-foreground">
              {[draft.press, draft.loss, draft.detail].filter(Boolean).join(' · ')} · {(draft.minutes / 60).toFixed(1)} h in {draft.period}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {saved ? (
          <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            ✓ Added as an open problem for {draft.material}
            {draft.press ? ` (${draft.press})` : ''}.{' '}
            <Link to="/die-followup/problems" className="font-medium underline">
              Open Die Problems
            </Link>
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={onClose} className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background">
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            <ErrorBanner message={error} onDismiss={clearError} />
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
              <label>
                Downtime date
                <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label>
                Lost time (min)
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  className={input}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
              </label>
              {draft.days.length > 1 && (
                <p className="col-span-2 -mt-1 text-[11px]">
                  Days with this loss:{' '}
                  {draft.days.map((d, i) => (
                    <button
                      key={d.date}
                      type="button"
                      onClick={() => (setDate(d.date), setMinutes(String(Math.round(d.minutes))))}
                      className={`underline-offset-2 hover:underline ${d.date === date ? 'font-semibold text-foreground' : ''}`}
                    >
                      {i > 0 ? ' · ' : ''}
                      {dm(d.date)} ({Math.round(d.minutes)} min)
                    </button>
                  ))}
                </p>
              )}
              <label>
                Operation
                <select className={input} value={operation} onChange={(e) => setOperation(e.target.value)}>
                  <option value={NO_OPERATION}>Not known</option>
                  {operations.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Problem type
                <select className={input} value={problemType} onChange={(e) => setProblemType(e.target.value)}>
                  {types.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-2">
                What happened
                <textarea rows={2} className={input} value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
              <label className="col-span-2">
                <span className="font-semibold text-foreground">Action</span> (required)
                <textarea
                  rows={3}
                  autoFocus
                  className={input}
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                  placeholder="What will be done, by whom — e.g. check the coil feeder setting on the die change"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!ok}
                onClick={() => void save()}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {pending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
