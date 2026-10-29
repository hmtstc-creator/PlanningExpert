import { X } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { MANUAL_JOB_REASON, manualJobSegments, type MovedJob, type MoveSegment, type MoveTarget } from '../../lib/jobMove'
import { computeRunPlan, eligiblePressesOf, type ProductSpec } from '../../lib/planning'
import { useSafeMutation } from '../../lib/useSafeMutation'
import { ErrorBanner } from '../ErrorBanner'

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
const hhmm = (m: number) => {
  const w = ((Math.round(m) % 1440) + 1440) % 1440
  return `${String(Math.floor(w / 60)).padStart(2, '0')}:${String(w % 60).padStart(2, '0')}`
}
const hours = (minutes: number) => `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min`

/**
 * Elle iş ekleme (kullanıcı kararı 2026-10-23): pres, parça, adet ve
 * başlangıç; süre motorun parçadan hesapladığı gibi (`computeRunPlan`).
 * İş o saatte kilitli yazılır; adedi o parçanın ileriki talebinden düşer,
 * presin diğer işleri arkasına kayar.
 */
export function AddJobDialog({
  presses,
  dates,
  products,
  initial,
  shiftStartMinute,
  check,
  currentUser,
  onClose,
}: {
  presses: { name: string; hall: string; feedsCoil?: boolean }[]
  dates: string[]
  products: ProductSpec[]
  initial: MoveTarget
  shiftStartMinute: number
  check: (segments: MoveSegment[], target: MoveTarget) => { moved: MovedJob } | { error: string }
  currentUser?: string
  onClose: () => void
}) {
  const [target, setTarget] = useState<MoveTarget>(initial)
  const [material, setMaterial] = useState('')
  const [qtyText, setQtyText] = useState('')
  const [dieMounted, setDieMounted] = useState(false)
  const move = useSafeMutation(api.planJobLocks.move)
  const recalc = useSafeMutation(api.planRuns.requestNow)
  const pending = move.pending || recalc.pending
  const error = move.error ?? recalc.error

  const press = presses.find((p) => p.name === target.press)
  const product = products.find((p) => p.code === material.trim())
  const qty = Number(qtyText.replace(/[\s.,]/g, ''))
  const run = product && qty > 0 ? computeRunPlan(product, qty) : null
  const segments = run ? manualJobSegments(run, { dieMounted, feedsCoil: press?.feedsCoil !== false }) : []
  const result: { moved: MovedJob } | { error: string } = !material.trim()
    ? { error: 'Enter a part number.' }
    : !product
      ? { error: `${material.trim()} is not in the master data (References).` }
      : !(qty > 0)
        ? { error: 'Enter a quantity.' }
        : segments.length === 0
          ? { error: `${product.code} has no cycle time in the master data — the duration cannot be computed.` }
          : check(segments, target)
  const eligible = product ? eligiblePressesOf(product) : []
  const offList = product && eligible.length > 0 && !eligible.includes(target.press)
  const total = segments.reduce((s, x) => s + x.end - x.start, 0)

  const setTime = (value: string) => {
    const [h, m] = value.split(':').map(Number)
    if (!Number.isFinite(h) || !Number.isFinite(m)) return
    const minute = h * 60 + m
    setTarget((t) => ({ ...t, clockMinute: minute < shiftStartMinute ? minute + 1440 : minute }))
  }

  const save = async () => {
    if (!('moved' in result) || !product || !run) return
    const { moved } = result
    const ok = await move.run({
      material: product.code,
      press: target.press,
      hall: press?.hall ?? '',
      date: moved.date,
      phase: 'fill',
      quantity: qty,
      shots: run.shots,
      coilsNeeded: run.coilsNeeded,
      setupStartMinute: moved.setupStartMinute,
      endMinute: moved.endMinute,
      endDate: moved.endDate,
      segments: moved.segments,
      reason: MANUAL_JOB_REASON,
      added: true,
      createdBy: currentUser,
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
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Add job</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              e.g. a part run for stock. It is locked at this time; its quantity comes off the part's demand and the
              work center's other jobs move behind it.
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

        <div className="mt-4 grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">
            Part number
            <input
              autoFocus
              list="add-job-parts"
              className={field}
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              placeholder="Material code"
            />
            <datalist id="add-job-parts">
              {products.map((p) => (
                <option key={p.code} value={p.code} />
              ))}
            </datalist>
          </label>
          <label className="text-xs text-muted-foreground">
            Quantity (pcs)
            <input inputMode="numeric" className={field} value={qtyText} onChange={(e) => setQtyText(e.target.value)} />
          </label>
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
          <div className="grid grid-cols-2 gap-2">
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
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={dieMounted} onChange={(e) => setDieMounted(e.target.checked)} />
          Die already mounted (no setup)
        </label>

        {offList && (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            {product!.code} is not defined for {target.press} (main / alternative: {eligible.join(', ')}). It is added anyway — your call.
          </p>
        )}
        <p
          className={`mt-3 rounded-lg border p-3 text-sm ${
            'moved' in result
              ? 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100'
              : 'border-border bg-muted/40 text-muted-foreground'
          }`}
        >
          {'moved' in result
            ? `${hours(total)} on ${target.press}: from ${dayLabel(result.moved.date)} ${hhmm(target.clockMinute)}, ends ${dayLabel(result.moved.endDate)}${run && run.coilsNeeded > 0 ? ` · ${run.coilsNeeded} coil${run.coilsNeeded === 1 ? '' : 's'}` : ''}.`
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
            {pending ? 'Saving…' : 'Add and lock'}
          </button>
        </div>
      </div>
    </div>
  )
}
