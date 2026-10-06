import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { ErrorBanner } from '../ErrorBanner'
import { useQuery } from '../../lib/convexTransport'
import { normalizeShifts, shiftMinutes, shiftProblems, type ShiftDef, type ShiftSource } from '../../lib/shifts'
import { useSafeMutation } from '../../lib/useSafeMutation'

/**
 * Company settings → Shifts: şirketin vardiya standardı ve plant'lerin kendi
 * tanımları (src/lib/shifts.ts). MES kodları (UB61, UB64 …) vardiya
 * numarasına burada bağlanır; OEE ve Loss Bridge bunları kullanır.
 */

interface Data {
  company: ShiftDef[]
  plants: { _id: string; name: string; own: ShiftDef[]; effective: { shifts: ShiftDef[]; source: ShiftSource } }[]
}

/** Düzenleme satırı: kodlar virgülle yazılır. */
interface Row {
  number: string
  name: string
  start: string
  end: string
  codes: string
}

const toRows = (list: ShiftDef[]): Row[] =>
  list.map((s) => ({ number: String(s.number), name: s.name, start: s.start ?? '', end: s.end ?? '', codes: s.codes.join(', ') }))
const fromRows = (rows: Row[]): ShiftDef[] =>
  rows.map((r) => ({
    number: Number(r.number),
    name: r.name,
    ...(r.start.trim() ? { start: r.start.trim() } : {}),
    ...(r.end.trim() ? { end: r.end.trim() } : {}),
    codes: r.codes.split(/[,;\s]+/).filter(Boolean),
  }))

const STARTER: Row[] = [
  { number: '1', name: 'Early', start: '06:00', end: '14:00', codes: '' },
  { number: '2', name: 'Late', start: '14:00', end: '22:00', codes: '' },
  { number: '3', name: 'Night', start: '22:00', end: '06:00', codes: '' },
]

const input = 'w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm'

export function ShiftSettings({ companyId }: { companyId: string }) {
  const data = useQuery(api.platform.shiftSettings, { companyId }) as Data | undefined
  const { run: saveCompany, error: e1, clearError: c1 } = useSafeMutation(api.platform.saveCompanyShifts)
  const { run: savePlant, error: e2, clearError: c2 } = useSafeMutation(api.platform.savePlantShifts)
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>
  return (
    <div className="space-y-6">
      <ErrorBanner message={e1 ?? e2} onDismiss={() => (c1(), c2())} />
      <section>
        <h2 className="text-sm font-semibold text-foreground">Company standard</h2>
        <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">
          The shifts every plant of the company uses unless it has its own. <b>MES codes</b>: the shift codes in the uploaded files (Shift
          Group / Shift Definition, e.g. UB61 and UB64 for shift 1) — the OEE pages number the shifts with them. One code belongs to one
          shift.
        </p>
        <ShiftEditor
          key={`c-${JSON.stringify(data.company)}`}
          initial={data.company}
          emptyHint="No standard yet — start with three 8-hour shifts and add the codes."
          onSave={(shifts) => saveCompany({ companyId, shifts })}
        />
      </section>
      <section>
        <h2 className="text-sm font-semibold text-foreground">Plants</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          A plant follows the company standard unless it has shifts of its own (other times or other MES codes).
        </p>
        <div className="mt-2 space-y-3">
          {data.plants.map((p) => (
            <PlantShifts key={p._id} plant={p} onSave={(shifts) => savePlant({ plantId: p._id, shifts })} />
          ))}
        </div>
      </section>
    </div>
  )
}

function PlantShifts({ plant, onSave }: { plant: Data['plants'][number]; onSave: (s: ShiftDef[]) => Promise<unknown> }) {
  const [own, setOwn] = useState(plant.own.length > 0)
  useEffect(() => setOwn(plant.own.length > 0), [plant.own.length])
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{plant.name}</p>
        <div className="flex rounded-md border border-border p-0.5 text-xs" role="group" aria-label={`${plant.name} shifts`}>
          <button
            type="button"
            aria-pressed={!own}
            onClick={() => {
              if (plant.own.length && !window.confirm(`Drop ${plant.name}'s own shifts and use the company standard?`)) return
              setOwn(false)
              if (plant.own.length) void onSave([])
            }}
            className={`rounded px-2.5 py-1 font-medium ${!own ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'}`}
          >
            Company standard
          </button>
          <button
            type="button"
            aria-pressed={own}
            onClick={() => setOwn(true)}
            className={`rounded px-2.5 py-1 font-medium ${own ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'}`}
          >
            Own shifts
          </button>
        </div>
      </div>
      {own ? (
        <ShiftEditor
          key={`p-${JSON.stringify(plant.own)}`}
          initial={plant.own.length ? plant.own : plant.effective.shifts}
          emptyHint="No shifts yet."
          onSave={onSave}
        />
      ) : (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {plant.effective.shifts.length
            ? plant.effective.shifts.map((s) => `${s.number} ${s.name}${s.codes.length ? ` (${s.codes.join(', ')})` : ''}`).join(' · ')
            : 'The company has no standard yet.'}
        </p>
      )}
    </div>
  )
}

function ShiftEditor({
  initial,
  emptyHint,
  onSave,
}: {
  initial: ShiftDef[]
  emptyHint: string
  onSave: (s: ShiftDef[]) => Promise<unknown>
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(initial))
  const [saved, setSaved] = useState(false)
  const dirty = JSON.stringify(normalizeShifts(fromRows(rows))) !== JSON.stringify(normalizeShifts(initial))
  const problems = shiftProblems(fromRows(rows))
  const set = (i: number, p: Partial<Row>) => {
    setSaved(false)
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)))
  }
  const next = String(Math.max(0, ...rows.map((r) => Number(r.number) || 0)) + 1)
  return (
    <div className="mt-2">
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {emptyHint}{' '}
          <button type="button" className="font-medium text-foreground underline" onClick={() => setRows(STARTER)}>
            Start with 3 shifts
          </button>
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="w-16 py-1 pr-2 text-left font-medium">No.</th>
                <th className="py-1 pr-2 text-left font-medium">Name</th>
                <th className="w-24 py-1 pr-2 text-left font-medium">Start</th>
                <th className="w-24 py-1 pr-2 text-left font-medium">End</th>
                <th className="w-16 py-1 pr-2 text-right font-medium">Hours</th>
                <th className="py-1 pr-2 text-left font-medium">MES codes (comma separated)</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const min = shiftMinutes({ start: r.start, end: r.end })
                return (
                  <tr key={i}>
                    <td className="py-1 pr-2">
                      <input
                        className={input}
                        inputMode="numeric"
                        value={r.number}
                        onChange={(e) => set(i, { number: e.target.value })}
                        aria-label="Shift number"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className={input}
                        value={r.name}
                        placeholder="Early"
                        onChange={(e) => set(i, { name: e.target.value })}
                        aria-label="Shift name"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className={input}
                        type="time"
                        value={r.start}
                        onChange={(e) => set(i, { start: e.target.value })}
                        aria-label="Start"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className={input}
                        type="time"
                        value={r.end}
                        onChange={(e) => set(i, { end: e.target.value })}
                        aria-label="End"
                      />
                    </td>
                    <td className="py-1 pr-2 text-right text-muted-foreground tabular-nums">
                      {min === null ? '—' : (min / 60).toFixed(1)}
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className={input}
                        value={r.codes}
                        placeholder="UB61, UB64"
                        onChange={(e) => set(i, { codes: e.target.value.toUpperCase() })}
                        aria-label="MES codes"
                      />
                    </td>
                    <td className="py-1">
                      <button
                        type="button"
                        onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Remove shift ${r.number}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, { number: next, name: '', start: '', end: '', codes: '' }])}
          className="flex items-center gap-1 text-xs font-medium text-foreground underline"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Shift
        </button>
        {problems.length > 0 && rows.length > 0 && <span className="text-xs text-destructive">{problems.join(' · ')}</span>}
        <span className="ml-auto flex items-center gap-2">
          {saved && !dirty && <span className="text-xs text-emerald-700">✓ Saved</span>}
          <button
            type="button"
            disabled={!dirty || problems.length > 0}
            onClick={() =>
              void onSave(normalizeShifts(fromRows(rows))).then((ok) => {
                if (ok) setSaved(true)
              })
            }
            className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
          >
            Save shifts
          </button>
        </span>
      </div>
    </div>
  )
}
