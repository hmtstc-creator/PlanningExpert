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
 * The layout is in pixels rather than percentages so that zooming means
 * something: at a week-wide fit a job is a sliver, and the planner cannot read
 * which coil to mount. Zooming in widens the minute, the labels appear, and
 * the strip scrolls; the press column stays pinned so the row is still
 * identifiable when scrolled far to the right.
 */
/**
 * Grey is deliberately outside the categorical palette: a coil change is the
 * absence of production rather than another kind of it, and it must not
 * compete with the mould setup for attention. The five chromatic kinds were
 * validated together as a set.
 */
const COLORS = {
  setup: { fill: '#3b6fd4', label: 'Mould setup' },
  coil: { fill: '#94a3b8', label: 'Coil change' },
  quality: { fill: '#a259a8', label: 'Quality approval' },
  run: { fill: '#5aa97b', label: 'Production' },
  meeting: { fill: '#d1ad33', label: 'Meeting / handover' },
  stop: { fill: '#a8460f', label: 'Tea / meal break' },
  other: { fill: '#475569', label: 'Other stop' },
} as const

type BlockKind = keyof typeof COLORS

/** Handover is the start-of-shift meeting; tea and meals are the breaks. */
function kindOfStop(stopKind: string): BlockKind {
  if (stopKind === 'handover') return 'meeting'
  if (stopKind === 'tea' || stopKind === 'meal') return 'stop'
  return 'other'
}

/** Zoom steps in pixels per hour. */
const ZOOM_STEPS = [3, 5, 8, 14, 24, 40, 70, 120] as const
const DEFAULT_ZOOM = 4

export interface WeekGanttSegment {
  kind: 'setup' | 'quality' | 'run' | 'coil'
  start: number
  end: number
}

export interface WeekGanttJob {
  date: string
  press: string
  material: string
  quantity: number
  late: boolean
  setupStartMinute: number
  endMinute: number
  /** Setup → approval → production → coil change → production … */
  segments: WeekGanttSegment[]
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
  label?: string
  /** Shown instead of `label` when the block is wide enough for it. */
  longLabel?: string
  title: string
}

const ROW_HEIGHT = 32
const LABEL_WIDTH = 96

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
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [dayFilter, setDayFilter] = useState<string | null>(null)

  const visibleDates = useMemo(
    () => (dayFilter && dates.includes(dayFilter) ? [dayFilter] : dates),
    [dates, dayFilter],
  )

  const pxPerHour = ZOOM_STEPS[zoom]
  const pxPerMinute = pxPerHour / 60

  const { rows, dayWidthMinutes, clashKeys } = useMemo(() => {
    const maxShifts = Math.max(1, ...presses.flatMap((p) => p.days.map((d) => d.shifts)))
    const dayWidthMinutes = maxShifts * shiftMinutes
    const dayIndex = new Map(visibleDates.map((d, i) => [d, i]))

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
        const base = index * dayWidthMinutes - shiftStartMinute
        const timeline = buildDayTimeline(shiftStartMinute, shiftMinutes, day.shifts, stops)

        for (const stop of timeline.stops) {
          blocks.push({
            kind: kindOfStop(stop.kind),
            press: press.name,
            hall: press.hall,
            start: base + stop.start,
            end: base + stop.end,
            label: stop.name,
            title: `${stop.name} · ${clockLabel(stop.start)}–${clockLabel(stop.end)}`,
          })
        }

        for (const job of jobsByPressDate.get(`${press.name}|${day.date}`) ?? []) {
          for (const span of job.segments) {
            const kind = span.kind as BlockKind
            for (const seg of netIntervalToClockBlocks(span.start, span.end, timeline)) {
              blocks.push({
                kind,
                press: press.name,
                hall: press.hall,
                start: base + seg.start,
                end: base + seg.end,
                label: kind === 'coil' ? undefined : job.material,
                // The quantity the setup is being made for is the first thing
                // a planner needs off the bar; it shows as soon as there is
                // room for it.
                longLabel:
                  kind === 'coil'
                    ? undefined
                    : `${job.material} (${job.quantity.toLocaleString('en-GB')})`,
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

    return { rows, dayWidthMinutes, clashKeys }
  }, [visibleDates, presses, jobs, stops, shiftStartMinute, shiftMinutes])

  const byCategory = useMemo(() => {
    const map = new Map<string, typeof rows>()
    for (const row of rows) {
      const key = row.press.category?.trim() || 'Uncategorised'
      const list = map.get(key) ?? []
      list.push(row)
      map.set(key, list)
    }
    return Array.from(map.entries()).sort((a, b) => {
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

  const totalMinutes = visibleDates.length * dayWidthMinutes
  const totalPx = Math.max(240, totalMinutes * pxPerMinute)
  const px = (minute: number) => minute * pxPerMinute

  // Hour ticks only once they are far enough apart to read.
  const tickHours = pxPerHour >= 40 ? 1 : pxPerHour >= 20 ? 2 : pxPerHour >= 10 ? 4 : 0

  const usedKinds = new Set(rows.flatMap((r) => r.blocks.map((b) => b.kind)))

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border px-3 py-2.5">
        {(Object.keys(COLORS) as BlockKind[])
          .filter((kind) => usedKinds.has(kind) || kind === 'setup' || kind === 'run')
          .map((kind) => (
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

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom((z) => Math.max(0, z - 1))}
            disabled={zoom === 0}
            aria-label="Zoom out"
            className="h-8 w-8 rounded-md border border-border text-base leading-none text-foreground hover:bg-muted disabled:opacity-40"
          >
            −
          </button>
          <button
            onClick={() => setZoom((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))}
            disabled={zoom === ZOOM_STEPS.length - 1}
            aria-label="Zoom in"
            className="h-8 w-8 rounded-md border border-border text-base leading-none text-foreground hover:bg-muted disabled:opacity-40"
          >
            +
          </button>
          <button
            onClick={() => {
              setZoom(DEFAULT_ZOOM)
              setDayFilter(null)
            }}
            className="ml-1 h-8 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted"
          >
            Reset
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => setDayFilter(null)}
            className={`h-8 rounded-md px-2 text-xs ${
              dayFilter === null
                ? 'bg-foreground text-background'
                : 'border border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            Whole week
          </button>
          {dates.map((date) => (
            <button
              key={date}
              onClick={() => {
                setDayFilter(date)
                // One day on screen deserves a readable scale.
                setZoom((z) => Math.max(z, 5))
              }}
              className={`h-8 rounded-md px-2 text-xs ${
                dayFilter === date
                  ? 'bg-foreground text-background'
                  : 'border border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {dayLabel(date)}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="py-3" style={{ width: LABEL_WIDTH + totalPx + 24 }}>
          <div className="flex">
            <div className="sticky left-0 z-20 shrink-0 bg-card" style={{ width: LABEL_WIDTH }} />
            <div className="relative h-8" style={{ width: totalPx }}>
              {visibleDates.map((date, i) => (
                <Fragment key={date}>
                  <span
                    className="absolute top-0 truncate text-[11px] font-medium text-foreground"
                    style={{ left: px(i * dayWidthMinutes) + 3, maxWidth: px(dayWidthMinutes) - 6 }}
                  >
                    {dayLabel(date)} · starts {clockLabel(shiftStartMinute)}
                  </span>
                  {tickHours > 0 &&
                    Array.from(
                      { length: Math.floor(dayWidthMinutes / 60 / tickHours) + 1 },
                      (_, t) => t * tickHours * 60,
                    ).map((offset) => {
                      // The first label of the first day would be cut in half
                      // by the pinned press column, so it is left-aligned.
                      const atStart = i === 0 && offset === 0
                      return (
                        <span
                          key={offset}
                          className={`absolute bottom-0 text-[10px] tabular-nums text-muted-foreground ${
                            atStart ? '' : '-translate-x-1/2'
                          }`}
                          style={{ left: px(i * dayWidthMinutes + offset) }}
                        >
                          {clockLabel(shiftStartMinute + offset)}
                        </span>
                      )
                    })}
                </Fragment>
              ))}
            </div>
          </div>

          {byCategory.map(([category, catRows]) => (
            <div key={category} className="mt-2 first:mt-0">
              <p className="sticky left-0 z-20 mb-1 bg-card pl-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {category}
              </p>
              {catRows.map(({ press, blocks }) => (
                <div key={press.name} className="flex items-center">
                  <span
                    className="sticky left-0 z-20 shrink-0 truncate bg-card pr-2 text-xs font-medium text-foreground"
                    style={{ width: LABEL_WIDTH }}
                    title={`${press.name} · ${press.hall}`}
                  >
                    {press.name}
                  </span>
                  <div
                    className="relative rounded border border-border bg-muted/30"
                    style={{ height: ROW_HEIGHT, width: totalPx }}
                  >
                    {visibleDates.map((date, i) => (
                      <span
                        key={date}
                        className="absolute top-0 h-full w-px bg-border"
                        style={{ left: px(i * dayWidthMinutes) }}
                        title={date}
                      />
                    ))}

                    {blocks.map((b, idx) => {
                      const id = `${press.name}-${idx}`
                      const width = Math.max(1, px(b.end - b.start))
                      const clashing =
                        b.kind === 'setup' && clashKeys.has(`${b.press}|${b.start}`)
                      return (
                        <div
                          key={id}
                          title={b.title}
                          className={`absolute top-1 flex items-center overflow-hidden rounded-sm px-0.5 text-[10px] font-medium text-white ${
                            clashing ? 'ring-2 ring-dashed ring-red-600' : ''
                          }`}
                          style={{
                            left: px(b.start),
                            width,
                            height: ROW_HEIGHT - 8,
                            backgroundColor: COLORS[b.kind].fill,
                          }}
                        >
                          {width > 34 && b.label && (
                            <span className="truncate">
                              {width > 96 && b.longLabel ? b.longLabel : b.label}
                            </span>
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
