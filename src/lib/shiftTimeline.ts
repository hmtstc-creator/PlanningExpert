// Maps between the scheduler's net production minutes and real clock time,
// around explicitly defined planned stops.
//
// The scheduler counts only productive minutes. The shop floor runs on the
// clock and loses time to shift handovers, tea and meal breaks at fixed
// times. A single "break minutes per shift" number could not express that:
// it could only sit at one place in the shift. Stops are now real intervals,
// so the timeline is built by cutting them out of each shift window.

export interface PlannedStop {
  /** 1 = first shift, 2 = second, 3 = third. */
  shiftIndex: number
  name: string
  kind: string
  /** Clock minutes from midnight. */
  startMinute: number
  durationMinutes: number
}

export interface Segment {
  start: number
  end: number
}

export interface StopBlock extends Segment {
  name: string
  kind: string
  shiftIndex: number
}

export interface DayTimeline {
  /** Productive stretches in clock minutes, in order. */
  segments: Segment[]
  /** Stops actually falling inside the day's shifts, for drawing. */
  stops: StopBlock[]
  /** Clock minute each shift begins, in order. */
  shiftStarts: number[]
  /** Total productive minutes in the day. */
  netMinutes: number
}

/**
 * Clock window of one shift. Shifts run back to back from the first shift's
 * start, so shift 3 of an 08:00 start runs 00:00–08:00 the next day; the
 * window is expressed as minutes past midnight of the plan day and may
 * therefore exceed 1440.
 */
function shiftWindow(
  shiftIndex: number,
  shiftStartMinute: number,
  shiftMinutes: number,
): Segment {
  const start = shiftStartMinute + (shiftIndex - 1) * shiftMinutes
  return { start, end: start + shiftMinutes }
}

/**
 * A stop is entered as a clock time, which is ambiguous once shifts wrap past
 * midnight. It is resolved into the shift it was assigned to: the same
 * time-of-day, shifted by whole days until it lands inside that shift.
 */
function resolveStop(stop: PlannedStop, window: Segment): StopBlock | null {
  for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
    const start = stop.startMinute + dayOffset * 1440
    const end = start + stop.durationMinutes
    if (start >= window.start && start < window.end) {
      return {
        start,
        end: Math.min(end, window.end),
        name: stop.name,
        kind: stop.kind,
        shiftIndex: stop.shiftIndex,
      }
    }
  }
  return null
}

/** Removes the stop intervals from a shift window, leaving productive time. */
function cutStops(window: Segment, stops: StopBlock[]): Segment[] {
  const ordered = [...stops].sort((a, b) => a.start - b.start)
  const segments: Segment[] = []
  let cursor = window.start

  for (const stop of ordered) {
    if (stop.start > cursor) segments.push({ start: cursor, end: Math.min(stop.start, window.end) })
    cursor = Math.max(cursor, stop.end)
  }
  if (cursor < window.end) segments.push({ start: cursor, end: window.end })

  return segments.filter((s) => s.end > s.start)
}

export function buildDayTimeline(
  shiftStartMinute: number,
  shiftMinutes: number,
  shiftsToday: number,
  stops: PlannedStop[],
): DayTimeline {
  const segments: Segment[] = []
  const resolved: StopBlock[] = []
  const shiftStarts: number[] = []

  for (let i = 1; i <= shiftsToday; i++) {
    const window = shiftWindow(i, shiftStartMinute, shiftMinutes)
    shiftStarts.push(window.start)

    const inShift = stops
      .filter((s) => s.shiftIndex === i)
      .map((s) => resolveStop(s, window))
      .filter((s): s is StopBlock => s !== null)

    resolved.push(...inShift)
    segments.push(...cutStops(window, inShift))
  }

  return {
    segments,
    stops: resolved.sort((a, b) => a.start - b.start),
    shiftStarts,
    netMinutes: segments.reduce((sum, s) => sum + (s.end - s.start), 0),
  }
}

/** Net production minute → clock minute. */
export function netToClock(net: number, timeline: DayTimeline): number {
  let remaining = net
  for (const segment of timeline.segments) {
    const length = segment.end - segment.start
    if (remaining < length) return segment.start + remaining
    remaining -= length
  }
  // Past the end of the day: continue from the last segment's end.
  const last = timeline.segments[timeline.segments.length - 1]
  return last ? last.end + remaining : remaining
}

/** Clock minute → productive minutes elapsed. */
export function clockToNet(clock: number, timeline: DayTimeline): number {
  let net = 0
  for (const segment of timeline.segments) {
    if (clock <= segment.start) break
    net += Math.min(clock, segment.end) - segment.start
  }
  return net
}

/**
 * Splits a net-minute interval into clock blocks, cut wherever a stop falls
 * inside it. A job running across the meal break is drawn as two blocks with
 * the break between them, not straight through it.
 */
export function netIntervalToClockBlocks(
  netStart: number,
  netEnd: number,
  timeline: DayTimeline,
): Segment[] {
  if (netEnd <= netStart) return []
  const blocks: Segment[] = []
  let consumed = 0

  for (const segment of timeline.segments) {
    const length = segment.end - segment.start
    const segStartNet = consumed
    const segEndNet = consumed + length
    consumed = segEndNet

    const from = Math.max(netStart, segStartNet)
    const to = Math.min(netEnd, segEndNet)
    if (to <= from) continue

    blocks.push({
      start: segment.start + (from - segStartNet),
      end: segment.start + (to - segStartNet),
    })
    if (to >= netEnd) break
  }

  return blocks
}

/** Productive minutes lost to stops in one shift. */
export function stopMinutesInShift(shiftIndex: number, stops: PlannedStop[]): number {
  return stops
    .filter((s) => s.shiftIndex === shiftIndex)
    .reduce((sum, s) => sum + s.durationMinutes, 0)
}
