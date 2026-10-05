import { describe, expect, it } from 'vitest'

import { MAX_PINS, MAX_RECENT, parseShortcuts, pushRecent, togglePin } from './shortcuts'

describe('kısayollar', () => {
  it('son açılan başa, tekrar yok, sınırlı', () => {
    expect(pushRecent(['/a', '/b'], '/b')).toEqual(['/b', '/a'])
    const many = Array.from({ length: 10 }, (_, i) => `/p${i}`).reduce(pushRecent, [] as string[])
    expect(many).toHaveLength(MAX_RECENT)
    expect(many[0]).toBe('/p9')
  })

  it('sabitle / kaldır', () => {
    expect(togglePin(['/a'], '/b')).toEqual(['/a', '/b'])
    expect(togglePin(['/a', '/b'], '/a')).toEqual(['/b'])
    const full = Array.from({ length: MAX_PINS }, (_, i) => `/p${i}`)
    expect(togglePin(full, '/new')).toEqual([...full.slice(1), '/new'])
  })

  it('bozuk kayıt sorun çıkarmaz', () => {
    expect(parseShortcuts(null)).toEqual({ pins: [], recent: [] })
    expect(parseShortcuts('{bad')).toEqual({ pins: [], recent: [] })
    expect(parseShortcuts(JSON.stringify({ pins: ['/a', 'javascript:alert(1)', 5, '/a'], recent: 'x' }))).toEqual({
      pins: ['/a'],
      recent: [],
    })
  })
})
