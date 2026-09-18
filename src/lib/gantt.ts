// Turns the scheduler's output into wall-clock blocks for the Gantt chart.
//
// The scheduler works in NET production minutes: a shift's break is already
// subtracted from the day's capacity, so minute 450 of a 480-minute shift with
// a 30-minute break is the last productive minute. A chart showing real clock
// times has to put the break back in, which also means a job that runs across
// a break is drawn as two blocks with the break between them.

export type BlockKind = 'setup' | 'run' | 'break'

export interface GanttBlock {
  kind: BlockKind
  /** Minutes from midnight of the plan day; may exceed 1440 when shifts run past midnight. */
  startMinute: number
  endMinute: number
  material?: string
  press: string
}

export interface ShiftLayout {
  /** Clock minute the first shift starts (e.g. 480 = 08:00). */
  shiftStartMinute: number
  /** Nominal shift length in minutes. */
  shiftMinutes: number
  /** Planned stop per shift, already excluded from the scheduler's capacity. */
  breakMinutesPerShift: number
}

/** Productive minutes in one shift. */
export function netShiftMinutes(layout: ShiftLayout): number {
  return Math.max(1, layout.shiftMinutes - layout.breakMinutesPerShift)
}

/**
 * Maps a net production minute onto the clock, skipping over breaks.
 * Net minute 0 is the start of shift 1.
 */
export function netMinuteToClock(net: number, layout: ShiftLayout): number {
  const perShift = netShiftMinutes(layout)
  const shiftIndex = Math.floor(net / perShift)
  const withinShift = net - shiftIndex * perShift
  return layout.shiftStartMinute + shiftIndex * layout.shiftMinutes + withinShift
}

/**
 * Splits a net-minute interval into clock-time blocks, breaking it wherever a
 * shift break falls in the middle. Returns at least one block for any
 * non-empty interval.
 */
export function toClockBlocks(
  netStart: number,
  netEnd: number,
  kind: BlockKind,
  layout: ShiftLayout,
  press: string,
  material?: string,
): GanttBlock[] {
  if (netEnd <= netStart) return []
  const perShift = netShiftMinutes(layout)
  const blocks: GanttBlock[] = []

  let cursor = netStart
  // Guard against pathological inputs producing an unbounded loop.
  for (let guard = 0; guard < 1000 && cursor < netEnd; guard++) {
    const shiftIndex = Math.floor(cursor / perShift)
    const shiftNetEnd = (shiftIndex + 1) * perShift
    const sliceEnd = Math.min(netEnd, shiftNetEnd)
    blocks.push({
      kind,
      startMinute: netMinuteToClock(cursor, layout),
      // A slice ending exactly on the shift boundary must not roll into the
      // next shift's start, so it is measured back from the slice length.
      endMinute: netMinuteToClock(cursor, layout) + (sliceEnd - cursor),
      material,
      press,
    })
    cursor = sliceEnd
  }
  return blocks
}

/**
 * The break blocks for a press on one day: one per shift boundary that the
 * day's capacity actually reaches.
 */
export function breakBlocks(
  capacityNetMinutes: number,
  layout: ShiftLayout,
  press: string,
): GanttBlock[] {
  if (layout.breakMinutesPerShift <= 0 || capacityNetMinutes <= 0) return []
  const perShift = netShiftMinutes(layout)
  const shifts = Math.ceil(capacityNetMinutes / perShift)
  const blocks: GanttBlock[] = []
  for (let i = 0; i < shifts; i++) {
    const start = layout.shiftStartMinute + i * layout.shiftMinutes + perShift
    blocks.push({
      kind: 'break',
      startMinute: start,
      endMinute: start + layout.breakMinutesPerShift,
      press,
    })
  }
  return blocks
}

export interface ScheduledLike {
  press: string
  material: string
  setupStartMinute: number
  setupEndMinute: number
  endMinute: number
}

/** All blocks for one press on one day, sorted by start time. */
export function pressDayBlocks(
  jobs: ScheduledLike[],
  capacityNetMinutes: number,
  layout: ShiftLayout,
  press: string,
): GanttBlock[] {
  const blocks: GanttBlock[] = []
  for (const job of jobs) {
    blocks.push(
      ...toClockBlocks(job.setupStartMinute, job.setupEndMinute, 'setup', layout, press, job.material),
    )
    blocks.push(
      ...toClockBlocks(job.setupEndMinute, job.endMinute, 'run', layout, press, job.material),
    )
  }
  blocks.push(...breakBlocks(capacityNetMinutes, layout, press))
  return blocks.sort((a, b) => a.startMinute - b.startMinute)
}

/**
 * Setups that overlap in time within the same hall. The crane can only serve
 * one setup at a time, so any overlap here is a planning error the chart must
 * make visible rather than hide.
 */
export function overlappingSetups(
  blocks: (GanttBlock & { hall: string })[],
): { hall: string; a: GanttBlock; b: GanttBlock }[] {
  const setups = blocks.filter((b) => b.kind === 'setup')
  const clashes: { hall: string; a: GanttBlock; b: GanttBlock }[] = []
  for (let i = 0; i < setups.length; i++) {
    for (let j = i + 1; j < setups.length; j++) {
      const a = setups[i]
      const b = setups[j]
      if (a.hall !== b.hall) continue
      if (a.press === b.press) continue
      if (a.startMinute < b.endMinute && b.startMinute < a.endMinute) {
        clashes.push({ hall: a.hall, a, b })
      }
    }
  }
  return clashes
}

/** Formats a clock minute (may exceed 1440) as HH:MM. */
export function formatClockMinute(minute: number): string {
  const wrapped = ((minute % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = Math.round(wrapped % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
