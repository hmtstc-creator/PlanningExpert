import { describe, expect, it } from 'vitest'

import { convexOrigins } from './securityHeaders'

describe('CSP: Convex adresleri', () => {
  it('Convex Cloud: yalnızca bulut adresleri', () => {
    expect(convexOrigins('https://happy-cat-123.convex.cloud')).toEqual(['https://*.convex.cloud', 'wss://*.convex.cloud', 'https://*.convex.site'])
    expect(convexOrigins(undefined)).toHaveLength(3)
  })

  it('kendi sunucumuzdaki Convex: HTTPS, WebSocket ve site adresi eklenir', () => {
    const o = convexOrigins('https://api.portal.example.com', 'https://files.portal.example.com')
    expect(o).toContain('https://api.portal.example.com')
    expect(o).toContain('wss://api.portal.example.com')
    expect(o).toContain('https://files.portal.example.com')
    expect(o).not.toContain('wss://files.portal.example.com')
  })

  it('okunamayan adres yok sayılır', () => {
    expect(convexOrigins('not a url')).toHaveLength(3)
  })
})
