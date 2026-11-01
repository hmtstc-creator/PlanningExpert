// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AutonomousLog, zamanYaz } from './AutonomousLog'

vi.mock('../lib/convexTransport', () => ({ useQuery: () => undefined }))
vi.mock('../lib/useSafeMutation', () => ({ useSafeMutation: () => ({ run: async () => true, error: null, pending: false }) }))

afterEach(cleanup)

describe('AutonomousLog', () => {
  it('converts UTC run time to Bucharest winter time (EET)', () => {
    expect(zamanYaz('20261101-0740')).toBe('2026-11-01 09:40 EET')
    // 25 Ekim 2026'da yaz saati bitti: 30 Ekim 23:00 UTC → 31 Ekim 01:00 EET
    expect(zamanYaz('20261030-2300')).toBe('2026-10-31 01:00 EET')
  })

  it('converts UTC run time to Bucharest summer time (EEST)', () => {
    expect(zamanYaz('20260701-0600')).toBe('2026-07-01 09:00 EEST')
    // 29 Mart 2026'da yaz saati başladı: 28 Mart 23:30 UTC → 29 Mart 01:30 EET (henüz kış)
    expect(zamanYaz('20260328-2330')).toBe('2026-03-29 01:30 EET')
    expect(zamanYaz('20260329-0100')).toBe('2026-03-29 04:00 EEST')
  })

  it('returns unknown formats unchanged', () => {
    expect(zamanYaz('bilinmiyor')).toBe('bilinmiyor')
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
