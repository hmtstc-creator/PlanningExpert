// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../convex/_generated/api', () => {
  const fn = (name: string) => ({ _name: name, toString: () => name })
  return {
    api: {
      operatorHeadcount: { list: fn('operatorHeadcount.list'), upsert: fn('operatorHeadcount.upsert'), remove: fn('operatorHeadcount.remove') },
      presses: { setCrewSize: fn('presses.setCrewSize') },
    },
  }
})
vi.mock('../../lib/convexTransport', () => ({
  useQuery: () => [],
  useMutation: () => vi.fn(async () => null),
}))

import { OperatorHeadcountGrid } from './OperatorHeadcountGrid'

afterEach(cleanup)

const view = (editCrew?: boolean) => (
  <OperatorHeadcountGrid
    costCenters={[{ code: 'CC1', name: 'Nut Welding' }]}
    workCenters={[{ name: 'APR-1', costCenter: 'CC1', crewSize: 2 }]}
    dates={['2026-10-26']}
    shiftMinutes={480}
    editCrew={editCrew}
  />
)

describe('OperatorHeadcountGrid crew row', () => {
  it('shows crew per line by default (Work Calendar)', () => {
    render(view())
    expect(screen.getByLabelText('Crew size APR-1')).toBeTruthy()
  })

  it('hides crew per line on the Production Plan (editCrew=false)', () => {
    render(view(false))
    expect(screen.queryByLabelText('Crew size APR-1')).toBeNull()
    expect(screen.getByLabelText('Operators 2026-10-26 shift 1')).toBeTruthy()
  })
})
