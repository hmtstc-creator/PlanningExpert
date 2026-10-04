import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { BOARD_AREA, MODULE_AREAS, areaFor, areaLinks, nodeHas, type NavNode } from './navigation'

const depth = (n: NavNode): number => 1 + Math.max(0, ...(n.children ?? []).map(depth))
const routeFile = (to: string) =>
  ['.tsx', '/index.tsx'].some((ext) => existsSync(`src/routes${to}${ext}`)) || existsSync(`src/routes${to.replace(/\/$/, '')}.tsx`)

describe('menü ağacı', () => {
  const areas = [...MODULE_AREAS, BOARD_AREA]

  it('en çok üç kademe: çubuk → menü → alt menü', () => {
    for (const a of areas) for (const n of a.nav) expect(depth(n), `${a.key} ${n.label}`).toBeLessThanOrEqual(3)
  })

  it('düğüm ya bağlantı ya grup; grup boş değil', () => {
    const walk = (n: NavNode) => {
      expect(Boolean(n.to) !== Boolean(n.children?.length), n.label).toBe(true)
      n.children?.forEach(walk)
    }
    for (const a of areas) a.nav.forEach(walk)
  })

  it('bir alanda aynı sayfa iki kez yok ve her bağlantının sayfası var', () => {
    for (const a of areas) {
      const links = areaLinks(a).map((l) => l.to)
      expect(new Set(links).size, a.key).toBe(links.length)
      for (const to of links) expect(routeFile(to), to).toBe(true)
    }
  })

  it('alt menüdeki sayfa üst grubu işaretler', () => {
    const planning = areaFor('/stoklar')
    const menu = planning.nav.find((n) => n.children)!
    expect(nodeHas(menu, '/stoklar')).toBe(true)
    expect(nodeHas(menu, '/planlama')).toBe(false)
  })
})
