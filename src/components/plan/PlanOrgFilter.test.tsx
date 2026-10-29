// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NO_ORG_FILTER, planOrgOptions, type OrgCostCenter, type OrgPress, type PlanOrgSelection } from '../../lib/planOrgFilter'
import { PlanOrgFilter } from './PlanOrgFilter'

afterEach(cleanup)

const costCenters: OrgCostCenter[] = [
  { code: '1100', name: 'Press line', department: 'Press' },
  { code: '1200', name: 'Transfer', department: 'Press' },
  { code: '2100', name: 'Nut welding', department: 'Assembly' },
]
const departments = ['Press', 'Assembly']
const presses: OrgPress[] = [
  { name: 'P1', costCenter: '1100', rateModel: 'stroke' },
  { name: 'P2', costCenter: '1100', rateModel: 'stroke' },
  { name: 'T1', costCenter: '1200', rateModel: 'stroke' },
  { name: 'NW1', costCenter: '2100', rateModel: 'cycle' },
]

const view = (selection: PlanOrgSelection, planned: number, onChange = vi.fn()) => {
  render(
    <PlanOrgFilter
      options={planOrgOptions(presses, costCenters, departments, selection)}
      selection={selection}
      onChange={onChange}
      planned={planned}
      total={3}
    />,
  )
  return onChange
}

describe('PlanOrgFilter', () => {
  it('süzgeç kapalıyken plandaki bütün iş yerlerini söyler', () => {
    view(NO_ORG_FILTER, 3)
    expect(screen.getByText('All 3 work centers in the plan')).toBeTruthy()
    expect(screen.queryByText('Clear filter')).toBeNull()
  })

  it('bölüm seçenekleri sayılarıyla gelir; seçim masraf yeri seçimini sıfırlar', () => {
    const onChange = view(NO_ORG_FILTER, 3)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect([...select.options].map((o) => o.text)).toEqual([
      'All departments',
      'Press · 3 WC',
      'Assembly · 0 WC + 1 not planned',
    ])
    fireEvent.change(select, { target: { value: 'Press' } })
    expect(onChange).toHaveBeenCalledWith({ department: 'Press', costCenters: [] })
  })

  it('masraf yeri rozeti çoklu seçer / bırakır', () => {
    const onChange = view({ department: 'Press', costCenters: [] }, 3)
    fireEvent.click(screen.getByRole('button', { name: /1100 — Press line/ }))
    expect(onChange).toHaveBeenCalledWith({ department: 'Press', costCenters: ['1100'] })
  })

  it('yalnız cycle hattı olan bölüm seçilince nedeni yazılır', () => {
    view({ department: 'Assembly', costCenters: [] }, 0)
    expect(screen.getByText(/does not plan those yet/)).toBeTruthy()
    expect(screen.getByText('Showing 0 of 3 work centers in the plan')).toBeTruthy()
  })
})
