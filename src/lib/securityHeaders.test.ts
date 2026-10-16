import { describe, expect, it } from 'vitest'

import { convexOrigins } from './securityHeaders'

describe('CSP: Convex adresleri', () => {
  it('adres yoksa yalnızca kendi sitemiz (bulut adresi eklenmez)', () => {
    expect(convexOrigins(undefined)).toEqual([])
    expect(convexOrigins('https://planningexpert.tail1234.ts.net:8443').some((o) => o.includes('convex.cloud'))).toBe(false)
  })

  it('kendi sunucumuzdaki Convex: HTTPS, WebSocket ve site adresi eklenir', () => {
    const o = convexOrigins('https://api.portal.example.com', 'https://files.portal.example.com')
    expect(o).toContain('https://api.portal.example.com')
    expect(o).toContain('wss://api.portal.example.com')
    expect(o).toContain('https://files.portal.example.com')
    expect(o).not.toContain('wss://files.portal.example.com')
  })

  it('Tailscale Funnel adresi, kapı numarasıyla', () => {
    const o = convexOrigins('https://planningexpert.tail1234.ts.net:8443')
    expect(o).toContain('https://planningexpert.tail1234.ts.net:8443')
    expect(o).toContain('wss://planningexpert.tail1234.ts.net:8443')
  })

  it('okunamayan adres yok sayılır', () => {
    expect(convexOrigins('not a url')).toEqual([])
  })
})
