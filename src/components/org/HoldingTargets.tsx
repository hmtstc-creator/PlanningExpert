import { useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { ErrorBanner } from '../ErrorBanner'
import { HOLDING_TARGET_KEYS, measureOf, type HoldingTargetKey, type HoldingTargets } from '../../lib/board'
import type { OrgHolding } from '../../lib/orgTree'
import { useSafeMutation } from '../../lib/useSafeMutation'

/**
 * Holding hedefleri (K7) — tek kaynak: Holdings & companies paneli ve
 * Organization map'in holding düğümü aynı formu kullanır. Board grup toplamında
 * o ölçünün planı; boş = şirket planlarının toplamı. Yüzdeler ekranda %,
 * kayıtta oran. Yalnız General (`platform.setHoldingTargets` sunucuda denetler).
 * Başka holding seçilince form sıfırlansın diye çağıran `key={holding._id}` verir.
 */

const input = 'mt-1 block w-24 rounded-md border border-input bg-background px-2 py-1 text-xs'
const btn = 'rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40'

export const HOLDING_TARGETS_HINT = "The holding's own target is the group plan on the Board Dashboard. Leave a field empty to use the sum of the companies' plans."

export function HoldingTargetsForm({ holding: h }: { holding: OrgHolding }) {
  const { run, error, clearError, pending } = useSafeMutation(api.platform.setHoldingTargets)
  const shown = (k: HoldingTargetKey) => {
    const value = h.targets?.[k]
    if (value === undefined) return ''
    return measureOf(k).unit === '%' ? String(Math.round(value * 1000) / 10) : String(value)
  }
  const initial = () => Object.fromEntries(HOLDING_TARGET_KEYS.map((k) => [k, shown(k)])) as Record<HoldingTargetKey, string>
  const [form, setForm] = useState(initial)
  const dirty = HOLDING_TARGET_KEYS.some((k) => form[k] !== shown(k))
  const save = () => {
    const targets: HoldingTargets = {}
    for (const k of HOLDING_TARGET_KEYS) {
      const text = form[k].trim().replace(',', '.')
      if (text) targets[k] = measureOf(k).unit === '%' ? Number(text) / 100 : Number(text)
    }
    return run({ id: h._id, targets })
  }
  return (
    <div className="space-y-2">
      <ErrorBanner message={error} onDismiss={clearError} />
      <div className="flex flex-wrap items-end gap-2">
        {HOLDING_TARGET_KEYS.map((k) => (
          <label key={k} className="text-xs text-muted-foreground">
            {measureOf(k).label}
            {measureOf(k).unit === '%' ? ' (%)' : ''}
            <input className={input} inputMode="decimal" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          </label>
        ))}
        <button className={btn} disabled={!dirty || pending} onClick={() => void save()}>
          Save targets
        </button>
      </div>
    </div>
  )
}
