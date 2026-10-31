// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const row = (material: string) => ({ _id: material, material, overdue: 0, periods: [{ label: 'W1', qty: -10 }] })
const plant = {
  active: {
    costCenters: [
      { code: 'CC1', name: 'Press 1 area', department: 'Pres' },
      { code: 'CC2', name: 'Injection area', department: 'Enjeksiyon' },
    ],
    departments: ['Pres', 'Enjeksiyon'],
  },
}
const presses = [
  { name: 'P1', costCenter: 'CC1' },
  { name: 'P2', costCenter: 'CC2' },
]
// A-100 ve A-300 ana iş yeri P1 (Pres); B-200 ana iş yeri P2; C-400 iş yeri yok.
const products = {
  rows: [
    { code: 'A-100', mainMachine: 'P1', altMachine1: 'P2' },
    { code: 'B-200', mainMachine: 'P2' },
    { code: 'A-300', mainMachine: 'P1' },
    { code: 'C-400', mainMachine: '' },
  ],
  complete: true,
}
vi.mock('../lib/convexTransport', () => ({
  usePaginatedQuery: () => ({ results: [row('A-100'), row('B-200'), row('A-300'), row('C-400')], status: 'Exhausted', loadMore: () => {} }),
  useQuery: (ref: unknown) => (ref === 'presses' ? presses : ref === 'products' ? products : undefined),
}))
vi.mock('../../convex/_generated/api', () => ({
  api: {
    presses: { list: 'presses' },
    products: { listAll: 'products' },
    stock: { planStock: 'stock' },
    demand: { listWeekly: 'listWeekly', listDaily: 'listDaily' },
  },
}))
vi.mock('../lib/plantContext', () => ({ usePlant: () => ({ ctx: plant }) }))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))
vi.mock('../components/PageHeader', () => ({ PageHeader: () => null, InfoTip: () => null }))

import { Route } from './siparisler'

const Page = (Route as unknown as { options: { component: () => React.ReactElement } }).options.component

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe('Demand — material filter', () => {
  it('yazılan metni içeren malzemeleri gösterir, büyük/küçük harf fark etmez', () => {
    render(<Page />)
    expect(screen.getAllByRole('row')).toHaveLength(5) // başlık + 4
    fireEvent.change(screen.getByLabelText('Filter material'), { target: { value: 'a-' } })
    expect(screen.queryByText('B-200')).toBeNull()
    expect(screen.getByText('A-100')).toBeTruthy()
    expect(screen.getByText('A-300')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter material'), { target: { value: 'zzz' } })
    expect(screen.getByText('No material matches the filter.')).toBeTruthy()
  })

  it('bölüm süzgeci seçiliyken yalnız ana iş yeri o bölümdeki malzemeleri gösterir', () => {
    window.localStorage.setItem(
      'planningexpert.demand.orgFilter',
      JSON.stringify({ department: 'Pres', costCenters: [], workCenters: [] }),
    )
    render(<Page />)
    expect(screen.getByText('A-100')).toBeTruthy()
    expect(screen.getByText('A-300')).toBeTruthy()
    expect(screen.queryByText('B-200')).toBeNull() // ana iş yeri P2 (Enjeksiyon)
    expect(screen.queryByText('C-400')).toBeNull() // ana iş yeri yok
  })

  it('iş yeri süzgeci alternatif iş yerlerini saymaz', () => {
    window.localStorage.setItem(
      'planningexpert.demand.orgFilter',
      JSON.stringify({ department: '', costCenters: [], workCenters: ['P2'] }),
    )
    render(<Page />)
    expect(screen.getByText('B-200')).toBeTruthy()
    expect(screen.queryByText('A-100')).toBeNull() // P2 yalnız alternatif
  })
})
