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
  { name: 'P1', costCenter: '1100' },
  { name: 'P2', costCenter: '1100' },
  { name: 'T1', costCenter: '1200' },
  { name: 'NW1', costCenter: '2100' },
]

const view = (selection: PlanOrgSelection, planned: number, onChange = vi.fn()) => {
  render(
    <PlanOrgFilter
      options={planOrgOptions(presses, costCenters, departments, selection)}
      selection={selection}
      onChange={onChange}
      planned={planned}
      total={4}
    />,
  )
  return onChange
}

describe('PlanOrgFilter', () => {
  it('süzgeç kapalıyken plandaki bütün iş yerlerini söyler', () => {
    view(NO_ORG_FILTER, 4)
    expect(screen.getByText('All 4 work centers in the plan')).toBeTruthy()
    expect(screen.queryByText('Clear filter')).toBeNull()
  })

  it('bölüm seçenekleri sayılarıyla gelir; seçim masraf yeri seçimini sıfırlar', () => {
    const onChange = view(NO_ORG_FILTER, 4)
    const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement
    expect([...select.options].map((o) => o.text)).toEqual([
      'All departments',
      'Press · 3 WC',
      'Assembly · 1 WC',
    ])
    fireEvent.change(select, { target: { value: 'Press' } })
    expect(onChange).toHaveBeenCalledWith({ department: 'Press', costCenters: [], workCenters: [] })
  })

  it('masraf yeri açılır listesi tek seçer; "hepsi" seçimi temizler', () => {
    const onChange = view({ department: 'Press', costCenters: [], workCenters: [] }, 3)
    fireEvent.change(screen.getByLabelText('Cost center'), { target: { value: '1100' } })
    expect(onChange).toHaveBeenCalledWith({ department: 'Press', costCenters: ['1100'], workCenters: [] })
  })

  it('nut welding bölümü de planda: "not planned" yazılmaz', () => {
    view({ department: 'Assembly', costCenters: [], workCenters: [] }, 1)
    expect(screen.getByText('Showing 1 of 4 work centers in the plan')).toBeTruthy()
    expect(screen.queryByText(/not planned|not part of the press plan|does not plan/)).toBeNull()
  })

  it('seçimde hiç iş yeri yoksa masraf yeri bağını kontrol etmeyi söyler', () => {
    view({ department: 'Press', costCenters: ['1200'], workCenters: [] }, 0)
    expect(screen.getByText(/Check the cost center of the work centers/)).toBeTruthy()
  })
})
