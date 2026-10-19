import { X } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { useSafeMutation } from '../../lib/useSafeMutation'
import { ErrorBanner } from '../ErrorBanner'

export interface LotDraft {
  material: string
  /** Talep kovası: lotun kimliği (malzeme + kova). */
  bucket: string
  /** Planda lotun toplam adedi (kalıp ömrüyle bölünmüşse bütün parçaları). */
  quantity: number
  /** Lot kaç işe bölündü. */
  jobCount: number
  /** Bir rulodan çıkan adet (rulo beslemeli lotta). */
  piecesPerCoil?: number
  /** Bu lot için kayıtlı adet kuralı. */
  override?: { id: string; qty: number }
}

const pcs = (n: number) => Math.round(n).toLocaleString('en-GB')

/**
 * Plan grafiğinde işe tıklayınca: lotun adedini değiştirip planı yeniden
 * hesaplatmak (planlamacı, 2026-10-19). Adet Plan overrides'a kural olarak
 * yazılır; motor onu rulo / minimum lota yuvarlar, farkı sonraki lotlara aktarır.
 */
export function LotQuantityDialog({ draft, onClose }: { draft: LotDraft; onClose: () => void }) {
  const [value, setValue] = useState(String(draft.override?.qty ?? Math.round(draft.quantity)))
  const save = useSafeMutation(api.planOverrides.setQuantity)
  const remove = useSafeMutation(api.planOverrides.remove)
  const recalc = useSafeMutation(api.planRuns.requestNow)
  const qty = Number(value.replace(/[\s.,]/g, ''))
  const valid = value.trim() !== '' && Number.isFinite(qty) && qty >= 0
  const coils = draft.piecesPerCoil && valid ? Math.ceil(qty / draft.piecesPerCoil) : 0
  const pending = save.pending || remove.pending || recalc.pending
  const error = save.error ?? remove.error ?? recalc.error

  const submit = async () => {
    if (!valid) return
    const ok = await save.run({ material: draft.material, bucket: draft.bucket, qty, previousQty: draft.quantity })
    if (ok && (await recalc.run({}))) onClose()
  }
  const reset = async () => {
    if (!draft.override) return
    if ((await remove.run({ id: draft.override.id })) && (await recalc.run({}))) onClose()
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:px-3">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-t-2xl border border-border bg-background p-4 text-foreground shadow-2xl sm:rounded-2xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Change lot quantity</p>
            <p className="mt-0.5 text-lg font-bold">{draft.material}</p>
            <p className="text-xs text-muted-foreground">
              Lot {draft.bucket} · now {pcs(draft.quantity)} pcs
              {draft.jobCount > 1 ? ` in ${draft.jobCount} jobs` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mt-3">
            <ErrorBanner
              message={error}
              onDismiss={() => {
                save.clearError()
                remove.clearError()
                recalc.clearError()
              }}
            />
          </div>
        )}

        <label className="mt-4 block text-sm">
          <span className="block text-xs text-muted-foreground">New quantity (pcs)</span>
          <input
            autoFocus
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            className="mt-1 h-11 w-full rounded-lg border-2 border-input bg-background px-3 text-base font-semibold tabular-nums outline-none focus:border-foreground"
          />
        </label>
        <p className="mt-2 text-xs text-muted-foreground">
          {draft.piecesPerCoil
            ? `Rounded up to whole coils (1 coil ≈ ${pcs(draft.piecesPerCoil)} pcs${coils > 0 ? ` → ${coils} coil${coils === 1 ? '' : 's'}` : ''}). `
            : 'Rounded up to the Min. lot if one is set. '}
          The difference moves to the next lots of this part: more now means less later, less now is added to the
          next lot. 0 skips this lot.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {draft.override && (
            <button
              type="button"
              disabled={pending}
              onClick={() => void reset()}
              className="mr-auto rounded-md px-2 py-1.5 text-sm text-destructive hover:underline disabled:opacity-50"
            >
              Back to engine quantity
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid || pending}
            onClick={() => void submit()}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save & recalculate'}
          </button>
        </div>
      </div>
    </div>
  )
}
