// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import fixture from '../lib/oee.fixture.json'
import { chartShare, daysFromShifts, lossDayOf, lossForPeriod, mondayOfWeek, parseOeeWorkbook, weekShiftTrend, type OeeConfig, type SheetRows } from '../lib/oee'
import { LineTrendChart, OeeBarChart, PeriodTable, StackedShareChart } from './OeeCharts'

afterEach(cleanup)

const parsed = parseOeeWorkbook(fixture as unknown as Record<string, SheetRows>)
const config: OeeConfig = {
  areas: [{ name: 'PRS', pick: 'costCenter' }],
  costCenters: [
    { code: '51010171', name: 'Transfer', area: 'PRS' },
    { code: '51010173', name: 'Progressive', area: 'PRS' },
  ],
  shifts: [
    { code: 'UB64', number: 1 },
    { code: 'UB65', number: 2 },
    { code: 'UB66', number: 3 },
  ],
  lossReasonCodes: ['UNSCD_DOWN'],
  breakReasonCodes: ['SCHED_DOWN'],
  lossGroups: [{ code: 'KLP', label: 'Die breakdown', chart: 'Die', breakdown: true }],
  setupTexts: [],
  startupRunMin: 60,
  trendWeeks: 10,
  topN: 10,
}
const scope = { area: 'PRS', key: '51010171' }

describe('OEE charts', () => {
  it('shift chart: 21 slots with a tooltip on hover, and the press table', () => {
    const t = weekShiftTrend(parsed.shifts, scope, config, mondayOfWeek(2026, 39))
    const { container, getByText } = render(
      <>
        <OeeBarChart points={t.slots} ariaLabel="shift" />
        <PeriodTable total={t.slots} rows={[...t.byWorkCenter]} />
      </>,
    )
    const groups = container.querySelectorAll('svg > g')
    expect(groups.length).toBeGreaterThanOrEqual(21)
    fireEvent.mouseEnter(groups[1])
    expect(getByText('Mon-1', { selector: 'p' })).toBeTruthy()
    expect(container.querySelectorAll('tbody tr').length).toBe(1 + t.byWorkCenter.size)
    // OEE değeri çubuğun üstünde, % işaretsiz.
    const first = t.slots.find((p) => p.oee !== null)!
    const values = [...container.querySelectorAll('text[font-weight="700"]')].map((e) => e.textContent)
    expect(values.length).toBe(t.slots.filter((p) => (p.oee ?? 0) > 0).length)
    expect(values[0]).toBe(String(Math.round(first.oee! * 100)))
  })

  it('loss charts render', () => {
    const b = lossForPeriod(daysFromShifts(parsed.shifts), parsed.downtimes.map(lossDayOf), { area: 'PRS', key: '51010173' }, config, '2026-09-21', '2026-09-21')
    const parts = ['Die', 'Speed'].map((c) => ({ key: c, label: c, value: chartShare(b, c) }))
    const { container } = render(
      <>
        <StackedShareChart columns={[{ key: 'd', label: 'Mon', parts }]} ariaLabel="stack" />
        <LineTrendChart labels={['W38', 'W39']} series={[{ key: 'die', label: 'Die', values: [null, chartShare(b, 'Die')] }]} ariaLabel="trend" />
      </>,
    )
    expect(container.querySelectorAll('rect').length).toBeGreaterThan(3)
  })
})
