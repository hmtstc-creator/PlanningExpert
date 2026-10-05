import { describe, expect, it } from 'vitest'

import type { Signal } from './cockpit'
import { EMPTY_DIGEST, composeDigest, digestDue, digestProblems, digestSignals, localNow } from './digest'

const cfg = { ...EMPTY_DIGEST, enabled: true, time: '07:30', days: ['MO', 'TU', 'WE', 'TH', 'FR'], to: ['plant.manager@example.com'] }

describe('günlük özet', () => {
  it('plant saatine göre zaman', () => {
    // 2026-10-05 Pazartesi 05:00 UTC = Bükreş 08:00.
    const l = localNow(Date.UTC(2026, 9, 5, 5, 0), 'Europe/Bucharest')
    expect(l).toEqual({ date: '2026-10-05', day: 'MO', minutes: 480 })
  })

  it('seçili gün ve saat geldiyse, bugün gönderilmediyse', () => {
    const mon = (minutes: number) => ({ date: '2026-10-05', day: 'MO', minutes })
    expect(digestDue(cfg, mon(7 * 60 + 29))).toBe(false)
    expect(digestDue(cfg, mon(7 * 60 + 30))).toBe(true)
    // Saat geçmiş ama bugün gitmemiş (sunucu o an kapalıydı): yine gider.
    expect(digestDue(cfg, mon(11 * 60))).toBe(true)
    expect(digestDue(cfg, mon(11 * 60), '2026-10-05')).toBe(false)
    expect(digestDue(cfg, { date: '2026-10-04', day: 'SU', minutes: 600 })).toBe(false)
    expect(digestDue({ ...cfg, enabled: false }, mon(600))).toBe(false)
    expect(digestDue({ ...cfg, to: [] }, mon(600))).toBe(false)
  })

  it('ayar denetimi', () => {
    expect(digestProblems(cfg)).toEqual([])
    expect(digestProblems({ ...cfg, time: '25:00', to: ['x'], days: [] })).toEqual([
      'Time must be HH:MM (00:00–23:59)',
      'Not an email address: x',
      'Choose at least one day',
    ])
    expect(digestProblems({ ...cfg, to: [] })).toContain('Add at least one recipient')
  })

  const signals: Signal[] = [
    { key: 'planError', level: 'critical', title: 'The last plan calculation failed', to: '/planlama' },
    { key: 'late', level: 'critical', title: '2 parts late', items: [{ text: 'A on P1', sub: 'overtime' }], to: '/planlama' },
    { key: 'dieProblems', level: 'warning', title: '1 open die problem', to: '/die-followup/problems' },
  ]

  it('seçilen türler; boşsa hepsi', () => {
    expect(digestSignals(signals, { signals: [] })).toHaveLength(3)
    expect(digestSignals(signals, { signals: ['plan', 'late'] }).map((s) => s.key)).toEqual(['planError', 'late'])
  })

  it('konu sayıları söyler; metin bağlantıları içerir', () => {
    const d = composeDigest({ company: 'Metal Stamping', plant: 'Romania' }, signals, { date: '2026-10-05', appUrl: 'https://portal.example.com/' })
    expect(d.subject).toBe('Romania — Today 2026-10-05: 2 critical, 1 warning')
    expect(d.text).toContain('[CRITICAL] 2 parts late')
    expect(d.text).toContain('  - A on P1 (overtime)')
    expect(d.text).toContain('https://portal.example.com/planlama')
    expect(d.html).toContain('<b>Metal Stamping · Romania</b>')
    expect(composeDigest({ company: 'C', plant: 'P' }, [], { date: 'd' }).subject).toBe('P — Today d: all clear')
  })
})
