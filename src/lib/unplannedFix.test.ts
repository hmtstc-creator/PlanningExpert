import { describe, expect, it } from 'vitest'

import { fixForUnplanned } from './unplannedFix'

// Motorun ürettiği gerçek sebep metinleri — scheduler.ts ile aynı olmalı.
const REASONS = [
  'No master data record found',
  'No eligible work center (main and alternative machines are undefined)',
  'Pinned work center is not defined: PRS-9',
  'Excluded from planning by the user',
  'No work centers defined',
  'Not enough free capacity in the visible calendar',
  'Not enough free capacity on the pinned work center/day',
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
      fixForUnplanned('No eligible work center (main and alternative machines are undefined)').to,
    ).toBe('/referanslar')
    expect(fixForUnplanned('No work centers defined').to).toBe('/makineler')
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

describe('flexible work center', () => {
  it('sends a part with no main work center to master data', () => {
    expect(
      fixForUnplanned('No main work center defined — alternatives are used only when "Flexible work center" is ticked'),
    ).toEqual({ label: 'Set main work center or tick Flexible', to: '/referanslar' })
  })
})

describe('held dies', () => {
  it('sends a held die to die readiness', () => {
    expect(fixForUnplanned('Mould held: not ready and no ready date')).toEqual({
      label: 'Check the die',
      to: '/die-followup/maintenance',
    })
  })
})

