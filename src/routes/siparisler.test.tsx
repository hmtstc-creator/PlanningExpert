// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const row = (material: string) => ({ _id: material, material, overdue: 0, periods: [{ label: 'W1', qty: -10 }] })
vi.mock('../lib/convexTransport', () => ({
  usePaginatedQuery: () => ({ results: [row('A-100'), row('B-200'), row('A-300')], status: 'Exhausted', loadMore: () => {} }),
  useQuery: () => undefined,
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))
vi.mock('../components/PageHeader', () => ({ PageHeader: () => null }))

import { Route } from './siparisler'

afterEach(cleanup)

describe('Demand — material filter', () => {
  it('yazılan metni içeren malzemeleri gösterir, büyük/küçük harf fark etmez', () => {
    const Page = (Route as unknown as { options: { component: () => React.ReactElement } }).options.component
    render(<Page />)
    expect(screen.getAllByRole('row')).toHaveLength(4) // başlık + 3
    fireEvent.change(screen.getByLabelText('Filter material'), { target: { value: 'a-' } })
    expect(screen.queryByText('B-200')).toBeNull()
    expect(screen.getByText('A-100')).toBeTruthy()
    expect(screen.getByText('A-300')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter material'), { target: { value: 'zzz' } })
    expect(screen.getByText('No material matches the filter.')).toBeTruthy()
  })
})
