// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AutonomousLog, zamanYaz } from './AutonomousLog'

vi.mock('../lib/convexTransport', () => ({ useQuery: () => undefined }))
vi.mock('../lib/useSafeMutation', () => ({ useSafeMutation: () => ({ run: async () => true, error: null, pending: false }) }))

afterEach(cleanup)

describe('AutonomousLog', () => {
  it('formats the run time', () => {
    expect(zamanYaz('20261030-2300')).toBe('2026-10-30 23:00')
  })

  it('shows before / after for each improvement', () => {
    const { getByText } = render(
      <AutonomousLog
        items={[
          {
            zaman: '20261030-2300',
            odak: 'src/routes/board.tsx',
            ozet: 'Toplantı özeti.',
            durum: 'yayinda',
            gorevler: [{ baslik: 'Link to plan', once: 'Bağlantı yok.', sonra: 'Tek tıkla plana gider.' }],
            oneriler: ['Motor önerisi'],
          },
        ]}
      />,
    )
    expect(getByText('2026-10-30 23:00')).toBeTruthy()
    expect(getByText('Live')).toBeTruthy()
    expect(getByText('Before: Bağlantı yok.')).toBeTruthy()
    expect(getByText('After: Tek tıkla plana gider.')).toBeTruthy()
    expect(getByText('Motor önerisi')).toBeTruthy()
  })

  it('says so when nothing ran yet', () => {
    const { getByText } = render(<AutonomousLog items={[]} />)
    expect(getByText(/No autonomous run yet/)).toBeTruthy()
  })
})
