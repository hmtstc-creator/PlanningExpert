import { describe, expect, it } from 'vitest'

import fixture from './oee.fixture.json'
import {
  SHORT_STOPS,
  SPEED,
  daysFromShifts,
  inScope,
  lossBreakdown,
  lossDayOf,
  parseOeeWorkbook,
  ratios,
  shortStopMinOf,
  sumTimes,
  type LossDay,
  type OeeConfig,
  type SheetRows,
} from './oee'
import { NOT_EXPLAINED, SHORT_STOPS_ROW, buildBridge, level3, type Bridge } from './oeeBridge'
import { fromStoredStops, stopDayOf } from './oeeReliability'
import { shortStopNote, shortStopTotals, splitShortStops } from './oeeShortStops'

// Gerçek kesit (ASAKAI dosyası): Progressive 21 Eylül vardiyaları ve duruşları.
const parsed = parseOeeWorkbook(fixture as unknown as Record<string, SheetRows>)
const allDays = daysFromShifts(parsed.shifts)
const allLoss = parsed.downtimes.map(lossDayOf)
const allStops = fromStoredStops(parsed.downtimes.map(stopDayOf))

const plant: OeeConfig = {
  areas: [{ name: 'PRS', pick: 'costCenter' }],
  costCenters: [
    { code: '51010171', name: 'Transfer', area: 'PRS' },
    { code: '51010173', name: 'Progressive', area: 'PRS' },
  ],
  shifts: [],
  lossReasonCodes: ['UNSCD_DOWN', '#'],
  breakReasonCodes: ['SCHED_DOWN'],
  lossGroups: [
    { code: 'KLP', label: 'Die breakdown', chart: 'Die', breakdown: true },
    { code: 'STP', label: 'Setup', chart: 'Setup', breakdown: false },
    { code: 'ARZ', label: 'Machine breakdown', chart: 'Machine', breakdown: true },
    { code: 'KSD', label: 'Short stoppages', chart: 'Short', breakdown: false },
    { code: 'KON', label: 'Quality', chart: 'Others', breakdown: false },
    { code: 'OFC', label: 'Logistic', chart: 'Others', breakdown: false },
    { code: 'YNT', label: 'Management', chart: 'Others', breakdown: false },
    { code: 'UTS', label: 'Breaks', chart: 'Others', breakdown: false },
    { code: '#', label: 'Undefined', chart: 'Undefined', breakdown: false, hidden: true },
  ],
  setupTexts: [],
  startupRunMin: 60,
  trendWeeks: 10,
  topN: 10,
}
const progressive = { area: 'PRS', key: '51010173' }
const day = '2026-09-21'
const pDays = allDays.filter((d) => d.date === day && inScope(d, progressive, plant))
const pLoss = allLoss.filter((l) => l.date === day && inScope(l, progressive, plant))
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

function expectCloses(b: Bridge) {
  let run: number | null = null
  for (const s of b.steps) {
    if (s.kind === 'total') {
      if (run !== null) expect(s.minutes, s.label).toBeCloseTo(run, 6)
      run = s.minutes
    } else run = (run ?? 0) - s.minutes
  }
}

describe('MES: Net Production Time yalnızca ≥ 2 dk plansız duruşları düşer', () => {
  // Plansız = SCHED_DOWN dışı (UNSCD_DOWN ve "#"). Bütün plansız duruşu kayıtlı (MES Unscheduled = kayıtlar) ve planlı duruşla
  // çakışmayan vardiyalarda Loading − Production = ≥ 2 dk duruşların toplamı.
  const clean = [
    ['PRS-104', 'UB65'],
    ['PRS-104', 'UB66'],
    ['PRS-105', 'UB64'],
    ['PRS-105', 'UB65'],
    ['PRS-105', 'UB66'],
    ['PRS-108', 'UB64'],
    ['PRS-110', 'UB66'],
  ]
  const unplanned = (wc: string, shift: string, minMin: number) =>
    sum(
      parsed.downtimes
        .filter((d) => d.date === day && d.workCenter === wc)
        .flatMap((d) => d.events)
        .filter((e) => (e.shiftDefinition === shift || e.shiftGroup === shift) && e.rc1 !== 'SCHED_DOWN' && e.minutes >= minMin)
        .map((e) => e.minutes),
    )
  const shiftRow = (wc: string, shift: string) =>
    parsed.shifts.find((s) => s.date === day && s.workCenter === wc && (s.shiftDefinition === shift || s.shiftGroup === shift))!

  it.each(clean)('%s %s: Loading − Production = Σ (≥ 2 dk), Σ (hepsi) değil', (wc, shift) => {
    const s = shiftRow(wc, shift)
    expect(s).toBeDefined()
    expect(Math.abs(s.loadingMin - s.productionMin - unplanned(wc, shift, 2))).toBeLessThan(0.15)
  })

  it('Planning Logic örneği: PRS-105 3. vardiya 140,6 dk = ≥ 2 dk duruşlar, 21,6 dk kısa duruş', () => {
    const s = shiftRow('PRS-105', 'UB66')
    expect(s.loadingMin - s.productionMin).toBeCloseTo(140.6, 1)
    expect(unplanned('PRS-105', 'UB66', 2)).toBeCloseTo(140.6, 1)
    expect(unplanned('PRS-105', 'UB66', 0) - unplanned('PRS-105', 'UB66', 2)).toBeCloseTo(21.6, 1)
  })

  it('eşik 0, 1 ya da 3 alınınca tutmuyor (2 dk MES sınırıdır)', () => {
    for (const t of [0, 1, 3]) {
      const hits = clean.filter(([wc, shift]) => {
        const s = shiftRow(wc, shift)
        return Math.abs(s.loadingMin - s.productionMin - unplanned(wc, shift, t)) < 0.15
      })
      expect(hits.length, `eşik ${t}`).toBeLessThan(clean.length)
    }
  })
})

describe('kayıp özetinin süreye göre bölünmesi', () => {
  const split = splitShortStops(pLoss, allStops, plant)

  it('kodun toplamı değişmez: kısa (ARZ<) + uzun = eski', () => {
    for (const [old, now] of pLoss.map((l, i) => [l, split.lossDays[i]] as [LossDay, LossDay])) {
      for (const [k, [m, n]] of Object.entries(old.codes)) {
        const [rc1, rc2] = k.split('|')
        const short = now.codes[`${rc1}|${rc2}<`] ?? [0, 0]
        const long = now.codes[k] ?? [0, 0]
        expect(short[0] + long[0], k).toBeCloseTo(m, 1)
        expect(short[1] + long[1], k).toBe(n)
      }
    }
  })

  it('kısa = < 2 dk plansız olaylar ("#" dahil); planlı bölünmez', () => {
    const events = parsed.downtimes.filter((d) => d.date === day && inScope(d, progressive, plant)).flatMap((d) => d.events)
    const want = events.filter((e) => plant.lossReasonCodes.includes(e.rc1) && e.minutes < 2)
    const got = shortStopTotals(split.lossDays, plant)
    expect(got.count).toBe(want.length)
    expect(got.minutes).toBeCloseTo(sum(want.map((e) => e.minutes)), 1)
    expect(got.count).toBeGreaterThan(0)
    expect(split.lossDays.some((l) => Object.keys(l.codes).some((k) => k.startsWith('SCHED_DOWN|') && k.endsWith('<')))).toBe(false)
  })

  it('süre verisi olmayan gün bölünmez ve not yazılır (01.09.2026 öncesi)', () => {
    const old = pLoss.map((l) => ({ ...l, date: '2026-08-20' }))
    const s = splitShortStops(old, allStops, plant)
    expect(s.lossDays).toEqual(old)
    expect(shortStopNote(s, plant)).toMatch(/^Duration split not available before 01\.09\.2026/)
    expect(shortStopNote(split, plant)).toBeNull()
  })

  it('eşik ayardan (tam dakika); yoksa 2', () => {
    expect(shortStopMinOf(plant)).toBe(2)
    expect(shortStopMinOf({ shortStopMin: 5 })).toBe(5)
    const five = shortStopTotals(splitShortStops(pLoss, allStops, { ...plant, shortStopMin: 5 }).lossDays, plant)
    expect(five.minutes).toBeGreaterThan(shortStopTotals(split.lossDays, plant).minutes)
  })
})

describe('Loss Bridge: < 2 dk performans, ≥ 2 dk availability', () => {
  const t = sumTimes(pDays)
  const old = buildBridge(pDays, pLoss, plant)
  const split = splitShortStops(pLoss, allStops, plant).lossDays
  const b = buildBridge(pDays, split, plant)
  const short = shortStopTotals(split, plant).minutes

  it('OEE, A ve P değişmez (MES ile aynı); köprü kapanır', () => {
    expectCloses(b)
    const r = ratios(t)
    expect(b.oee).toBeCloseTo(r.oee!, 9)
    expect(b.availability).toBeCloseTo(r.availability!, 9)
    expect(b.performance).toBeCloseTo(r.performance!, 9)
    expect(b.oee).toBeCloseTo(old.oee!, 9)
  })

  it('aynı kod iki aileye bölünür; hız kaybı = Production − Operation − kısa duruşlar', () => {
    const perf = b.items.filter((i) => i.family === 'performance' && i.key !== 'pf:speed')
    expect(perf.length).toBeGreaterThan(0)
    expect(perf.every((i) => i.label.endsWith('< 2 min') && i.groups.every((g) => g.endsWith('<')))).toBe(true)
    expect(sum(perf.map((i) => i.minutes))).toBeCloseTo(short, 6)
    expect(b.speed).toBeCloseTo(t.productionMin - t.operatingMin - short, 6)
    // Kısa duruşlar Loading − Production'da değildir: "Not explained" kayıtlı uzunlara göre.
    expect(b.notExplained).toBeCloseTo(old.notExplained + short, 6)
    expect(b.steps.some((s) => s.label === NOT_EXPLAINED || s.key === 'av:unexplained')).toBe(Math.abs(b.notExplained) >= 0.5)
  })

  it('Level 3: kısa kalem nedenlere, hız kaybı makinelere toplamıyla eşit', () => {
    const set = { days: pDays, lossDays: split, orders: [] }
    const empty = { days: [], lossDays: [], orders: [] }
    for (const item of b.items.filter((i) => i.family === 'performance')) {
      for (const by of ['reason', 'machine'] as const) {
        if (item.key === 'pf:speed' && by === 'reason') continue
        const rows = level3(item, by, plant, set, empty)
        expect(sum(rows.map((r) => r.minutes)), `${item.label} ${by}`).toBeCloseTo(item.minutes, 1)
      }
    }
    const speed = b.items.find((i) => i.key === 'pf:speed')!
    const parts = level3(speed, 'part', plant, set, empty)
    expect(parts.find((r) => r.label === SHORT_STOPS_ROW)?.minutes).toBeCloseTo(-short, 6)
    expect(sum(parts.map((r) => r.minutes))).toBeCloseTo(speed.minutes, 4)
  })
})

describe('Losses Trend: "Short stops" sütunu, Speed kalan', () => {
  it('Speed = Production − Operation − kısa duruşlar; toplam aynı', () => {
    const t = sumTimes(pDays)
    const split = splitShortStops(pLoss, allStops, plant).lossDays
    const a = lossBreakdown(t, pLoss, plant)
    const b = lossBreakdown(t, split, plant)
    const short = shortStopTotals(split, plant).minutes
    expect(b.chart[SHORT_STOPS]).toBeCloseTo(short, 6)
    expect(b.chart[SPEED]).toBeCloseTo(Math.max(0, t.productionMin - t.operatingMin - short), 6)
    const total = (x: typeof a) => sum(Object.entries(x.chart).filter(([k]) => k !== SPEED && k !== SHORT_STOPS).map(([, v]) => v))
    expect(total(b) + b.chart[SHORT_STOPS]).toBeCloseTo(total(a), 6)
  })
})
