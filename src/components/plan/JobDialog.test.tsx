// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Her mutation çağrısı adıyla kaydedilir.
const calls: { name: string; args: unknown }[] = []
vi.mock('../../lib/useSafeMutation', () => ({
  useSafeMutation: (fn: unknown) => ({
    run: async (args: unknown) => {
      calls.push({ name: String((fn as { _name?: string })?._name ?? fn), args })
      return true
    },
    pending: false,
    error: null,
    clearError: () => {},
  }),
}))
vi.mock('../../../convex/_generated/api', () => {
  const fn = (name: string) => ({ _name: name, toString: () => name })
  return {
    api: {
      planOverrides: { setQuantity: fn('setQuantity'), remove: fn('remove'), set: fn('set') },
      planJobLocks: { approve: fn('approve'), unlock: fn('unlock') },
      planRuns: { requestNow: fn('requestNow') },
    },
  }
})

import { JobDialog, type JobDraft } from './JobDialog'

afterEach(() => {
  cleanup()
  calls.length = 0
})

const job = { material: 'A-100', press: 'PRS104', date: '2026-10-23', quantity: 500, segments: [] } as unknown as JobDraft['job']

describe('JobDialog — delete', () => {
  it('motor işinde "Delete this lot" lotu 0 adede çeker ve planı yeniden hesaplatır', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<JobDialog draft={{ job, bucket: 'W43', lotQuantity: 500, lotJobCount: 1 }} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Delete this lot'))
    await vi.waitFor(() => expect(calls.map((c) => c.name)).toEqual(['setQuantity', 'requestNow']))
    expect(calls[0].args).toMatchObject({ material: 'A-100', bucket: 'W43', qty: 0 })
  })

  it('elle eklenen işte "Delete job" kilidi kaldırır', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <JobDialog
        draft={{ job, bucket: '', lotQuantity: 500, lotJobCount: 1, lock: { id: 'L1', createdAt: 0, manual: true } }}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('Delete job'))
    await vi.waitFor(() => expect(calls.map((c) => c.name)).toEqual(['unlock', 'requestNow']))
    expect(calls[0].args).toEqual({ id: 'L1' })
  })

  it('onay verilmezse silmez', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<JobDialog draft={{ job, bucket: 'W43', lotQuantity: 500, lotJobCount: 1 }} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Delete this lot'))
    expect(calls).toEqual([])
  })
})
