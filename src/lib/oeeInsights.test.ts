import { describe, expect, it } from 'vitest'

import { EMPTY_CONFIG, addDaysIso, type DayRow, type LossDay, type OeeConfig, type OrderRow, type ShiftRow } from './oee'
import {
  AFTER_BREAK,
  FIVE_S,
  INSIGHT_STALE_MS,
  defaultLossMeaning,
  fullWeeks,
  insightSignals,
  insightUserMessage,
  isStaleInsight,
  lossCodeMeanings,
  lossMeaning,
  parseInsightAnswer,
  pearson,
  ruleFindings,
  topReasons,
  undefinedLossCodes,
  type InsightInput,
  type Signal,
} from './oeeInsights'

const config: OeeConfig = {
  ...EMPTY_CONFIG,
  costCenters: [{ code: 'CC1', name: 'Press line 1', area: 'Press' }],
  shifts: [
    { code: 'S1', number: 1 },
    { code: 'S2', number: 2 },
  ],
  lossReasonCodes: ['L'],
  lossGroups: [
    { code: 'KLP', label: 'Die', chart: 'Die', breakdown: true },
    { code: 'ARZ', label: 'Breakdown', chart: 'Breakdown', breakdown: true },
  ],
}
const FROM = '2026-09-28' // Pazartesi
const TO = '2026-10-25' // Pazar, 4 hafta
const dates = (n: number) => Array.from({ length: n }, (_, i) => addDaysIso(FROM, i))

const times = { good: 1000, scrap: 5, reject: 0, scheduledMin: 960, unscheduledMin: 0, loadingMin: 900, productionMin: 800, operatingMin: 720 }
const day = (date: string, workCenter = 'WC-A', extra: Partial<DayRow> = {}): DayRow =>
  ({ date, plantKey: 'P', responsible: 'x', costCenter: 'CC1', workCenter, source: 'shiftly', ...times, ...extra }) as DayRow
const loss = (date: string, codes: LossDay['codes'], parts: LossDay['parts'] = {}, workCenter = 'WC-A'): LossDay => ({
  date,
  costCenter: 'CC1',
  workCenter,
  codes,
  reasons: {},
  parts,
})
const order = (date: string, o: Partial<OrderRow>): OrderRow =>
  ({ date, plant: 'P', plantName: 'P', workCenter: 'WC-A', shift: '1', order: 'O1', equipment: '', material: 'P1', ...times, ...o }) as OrderRow
const input = (x: Partial<InsightInput>): InsightInput => ({ from: FROM, to: TO, config, days: [], losses: [], shifts: [], orders: [], ...x })
const kinds = (xs: Signal[]) => xs.map((s) => s.kind)

describe('Agent Insights: signals', () => {
  it('flat data with scrap recorded → no signal', () => {
    const ds = dates(28)
    const xs = insightSignals(input({ days: ds.map((d) => day(d)), losses: ds.map((d) => loss(d, { 'L|ARZ': [10, 2] })) }))
    expect(xs).toEqual([])
  })

  it('hidden concentration: 83% of the die loss on a part with 10% of the loading', () => {
    const ds = dates(20)
    const xs = insightSignals(
      input({
        days: ds.map((d) => day(d)),
        losses: ds.map((d) => loss(d, { 'L|KLP': [60, 3] }, { 'L|KLP|P1': [50, 2], 'L|KLP|P2': [10, 1] })),
        orders: ds.flatMap((d) => [order(d, { material: 'P1', loadingMin: 100 }), order(d, { order: 'O2', material: 'P2', loadingMin: 900 })]),
      }),
    )
    const s = xs.find((x) => x.kind === 'concentration')!
    expect(s.title).toBe('83% of Die loss is on one part: P1')
    // 1000 dk kayıp − beklenen (%10 × 1200) = 880 dk / 4 hafta = 220 dk / hafta.
    expect(s.gainMinPerWeek).toBe(220)
  })

  it('part × machine: the same part loses far more on one work centre', () => {
    const ds = dates(10)
    const xs = insightSignals(
      input({
        days: ds.flatMap((d) => [day(d), day(d, 'WC-B')]),
        losses: ds.flatMap((d) => [loss(d, { 'L|KLP': [30, 2] }, { 'L|KLP|P1': [30, 2] }), loss(d, { 'L|KLP': [2, 1] }, { 'L|KLP|P1': [2, 1] }, 'WC-B')]),
        orders: ds.flatMap((d) => [order(d, { loadingMin: 300 }), order(d, { workCenter: 'WC-B', loadingMin: 300 })]),
      }),
    )
    const s = xs.find((x) => x.kind === 'interaction')!
    expect(s.id).toBe('interaction|P1|WC-A|WC-B')
    expect(s.finding).toContain('6.0 min per loading hour')
  })

  it('changeovers: availability falls on days with more orders', () => {
    const ds = dates(20)
    const n = (i: number) => (i % 2 ? 5 : 1)
    const xs = insightSignals(
      input({
        days: ds.map((d, i) => day(d, 'WC-A', { productionMin: 900 * (0.95 - 0.05 * n(i)) })),
        orders: ds.flatMap((d, i) => Array.from({ length: n(i) }, (_, k) => order(d, { order: `O${k}` }))),
      }),
    )
    expect(kinds(xs)).toContain('changeover')
  })

  it('shift: one shift steadily below the other', () => {
    const ds = dates(20)
    const sh = (date: string, shiftGroup: string, productionMin: number, operatingMin: number) =>
      ({ date, plantKey: 'P', responsible: 'x', costCenter: 'CC1', workCenter: 'WC-A', shiftGroup, shiftDefinition: shiftGroup, ...times, loadingMin: 450, productionMin, operatingMin }) as ShiftRow
    const xs = insightSignals(input({ days: ds.map((d) => day(d)), shifts: ds.flatMap((d) => [sh(d, 'S1', 430, 400), sh(d, 'S2', 300, 280)]) }))
    const s = xs.find((x) => x.kind === 'shift')!
    expect(s.id).toBe('shift|WC-A|2')
  })

  it('weekday: Mondays lose six times more', () => {
    const ds = dates(28)
    const xs = insightSignals(input({ days: ds.map((d) => day(d)), losses: ds.map((d, i) => loss(d, { 'L|ARZ': [i % 7 === 0 ? 60 : 10, 2] })) }))
    expect(xs.find((x) => x.kind === 'weekday')!.id).toBe('weekday|WC-A|0')
  })

  it('micro stops: many stops of one minute', () => {
    const ds = dates(20)
    const xs = insightSignals(input({ days: ds.map((d) => day(d)), losses: ds.map((d) => loss(d, { 'L|ARZ': [30, 30] })) }))
    expect(kinds(xs)).toContain('micro')
  })

  it('regime change: the die loss jumps from one day on', () => {
    const ds = dates(20)
    const xs = insightSignals(input({ days: ds.map((d) => day(d)), losses: ds.map((d, i) => loss(d, { 'L|KLP': [i < 10 ? 5 : 60, 2] })) }))
    const s = xs.find((x) => x.kind === 'regime')!
    expect(s.title).toBe(`WC-A: Die loss jumped from ${ds[10]}`)
  })

  it('performance above 100 % → master data', () => {
    const ds = dates(5)
    const xs = insightSignals(input({ days: ds.map((d) => day(d)), orders: ds.map((d) => order(d, { productionMin: 300, operatingMin: 360 })) }))
    expect(xs.find((x) => x.kind === 'performance')!.title).toContain('120% performance')
  })

  it('data quality: half of the loss without a reason, and no scrap at all', () => {
    const ds = dates(20)
    const xs = insightSignals(input({ days: ds.map((d) => day(d, 'WC-A', { scrap: 0 })), losses: ds.map((d) => loss(d, { 'L|#': [100, 5], 'L|KLP': [100, 5] })) }))
    const ids = xs.filter((x) => x.kind === 'dataQuality').map((x) => x.id)
    expect(ids).toEqual(expect.arrayContaining(['dataQuality|unclassified', 'dataQuality|noScrap']))
  })

  it('pearson', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1)
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull()
  })
})

describe('Agent Insights: AI answer', () => {
  const ds = dates(20)
  const signals = insightSignals(input({ days: ds.map((d) => day(d)), losses: ds.map((d, i) => loss(d, { 'L|KLP': [i < 10 ? 5 : 60, 2], 'L|ARZ': [30, 30] })) }))

  it('broken or empty answers → no finding (rules are shown)', () => {
    expect(parseInsightAnswer('not json', signals)).toEqual([])
    expect(parseInsightAnswer('{"findings":[]}', signals)).toEqual([])
    expect(parseInsightAnswer('{"findings":[{"signal_ids":["made-up"],"title":"x"}]}', signals)).toEqual([])
  })

  it('valid finding: gain is capped by its signals, missing parts come from the signal', () => {
    const id = signals[0].id
    const [f] = parseInsightAnswer(
      `\`\`\`json\n{"findings":[{"signal_ids":["${id}"],"title":"Die loss started on a date","estimated_gain_min_per_week":99999,"confidence":"high"}]}\n\`\`\``,
      signals,
    )
    expect(f.gainMinPerWeek).toBe(signals[0].gainMinPerWeek)
    expect(f.finding).toBe(signals[0].finding)
    expect(f.confidence).toBe('high')
  })

  it('rules fallback: the 3 strongest signals', () => {
    expect(ruleFindings(signals).map((f) => f.signalIds[0])).toEqual(signals.slice(0, 3).map((s) => s.id))
  })

  it('the request carries no personal data and stays small', () => {
    const msg = insightUserMessage({ costCenter: 'Press line 1', workCenter: '', from: FROM, to: TO, codes: { KLP: 'die breakdown' } }, signals)
    expect(msg).not.toContain('responsible')
    expect(msg.length).toBeLessThanOrEqual(24_000)
    expect(JSON.parse(msg).lossCodes.KLP).toBe('die breakdown')
  })
})

describe('Agent Insights: sub-reasons and new signals', () => {
  const why = (date: string, codes: LossDay['codes'], reasons: LossDay['reasons']): LossDay => ({ ...loss(date, codes), reasons })

  it('top 3 sub-reasons by minutes', () => {
    expect(topReasons([
      { text: 'A', min: 5, count: 1 },
      { text: 'B', min: 20, count: 4 },
      { text: 'A', min: 10, count: 2 },
      { text: 'C', min: 1, count: 1 },
      { text: 'D', min: 2, count: 1 },
    ])).toEqual([
      { text: 'B', min: 20, count: 4 },
      { text: 'A', min: 15, count: 3 },
      { text: 'D', min: 2, count: 1 },
    ])
  })

  it('every loss signal carries the top 3 sub-reasons of its loss', () => {
    const ds = dates(20)
    const xs = insightSignals(
      input({
        days: ds.map((d) => day(d)),
        losses: ds.map((d) => why(d, { 'L|ARZ': [30, 30] }, { 'L|ARZ|SENSOR': [20, 20], 'L|ARZ|feeder ': [8, 8], 'L|ARZ|CONVEYOR': [2, 2], 'L|KLP|BURR': [99, 1] })),
      }),
    )
    const s = xs.find((x) => x.kind === 'micro')!
    expect(s.evidence).toBe('150 stops a week on WC-A. Top reasons: SENSOR 6.7 h / 400 stops; FEEDER 2.7 h / 160 stops; CONVEYOR 40 min / 40 stops.')
  })

  it('frequent short set-up: electrode adjustment 1400 times, 2 min each', () => {
    const c = { ...config, lossGroups: [...config.lossGroups, { code: 'STP', label: 'Set-up', chart: 'Set-up', breakdown: false }] }
    const ds = dates(28)
    const xs = insightSignals(
      input({ config: c, days: ds.map((d) => day(d)), losses: ds.map((d) => why(d, { 'L|STP': [100, 50] }, { 'L|STP|REGLAJ ELECTROT': [100, 50] })) }),
    )
    const s = xs.find((x) => x.kind === 'setupRepeat')!
    expect(s.title).toBe('WC-A: "REGLAJ ELECTROT" 1400 times, 2.0 min each')
    // 2800 dk ÷ 2 ÷ 4 hafta = 350 dk / hafta.
    expect(s.gainMinPerWeek).toBe(350)
  })

  it('residual stop after breaks and 5S booked as an unplanned loss', () => {
    const ds = dates(28)
    const xs = insightSignals(
      input({ days: ds.map((d) => day(d)), losses: ds.map((d) => why(d, { 'L|YNT': [35, 2] }, { 'L|YNT|LATE START AFTER BREAK': [15, 1], 'L|YNT|5S': [20, 1] })) }),
    )
    const after = xs.find((x) => x.kind === 'afterBreak')!
    expect(after.title).toBe('WC-A: 1.8 h a week lost after breaks')
    expect(after.gainMinPerWeek).toBe(105)
    const five = xs.find((x) => x.kind === 'unplanned5S')!
    expect(five.title).toBe('WC-A: 2.3 h a week of 5S booked as an unplanned loss')
    expect(five.gainMinPerWeek).toBe(70)
    expect(AFTER_BREAK.test('DUPĂ PAUZĂ')).toBe(true)
    expect([FIVE_S.test('5 S CLEANING'), FIVE_S.test('P15SX')]).toEqual([true, false])
  })

  it('after-break and 5S patterns cover common spellings', () => {
    const yes = [
      'LATE START AFTER BREAK', 'POST-BREAK RESTART', 'AFTER LUNCH BREAK', 'AFTER LUNCH', 'START AFTER COFFEE BREAK',
      'DUPA PAUZA', 'PORNIRE DUPĂ PAUZA DE MASA', 'DUPA MASA',
      'MOLA SONRASI', 'MOLADAN SONRA', 'MOLA DÖNÜŞÜ', 'MOLA DONUSU', 'ÇAY MOLASI SONRASI', 'YEMEKTEN SONRA',
    ]
    const no = ['AFTER BREAKDOWN', 'TOOL BREAKAGE', 'MOLA', 'PAUZA', 'BREAK']
    expect(yes.filter((t) => !AFTER_BREAK.test(t))).toEqual([])
    expect(no.filter((t) => AFTER_BREAK.test(t))).toEqual([])
    expect(['5S', 'CURATENIE 5S', '5-S AUDIT', '5S.'].every((t) => FIVE_S.test(t))).toBe(true)
    expect(['15S', 'P5SX', '5SEC'].some((t) => FIVE_S.test(t))).toBe(false)
  })

  it('"#" stops far longer than coded stops → big stops stay unexplained', () => {
    const ds = dates(20)
    const xs = insightSignals(input({ days: ds.map((d) => day(d)), losses: ds.map((d) => loss(d, { 'L|#': [90, 1], 'L|ARZ': [10, 2] })) }))
    const s = xs.find((x) => x.id === 'dataQuality|longUnclassified|WC-A')!
    expect(s.finding).toBe('20 stops with "#" average 1.5 h, coded stops 5 min; 30.0 h in total.')
  })
})

describe('Agent Insights: loss code meanings', () => {
  const c: OeeConfig = { ...config, lossReasonCodes: ['UNSCD_DOWN'], lossGroups: [...config.lossGroups, { code: 'YNT', label: 'Organisation', chart: 'Org', breakdown: false }] }

  it('default meaning: "RC1 RC2" first, then RC2; what the user wrote always wins', () => {
    expect(defaultLossMeaning('YNT', c)).toMatch(/^organisation \/ people/)
    expect(defaultLossMeaning('YNT', { ...c, lossReasonCodes: ['SCHED_DOWN'] })).toBe('planned stop / no work / try-out')
    expect(defaultLossMeaning('', c)).toBe('no reason entered (data quality)')
    expect(lossMeaning('KLP', c)).toMatch(/^die \/ part quality/)
    const own = { ...c, lossGroups: c.lossGroups.map((g) => (g.code === 'KLP' ? { ...g, meaning: 'die breakdown' } : g)) }
    expect(lossMeaning('KLP', own)).toBe('die breakdown')
    expect(defaultLossMeaning('ZZZ', c)).toBe('')
  })

  it('codes in the data but not in Loss groups → undefined code, marked for the AI', () => {
    const xs = undefinedLossCodes([{ ...loss(FROM, { 'UNSCD_DOWN|OFC': [30, 2], 'UNSCD_DOWN|KLP': [10, 1], 'SCHED_DOWN|UTS': [25, 2] }) }, { ...loss(TO, { 'UNSCD_DOWN|OFC': [5, 1], 'UNSCD_DOWN|': [7, 1] }) }], c)
    expect(xs).toEqual([
      { code: 'OFC', min: 35, count: 3 },
      { code: '#', min: 7, count: 1 },
    ])
    const codes = lossCodeMeanings(c, ['OFC'])
    expect(codes.OFC).toBe('not defined in OEE Settings; logistics / waiting for material (transport, empty boxes, missing raw material, crane)')
    expect(codes.KLP).toMatch(/^Die: die \/ part quality/)
  })

  it('a too long request drops the weakest signals and stays valid JSON', () => {
    const big: Signal[] = Array.from({ length: 30 }, (_, i) => ({
      id: `s${i}`,
      kind: 'micro',
      title: 't',
      finding: 'f',
      evidence: 'x'.repeat(2000),
      whyNonObvious: 'w',
      firstCheck: 'c',
      gainMinPerWeek: 1,
      gainPiecesPerWeek: null,
      confidence: 'low',
      score: 1,
    }))
    const msg = insightUserMessage({ costCenter: 'CC', workCenter: '', from: FROM, to: TO, codes: {} }, big)
    expect(msg.length).toBeLessThanOrEqual(24_000)
    const n = JSON.parse(msg).signals.length
    expect(n).toBeGreaterThan(5)
    expect(n).toBeLessThan(20)
  })
})

describe('Agent Insights: date range', () => {
  it('last 4 full weeks before a Friday', () => {
    expect(fullWeeks('2026-10-23', 4)).toEqual({ from: '2026-09-21', to: '2026-10-18' })
    expect(fullWeeks('2026-10-26', 1)).toEqual({ from: '2026-10-19', to: '2026-10-25' })
  })
})

describe('isStaleInsight', () => {
  it('15 dakikadan uzun running kalan rapor takılmıştır', () => {
    expect(INSIGHT_STALE_MS).toBe(15 * 60_000)
    expect(isStaleInsight({ status: 'running', createdAt: 0 }, 14 * 60_000)).toBe(false)
    expect(isStaleInsight({ status: 'running', createdAt: 0 }, 16 * 60_000)).toBe(true)
    expect(isStaleInsight({ status: 'done', createdAt: 0 }, 60 * 60_000)).toBe(false)
  })
})
