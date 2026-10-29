import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import {
  activeShiftList,
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
 * Grey is deliberately outside the categorical palette: a frequency stop (coil change …) is the
 * absence of production rather than another kind of it, and it must not
 * compete with the mould setup for attention. The five chromatic kinds were
 * validated together as a set.
 */
const COLORS = {
  setup: { fill: '#3b6fd4', label: 'Mould setup' },
  coil: { fill: '#94a3b8', label: 'Frequency stop' },
  quality: { fill: '#a259a8', label: 'Quality approval' },
  run: { fill: '#5aa97b', label: 'Production' },
  meeting: { fill: '#d1ad33', label: 'Meeting / handover' },
  stop: { fill: '#a8460f', label: 'Tea / meal break' },
  // Bakım kategorik paletten renk almıyor: nötr gri + çapraz tarama. Presin
  // kapalı olması bir üretim türü değil, üretimin yokluğudur; renkli olsaydı
  // grafikte bir iş gibi okunurdu.
  maintenance: { fill: '#475569', label: 'Work center maintenance' },
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

/** Araç çubuğu düğmeleri: planlamacının gözü önce buraya gitsin diye büyük. */
const TOOL_BUTTON = 'h-10 rounded-lg px-3.5 text-sm font-semibold shadow-sm transition-colors disabled:opacity-40'
const TOOL_IDLE = 'border border-border bg-background text-foreground hover:bg-muted'
const TOOL_ACTIVE = 'bg-foreground text-background'

/** Arama vurgusu: plandaki hiçbir türün rengi değil, uzaktan seçilsin. */
const SEARCH_FILL = '#ea580c'

/** Referans karşılaştırması: büyük/küçük harf ve boşluk fark etmez. */
function normalizeRef(text: string): string {
  return text.replace(/\s+/g, '').toUpperCase()
}

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
  /** Talep kovası: lotun kimliği (malzeme + kova) — adet değiştirmek için. */
  bucketLabel?: string
  /** Lot adedi planlamacı tarafından elle verildi (Plan overrides). */
  quantityFixed?: boolean
  /** Tek tek onaylanmış (kilitli) iş: dondurulmuş gibi çizilir ama tıklanır. */
  locked?: boolean
}

export interface WeekGanttDay {
  date: string
  /** Normal vardiya sayısı. */
  shifts: number
  /** Çalışan vardiya numaraları; yalnız 1'den art arda değilse (gün kaydı). */
  activeShifts?: number[]
  /** Açılan mesai pencereleri (üretim gününün saat ekseni). */
  overtime?: { start: number; end: number; name?: string }[]
  capacityMinutes: number
}

/** Günün çalışılan son dakikası (birinci vardiyanın başından). */
function daySpan(day: WeekGanttDay, shiftStartMinute: number, shiftMinutes: number): number {
  const ot = Math.max(0, ...(day.overtime ?? []).map((o) => o.end - shiftStartMinute))
  return Math.max(Math.max(0, ...activeShiftList(day)) * shiftMinutes, ot)
}

export interface WeekGanttPress {
  name: string
  hall: string
  category?: string
  /** Work center'ın frekansiyel duruşunun adı (ör. Coil setup). */
  frequencyStop?: string
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
  /**
   * İşe tıklanınca (adet, tek iş onayı, hariç tutma). Bakım ve tam plan
   * onayından dondurulmuş işler tıklanamaz; tek tek onaylanan işler tıklanır.
   */
  onJobClick?: (job: WeekGanttJob) => void
  /**
   * İş sürüklenip bırakılınca: hedef pres, gün ve işin başlayacağı saat
   * (5 dakikaya yuvarlı). Verilmezse sürükleme kapalıdır. Bakım ve tam plan
   * onayından dondurulmuş işler taşınmaz; tek tek onaylanan işler taşınır.
   */
  onJobMove?: (job: WeekGanttJob, target: GanttMoveTarget) => void
  /**
   * Boş pres aralığına (kesikli çizgi) tıklanınca: aralığın başladığı pres,
   * gün ve saat (5 dakikaya yukarı yuvarlı). Verilmezse aralık yalnız bilgidir.
   */
  onGapClick?: (target: GanttMoveTarget) => void
}

export interface GanttMoveTarget {
  press: string
  date: string
  /** Gece yarısından dakika (gece vardiyasında 1440'ı aşabilir). */
  clockMinute: number
}

/** Sürüklenen iş: fare hemen, dokunmatik basılı tutunca (kaydırmayla karışmasın) başlar. */
interface DragState {
  job: WeekGanttJob
  pointerId: number
  startX: number
  startY: number
  /** İmlecin çubuğun sol kenarına uzaklığı (px): iş çubuğun sol kenarının bırakıldığı yerde başlar. */
  grab: number
  width: number
  touch: boolean
  active: boolean
  timer?: ReturnType<typeof setTimeout>
  x: number
  y: number
  target: GanttMoveTarget | null
}

const LONG_PRESS_MS = 350

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
  onJobClick,
  onJobMove,
  onGapClick,
}: Props) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [dayFilter, setDayFilter] = useState<string | null>(null)
  const [weekFilter, setWeekFilter] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)

  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag
  const onJobMoveRef = useRef(onJobMove)
  onJobMoveRef.current = onJobMove
  // Bırakma noktası → pres / gün / saat; ölçüler aşağıda (her çizimde) bağlanır.
  const dropAtRef = useRef<(x: number, y: number, grab: number) => GanttMoveTarget | null>(() => null)
  // Sürüklemenin sonunda gelen tıklama iş penceresini açmasın.
  const suppressClick = useRef(false)
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d || e.pointerId !== d.pointerId) return
      const moved = Math.hypot(e.clientX - d.startX, e.clientY - d.startY)
      if (!d.active) {
        // Dokunmatikte basılı tutmadan kaydırılırsa sayfa kayar, iş değil.
        if (d.touch) {
          if (moved > 8) {
            clearTimeout(d.timer)
            setDrag(null)
          }
          return
        }
        if (moved < 5) return
      }
      setDrag({ ...d, active: true, x: e.clientX, y: e.clientY, target: dropAtRef.current(e.clientX, e.clientY, d.grab) })
    }
    const up = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d || e.pointerId !== d.pointerId) return
      clearTimeout(d.timer)
      setDrag(null)
      if (!d.active) return
      suppressClick.current = true
      setTimeout(() => (suppressClick.current = false), 0)
      const target = dropAtRef.current(e.clientX, e.clientY, d.grab)
      if (target) onJobMoveRef.current?.(d.job, target)
    }
    const cancel = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d || e.pointerId !== d.pointerId) return
      clearTimeout(d.timer)
      setDrag(null)
    }
    // Sürükleme başladıysa dokunmatik kaydırma durur.
    const block = (e: TouchEvent) => {
      if (dragRef.current?.active) e.preventDefault()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('touchmove', block, { passive: false })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('touchmove', block)
    }
  }, [dragging])
  const needle = normalizeRef(search)
  const isMatch = (job: WeekGanttJob) => needle !== '' && normalizeRef(job.material).includes(needle)

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
    // Gün genişliği: en uzun çalışılan gün (normal vardiyalar ya da mesai).
    const dayWidthMinutes = Math.max(
      shiftMinutes,
      ...presses.flatMap((p) => p.days.map((d) => daySpan(d, shiftStartMinute, shiftMinutes))),
    )
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
        if (index === undefined || (day.shifts <= 0 && !day.overtime?.length)) continue
        const base = index * dayWidthMinutes - shiftStartMinute
        const timeline = buildDayTimeline(shiftStartMinute, shiftMinutes, day, stops)

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
                `${job.material} · ${kind === 'coil' && press.frequencyStop ? press.frequencyStop : COLORS[kind].label} · ` +
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
        .filter((d) => dayIndex.has(d.date))
        .flatMap((d) => {
          const base = dayIndex.get(d.date)! * dayWidthMinutes
          const list = activeShiftList(d).map((n) => ({ start: base + (n - 1) * shiftMinutes, end: base + n * shiftMinutes }))
          for (const o of d.overtime ?? []) list.push({ start: base + o.start - shiftStartMinute, end: base + o.end - shiftStartMinute })
          return list
        })
        .sort((a, b) => a.start - b.start)
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
      // Çalışma pencereleri (bitişik vardiyalar tek pencere): çubuk bir
      // pencerenin dışına taşamaz. Kapalı bir vardiya (ör. gün kaydıyla
      // kapatılan 2. vardiya) iki pencere arasında boşluk bırakır; tek
      // çubuk çizilseydi plan o saatte çalışıyormuş gibi görünürdü
      // (planlamacı 2026-10-29).
      const spans: { start: number; end: number }[] = []
      for (const w of windows) {
        const last = spans[spans.length - 1]
        if (last && w.start <= last.end + 0.001) last.end = Math.max(last.end, w.end)
        else spans.push({ ...w })
      }
      const spanAt = (pos: number) => {
        const i = spans.findIndex((w) => pos >= w.start - 0.001 && pos < w.end)
        // Pencere dışında kalan parça (ör. bakım) kendi başına çizilir.
        return i < 0 ? `x${Math.round(pos)}` : i
      }
      const groups = new Map<string, { job: WeekGanttJob; parts: PlacedBlock[] }>()
      const jobIds = new Map<WeekGanttJob, number>()
      for (const b of blocks) {
        if (!b.job || b.kind === 'idle') continue
        if (!jobIds.has(b.job)) jobIds.set(b.job, jobIds.size)
        const key = `${jobIds.get(b.job)}|${dayOf(b.start)}|${spanAt(b.start)}`
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
            : `${job.material} · ${job.quantity.toLocaleString('en-GB')}${job.quantityFixed ? ' ✎' : ''}${job.locked ? ' ✓' : ''}${carriedOver ? ' ↻' : ''}`,
          title: maintenanceBar
            ? `${job.material} · ${toClock(start)}–${toClock(end)}`
            : [
                `${job.material} · ${job.quantity.toLocaleString('en-GB')} pcs`,
                `${toClock(start)}–${toClock(end)}`,
                setupMin > 0 ? `setup ${Math.round(setupMin)} min` : 'no setup (die already mounted)',
                coilCount > 0 ? `${coilCount} × ${(press.frequencyStop ?? 'frequency stop').toLowerCase()}` : '',
                carriedOver ? `continued from ${job.date}` : '',
                job.urgentSetup ? 'urgent: setup may overlap another' : '',
                job.quantityFixed ? 'quantity set by hand (Plan overrides)' : '',
                job.locked ? 'APPROVED — locked job' : job.frozen ? 'FROZEN (approved plan)' : '',
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

  // Aranan referansın görünen çubukları, plandaki sırasıyla. Önceki/sonraki
  // bunlar arasında gezer; gösterilen günlerin dışındaki işler ayrıca sayılır.
  const matches = useMemo(() => {
    if (!needle) return []
    return rows
      .flatMap((r) => r.bars.filter((b) => normalizeRef(b.job.material).includes(needle)).map((b) => ({ press: r.press.name, bar: b })))
      .sort((a, b) => a.bar.start - b.bar.start || a.press.localeCompare(b.press))
  }, [rows, needle])
  const matchedJobs = needle ? jobs.filter(isMatch) : []
  const hiddenJobs = matchedJobs.filter((j) => !matches.some((m) => m.bar.job === j)).length
  const matchedMaterials = Array.from(new Set(matchedJobs.map((j) => j.material)))
  const current = matches.length > 0 ? matches[Math.min(matchIndex, matches.length - 1)] : null

  const scrollToBar = (bar: Bar) => {
    const el = scroller.current
    if (!el) return
    const x = bar.start * (ZOOM_STEPS[zoom] / 60)
    el.scrollTo({ left: Math.max(0, x - 120), behavior: 'smooth' })
  }

  // Yeni bir referans yazılınca ilk eşleşmeye git.
  useEffect(() => {
    setMatchIndex(0)
    if (matches.length > 0) scrollToBar(matches[0].bar)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needle])

  const stepMatch = (dir: 1 | -1) => {
    if (matches.length === 0) return
    const next = (Math.min(matchIndex, matches.length - 1) + dir + matches.length) % matches.length
    setMatchIndex(next)
    scrollToBar(matches[next].bar)
  }

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

  dropAtRef.current = (x, y, grab) => {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-gantt-row]')
    const press = row?.dataset.ganttRow
    if (!row || !press) return null
    const minute = Math.max(0, (x - grab - row.getBoundingClientRect().left) / pxPerMinute)
    const index = Math.min(visibleDates.length - 1, Math.floor(minute / dayWidthMinutes))
    const clockMinute = Math.round((minute - index * dayWidthMinutes + shiftStartMinute) / 5) * 5
    return { press, date: visibleDates[index], clockMinute }
  }
  // Boşluğun başı → pres / gün / saat (şimdiden önceye düşmesin diye yukarı yuvarlı).
  const gapTarget = (press: string, minute: number): GanttMoveTarget => {
    const index = Math.min(visibleDates.length - 1, Math.floor(minute / dayWidthMinutes))
    const clockMinute = Math.ceil((minute - index * dayWidthMinutes + shiftStartMinute) / 5) * 5
    return { press, date: visibleDates[index], clockMinute }
  }
  const startDrag = (e: React.PointerEvent<HTMLElement>, job: WeekGanttJob) => {
    if (e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const touch = e.pointerType === 'touch'
    const d: DragState = {
      job,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      grab: e.clientX - rect.left,
      width: rect.width,
      touch,
      active: false,
      x: e.clientX,
      y: e.clientY,
      target: null,
    }
    if (touch) {
      d.timer = setTimeout(
        () =>
          setDrag((cur) =>
            cur && cur.pointerId === d.pointerId
              ? { ...cur, active: true, target: dropAtRef.current(cur.startX, cur.startY, cur.grab) }
              : cur,
          ),
        LONG_PRESS_MS,
      )
    }
    setDrag(d)
  }

  // Hour ticks only once they are far enough apart to read.
  const tickHours = pxPerHour >= 40 ? 1 : pxPerHour >= 20 ? 2 : pxPerHour >= 10 ? 4 : 0

  const usedKinds = new Set(rows.flatMap((r) => r.blocks.map((b) => b.kind)))

  return (
    <div className="rounded-lg border border-border bg-card">
      {drag?.active && (
        <div className="pointer-events-none fixed z-[90]" style={{ left: drag.x - drag.grab, top: drag.y - 14 }}>
          <div
            className="rounded-md opacity-75 shadow-lg ring-2 ring-foreground"
            style={{ width: Math.max(24, drag.width), height: ROW_HEIGHT - 12, backgroundColor: COLORS.run.fill }}
          />
          <div className="mt-1 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[11px] font-medium text-background shadow">
            {drag.job.material} →{' '}
            {drag.target ? `${drag.target.press} · ${dayLabel(drag.target.date)} ${clockLabel(drag.target.clockMinute)}` : 'drop on a work center row'}
          </div>
        </div>
      )}
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
          label="Frequency stop"
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
            label="Work center maintenance"
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
        {jobs.some((j) => j.quantityFixed) && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">✎</span>
            Quantity set by hand
          </span>
        )}
        {jobs.some((j) => j.locked) && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">✓</span>
            Approved job (locked)
          </span>
        )}
        {jobs.some((j) => j.frozen && !j.locked) && (
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
            className={`${TOOL_BUTTON} ${TOOL_IDLE} w-10 px-0 text-lg leading-none`}
          >
            −
          </button>
          <button
            onClick={() => setZoom((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))}
            disabled={zoom === ZOOM_STEPS.length - 1}
            aria-label="Zoom in"
            className={`${TOOL_BUTTON} ${TOOL_IDLE} w-10 px-0 text-lg leading-none`}
          >
            +
          </button>
          <button
            onClick={() => {
              setZoom(DEFAULT_ZOOM)
              setDayFilter(null)
              setWeekFilter(null)
            }}
            className={`${TOOL_BUTTON} ${TOOL_IDLE} ml-1`}
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
            className={`${TOOL_BUTTON} ${dayFilter === null && weekFilter === null ? TOOL_ACTIVE : TOOL_IDLE}`}
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
                className={`${TOOL_BUTTON} ${
                  weekFilter === w.key && dayFilter === null
                    ? TOOL_ACTIVE
                    : weekFilter === w.key
                      ? 'border-2 border-foreground bg-background text-foreground'
                      : TOOL_IDLE
                }`}
              >
                {w.label}
              </button>
            ))}
          {multiWeek && dayButtons.length > 0 && <span className="mx-1 h-6 w-px bg-border" aria-hidden />}
          {dayButtons.map((date) => (
            <button
              key={date}
              onClick={() => {
                setDayFilter(date)
                // One day on screen deserves a readable scale.
                setZoom((z) => Math.max(z, 5))
              }}
              className={`${TOOL_BUTTON} ${dayFilter === date ? TOOL_ACTIVE : TOOL_IDLE}`}
            >
              {dayLabel(date)}
            </button>
          ))}
        </div>

        {/* Referans arama: yazılan malzemenin çubukları turuncuya boyanır, diğerleri soluklaşır. */}
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <div className="relative">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  stepMatch(e.shiftKey ? -1 : 1)
                } else if (e.key === 'Escape') setSearch('')
              }}
              placeholder="Find reference…"
              aria-label="Find a reference in the plan"
              className={`h-10 w-56 rounded-lg border-2 bg-background px-3 text-sm font-medium text-foreground shadow-sm outline-none placeholder:font-normal placeholder:text-muted-foreground focus:border-[#ea580c] ${
                needle ? 'border-[#ea580c]' : 'border-border'
              }`}
            />
          </div>
          {needle && (
            <>
              <button
                onClick={() => stepMatch(-1)}
                disabled={matches.length === 0}
                aria-label="Previous match"
                className={`${TOOL_BUTTON} ${TOOL_IDLE} w-10 px-0`}
              >
                ‹
              </button>
              <button
                onClick={() => stepMatch(1)}
                disabled={matches.length === 0}
                aria-label="Next match"
                className={`${TOOL_BUTTON} ${TOOL_IDLE} w-10 px-0`}
              >
                ›
              </button>
              <span
                className={`text-sm font-medium tabular-nums ${matchedJobs.length === 0 ? 'text-destructive' : 'text-foreground'}`}
                title={matchedMaterials.join(', ')}
              >
                {matchedJobs.length === 0
                  ? 'Not in the plan'
                  : matches.length === 0
                    ? `${matchedJobs.length} job${matchedJobs.length === 1 ? '' : 's'} outside this view`
                    : `${Math.min(matchIndex, matches.length - 1) + 1} / ${matches.length}` +
                      (hiddenJobs > 0 ? ` · ${hiddenJobs} more outside this view` : '')}
              </span>
            </>
          )}
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
                {catRows.map(({ press, bars }) => (
                  <div
                    key={press.name}
                    className="flex items-center"
                    style={{ height: ROW_HEIGHT }}
                  >
                    <span
                      className={`truncate pl-1 pr-2 text-xs ${
                        needle && bars.some((b) => isMatch(b.job))
                          ? 'font-bold text-[#ea580c]'
                          : 'font-medium text-foreground'
                      }`}
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
                    <div data-gantt-row={press.name} className="relative rounded-md bg-muted/25" style={{ height: ROW_HEIGHT - 4, width: totalPx }}>
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

                      {/* Boş pres: ince kesikli alt çizgi; nedeni üzerine gelince, tıklayınca elle iş. */}
                      {idle.map((b, idx) => (
                        <div
                          key={`idle-${idx}`}
                          title={onGapClick ? `${b.title} · click to add a job here` : b.title}
                          {...(onGapClick && {
                            role: 'button',
                            tabIndex: 0,
                            onClick: () => onGapClick(gapTarget(b.press, b.start)),
                            onKeyDown: (e: React.KeyboardEvent) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                onGapClick(gapTarget(b.press, b.start))
                              }
                            },
                          })}
                          className={`absolute bottom-0 top-0 ${
                            onGapClick ? 'cursor-copy rounded-md hover:bg-sky-500/15' : 'cursor-help'
                          }`}
                          style={{ left: px(b.start), width: Math.max(onGapClick ? 12 : 2, px(b.end - b.start)) }}
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
                        const hit = isMatch(bar.job)
                        const focused = current?.bar === bar
                        const editable =
                          !!onJobClick && !bar.maintenance && (bar.job.locked || (!bar.job.frozen && !!bar.job.bucketLabel))
                        const movable = !!onJobMove && !bar.maintenance && (bar.job.locked || !bar.job.frozen)
                        const beingDragged = drag?.active && drag.job === bar.job
                        return (
                          <div
                            key={`bar-${idx}`}
                            title={
                              (editable ? `${bar.title} · click to change the quantity` : bar.title) +
                              (movable ? ' · drag to move (hold on touch)' : '')
                            }
                            {...(movable && { onPointerDown: (e: React.PointerEvent<HTMLElement>) => startDrag(e, bar.job) })}
                            {...(editable && {
                              role: 'button',
                              tabIndex: 0,
                              onClick: () => {
                                if (!suppressClick.current) onJobClick(bar.job)
                              },
                              onKeyDown: (e: React.KeyboardEvent) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  onJobClick(bar.job)
                                }
                              },
                            })}
                            className={`absolute top-1 overflow-hidden rounded-md shadow-sm transition-opacity ${
                              movable ? 'cursor-grab select-none [-webkit-touch-callout:none]' : ''
                            } ${
                              editable ? 'cursor-pointer hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground' : ''
                            } ${
                              focused
                                ? 'z-10 ring-[3px] ring-foreground ring-offset-1 ring-offset-card'
                                : hit
                                  ? 'z-10 ring-2 ring-[#ea580c] ring-offset-1 ring-offset-card'
                                  : ''
                            }`}
                            style={{
                              left: px(bar.start),
                              width,
                              height: ROW_HEIGHT - 12,
                              opacity: beingDragged ? 0.4 : needle && !hit ? 0.25 : 1,
                              backgroundColor: hit
                                ? SEARCH_FILL
                                : bar.maintenance
                                  ? COLORS.maintenance.fill
                                  : COLORS.run.fill,
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
