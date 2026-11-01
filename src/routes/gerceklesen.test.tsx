// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockRows: { material: string; postingDate: string; quantity: number }[] = []
vi.mock('../lib/convexTransport', () => ({
  useQuery: () => ({ rows: mockRows, complete: true }),
}))
vi.mock('../../convex/_generated/api', () => ({
  api: { actualProduction: { listAll: 'actualProduction.listAll' } },
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))
vi.mock('../components/PageHeader', () => ({ PageHeader: () => null, InfoTip: () => null }))

import { Route } from './gerceklesen'

const Page = (Route as unknown as { options: { component: () => React.ReactElement } }).options.component

beforeEach(() => {
  mockRows = []
})
afterEach(cleanup)

describe('Actual Production — empty state', () => {
  it('veri hiç yoksa yükleme mesajını gösterir', () => {
    render(<Page />)
    expect(screen.getByText('No MB51 data uploaded yet.')).toBeTruthy()
  })

  it('veri var ama arama eşleşmezse eşleşme mesajını gösterir', () => {
    mockRows = [{ material: 'A-100', postingDate: '2026-10-01', quantity: 5 }]
    render(<Page />)
    fireEvent.change(screen.getByPlaceholderText('Search material…'), {
      target: { value: 'ZZZ' },
    })
    expect(screen.getByText('No materials match "ZZZ".')).toBeTruthy()
    expect(screen.queryByText('No MB51 data uploaded yet.')).toBeNull()
  })

  it('eşleşen malzeme varsa boş mesaj görünmez', () => {
    mockRows = [{ material: 'A-100', postingDate: '2026-10-01', quantity: 5 }]
    render(<Page />)
    fireEvent.change(screen.getByPlaceholderText('Search material…'), {
      target: { value: 'a-1' },
    })
    expect(screen.getByText('A-100')).toBeTruthy()
    expect(screen.queryByText(/No materials match/)).toBeNull()
  })
})
