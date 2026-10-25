// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Sorgular yüklenirken / 'skip' iken undefined döner (gerçek davranış).
vi.mock('../../lib/convexTransport', () => ({ useQuery: () => undefined }))
const plant = vi.hoisted(() => ({ isPlatform: false, ctx: null }))
vi.mock('../../lib/plantContext', () => ({ usePlant: () => plant }))
vi.mock('../../lib/useSafeMutation', () => ({ useSafeMutation: () => async () => null }))

import { OrgMap } from './OrgMap'

afterEach(cleanup)

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

describe('OrgMap', () => {
  it('veri yokken (skip / yükleniyor) sonsuz güncelleme döngüsüne girmez (React #185)', () => {
    expect(() => render(<OrgMap />)).not.toThrow()
  })

  it('Company settings kapsamında General için de holding işlemi yok; Administration kapsamında var', () => {
    plant.isPlatform = true
    render(<OrgMap scope="company" />)
    expect(screen.queryByText('Add holding')).toBeNull()
    cleanup()
    render(<OrgMap />)
    expect(screen.getByText('Add holding')).toBeTruthy()
    plant.isPlatform = false
  })
})
