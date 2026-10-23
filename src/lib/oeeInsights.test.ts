import { describe, expect, it } from 'vitest'

import { EMPTY_CONFIG, addDaysIso, type DayRow, type LossDay, type OeeConfig, type OrderRow, type ShiftRow } from './oee'
import { fullWeeks, insightSignals, insightUserMessage, parseInsightAnswer, pearson, ruleFindings, type InsightInput, type Signal } from './oeeInsights'

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

describe('Agent Insights: date range', () => {
  it('last 4 full weeks before a Friday', () => {
    expect(fullWeeks('2026-10-23', 4)).toEqual({ from: '2026-09-21', to: '2026-10-18' })
    expect(fullWeeks('2026-10-26', 1)).toEqual({ from: '2026-10-19', to: '2026-10-25' })
  })
})
