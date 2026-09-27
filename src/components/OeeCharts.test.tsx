// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import fixture from '../lib/oee.fixture.json'
import { LOSS_CHART_GROUPS, chartShare, lossDayOf, lossForPeriod, mondayOfWeek, parseOeeWorkbook, weekShiftTrend, type SheetRows } from '../lib/oee'
import { LineTrendChart, OeeBarChart, PeriodTable, StackedShareChart } from './OeeCharts'

afterEach(cleanup)

const parsed = parseOeeWorkbook(fixture as unknown as Record<string, SheetRows>)
const scope = { area: 'PRS' as const, key: '51010171' }

describe('OEE charts', () => {
  it('shift chart: 21 slots with a tooltip on hover, and the press table', () => {
    const t = weekShiftTrend(parsed.shifts, scope, mondayOfWeek(2026, 39))
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
  })

  it('loss charts render', () => {
    const b = lossForPeriod(parsed.shifts, parsed.downtimes.map(lossDayOf), { area: 'PRS', key: '51010173' }, '2026-09-21', '2026-09-21')
    const parts = LOSS_CHART_GROUPS.map((g) => ({ key: g.key, label: g.label, value: chartShare(b, g.key) }))
    const { container } = render(
      <>
        <StackedShareChart columns={[{ key: 'd', label: 'Mon', parts }]} ariaLabel="stack" />
        <LineTrendChart labels={['W38', 'W39']} series={[{ key: 'die', label: 'Die', values: [null, chartShare(b, 'die')] }]} ariaLabel="trend" />
      </>,
    )
    expect(container.querySelectorAll('rect').length).toBeGreaterThan(3)
  })
})
