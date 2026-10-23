import { describe, expect, it } from 'vitest'

import { EMPTY_CONFIG, addDaysIso, type DayRow, type LossDay, type OeeConfig } from './oee'
import { compactDays, decideTopics, parseAiAnswer, topicCandidates, topicKey, type GroupDay } from './oeeTopics'

const config: OeeConfig = {
  ...EMPTY_CONFIG,
  costCenters: [{ code: 'CC1', name: 'Press line 1', area: 'Press' }],
  lossReasonCodes: ['L'],
  lossGroups: [{ code: 'KLP', label: 'Die', chart: 'Die', breakdown: true }],
}
const DAY = '2026-10-22'

/** İş yeri PRS-1, grup KLP: her hafta bir günde `weekMin[k]` dakika, bugün `today`. */
function history(today: number, weekMin: number[]): GroupDay[] {
  const rows: GroupDay[] = [{ date: DAY, costCenter: 'CC1', workCenter: 'PRS-1', loadingMin: 900, groups: { KLP: today } }]
  weekMin.forEach((m, i) => {
    rows.push({ date: addDaysIso(DAY, -7 * (i + 1) - 2), costCenter: 'CC1', workCenter: 'PRS-1', loadingMin: 900, groups: { KLP: m } })
  })
  return rows
}

describe('OEE open topics: compact days', () => {
  it('counts only loss codes with a reason, and sums loading', () => {
    const days = [{ date: DAY, costCenter: 'CC1', workCenter: 'PRS-1', loadingMin: 480 } as DayRow]
    const losses: LossDay[] = [
      { date: DAY, costCenter: 'CC1', workCenter: 'PRS-1', codes: { 'L|KLP': [70, 3], 'L|#': [40, 1], 'B|KLP': [30, 1] }, reasons: {} },
    ]
    expect(compactDays(days, losses, config)).toEqual([
      { date: DAY, costCenter: 'CC1', workCenter: 'PRS-1', loadingMin: 480, groups: { KLP: 70 } },
    ])
  })
})

describe('OEE open topics: candidates', () => {
  it('chronic and not falling → added by the rules (90 min today, 4 of 6 weeks)', () => {
    const [x] = topicCandidates(DAY, history(90, [150, 0, 200, 130, 0, 160]), config, new Set())
    expect(x.key).toBe('CC1|PRS-1|KLP')
    expect(x.costCenterName).toBe('Press line 1')
    expect(x.weeks).toEqual([90, 150, 0, 200, 130, 0, 160])
    expect(x.pastHits).toBe(4)
    // Bu hafta 90 dk < 120 (weekMin): kural eklemez.
    expect(x.ruleAdd).toBe(false)
    const [y] = topicCandidates(DAY, history(140, [150, 0, 200, 130, 0, 160]), config, new Set())
    expect(y.ruleAdd).toBe(true)
  })

  it('one bad week is not chronic; no history is not a candidate', () => {
    const [x] = topicCandidates(DAY, history(200, [300, 0, 0, 0, 0, 0]), config, new Set())
    expect(x.pastHits).toBe(1)
    expect(x.ruleAdd).toBe(false)
    expect(topicCandidates(DAY, history(200, [0, 0, 0, 0, 0, 0]), config, new Set())).toEqual([])
  })

  it('a falling trend is not critical', () => {
    const [x] = topicCandidates(DAY, history(130, [400, 400, 400, 400, 400, 400]), config, new Set())
    expect(x.ruleAdd).toBe(false)
  })

  it('below the minutes of the day → no candidate', () => {
    expect(topicCandidates(DAY, history(59, [150, 150, 150, 150, 150, 150]), config, new Set())).toEqual([])
  })

  it('an open topic is not written again (yesterday found it, today only updates)', () => {
    const open = new Set([topicKey('CC1', 'PRS-1', 'KLP')])
    const xs = topicCandidates(DAY, history(140, [150, 150, 150, 150, 150, 150]), config, open)
    expect(xs[0].open).toBe(true)
    expect(decideTopics(xs, null)).toEqual([])
  })
})

describe('OEE open topics: AI answer', () => {
  const xs = topicCandidates(DAY, history(140, [150, 0, 200, 130, 0, 160]), config, new Set())

  it('the AI decision wins over the rules', () => {
    const ai = parseAiAnswer(
      '```json\n{"topics":[{"key":"CC1|PRS-1|KLP","add":false,"title":"Not chronic","analysis":"","action":""}]}\n```',
      xs.map((x) => x.key),
    )
    expect(ai.get('CC1|PRS-1|KLP')?.add).toBe(false)
    expect(decideTopics(xs, ai)).toEqual([])
  })

  it('unknown keys and broken answers are ignored → rules decide', () => {
    expect(parseAiAnswer('{"topics":[{"key":"X|Y|Z","add":true,"title":"t"}]}', ['CC1|PRS-1|KLP']).size).toBe(0)
    const broken = parseAiAnswer('not json', ['CC1|PRS-1|KLP'])
    expect(broken.size).toBe(0)
    const [d] = decideTopics(xs, broken)
    expect(d.source).toBe('rules')
    expect(d.title).toBe('PRS-1 · Die: chronic loss in 4 of the last 6 weeks')
    expect(d.evidence).toContain('Today 2.3 h (16% of loading)')
  })
})
