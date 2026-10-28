import { X } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { dottedDate, jobStatus } from '../../lib/jobStatus'
import type { PlanJob } from '../../lib/planPipeline'
import { useSafeMutation } from '../../lib/useSafeMutation'
import { ErrorBanner } from '../ErrorBanner'

export interface JobDraft {
  /** Tıklanan iş (onay için olduğu gibi kaydedilir). */
  job: PlanJob
  /** Talep kovası: lotun kimliği (malzeme + kova). */
  bucket: string
  /** Planda lotun toplam adedi (kalıp ömrüyle bölünmüşse bütün parçaları). */
  lotQuantity: number
  /** Lot kaç işe bölündü. */
  lotJobCount: number
  /** Bir rulodan çıkan adet (rulo beslemeli lotta). */
  piecesPerCoil?: number
  /** Bu lot için kayıtlı adet kuralı. */
  override?: { id: string; qty: number }
  /** İş tek tek onaylanmış (kilitli). */
  lock?: { id: string; approvedBy?: string; createdAt: number; manual?: boolean }
  /** Setup başlangıcı ve iş bitişi, okunur saat ("Wed 28 Oct 13:20"). */
  startLabel?: string
  endLabel?: string
  /** Malzeme ana verisi: ana ve alternatif iş yerleri (bilgi). */
  mainMachine?: string
  altMachines?: string[]
}

const pcs = (n: number) => Math.round(n).toLocaleString('en-GB')
const hrs = (h: number) => `${h.toLocaleString('en-GB', { maximumFractionDigits: 1 })} hour${h === 1 ? '' : 's'}`
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })

/**
 * Plan grafiğinde işe tıklanınca (planlamacı, 2026-10-19): lot adedini
 * değiştirmek, işi tek başına onaylamak (kilit) ya da parçayı plandan hariç
 * tutmak. Her değişiklikten sonra plan yeniden hesaplanır.
 */
export function JobDialog({ draft, onClose, onMove }: { draft: JobDraft; onClose: () => void; onMove?: () => void }) {
  const { job } = draft
  const [value, setValue] = useState(String(draft.override?.qty ?? Math.round(draft.lotQuantity)))
  const [excluding, setExcluding] = useState(false)
  const [reason, setReason] = useState('')
  const saveQty = useSafeMutation(api.planOverrides.setQuantity)
  const removeRule = useSafeMutation(api.planOverrides.remove)
  const setRule = useSafeMutation(api.planOverrides.set)
  const approve = useSafeMutation(api.planJobLocks.approve)
  const unlock = useSafeMutation(api.planJobLocks.unlock)
  const recalc = useSafeMutation(api.planRuns.requestNow)
  const all = [saveQty, removeRule, setRule, approve, unlock, recalc]
  const pending = all.some((m) => m.pending)
  const error = all.find((m) => m.error)?.error ?? null

  const qty = Number(value.replace(/[\s.,]/g, ''))
  const valid = value.trim() !== '' && Number.isFinite(qty) && qty >= 0
  const coils = draft.piecesPerCoil && valid ? Math.ceil(qty / draft.piecesPerCoil) : 0
  const requirements = job.requirements ?? []
  const status = jobStatus(job.quantity, requirements)

  /** Değişikliği yaz, sonra planı yeniden hesaplat. */
  const thenRecalc = async (write: Promise<boolean>) => {
    if ((await write) && (await recalc.run({}))) onClose()
  }

  const approveJob = () =>
    thenRecalc(
      approve.run({
        material: job.material,
        press: job.press,
        hall: job.hall,
        date: job.date,
        phase: job.phase,
        quantity: job.quantity,
        shots: job.shots,
        coilsNeeded: job.coilsNeeded,
        setupStartMinute: job.setupStartMinute,
        endMinute: job.endMinute,
        endDate: job.endDate,
        segments: job.segments.map((s) => ({ kind: s.kind, date: s.date, start: s.start, end: s.end })),
        reason: job.reason,
      }),
    )

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:px-3">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" />
      <div className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-border bg-background p-4 text-foreground shadow-2xl sm:rounded-2xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {draft.lock ? 'Approved job' : 'Plan job'}
            </p>
            <p className="mt-0.5 text-lg font-bold">{job.material}</p>
            <p className="text-xs text-muted-foreground">
              {job.press} · {dayLabel(job.date)}
              {!draft.lock && ` · lot ${draft.bucket}`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* İhtiyaç ve durum (planlamacı 2026-10-28): ihtiyaç günü 08:00'e göre erken / geç, rulo fazlası overstock. */}
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <dt className="text-muted-foreground">Req dates</dt>
          <dd>
            {requirements.length > 0
              ? `(${[...new Set(requirements.map((r) => dottedDate(r.date)))].join(', ')}) – ${pcs(requirements.reduce((a, r) => a + r.qty, 0))}`
              : job.longTerm
                ? 'long term (weekly ZPP) — fills free capacity'
                : 'none in the horizon (stock build)'}
          </dd>
          {draft.startLabel && (
            <>
              <dt className="text-muted-foreground">Start time</dt>
              <dd>{draft.startLabel}</dd>
            </>
          )}
          {draft.endLabel && (
            <>
              <dt className="text-muted-foreground">End time</dt>
              <dd>{draft.endLabel}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            {status.map((p, i) => (
              <span key={i}>
                {i > 0 && ' and '}
                {pcs(p.qty)} pcs{' '}
                <span
                  className={
                    p.kind === 'late'
                      ? 'font-semibold text-destructive'
                      : p.kind === 'overstock'
                        ? 'text-amber-700 dark:text-amber-300'
                        : 'text-emerald-700 dark:text-emerald-300'
                  }
                >
                  ({p.kind === 'overstock' ? 'overstock' : p.kind === 'onTime' ? 'on time' : `${hrs(p.hours ?? 0)} ${p.kind === 'late' ? 'late' : 'before'}`})
                </span>
              </span>
            ))}
          </dd>
        </dl>

        {error && (
          <div className="mt-3">
            <ErrorBanner message={error} onDismiss={() => all.forEach((m) => m.clearError())} />
          </div>
        )}

        {draft.lock ? (
          <>
            <p className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
              {draft.lock.manual ? 'Added by hand and locked' : 'Locked in the plan'}
              {draft.lock.approvedBy ? ` by ${draft.lock.approvedBy}` : ''} on{' '}
              {new Date(draft.lock.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}. A
              recalculation keeps it on this work center at this time.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
                Close
              </button>
              {onMove && (
                <button type="button" disabled={pending} onClick={onMove} className="rounded-md border border-sky-600 px-3 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50 dark:text-sky-300 dark:hover:bg-sky-950">
                  Move…
                </button>
              )}
              <button
                type="button"
                disabled={pending}
                title={
                  draft.lock.manual
                    ? 'The job leaves the plan; its quantity is no longer deducted from demand'
                    : 'The job goes back to the engine, which plans it again'
                }
                onClick={() => {
                  if (draft.lock!.manual && !window.confirm(`Delete this job (${job.material}, ${pcs(job.quantity)} pcs) from the plan?`)) return
                  void thenRecalc(unlock.run({ id: draft.lock!.id }))
                }}
                className="rounded-md border border-destructive px-3 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                {pending ? 'Saving…' : draft.lock.manual ? 'Delete job' : 'Remove approval'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Taşı: başka pres / gün / saat, orada kilitlenir. */}
            {onMove && !job.frozen && (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Move it to another work center, day or time — it is locked there. You can also drag the bar.</p>
                <button
                  type="button"
                  disabled={pending}
                  onClick={onMove}
                  className="shrink-0 rounded-md border border-sky-600 px-3 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50 dark:text-sky-300 dark:hover:bg-sky-950"
                >
                  Move…
                </button>
              </div>
            )}

            {/* Onay: iş olduğu gibi kilitlenir. */}
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">
                Lock this job as it is: a recalculation keeps it on {job.press} at this time.
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => void approveJob()}
                className="shrink-0 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Approve this job
              </button>
            </div>

            {/* Adet */}
            <div className="mt-3 rounded-lg border border-border p-3">
              <label className="block text-sm">
                <span className="block text-xs text-muted-foreground">
                  Lot quantity (pcs) · now {pcs(draft.lotQuantity)}
                  {draft.lotJobCount > 1 ? ` in ${draft.lotJobCount} jobs` : ''}
                </span>
                <input
                  autoFocus
                  inputMode="numeric"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && valid)
                      void thenRecalc(saveQty.run({ material: job.material, bucket: draft.bucket, qty, previousQty: draft.lotQuantity }))
                  }}
                  className="mt-1 h-11 w-full rounded-lg border-2 border-input bg-background px-3 text-base font-semibold tabular-nums outline-none focus:border-foreground"
                />
              </label>
              <p className="mt-2 text-xs text-muted-foreground">
                {draft.piecesPerCoil
                  ? `Rounded up to whole coils (1 coil ≈ ${pcs(draft.piecesPerCoil)} pcs${coils > 0 ? ` → ${coils} coil${coils === 1 ? '' : 's'}` : ''}). `
                  : 'Rounded up to the Min. lot if one is set. '}
                The difference moves to the next lots of this part. 0 skips this lot.
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {draft.override && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void thenRecalc(removeRule.run({ id: draft.override!.id }))}
                    className="mr-auto px-1 py-1.5 text-sm text-muted-foreground hover:underline disabled:opacity-50"
                  >
                    Back to engine quantity
                  </button>
                )}
                <button
                  type="button"
                  disabled={!valid || pending}
                  onClick={() =>
                    void thenRecalc(saveQty.run({ material: job.material, bucket: draft.bucket, qty, previousQty: draft.lotQuantity }))
                  }
                  className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-50"
                >
                  {pending ? 'Saving…' : 'Save & recalculate'}
                </button>
              </div>
            </div>

            {/* Sil: lot 0 adet — talebi sonraki lotlara kayar (kullanıcı kararı 2026-10-23). */}
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">
                Delete this lot{draft.lotJobCount > 1 ? ` (${draft.lotJobCount} jobs)` : ''} from the plan; its demand moves to the
                next lots of this part.
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(`Delete lot ${draft.bucket} of ${job.material} (${pcs(draft.lotQuantity)} pcs) from the plan?`)) return
                  void thenRecalc(saveQty.run({ material: job.material, bucket: draft.bucket, qty: 0, previousQty: draft.lotQuantity }))
                }}
                className="shrink-0 rounded-md border border-destructive px-3 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                Delete this lot
              </button>
            </div>

            {/* Hariç tut */}
            <div className="mt-3 rounded-lg border border-border p-3">
              {!excluding ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">Keep this part out of the plan (e.g. raw material missing).</p>
                  <button
                    type="button"
                    onClick={() => setExcluding(true)}
                    className="shrink-0 rounded-md border border-destructive px-3 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10"
                  >
                    Exclude from planning
                  </button>
                </div>
              ) : (
                <>
                  <label className="block text-sm">
                    <span className="block text-xs text-muted-foreground">Reason (optional)</span>
                    <input
                      autoFocus
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. raw material missing"
                      className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    />
                  </label>
                  <p className="mt-2 text-xs text-muted-foreground">
                    All jobs of {job.material} leave the plan until you remove the rule under Plan overrides. Approved
                    (locked) jobs stay.
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" onClick={() => setExcluding(false)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        void thenRecalc(
                          setRule.run({ material: job.material, kind: 'exclude', note: reason.trim() || undefined }),
                        )
                      }
                      className="rounded-md bg-destructive px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {pending ? 'Saving…' : `Exclude ${job.material}`}
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* Bilgi: malzeme ana verisindeki iş yerleri. */}
        {(draft.mainMachine || (draft.altMachines?.length ?? 0) > 0) && (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border p-3 text-sm">
            <dt className="text-muted-foreground">Main work center</dt>
            <dd>{draft.mainMachine || '—'}</dd>
            <dt className="text-muted-foreground">Alternative</dt>
            <dd>{draft.altMachines?.length ? draft.altMachines.join(', ') : '—'}</dd>
          </dl>
        )}
      </div>
    </div>
  )
}
