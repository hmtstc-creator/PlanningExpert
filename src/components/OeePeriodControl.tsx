import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { useQuery } from '../lib/convexTransport'
import { addDaysIso, type OeeConfig } from '../lib/oee'
import {
  MAX_EVENT_DAYS,
  MAX_RANGE_DAYS,
  clipToData,
  daysBetween,
  isWholeMonth,
  previousRange,
  selectedRange,
  type PeriodMode,
} from '../lib/oeeBridge'
import { usePlant } from '../lib/plantContext'

function localIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const dm = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
export const rangeText = (r: { from: string; to: string }) => (r.from === r.to ? dm(r.from) : `${dm(r.from)} – ${dm(r.to)}`)

export type DateRange = { from: string; to: string }

/**
 * Loss Bridge ve Daily Report'un dönemi: tek gün ya da tarih aralığı
 * (planlamacı, 2026-10-07); boşsa son yüklenen gün. Dönem son yüklenen güne
 * kırpılır; önceki dönem karşılaştırma içindir.
 */
export function useOeePeriod() {
  const coverage = useQuery(api.oee.coverage) as { days: DateRange | null } | undefined
  const [mode, setMode] = useState<PeriodMode>('day')
  const [dayRaw, setDay] = useState('')
  const [rangeRaw, setRange] = useState<DateRange | null>(null)
  const lastDay = coverage?.days?.to ?? null
  const firstDay = coverage?.days?.from ?? null
  const fallbackDay = lastDay ?? addDaysIso(localIso(new Date()), -1)
  const day = dayRaw || fallbackDay
  const range = rangeRaw ?? { from: addDaysIso(fallbackDay, -6), to: fallbackDay }
  const wanted = selectedRange(mode, day, range)
  const cur = clipToData(wanted, lastDay)
  // Bir takvim ayının tamamı önceki ayın tamamıyla, diğerleri önceki eşit dönemle karşılaştırılır.
  const prev = cur ? previousRange(cur, isWholeMonth(wanted)) : null
  // Önceki dönem ilk yüklenen günden önce başlıyorsa karşılaştırma yapılmaz (yarım dönem).
  const prevFull = !!prev && !!firstDay && prev.from >= firstDay
  // Ham duruş ve vardiya kayıtları en çok 8 günlük dönemde okunur.
  const eventsOk = !!cur && daysBetween(cur.from, cur.to) <= MAX_EVENT_DAYS
  return { mode, setMode, day, setDay, range, setRange, lastDay, firstDay, wanted, cur, prev, prevFull, eventsOk }
}

export type OeePeriod = ReturnType<typeof useOeePeriod>

/** Vardiyalar: Working calendar (adlarıyla), yoksa OEE ayarındaki kodların numaraları. */
export function useShiftOptions(config: OeeConfig) {
  const { ctx } = usePlant()
  return useMemo(() => {
    const named = ctx?.active?.shifts ?? []
    const numbers = [...new Set(config.shifts.map((x) => x.number))].sort((a, b) => a - b)
    return numbers.map((n) => {
      const d = named.find((x) => x.number === n)
      return { number: n, label: d ? `${n} · ${d.name}` : `Shift ${n}` }
    })
  }, [config.shifts, ctx?.active?.shifts])
}

/** Dönem, vardiya ve makine seçimi (OeeControls'un `period` alanına). */
export function OeePeriodFields({
  period: p,
  shift,
  setShift,
  shiftOptions,
  machine,
  setMachine,
  machineOptions,
  showPrevious = true,
}: {
  period: OeePeriod
  shift: number
  setShift: (n: number) => void
  shiftOptions: { number: number; label: string }[]
  machine: string
  setMachine: (m: string) => void
  machineOptions: string[]
  showPrevious?: boolean
}) {
  const { mode, setMode, day, setDay, range, setRange, lastDay, cur, prev, eventsOk } = p
  return (
    <>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        Period
        <div className="flex rounded-md border border-input p-0.5" role="group" aria-label="Period">
          {(
            [
              ['day', 'Single day'],
              ['range', 'Date range'],
            ] as [PeriodMode, string][]
          ).map(([m, text]) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`rounded px-2.5 py-1 text-sm font-medium ${mode === m ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'}`}
            >
              {text}
            </button>
          ))}
        </div>
      </div>
      {mode === 'day' ? (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Day
          <input
            type="date"
            value={day}
            max={lastDay ?? undefined}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            From
            <input
              type="date"
              value={range.from}
              max={lastDay ?? undefined}
              onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            To (max {MAX_RANGE_DAYS} days)
            <input
              type="date"
              value={range.to}
              max={lastDay ?? undefined}
              onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
        </>
      )}
      {shiftOptions.length > 0 && (
        <label
          className="flex flex-col gap-1 text-xs text-muted-foreground"
          title={eventsOk ? undefined : `The shift filter works for periods of up to ${MAX_EVENT_DAYS} days`}
        >
          Shift
          <select
            value={eventsOk ? shift : 0}
            disabled={!eventsOk}
            onChange={(e) => setShift(Number(e.target.value))}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
          >
            <option value={0}>All shifts</option>
            {shiftOptions.map((o) => (
              <option key={o.number} value={o.number}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {machineOptions.length > 1 && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Machine
          <select
            value={machine}
            onChange={(e) => setMachine(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
          >
            <option value="">All in the selection</option>
            {machineOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      )}
      <span className="pb-2 text-xs text-muted-foreground">
        {cur ? (
          <>
            <strong className="text-foreground">{rangeText(cur)}</strong> · {daysBetween(cur.from, cur.to)} day(s)
            {showPrevious && <> · vs {prev ? rangeText(prev) : '—'}</>}
          </>
        ) : (
          'No data for this period'
        )}
      </span>
    </>
  )
}
