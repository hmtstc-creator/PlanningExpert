import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

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
  // Bakım kategorik paletten renk almıyor: nötr gri + çapraz tarama. Presin
  // kapalı olması bir üretim türü değil, üretimin yokluğudur; renkli olsaydı
  // grafikte bir iş gibi okunurdu.
  maintenance: { fill: '#475569', label: 'Press maintenance' },
  other: { fill: '#475569', label: 'Other stop' },
  // Boş pres: renk değil, kesikli çerçeve — üzerine gelince nedeni yazar.
  idle: { fill: 'transparent', label: 'Idle (hover for why)' },
} as const

type BlockKind = keyof typeof COLORS

/** Handover is the start-of-shift meeting; tea and meals are the breaks. */
/**
 * Setup çay ve yemek molasında durmaz (setup ekibi endirekt): moladan önce
 * ve sonraki parçaları tek çubuk olur, molada biten setup molanın içine
 * uzar. Böylece grafikte setup'ın gerçek süresi görünür.
 */
function setupThroughBreaks(
  blocks: { start: number; end: number }[],
  stops: { start: number; end: number; kind: string }[],
  nominal: number | undefined,
): { start: number; end: number }[] {
  const through = stops.filter((st) => st.kind === 'tea' || st.kind === 'meal' || st.kind === 'break')
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5
  const merged: { start: number; end: number }[] = []
  for (const b of blocks) {
    const prev = merged[merged.length - 1]
    if (prev && through.some((st) => near(st.start, prev.end) && near(st.end, b.start))) prev.end = b.end
    else merged.push({ ...b })
  }
  const last = merged[merged.length - 1]
  if (last && nominal !== undefined) {
    const drawn = merged.reduce((sum, b) => sum + b.end - b.start, 0)
    const stop = through.find((st) => near(st.start, last.end))
    if (stop && drawn < nominal - 0.5) last.end = Math.min(stop.end, last.end + (nominal - drawn))
  }
  return merged
}

function kindOfStop(stopKind: string): BlockKind {
  if (stopKind === 'handover') return 'meeting'
  if (stopKind === 'tea' || stopKind === 'meal') return 'stop'
  return 'other'
}

/** Zoom steps in pixels per hour. */
const ZOOM_STEPS = [3, 5, 8, 14, 24, 40, 70, 120] as const
const DEFAULT_ZOOM = 4

export interface WeekGanttSegment {
  kind: 'setup' | 'quality' | 'run' | 'coil' | 'maintenance'
  /**
   * The segment's own day. A job is not confined to one day: production that
   * does not fit before the shift closes continues the next morning, so each
   * piece is drawn against the day it actually runs on, not the day the job
   * started.
   */
  date: string
  start: number
  end: number
}

export interface WeekGanttJob {
  /** The day the job starts; `segments` may reach beyond it. */
  date: string
  press: string
  material: string
  quantity: number
  late: boolean
  /**
   * Dondurulmuş ufuktan gelen taahhüt: yeniden hesaplanmadı, onaylı plandan
   * olduğu gibi çizilir. Planlamacı neye dokunamayacağını görmeli.
   */
  frozen?: boolean
  setupStartMinute: number
  /** Setup'ın saat olarak süresi (çay/yemek molasında durmaz). */
  setupMinutes?: number
  endMinute: number
  /** Setup → approval → production → coil change → production … */
  segments: WeekGanttSegment[]
  /** Pres bu işten önce boş kaldıysa nedeni (motordan). */
  waitReason?: string
  /** Setup bakiye/geç iş kuralıyla başka bir setup'la çakışabildi. */
  urgentSetup?: boolean
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
  /**
   * Şu an: üretim günü ve o gün içindeki dakika. Grafikte dikey bir çizgi
   * olarak çizilir — planlamacı sahanın nerede olduğunu görmeden hangi işin
   * geçtiğini, hangisinin sırada olduğunu okuyamaz.
   */
  now?: { date: string; clockMinute: number }
}

interface PlacedBlock extends Segment {
  kind: BlockKind
  press: string
  hall: string
  label?: string
  /** Shown instead of `label` when the block is wide enough for it. */
  longLabel?: string
  title: string
  /** Frozen work is drawn hatched so it reads as "not up for replanning". */
  frozen?: boolean
  /** The job this block belongs to, and whether it is the job's first block. */
  job?: WeekGanttJob
  firstOfJob?: boolean
}

/** Bir işin o günkü tek çubuğu. */
interface Bar {
  job: WeekGanttJob
  start: number
  end: number
  maintenance: boolean
  /** Setup ve onay — çubuğun renkli başı. */
  phases: PlacedBlock[]
  /** Rulo değişimleri — ince dikiş. */
  coils: PlacedBlock[]
  /** Çubuğun içine düşen molalar — küçük nokta. */
  breaks: PlacedBlock[]
  label: string
  title: string
}

const ROW_HEIGHT = 32
const LABEL_WIDTH = 96
/** Gün adları ve saat çentiklerinin şeridi. */
const HEADER_HEIGHT = 32
/** Kategori başlığı satırı — iki sütunda da aynı olmalı, yoksa hiza kayar. */
const CATEGORY_HEIGHT = 20

function clockLabel(minute: number): string {
  const wrapped = ((minute % 1440) + 1440) % 1440
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(
    Math.round(wrapped % 60),
  ).padStart(2, '0')}`
}

/** ISO haftası ve Pazartesisi — çok haftalı grafikte hafta düğmeleri için. */
function weekOf(date: string): { key: string; label: string } {
  const d = new Date(`${date}T00:00:00`)
  const monday = new Date(d)
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  const thursday = new Date(monday)
  thursday.setDate(monday.getDate() + 3)
  const firstThursday = new Date(thursday.getFullYear(), 0, 4)
  firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3)
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
  const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
  return { key, label: `W${week}` }
}

/** Başlıktaki gün etiketi: tarih ve ay; haftanın ilk günü hafta numarasıyla. */
function headerLabel(date: string, first: boolean): string {
  const d = new Date(`${date}T00:00:00`)
  const text = d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
  return d.getDay() === 1 || first ? `${weekOf(date).label} · ${text}` : text
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
  now,
}: Props) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [dayFilter, setDayFilter] = useState<string | null>(null)
  const [weekFilter, setWeekFilter] = useState<string | null>(null)

  // Birden fazla haftalık grafik: önce hafta seçilir, sonra o haftanın günü.
  const weekList = useMemo(() => {
    const map = new Map<string, { key: string; label: string; dates: string[] }>()
    for (const d of dates) {
      const w = weekOf(d)
      const entry = map.get(w.key) ?? { ...w, dates: [] }
      entry.dates.push(d)
      map.set(w.key, entry)
    }
    return Array.from(map.values())
  }, [dates])
  const multiWeek = weekList.length > 1
  const selectedWeek = weekList.find((w) => w.key === weekFilter) ?? null

  const visibleDates = useMemo(() => {
    if (dayFilter && dates.includes(dayFilter)) return [dayFilter]
    if (selectedWeek) return selectedWeek.dates
    return dates
  }, [dates, dayFilter, selectedWeek])
  const dayButtons = multiWeek ? (selectedWeek?.dates ?? []) : dates

  const pxPerHour = ZOOM_STEPS[zoom]
  const pxPerMinute = pxPerHour / 60

  const { rows, dayWidthMinutes, clashKeys } = useMemo(() => {
    const maxShifts = Math.max(1, ...presses.flatMap((p) => p.days.map((d) => d.shifts)))
    const dayWidthMinutes = maxShifts * shiftMinutes
    const dayIndex = new Map(visibleDates.map((d, i) => [d, i]))

    // Parçalar kendi günlerine göre dağıtılır — işin başladığı güne değil.
    const spansByPressDate = new Map<
      string,
      { job: WeekGanttJob; span: WeekGanttSegment }[]
    >()
    for (const job of jobs) {
      for (const span of job.segments) {
        const key = `${job.press}|${span.date || job.date}`
        const list = spansByPressDate.get(key) ?? []
        list.push({ job, span })
        spansByPressDate.set(key, list)
      }
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

        for (const { job, span } of spansByPressDate.get(`${press.name}|${day.date}`) ?? []) {
          const kind = span.kind as BlockKind
          // A piece that carries on from the previous day is marked so the
          // planner does not read it as a second setup for the same part.
          const carriedOver = (span.date || job.date) !== job.date
          const firstSpan = span === job.segments[0]
          const clockBlocks = netIntervalToClockBlocks(span.start, span.end, timeline)
          const drawnBlocks =
            kind === 'setup' ? setupThroughBreaks(clockBlocks, timeline.stops, job.setupMinutes) : clockBlocks
          for (const [segIndex, seg] of drawnBlocks.entries()) {
            blocks.push({
              job,
              firstOfJob: firstSpan && segIndex === 0,
              kind,
              press: press.name,
              hall: press.hall,
              frozen: job.frozen,
              start: base + seg.start,
              end: base + seg.end,
              label: kind === 'coil' ? undefined : job.material,
              // The quantity the setup is being made for is the first thing
              // a planner needs off the bar; it shows as soon as there is
              // room for it.
              longLabel:
                kind === 'coil'
                  ? undefined
                  : kind === 'maintenance'
                    ? job.material
                    : `${job.material} (${job.quantity.toLocaleString('en-GB')})${
                        carriedOver ? ' ↻' : ''
                      }`,
              title:
                `${job.material} · ${COLORS[kind].label} · ` +
                `${clockLabel(seg.start)}–${clockLabel(seg.end)}` +
                (kind === 'maintenance'
                  ? ''
                  : ` · ${job.quantity.toLocaleString('en-GB')} pcs`) +
                (carriedOver ? ` · continued from ${job.date}` : '') +
                (job.frozen ? ' · FROZEN (from the approved plan)' : '') +
                (job.late ? ' · LATE' : ''),
            })
          }
        }
      }

      blocks.sort((a, b) => a.start - b.start)

      // Boşluklar: iki iş arasında pres çalışma saatindeyken boş kaldıysa,
      // sonraki işin bekleme nedeniyle birlikte çizilir. Mola, gece ve
      // geçmiş saatler boşluk sayılmaz.
      const windows = press.days
        .filter((d) => d.shifts > 0 && dayIndex.has(d.date))
        .map((d) => {
          const start = dayIndex.get(d.date)! * dayWidthMinutes
          return { start, end: start + d.shifts * shiftMinutes }
        })
      const nowIndex = now ? visibleDates.indexOf(now.date) : -1
      const nowAt =
        now && nowIndex >= 0 ? nowIndex * dayWidthMinutes + (now.clockMinute - shiftStartMinute) : null
      const stopsOnRow = blocks.filter(
        (b) => b.kind === 'stop' || b.kind === 'meeting' || b.kind === 'other',
      )
      const work = blocks.filter((b) => b.job)
      const idle: PlacedBlock[] = []
      let prevEnd: number | null = null
      for (const next of work) {
        if (next.firstOfJob && next.job && (prevEnd !== null || next.job.waitReason)) {
          for (const w of windows) {
            let from = Math.max(w.start, prevEnd ?? w.start, nowAt ?? Number.NEGATIVE_INFINITY)
            const to = Math.min(w.end, next.start)
            if (to - from < 10) continue
            // Molaları çıkar: boşluk molaların arasındaki parçalardır.
            const pieces: [number, number][] = []
            for (const st of stopsOnRow) {
              if (st.end <= from || st.start >= to) continue
              if (st.start > from) pieces.push([from, st.start])
              from = Math.max(from, st.end)
            }
            if (to > from) pieces.push([from, to])
            for (const [a, b] of pieces) {
              if (b - a < 10) continue
              idle.push({
                kind: 'idle',
                press: press.name,
                hall: press.hall,
                start: a,
                end: b,
                title:
                  `Idle ${Math.round(b - a)} min before ${next.job.material} — ` +
                  (next.job.waitReason ?? 'no reason recorded (recalculate the plan)'),
              })
            }
          }
        }
        prevEnd = Math.max(prevEnd ?? Number.NEGATIVE_INFINITY, next.end)
      }
      blocks.push(...idle)
      blocks.sort((a, b) => a.start - b.start)

      // ---- Sunum: her iş tek çubuk -------------------------------------
      // Molalar çubuğu bölmez: çubuğun içinde küçük bir nokta olur. Rulo
      // değişimi ince bir dikiş, setup ve onay çubuğun başındaki renkli
      // kısımdır. Ayrıntılar üzerine gelince okunur.
      const dayOf = (pos: number) => Math.floor(pos / dayWidthMinutes)
      const toClock = (pos: number) =>
        clockLabel(pos - dayOf(pos) * dayWidthMinutes + shiftStartMinute)
      const groups = new Map<string, { job: WeekGanttJob; parts: PlacedBlock[] }>()
      const jobIds = new Map<WeekGanttJob, number>()
      for (const b of blocks) {
        if (!b.job || b.kind === 'idle') continue
        if (!jobIds.has(b.job)) jobIds.set(b.job, jobIds.size)
        const key = `${jobIds.get(b.job)}|${dayOf(b.start)}`
        const group = groups.get(key) ?? { job: b.job, parts: [] }
        group.parts.push(b)
        groups.set(key, group)
      }
      const bars: Bar[] = []
      for (const { job, parts } of groups.values()) {
        const start = Math.min(...parts.map((p) => p.start))
        const end = Math.max(...parts.map((p) => p.end))
        const maintenanceBar = parts.every((p) => p.kind === 'maintenance')
        const carriedOver = parts.some((p) => p.longLabel?.endsWith('↻'))
        const setupMin = parts.filter((p) => p.kind === 'setup').reduce((s, p) => s + p.end - p.start, 0)
        const coilCount = parts.filter((p) => p.kind === 'coil').length
        bars.push({
          job,
          start,
          end,
          maintenance: maintenanceBar,
          phases: parts.filter((p) => p.kind === 'setup' || p.kind === 'quality'),
          coils: parts.filter((p) => p.kind === 'coil'),
          breaks: stopsOnRow.filter((st) => st.start >= start && st.end <= end),
          label: maintenanceBar
            ? job.material
            : `${job.material} · ${job.quantity.toLocaleString('en-GB')}${carriedOver ? ' ↻' : ''}`,
          title: maintenanceBar
            ? `${job.material} · ${toClock(start)}–${toClock(end)}`
            : [
                `${job.material} · ${job.quantity.toLocaleString('en-GB')} pcs`,
                `${toClock(start)}–${toClock(end)}`,
                setupMin > 0 ? `setup ${Math.round(setupMin)} min` : 'no setup (die already mounted)',
                coilCount > 0 ? `${coilCount} coil change${coilCount > 1 ? 's' : ''}` : '',
                carriedOver ? `continued from ${job.date}` : '',
                job.urgentSetup ? 'urgent: setup may overlap another' : '',
                job.frozen ? 'FROZEN (approved plan)' : '',
                job.late ? 'LATE — starts after the stock runs out' : '',
              ]
                .filter(Boolean)
                .join(' · '),
        })
      }
      // Pres boşken (çubuk dışında) molalar yalnızca soluk bir nokta.
      const looseBreaks = stopsOnRow.filter(
        (st) => !bars.some((bar) => st.start >= bar.start && st.end <= bar.end),
      )
      return { press, blocks, bars, idle, looseBreaks }
    })


    const setups = rows.flatMap((r) => r.blocks.filter((b) => b.kind === 'setup'))
    const clashKeys = new Set<string>()
    for (let i = 0; i < setups.length; i++) {
      for (let j = i + 1; j < setups.length; j++) {
        const a = setups[i]
        const b = setups[j]
        if (a.hall !== b.hall || a.press === b.press) continue
        // Bakiye/geç iş kuralıyla bilerek çakıştırılan setup hata değildir.
        if (a.job?.urgentSetup || b.job?.urgentSetup) continue
        if (a.start < b.end && b.start < a.end) {
          clashKeys.add(`${a.press}|${a.start}`)
          clashKeys.add(`${b.press}|${b.start}`)
        }
      }
    }

    return { rows, dayWidthMinutes, clashKeys }
  }, [visibleDates, presses, jobs, stops, shiftStartMinute, shiftMinutes, now])

  /**
   * "Şimdi" çizgisinin eksendeki yeri. Gün, gösterilen günler arasında
   * değilse çizgi çizilmez — dünün ya da gelecek haftanın grafiğine
   * bugünün saatini koymak yanlış olur.
   */
  const nowOffset = useMemo(() => {
    if (!now) return null
    const index = visibleDates.indexOf(now.date)
    if (index === -1) return null
    return index * dayWidthMinutes + (now.clockMinute - shiftStartMinute)
  }, [now, visibleDates, dayWidthMinutes, shiftStartMinute])

  // Açılışta (ve hafta/gün ya da yakınlık değişince) "şimdi" çizgisine kay:
  // uzun planda sayfa geçmiş günlerle açılmasın. Veri tazelenince kaydırma
  // bozulmasın diye yalnızca bu değişikliklerde yapılır.
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollX, setScrollX] = useState(0)
  const scrollKey = `${visibleDates[0]}|${visibleDates.length}|${zoom}`
  useEffect(() => {
    const el = scroller.current
    if (!el || nowOffset === null) return
    el.scrollLeft = Math.max(0, nowOffset * (ZOOM_STEPS[zoom] / 60) - 120)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey])

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
        <LegendItem swatch={<span className="inline-block h-3 w-4 rounded-sm" style={{ backgroundColor: COLORS.setup.fill }} />} label="Mould setup" />
        <LegendItem swatch={<span className="inline-block h-3 w-1.5 rounded-sm" style={{ backgroundColor: COLORS.quality.fill }} />} label="Quality approval" />
        <LegendItem swatch={<span className="inline-block h-3 w-4 rounded-sm" style={{ backgroundColor: COLORS.run.fill }} />} label="Production" />
        <LegendItem
          swatch={
            <span className="relative inline-block h-3 w-4 rounded-sm" style={{ backgroundColor: COLORS.run.fill }}>
              <span className="absolute inset-y-0 left-1/2 w-px bg-white/80" />
            </span>
          }
          label="Coil change"
        />
        <LegendItem
          swatch={
            <span className="relative inline-block h-3 w-4 rounded-sm" style={{ backgroundColor: COLORS.run.fill }}>
              <span className="absolute inset-x-1 bottom-[2px] h-[2px] rounded-full bg-white/85" />
            </span>
          }
          label="Break / handover"
        />
        {rows.some((r) => r.idle.length > 0) && (
          <LegendItem swatch={<span className="inline-block w-4 border-b-2 border-dashed border-amber-500" />} label="Idle — hover for why" />
        )}
        {usedKinds.has('maintenance') && (
          <LegendItem
            swatch={
              <span
                className="inline-block h-3 w-4 rounded-sm"
                style={{
                  backgroundColor: COLORS.maintenance.fill,
                  backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.45) 0 2px, transparent 2px 4px)',
                }}
              />
            }
            label="Press maintenance"
          />
        )}
        {jobs.some((j) => j.late) && (
          <LegendItem
            swatch={
              <span className="relative inline-block h-3 w-4 rounded-sm" style={{ backgroundColor: COLORS.run.fill }}>
                <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-red-600" />
              </span>
            }
            label="Late"
          />
        )}
        {jobs.some((j) => j.frozen) && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="inline-block h-3 w-3 rounded-sm bg-muted-foreground"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(45deg, rgba(255,255,255,0.5) 0 2px, transparent 2px 5px)',
              }}
            />
            Frozen (from the approved plan)
          </span>
        )}
        {nowOffset !== null && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-3 w-0.5 bg-red-600/80" />
            Now
          </span>
        )}
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
              setWeekFilter(null)
            }}
            className="ml-1 h-8 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted"
          >
            Reset
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => {
              setDayFilter(null)
              setWeekFilter(null)
            }}
            className={`h-8 rounded-md px-2 text-xs ${
              dayFilter === null && weekFilter === null
                ? 'bg-foreground text-background'
                : 'border border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            {multiWeek ? 'Whole plan' : 'Whole week'}
          </button>
          {multiWeek &&
            weekList.map((w) => (
              <button
                key={w.key}
                onClick={() => {
                  setWeekFilter(w.key)
                  setDayFilter(null)
                }}
                className={`h-8 rounded-md px-2 text-xs ${
                  weekFilter === w.key && dayFilter === null
                    ? 'bg-foreground text-background'
                    : weekFilter === w.key
                      ? 'border border-foreground text-foreground'
                      : 'border border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {w.label}
              </button>
            ))}
          {multiWeek && dayButtons.length > 0 && <span className="mx-1 h-5 w-px bg-border" aria-hidden />}
          {dayButtons.map((date) => (
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

      {/*
        Pres adı sütunu kaydırma alanının DIŞINDA.

        Önce her şey tek bir yatay kaydırma kutusundaydı ve adlar `sticky`
        ile solda tutuluyordu: kaydırınca ad kutusu grafiğin üstüne binip
        altındaki çubukları örtüyordu. Günün ilk saatlerindeki iş hiç
        görünmüyor, ilk saat etiketi de yarıdan kesiliyordu. Artık iki ayrı
        sütun var; hizanın bozulmaması için satır yükseklikleri iki tarafta
        da aynı sabitlerden geliyor.
      */}
      <div className="flex">
        <div
          className="relative z-10 shrink-0 border-r border-border bg-card"
          style={{ width: LABEL_WIDTH }}
        >
          <div className="py-3">
            {/* Grafikteki başlık şeridiyle aynı yükseklik. */}
            <div style={{ height: HEADER_HEIGHT }} />
            {byCategory.map(([category, catRows]) => (
              <div key={category} className="mt-2 first:mt-0">
                {/*
                  Kategori adı ad sütununa sığmaz ("Progressive 800 t" 96
                  piksele girmiyor) ve kısaltılırsa hangi grup olduğu
                  okunmaz. Taşmasına izin veriliyor: karşısındaki satır
                  grafikte boş bırakılmış bir ayraç, yani üstüne bindiği bir
                  şey yok.
                */}
                <p
                  className="mb-1 whitespace-nowrap pl-1 text-[11px] font-semibold uppercase leading-5 tracking-wide text-muted-foreground"
                  style={{ height: CATEGORY_HEIGHT }}
                >
                  {category}
                </p>
                {catRows.map(({ press }) => (
                  <div
                    key={press.name}
                    className="flex items-center"
                    style={{ height: ROW_HEIGHT }}
                  >
                    <span
                      className="truncate pl-1 pr-2 text-xs font-medium text-foreground"
                      title={`${press.name} · ${press.hall}`}
                    >
                      {press.name}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div
          ref={scroller}
          className="min-w-0 flex-1 overflow-x-auto"
          onScroll={(e) => setScrollX(e.currentTarget.scrollLeft)}
        >
          <div className="py-3" style={{ width: totalPx + 24 }}>
            <div className="relative" style={{ height: HEADER_HEIGHT, width: totalPx }}>
              {visibleDates.map((date, i) => (
                <Fragment key={date}>
                  {/* Gün etiketi, kaydırınca günün görünen kısmının soluna kayar:
                      yarım kalan günün tarihi de okunur. */}
                  <span
                    className="absolute top-0 truncate bg-card px-1 text-[11px] font-medium text-foreground"
                    style={{
                      left: Math.min(
                        Math.max(px(i * dayWidthMinutes), scrollX),
                        px((i + 1) * dayWidthMinutes) - 180,
                      ),
                      maxWidth: px(dayWidthMinutes) - 6,
                    }}
                  >
                    {headerLabel(date, i === 0)} · starts {clockLabel(shiftStartMinute)}
                  </span>
                  {tickHours > 0 &&
                    Array.from(
                      { length: Math.floor(dayWidthMinutes / 60 / tickHours) + 1 },
                      (_, t) => t * tickHours * 60,
                    ).map((offset) => {
                      // Ortalanan ilk etiket kaydırma kutusunun sol kenarında
                      // yarıya kesilirdi; o yüzden sola dayanıyor.
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

            {byCategory.map(([category, catRows]) => (
              <div key={category} className="mt-2 first:mt-0">
                {/* Soldaki kategori başlığının karşılığı — hiza için. */}
                <div className="mb-1" style={{ height: CATEGORY_HEIGHT }} />
                {catRows.map(({ press, bars, idle, looseBreaks }) => (
                  <div
                    key={press.name}
                    className="flex items-center"
                    style={{ height: ROW_HEIGHT }}
                  >
                    <div className="relative rounded-md bg-muted/25" style={{ height: ROW_HEIGHT - 4, width: totalPx }}>
                      {visibleDates.map((date, i) => (
                        <span
                          key={date}
                          className="absolute top-0 h-full w-px bg-border/70"
                          style={{ left: px(i * dayWidthMinutes) }}
                          title={date}
                        />
                      ))}

                      {nowOffset !== null && (
                        <span
                          className="pointer-events-none absolute -top-0.5 z-20 h-[calc(100%+4px)] w-0.5 rounded bg-red-600/80"
                          style={{ left: px(nowOffset) }}
                          title="Now"
                        />
                      )}

                      {/* Boş pres: ince kesikli alt çizgi; nedeni üzerine gelince. */}
                      {idle.map((b, idx) => (
                        <div
                          key={`idle-${idx}`}
                          title={b.title}
                          className="absolute bottom-0 top-0 cursor-help"
                          style={{ left: px(b.start), width: Math.max(2, px(b.end - b.start)) }}
                        >
                          <span className="absolute inset-x-0 bottom-1 border-b-2 border-dashed border-amber-500/80" />
                        </div>
                      ))}

                      {/* Pres boşken düşen molalar: soluk nokta. */}
                      {looseBreaks.map((b, idx) => (
                        <span
                          key={`lb-${idx}`}
                          title={b.title}
                          className="absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/35"
                          style={{ left: px((b.start + b.end) / 2) }}
                        />
                      ))}

                      {bars.map((bar, idx) => {
                        const width = Math.max(2, px(bar.end - bar.start))
                        const local = (x: number) => px(x - bar.start)
                        return (
                          <div
                            key={`bar-${idx}`}
                            title={bar.title}
                            className="absolute top-1 overflow-hidden rounded-md shadow-sm"
                            style={{
                              left: px(bar.start),
                              width,
                              height: ROW_HEIGHT - 12,
                              backgroundColor: bar.maintenance ? COLORS.maintenance.fill : COLORS.run.fill,
                              backgroundImage: bar.maintenance
                                ? 'repeating-linear-gradient(45deg, rgba(255,255,255,0.45) 0 4px, transparent 4px 8px)'
                                : bar.job.frozen
                                  ? 'repeating-linear-gradient(45deg, rgba(255,255,255,0.3) 0 3px, transparent 3px 7px)'
                                  : undefined,
                            }}
                          >
                            {bar.phases.map((ph, i) => {
                              const clashing = ph.kind === 'setup' && clashKeys.has(`${ph.press}|${ph.start}`)
                              return (
                                <span
                                  key={`ph-${i}`}
                                  title={ph.title}
                                  className={`absolute inset-y-0 ${clashing ? 'ring-2 ring-inset ring-red-600' : ''}`}
                                  style={{
                                    left: local(ph.start),
                                    width: Math.max(1, px(ph.end - ph.start)),
                                    backgroundColor: COLORS[ph.kind].fill,
                                  }}
                                />
                              )
                            })}
                            {bar.coils.map((c, i) => (
                              <span
                                key={`c-${i}`}
                                title={c.title}
                                className="absolute inset-y-0 -translate-x-1/2 px-[3px]"
                                style={{ left: local((c.start + c.end) / 2) }}
                              >
                                <span className="block h-full w-px bg-white/75" />
                              </span>
                            ))}
                            {bar.breaks.map((b, i) => (
                              <span
                                key={`b-${i}`}
                                title={b.title}
                                className="absolute bottom-0 h-2"
                                style={{ left: local(b.start), width: Math.max(4, px(b.end - b.start)) }}
                              >
                                <span className="absolute inset-x-0 bottom-[3px] h-[2px] rounded-full bg-white/80" />
                              </span>
                            ))}
                            {bar.job.late && (
                              <span
                                title="Late — starts after the stock runs out"
                                className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-600 ring-1 ring-white/80"
                              />
                            )}
                            {width > 40 && (
                              <span
                                className="pointer-events-none absolute inset-y-0 left-1.5 flex max-w-[calc(100%-12px)] items-center truncate text-[10px] font-medium text-white"
                                style={{ textShadow: '0 1px 1px rgba(0,0,0,0.35)' }}
                              >
                                {width > 110 ? bar.label : bar.job.material}
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
    </div>
  )
}

function LegendItem({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {swatch}
      {label}
    </span>
  )
}
