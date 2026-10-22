// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Sorgular yüklenirken / 'skip' iken undefined döner (gerçek davranış).
vi.mock('../../lib/convexTransport', () => ({ useQuery: () => undefined }))
vi.mock('../../lib/plantContext', () => ({ usePlant: () => ({ isPlatform: false, ctx: null }) }))
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
})
