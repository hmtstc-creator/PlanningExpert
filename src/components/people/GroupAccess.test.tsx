// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const run = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../../lib/useSafeMutation', () => ({ useSafeMutation: () => ({ run, error: null, pending: false, clearError: () => {} }) }))

import { GroupAccessForm } from './GroupAccess'

afterEach(cleanup)

const company = { modules: ['planning', 'oee'], plants: [{ _id: 'p1', name: 'Bucharest' }, { _id: 'p2', name: 'Bursa' }] }
const group = { _id: 'g1', name: 'Planners', allPlants: false, plantIds: ['p1'], permissions: { planning: 'view' as const, oee: 'none' as const } }

describe('GroupAccessForm (Organization map → grup düğümü)', () => {
  it('yalnız kiralanan modülleri gösterir; değişmeden kaydet kapalı', () => {
    render(<GroupAccessForm group={group} companyId="c1" company={company} />)
    expect(screen.getByText('PlanningExpert')).toBeTruthy()
    expect(screen.getByText(/Not rented by the company/)).toBeTruthy()
    expect((screen.getByText('Save access') as HTMLButtonElement).disabled).toBe(true)
  })

  it('plant ve modül seviyesi değişince Users & permissions ile aynı yükü kaydeder (ad değişmez)', () => {
    render(<GroupAccessForm group={group} companyId="c1" company={company} />)
    fireEvent.click(screen.getByLabelText(/Bursa/))
    const moduleSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement
    fireEvent.change(moduleSelect, { target: { value: 'edit' } })
    fireEvent.click(screen.getByText('Save access'))
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'g1', companyId: 'c1', name: 'Planners', allPlants: false, plantIds: ['p1', 'p2'], permissions: expect.objectContaining({ planning: 'edit', oee: 'none' }), areas: {} }),
    )
  })
})
