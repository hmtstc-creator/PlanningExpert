import { useMemo, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { useMutation } from '../../lib/convexTransport'
import { friendlyError } from '../../lib/mutationErrors'
import { DEFAULT_RAW, type LeadTimeRow } from '../../lib/rawLeadTime'
import { SETTINGS_DEFAULTS } from '../../lib/settingsDefaults'
import { InfoTip } from '../PageHeader'

interface Draft {
  days: string
  supplier: string
  note: string
}

const toDraft = (row?: LeadTimeRow): Draft => ({
  days: row ? String(row.leadTimeDays) : '',
  supplier: row?.supplier ?? '',
  note: row?.note ?? '',
})
const same = (a: Draft, b: Draft) => a.days.trim() === b.days.trim() && a.supplier.trim() === b.supplier.trim() && a.note.trim() === b.note.trim()
const INPUT = 'w-full rounded-md border border-input bg-background px-2 py-1'

/**
 * Sac kodu başına tedarik süresi (takvim günü). Satırlar Master Data'daki
 * hammadde kodlarından gelir; süresi boş olan sac varsayılanı kullanır ve
 * "not entered" görünür. Değişiklikler tek "Save" ile yazılır.
 */
export function LeadTimePanel({
  rows,
  raws,
}: {
  rows: LeadTimeRow[] | undefined
  /** Sayfadaki hammaddeler ve onları kullanan mamuller. */
  raws: { rawMaterial: string; materials: string[] }[]
}) {
  const save = useMutation(api.rawLeadTimes.save)
  const [open, setOpen] = useState(false)
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [edits, setEdits] = useState<Map<string, Draft>>(new Map())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const saved = useMemo(() => new Map((rows ?? []).map((r) => [r.rawMaterialCode, r])), [rows])
  // Sayfadaki saclar + kayıtlı olup artık Master Data'da olmayanlar (silinebilsin).
  const lines = useMemo(() => {
    const usedBy = new Map(raws.map((r) => [r.rawMaterial, r.materials]))
    for (const code of saved.keys()) if (code !== DEFAULT_RAW && !usedBy.has(code)) usedBy.set(code, [])
    return Array.from(usedBy.entries())
      .map(([rawMaterial, materials]) => ({ rawMaterial, materials }))
      .sort((a, b) => a.rawMaterial.localeCompare(b.rawMaterial))
  }, [raws, saved])

  const draftOf = (code: string) => edits.get(code) ?? toDraft(saved.get(code))
  const setField = (code: string, field: keyof Draft, value: string) =>
    setEdits((prev) => new Map(prev).set(code, { ...draftOf(code), [field]: value }))
  const dirty = Array.from(edits.entries()).filter(([code, d]) => !same(d, toDraft(saved.get(code))))
  const problem = (d: Draft) =>
    d.days.trim() === ''
      ? d.supplier.trim() || d.note.trim()
        ? 'enter the days to keep the supplier or note'
        : null
      : /^\d{1,3}$/.test(d.days.trim()) && Number(d.days) <= 365
        ? null
        : 'days must be 0–365'
  const invalid = dirty.map(([code, d]) => [code, problem(d)] as const).find(([, p]) => p)

  const defaultDays = saved.get(DEFAULT_RAW)?.leadTimeDays ?? SETTINGS_DEFAULTS.rawLeadTimeDays
  const missing = lines.filter((l) => !saved.has(l.rawMaterial)).length
  const shown = onlyMissing ? lines.filter((l) => !saved.has(l.rawMaterial)) : lines

  const submit = async () => {
    if (invalid) return
    setBusy(true)
    setError(null)
    try {
      await save({
        rows: dirty.map(([code, d]) => ({
          rawMaterialCode: code,
          leadTimeDays: d.days.trim() === '' ? null : Number(d.days.trim()),
          supplier: d.supplier,
          note: d.note,
        })),
      })
      setEdits(new Map())
    } catch (e) {
      setError(friendlyError(e).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-2 text-left font-semibold text-foreground">
          {open ? '▾' : '▸'} Lead times
          <span className="font-normal text-muted-foreground">
            (calendar days) · default {defaultDays} days ·{' '}
            {rows === undefined ? '…' : missing > 0 ? (
              <span className="text-amber-700">
                {missing} of {lines.length} not entered
              </span>
            ) : (
              `all ${lines.length} entered`
            )}
          </span>
        </button>
        <InfoTip label="About lead times">
          Days from placing the order to the coil arriving, in <b>calendar days</b> (weekends and holidays
          count). Order by = Monday of the delivery week − lead time. A coil without its own lead time
          uses the default and is marked <em>not entered</em>. Changing it does not recalculate the
          production plan.
        </InfoTip>
      </div>
      {open && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
              Only not entered
            </label>
            <span className="text-muted-foreground">Leave the days empty to use the default again.</span>
            <span className="ml-auto flex items-center gap-2">
              {invalid && <span className="text-destructive">{invalid[0] === DEFAULT_RAW ? 'Default' : invalid[0]}: {invalid[1]}</span>}
              {error && <span className="text-destructive">{error}</span>}
              {dirty.length > 0 && (
                <button type="button" onClick={() => setEdits(new Map())} className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-muted">
                  Discard
                </button>
              )}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={dirty.length === 0 || busy || !!invalid}
                className="rounded-md bg-foreground px-3 py-1.5 font-medium text-background disabled:opacity-40"
              >
                {busy ? 'Saving…' : dirty.length > 0 ? `Save ${dirty.length} change(s)` : 'Save'}
              </button>
            </span>
          </div>
          <div className="mt-2 max-h-[28rem] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[44rem] text-left text-xs">
              <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Raw material</th>
                  <th className="px-3 py-2 font-medium">Used by</th>
                  <th className="w-28 px-3 py-2 font-medium">Lead time (calendar days)</th>
                  <th className="w-44 px-3 py-2 font-medium">Supplier</th>
                  <th className="px-3 py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                <Line
                  code={DEFAULT_RAW}
                  label="Default"
                  usedBy="every coil without its own lead time"
                  draft={draftOf(DEFAULT_RAW)}
                  placeholder={String(SETTINGS_DEFAULTS.rawLeadTimeDays)}
                  status={saved.has(DEFAULT_RAW) ? null : `not set — ${SETTINGS_DEFAULTS.rawLeadTimeDays} days`}
                  onChange={setField}
                  highlight
                />
                {shown.map((l) => (
                  <Line
                    key={l.rawMaterial}
                    code={l.rawMaterial}
                    label={l.rawMaterial}
                    usedBy={l.materials.length === 0 ? 'not in Master Data any more' : l.materials.join(', ')}
                    draft={draftOf(l.rawMaterial)}
                    placeholder={String(defaultDays)}
                    status={saved.has(l.rawMaterial) ? null : `not entered — default ${defaultDays} days`}
                    onChange={setField}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Line({
  code,
  label,
  usedBy,
  draft,
  placeholder,
  status,
  onChange,
  highlight,
}: {
  code: string
  label: string
  usedBy: string
  draft: Draft
  placeholder: string
  status: string | null
  onChange: (code: string, field: keyof Draft, value: string) => void
  highlight?: boolean
}) {
  return (
    <tr className={`border-t border-border ${highlight ? 'bg-sky-50/60' : ''}`}>
      <td className="whitespace-nowrap px-3 py-1.5 font-medium text-foreground">
        {label}
        {status && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-normal text-amber-800">{status}</span>}
      </td>
      <td className="max-w-56 truncate px-3 py-1.5 text-muted-foreground" title={usedBy}>
        {usedBy}
      </td>
      <td className="px-3 py-1">
        <input
          type="number"
          min={0}
          max={365}
          inputMode="numeric"
          value={draft.days}
          placeholder={placeholder}
          onChange={(e) => onChange(code, 'days', e.target.value)}
          className={`${INPUT} text-right tabular-nums`}
        />
      </td>
      <td className="px-3 py-1">
        <input value={draft.supplier} onChange={(e) => onChange(code, 'supplier', e.target.value)} className={INPUT} maxLength={120} />
      </td>
      <td className="px-3 py-1">
        <input value={draft.note} onChange={(e) => onChange(code, 'note', e.target.value)} className={INPUT} maxLength={300} />
      </td>
    </tr>
  )
}
