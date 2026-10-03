import { useMutation, useQuery } from '../../lib/convexTransport'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import { InfoTip } from '../PageHeader'

/** Hat bazlı plan başlangıcı / geride-ileride paneli (Production Plan). */
type PressStartRow = {
  press: string
  fromDate?: string
  fromMinute?: number
  reason?: string
  delayMinutes?: number
  updatedBy?: string
}

const HOLD_REASONS = ['No operator', 'No raw material', 'Die not ready', 'Other']

const toTime = (m?: number) =>
  m === undefined ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/**
 * Planlamacının müdahalesi, "Recalculate"den önce: bir pres belli bir ana
 * kadar yeni iş almaz (operatör yok, hammadde yok…) ya da hat onaylı plana
 * göre geride/ileride. Belirtilmeyen pres her zamanki gibi şu andan planlanır.
 */
export function PressStartPanel({ presses }: { presses: string[] }) {
  const rows = (useQuery(api.pressPlanStarts.list) ?? []) as PressStartRow[]
  const save = useMutation(api.pressPlanStarts.set)
  const clearAll = useMutation(api.pressPlanStarts.clearAll)
  const [open, setOpen] = useState(false)
  const [allDelay, setAllDelay] = useState('')
  const byPress = new Map(rows.map((r) => [r.press, r]))
  const active = rows.filter((r) => r.fromDate || r.delayMinutes)
  const list = Array.from(new Set([...presses, ...rows.map((r) => r.press)])).sort()
  return (
    <div className={`mt-4 rounded-lg border p-3 ${active.length > 0 ? 'border-sky-300 bg-sky-50/60' : 'border-border'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-semibold text-foreground">Plan settings — work center start &amp; delays</span>{' '}
          <span className="text-muted-foreground">
            {active.length === 0
              ? '· every work center is planned from now'
              : `· ${active
                  .map((r) =>
                    [
                      r.press,
                      r.fromDate ? `from ${r.fromDate} ${toTime(r.fromMinute)}${r.reason ? ` (${r.reason})` : ''}` : '',
                      r.delayMinutes ? `${r.delayMinutes > 0 ? '+' : ''}${Math.round((r.delayMinutes / 60) * 10) / 10} h` : '',
                    ]
                      .filter(Boolean)
                      .join(' '),
                  )
                  .join(' · ')}`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
        >
          {open ? 'Hide ▴' : 'Edit ▾'}
        </button>
      </div>
      {open && (
        <div className="mt-3">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            How these work
            <InfoTip label="About work center start and delays">
              <p>
                <b>Plan from</b>: the work center takes no new work before this date and time (no operator,
                no raw material…). Approved jobs on it that would start earlier are released and
                planned again after it.
              </p>
              <p>
                <b>Behind / ahead</b>: the line did not keep to the approved plan. +3 h moves the
                approved (frozen and running) jobs 3 hours later and closes the first 3 hours; −2 h
                brings them forward. Leave empty to plan normally. Each save recalculates the plan.
              </p>
            </InfoTip>
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2 text-xs">
            <label>
              <span className="block text-muted-foreground">All work centers behind (+) / ahead (−), hours</span>
              <input
                type="number"
                step="0.5"
                value={allDelay}
                onChange={(e) => setAllDelay(e.target.value)}
                className="mt-1 w-28 rounded-md border border-input bg-background px-2 py-1"
              />
            </label>
            <button
              type="button"
              disabled={allDelay.trim() === '' || !Number.isFinite(Number(allDelay))}
              onClick={() => {
                const minutes = Math.round(Number(allDelay) * 60)
                void Promise.all(
                  list.map((press) => {
                    const r = byPress.get(press)
                    return save({ press, fromDate: r?.fromDate, fromMinute: r?.fromMinute, reason: r?.reason, delayMinutes: minutes || undefined })
                  }),
                )
                setAllDelay('')
              }}
              className="rounded-md border border-input bg-background px-3 py-1 font-medium hover:bg-muted disabled:opacity-50"
            >
              Apply to all
            </button>
            {active.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Clear the start and delay settings of every work center? The plan is recalculated from now.')) void clearAll({})
                }}
                className="rounded-md border border-input bg-background px-3 py-1 font-medium text-destructive hover:bg-muted"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="mt-3 overflow-x-auto rounded-md border border-border bg-background">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Work center</th>
                  <th className="px-3 py-2 font-medium">Plan from (date, time)</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Behind / ahead (h)</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {list.map((press) => (
                  <PressStartRowEditor key={`${press}|${JSON.stringify(byPress.get(press) ?? {})}`} press={press} row={byPress.get(press)} save={save} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function PressStartRowEditor({
  press,
  row,
  save,
}: {
  press: string
  row: PressStartRow | undefined
  save: (args: { press: string; fromDate?: string; fromMinute?: number; reason?: string; delayMinutes?: number }) => Promise<unknown>
}) {
  const [date, setDate] = useState(row?.fromDate ?? '')
  const [time, setTime] = useState(toTime(row?.fromMinute) || '07:00')
  const [reason, setReason] = useState(row?.reason ?? '')
  const [delay, setDelay] = useState(row?.delayMinutes ? String(Math.round((row.delayMinutes / 60) * 10) / 10) : '')
  const [busy, setBusy] = useState(false)
  const minuteOf = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : undefined
  }
  const dirty =
    date !== (row?.fromDate ?? '') ||
    (date !== '' && minuteOf(time) !== row?.fromMinute) ||
    reason !== (row?.reason ?? '') ||
    Math.round(Number(delay || 0) * 60) !== (row?.delayMinutes ?? 0)
  const submit = async (clear = false) => {
    setBusy(true)
    try {
      await save(
        clear
          ? { press }
          : {
              press,
              fromDate: date || undefined,
              fromMinute: date ? minuteOf(time) : undefined,
              reason: reason || undefined,
              delayMinutes: Math.round(Number(delay || 0) * 60) || undefined,
            },
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-1.5 font-medium text-foreground">{press}</td>
      <td className="px-3 py-1.5">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1 text-xs" />{' '}
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!date} className="rounded-md border border-input bg-background px-2 py-1 text-xs disabled:opacity-50" />
      </td>
      <td className="px-3 py-1.5">
        <input
          list="press-hold-reasons"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="No operator…"
          className="w-40 rounded-md border border-input bg-background px-2 py-1 text-xs"
        />
        <datalist id="press-hold-reasons">
          {HOLD_REASONS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </td>
      <td className="px-3 py-1.5">
        <input
          type="number"
          step="0.5"
          value={delay}
          onChange={(e) => setDelay(e.target.value)}
          placeholder="0"
          className="w-20 rounded-md border border-input bg-background px-2 py-1 text-xs"
        />
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-right">
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={() => void submit()}
          className="rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background disabled:opacity-40"
        >
          Save
        </button>{' '}
        {row && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Clear the start and delay settings of ${press}?`)) void submit(true)
            }}
            className="rounded-md border border-input px-2.5 py-1 text-xs font-medium hover:bg-muted"
          >
            Clear
          </button>
        )}
        {row?.updatedBy && <span className="ml-2 text-[11px] text-muted-foreground">{row.updatedBy}</span>}
      </td>
    </tr>
  )
}
