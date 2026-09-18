import { Fragment, useMemo, useState } from 'react'

import {
  buildDayTimeline,
  netIntervalToClockBlocks,
  type PlannedStop,
  type Segment,
} from '../lib/shiftTimeline'

/**
 * One week of production across every press.
 *
 * A planner schedules a week, not a day, so the whole week is one continuous
 * strip: days sit side by side in equal bands with a separator between them,
 * and each press keeps a single row throughout. Rows group by press category,
 * which is what the shop calls its machines; hall stays a scheduling
 * constraint rather than a display grouping.
 *
 * Each job is drawn as setup → quality approval → production, and the planned
 * stops are drawn too, so a bar that stops for the meal break looks like it
 * stops for the meal break.
 */
const COLORS = {
  setup: { fill: '#3b6fd4', label: 'Setup' },
  quality: { fill: '#9a6fb0', label: 'Quality approval' },
  run: { fill: '#5aa97b', label: 'Production' },
  stop: { fill: '#dd8030', label: 'Planned stop' },
} as const

type BlockKind = keyof typeof COLORS

export interface WeekGanttJob {
  date: string
  press: string
  material: string
  quantity: number
  late: boolean
  /** Net production minutes within the day. */
  setupStartMinute: number
  setupEndMinute: number
  qualityEndMinute: number
  endMinute: number
}

export interface WeekGanttDay {
  date: string
  shifts: number
  capacityMinutes: number
}

export interface WeekGanttPress {
  name: string
  hall: string
  category?: string
  days: WeekGanttDay[]
}

interface Props {
  dates: string[]
  presses: WeekGanttPress[]
  jobs: WeekGanttJob[]
  stops: PlannedStop[]
  shiftStartMinute: number
  shiftMinutes: number
}

interface PlacedBlock extends Segment {
  kind: BlockKind
  press: string
  hall: string
  date: string
  label?: string
  title: string
}

const ROW_HEIGHT = 30
const LABEL_WIDTH = 108

function clockLabel(minute: number): string {
  const wrapped = ((minute % 1440) + 1440) % 1440
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(
    Math.round(wrapped % 60),
  ).padStart(2, '0')}`
}

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
  })
}

export function WeekGantt({
  dates,
  presses,
  jobs,
  stops,
  shiftStartMinute,
  shiftMinutes,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null)

  const { rows, dayWidth, totalWidth, clashKeys } = useMemo(() => {
    // Every day gets the same width so the axis stays readable; the width is
    // set by the busiest press so nothing is ever clipped.
    const maxShifts = Math.max(
      1,
      ...presses.flatMap((p) => p.days.map((d) => d.shifts)),
    )
    const dayWidth = maxShifts * shiftMinutes
    const dayIndex = new Map(dates.map((d, i) => [d, i]))

    const jobsByPressDate = new Map<string, WeekGanttJob[]>()
    for (const job of jobs) {
      const key = `${job.press}|${job.date}`
      const list = jobsByPressDate.get(key) ?? []
      list.push(job)
      jobsByPressDate.set(key, list)
    }

    const rows = presses.map((press) => {
      const blocks: PlacedBlock[] = []

      for (const day of press.days) {
        const index = dayIndex.get(day.date)
        if (index === undefined || day.shifts <= 0) continue
        const base = index * dayWidth - shiftStartMinute
        const timeline = buildDayTimeline(shiftStartMinute, shiftMinutes, day.shifts, stops)

        for (const stop of timeline.stops) {
          blocks.push({
            kind: 'stop',
            press: press.name,
            hall: press.hall,
            date: day.date,
            start: base + stop.start,
            end: base + stop.end,
            title: `${stop.name} · ${clockLabel(stop.start)}–${clockLabel(stop.end)}`,
          })
        }

        for (const job of jobsByPressDate.get(`${press.name}|${day.date}`) ?? []) {
          const spans: [BlockKind, number, number][] = [
            ['setup', job.setupStartMinute, job.setupEndMinute],
            ['quality', job.setupEndMinute, job.qualityEndMinute],
            ['run', job.qualityEndMinute, job.endMinute],
          ]
          for (const [kind, from, to] of spans) {
            for (const seg of netIntervalToClockBlocks(from, to, timeline)) {
              blocks.push({
                kind,
                press: press.name,
                hall: press.hall,
                date: day.date,
                start: base + seg.start,
                end: base + seg.end,
                label: kind === 'run' ? job.material : undefined,
                title:
                  `${job.material} · ${COLORS[kind].label} · ` +
                  `${clockLabel(seg.start)}–${clockLabel(seg.end)}` +
                  ` · ${job.quantity.toLocaleString('en-GB')} pcs` +
                  (job.late ? ' · LATE' : ''),
              })
            }
          }
        }
      }

      blocks.sort((a, b) => a.start - b.start)
      return { press, blocks }
    })

    // Two setups overlapping in the same hall means the crane is double
    // booked — a planning error the chart must show rather than smooth over.
    const setups = rows.flatMap((r) => r.blocks.filter((b) => b.kind === 'setup'))
    const clashKeys = new Set<string>()
    for (let i = 0; i < setups.length; i++) {
      for (let j = i + 1; j < setups.length; j++) {
        const a = setups[i]
        const b = setups[j]
        if (a.hall !== b.hall || a.press === b.press) continue
        if (a.start < b.end && b.start < a.end) {
          clashKeys.add(`${a.press}|${a.start}`)
          clashKeys.add(`${b.press}|${b.start}`)
        }
      }
    }

    return { rows, dayWidth, totalWidth: dates.length * dayWidth, clashKeys }
  }, [dates, presses, jobs, stops, shiftStartMinute, shiftMinutes])

  const byCategory = useMemo(() => {
    const map = new Map<string, typeof rows>()
    for (const row of rows) {
      const key = row.press.category?.trim() || 'Uncategorised'
      const list = map.get(key) ?? []
      list.push(row)
      map.set(key, list)
    }
    return Array.from(map.entries()).sort((a, b) => {
      // Keep the catch-all last; it is where setup work is still needed.
      if (a[0] === 'Uncategorised') return 1
      if (b[0] === 'Uncategorised') return -1
      return a[0].localeCompare(b[0])
    })
  }, [rows])

  if (rows.length === 0 || dates.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Nothing to show for this week.
      </p>
    )
  }

  const pct = (x: number) => (x / totalWidth) * 100

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border px-4 py-2.5">
        {(Object.keys(COLORS) as BlockKind[]).map((kind) => (
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
            Setup overlap in the same hall
          </span>
        )}
      </div>

      <p className="px-4 pt-2 text-[11px] text-muted-foreground lg:hidden">
        Scroll sideways to see the whole week.
      </p>
      <div className="overflow-x-auto">
        <div className="min-w-[900px] px-4 py-3">
          <div className="relative mb-1 h-5" style={{ marginLeft: LABEL_WIDTH }}>
            {dates.map((date, i) => (
              <span
                key={date}
                className="absolute text-[11px] font-medium text-muted-foreground"
                style={{ left: `${pct(i * dayWidth)}%`, width: `${pct(dayWidth)}%` }}
              >
                {dayLabel(date)}
              </span>
            ))}
          </div>

          {byCategory.map(([category, catRows]) => (
            <div key={category} className="mb-3 last:mb-0">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {category}
              </p>
              {catRows.map(({ press, blocks }) => (
                <div key={press.name} className="flex items-center">
                  <span
                    className="shrink-0 truncate pr-2 text-xs font-medium text-foreground"
                    style={{ width: LABEL_WIDTH }}
                    title={`${press.name} · ${press.hall}`}
                  >
                    {press.name}
                  </span>
                  <div
                    className="relative flex-1 rounded border border-border bg-muted/30"
                    style={{ height: ROW_HEIGHT }}
                  >
                    {dates.map((date, i) => (
                      <span
                        key={date}
                        className="absolute top-0 h-full w-px bg-border"
                        style={{ left: `${pct(i * dayWidth)}%` }}
                        title={date}
                      />
                    ))}

                    {blocks.map((b, idx) => {
                      const id = `${press.name}-${idx}`
                      const width = Math.max(0.05, pct(b.end) - pct(b.start))
                      const clashing =
                        b.kind === 'setup' && clashKeys.has(`${b.press}|${b.start}`)
                      return (
                        <div
                          key={id}
                          title={b.title}
                          onMouseEnter={() => setHovered(id)}
                          onMouseLeave={() => setHovered(null)}
                          className={`absolute top-1 flex items-center overflow-hidden rounded-sm px-0.5 text-[9px] font-medium text-white ${
                            clashing ? 'ring-2 ring-dashed ring-red-600' : ''
                          } ${hovered && hovered !== id ? 'opacity-70' : ''}`}
                          style={{
                            left: `${pct(b.start)}%`,
                            width: `${width}%`,
                            height: ROW_HEIGHT - 8,
                            backgroundColor: COLORS[b.kind].fill,
                          }}
                        >
                          {width > 3 && b.label && <span className="truncate">{b.label}</span>}
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
