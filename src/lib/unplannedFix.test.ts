import { describe, expect, it } from 'vitest'

import { fixForUnplanned } from './unplannedFix'

// Motorun ürettiği gerçek sebep metinleri — scheduler.ts ile aynı olmalı.
const REASONS = [
  'No master data record found',
  'No eligible press (main and alternative machines are undefined)',
  'Pinned press is not defined: PRS-9',
  'Excluded from planning by the user',
  'No presses defined',
  'Not enough free capacity in the visible calendar',
  'Not enough free capacity on the pinned press/day',
]

describe('planlanamayan kalemin çaresi', () => {
  it('her sebep bir eyleme karşılık gelir', () => {
    for (const reason of REASONS) {
      const fix = fixForUnplanned(reason)
      expect(fix.label.length, reason).toBeGreaterThan(0)
    }
  })

  it('sebebi doğru sayfaya yönlendirir', () => {
    expect(fixForUnplanned('No master data record found').to).toBe('/referanslar')
    expect(
      fixForUnplanned('No eligible press (main and alternative machines are undefined)').to,
    ).toBe('/referanslar')
    expect(fixForUnplanned('No presses defined').to).toBe('/makineler')
    expect(fixForUnplanned('Not enough free capacity in the visible calendar').to).toBe(
      '/takvim',
    )
  })

  it('bu sayfada çözülenler için bağlantı vermez', () => {
    // Kural bu sayfada duruyor; başka sayfaya göndermek yanlış olur.
    expect(fixForUnplanned('Excluded from planning by the user').to).toBeUndefined()
    expect(fixForUnplanned('something unexpected').to).toBeUndefined()
    expect(fixForUnplanned('something unexpected').label).toBe('Move to front')
  })
})

describe('flexible press', () => {
  it('sends a part with no main press to master data', () => {
    expect(
      fixForUnplanned('No main press defined — alternatives are used only when "Flexible press" is ticked'),
    ).toEqual({ label: 'Set main press or tick Flexible', to: '/referanslar' })
  })
})

