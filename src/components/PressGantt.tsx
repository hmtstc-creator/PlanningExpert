import { useMemo, useState } from 'react'

import {
  breakBlocks,
  formatClockMinute,
  netShiftMinutes,
  overlappingSetups,
  toClockBlocks,
  type GanttBlock,
  type ShiftLayout,
} from '../lib/gantt'

/**
 * Press-by-press timeline for one day.
 *
 * Rows are presses grouped by hall, the axis is real clock time in one-hour
 * columns, and each job appears as a setup block followed by a production
 * block. Shift breaks are drawn too, because capacity the plan cannot use is
 * as meaningful as capacity it can.
 *
 * Colours are validated for colour-vision deficiency; every block also carries
 * a text label and the legend names each kind, so nothing is encoded by colour
 * alone.
 */
const COLORS: Record<GanttBlock['kind'], { fill: string; label: string }> = {
  setup: { fill: '#3b6fd4', label: 'Setup' },
  run: { fill: '#5aa97b', label: 'Production' },
  break: { fill: '#dd8030', label: 'Planned stop' },
}

export interface GanttJob {
  press: string
  hall: string
  material: string
  setupStartMinute: number
  setupEndMinute: number
  endMinute: number
  quantity: number
  late: boolean
}

export interface GanttPress {
  name: string
  hall: string
  /** Net productive minutes available on this day. */
  capacityMinutes: number
}

interface Props {
  date: string
  presses: GanttPress[]
  jobs: GanttJob[]
  layout: ShiftLayout
}

const ROW_HEIGHT = 34
const LABEL_WIDTH = 104

export function PressGantt({ date, presses, jobs, layout }: Props) {
  const [hovered, setHovered] = useState<string | null>(null)

  const { rows, axisStart, axisEnd, clashKeys } = useMemo(() => {
    const jobsByPress = new Map<string, GanttJob[]>()
    for (const job of jobs) {
      const list = jobsByPress.get(job.press) ?? []
      list.push(job)
      jobsByPress.set(job.press, list)
    }

    const rows = presses
      .filter((p) => p.capacityMinutes > 0 || jobsByPress.has(p.name))
      .map((press) => {
        const pressJobs = jobsByPress.get(press.name) ?? []
        const blocks: (GanttBlock & { hall: string; quantity?: number; late?: boolean })[] = []
        for (const job of pressJobs) {
          for (const b of toClockBlocks(
            job.setupStartMinute,
            job.setupEndMinute,
            'setup',
            layout,
            press.name,
            job.material,
          )) {
            blocks.push({ ...b, hall: press.hall, quantity: job.quantity, late: job.late })
          }
          for (const b of toClockBlocks(
            job.setupEndMinute,
            job.endMinute,
            'run',
            layout,
            press.name,
            job.material,
          )) {
            blocks.push({ ...b, hall: press.hall, quantity: job.quantity, late: job.late })
          }
        }
        for (const b of breakBlocks(press.capacityMinutes, layout, press.name)) {
          blocks.push({ ...b, hall: press.hall })
        }
        blocks.sort((a, b) => a.startMinute - b.startMinute)
        return { press, blocks }
      })

    const allBlocks = rows.flatMap((r) => r.blocks)
    const clashes = overlappingSetups(allBlocks)
    const clashKeys = new Set(
      clashes.flatMap((c) => [
        `${c.a.press}|${c.a.startMinute}`,
        `${c.b.press}|${c.b.startMinute}`,
      ]),
    )

    // Axis spans the working window, rounded out to whole hours.
    const shiftsPerDay = Math.max(
      1,
      ...rows.map((r) => Math.ceil(r.press.capacityMinutes / netShiftMinutes(layout))),
    )
    const rawEnd = Math.max(
      layout.shiftStartMinute + shiftsPerDay * layout.shiftMinutes,
      ...allBlocks.map((b) => b.endMinute),
      layout.shiftStartMinute + 60,
    )
    return {
      rows,
      axisStart: Math.floor(layout.shiftStartMinute / 60) * 60,
      axisEnd: Math.ceil(rawEnd / 60) * 60,
      clashKeys,
    }
  }, [presses, jobs, layout])

  const span = Math.max(60, axisEnd - axisStart)
  const hours: number[] = []
  for (let m = axisStart; m <= axisEnd; m += 60) hours.push(m)

  const pct = (minute: number) => ((minute - axisStart) / span) * 100

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No presses with capacity on {date}.
      </p>
    )
  }

  // Group rows by hall so the crane constraint is visible as a grouping.
  const byHall = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = row.press.hall || '—'
    const list = byHall.get(key) ?? []
    list.push(row)
    byHall.set(key, list)
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-2.5">
        {(['setup', 'run', 'break'] as const).map((kind) => (
          <span key={kind} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: COLORS[kind].fill }}
            />
            {COLORS[kind].label}
          </span>
        ))}
        {clashKeys.size > 0 && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-destructive">
            <span className="inline-block h-3 w-3 rounded-sm border-2 border-dashed border-destructive" />
            Overlapping setup in the same hall
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[760px] px-4 py-3">
          {/* Hour axis */}
          <div className="relative mb-1 h-5" style={{ marginLeft: LABEL_WIDTH }}>
            {hours.map((m) => (
              <span
                key={m}
                className="absolute -translate-x-1/2 text-[11px] tabular-nums text-muted-foreground"
                style={{ left: `${pct(m)}%` }}
              >
                {formatClockMinute(m)}
              </span>
            ))}
          </div>

          {Array.from(byHall.entries()).map(([hall, hallRows]) => (
            <div key={hall} className="mb-3 last:mb-0">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {hall}
              </p>
              {hallRows.map(({ press, blocks }) => (
                <div key={press.name} className="flex items-center">
                  <span
                    className="shrink-0 truncate pr-2 text-xs font-medium text-foreground"
                    style={{ width: LABEL_WIDTH }}
                    title={press.name}
                  >
                    {press.name}
                  </span>
                  <div
                    className="relative flex-1 rounded border border-border bg-muted/40"
                    style={{ height: ROW_HEIGHT }}
                  >
                    {/* Hour gridlines */}
                    {hours.map((m) => (
                      <span
                        key={m}
                        className="absolute top-0 h-full w-px bg-border/70"
                        style={{ left: `${pct(m)}%` }}
                      />
                    ))}

                    {blocks.map((b, i) => {
                      const key = `${b.press}|${b.startMinute}`
                      const clashing = b.kind === 'setup' && clashKeys.has(key)
                      const width = Math.max(0.25, pct(b.endMinute) - pct(b.startMinute))
                      const id = `${press.name}-${i}`
                      const title =
                        b.kind === 'break'
                          ? `Planned stop · ${formatClockMinute(b.startMinute)}–${formatClockMinute(b.endMinute)}`
                          : `${b.material ?? ''} · ${COLORS[b.kind].label} · ` +
                            `${formatClockMinute(b.startMinute)}–${formatClockMinute(b.endMinute)}` +
                            (b.quantity ? ` · ${b.quantity.toLocaleString('en-GB')} pcs` : '')
                      return (
                        <div
                          key={id}
                          title={title}
                          onMouseEnter={() => setHovered(id)}
                          onMouseLeave={() => setHovered(null)}
                          className={`absolute top-1 flex items-center overflow-hidden rounded-sm px-1 text-[10px] font-medium text-white transition-opacity ${
                            clashing ? 'ring-2 ring-dashed ring-red-600' : ''
                          } ${hovered && hovered !== id ? 'opacity-70' : ''}`}
                          style={{
                            left: `${pct(b.startMinute)}%`,
                            width: `${width}%`,
                            height: ROW_HEIGHT - 8,
                            backgroundColor: COLORS[b.kind].fill,
                            // A 2px surface gap keeps adjacent blocks readable
                            // as separate marks rather than one long bar.
                            marginRight: 2,
                          }}
                        >
                          {width > 6 && b.kind !== 'break' && (
                            <span className="truncate">{b.material}</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
