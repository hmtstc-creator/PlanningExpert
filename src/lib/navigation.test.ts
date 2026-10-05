import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { BOARD_AREA, MODULE_AREAS, RELATED_PAGE_MAP, areaFor, areaLinks, nodeHas, type NavNode } from './navigation'

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

  it('kısayol haritasındaki her sayfa ve hedef var', () => {
    for (const [from, targets] of Object.entries(RELATED_PAGE_MAP)) {
      expect(routeFile(from), from).toBe(true)
      for (const to of targets) {
        expect(routeFile(to), `${from} → ${to}`).toBe(true)
        expect(to, `${from} kendine bağlanmaz`).not.toBe(from)
      }
    }
  })

  it('kaynak koddaki her sabit bağlantı (to="/…") bir sayfaya gider', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !e.name.includes('.test.') && e.name !== 'routeTree.gen.ts' ? [join(dir, e.name)] : [],
      )
    const broken: string[] = []
    for (const f of files('src')) {
      const src = readFileSync(f, 'utf-8')
      for (const m of src.matchAll(/\bto(?:=|: )["'](\/[A-Za-z0-9/_-]*)["']/g)) {
        const to = m[1].replace(/\/$/, '') || '/'
        if (to === '/' ) continue
        if (!routeFile(to)) broken.push(`${f}: ${to}`)
      }
    }
    expect(broken).toEqual([])
  })

  it('her modül sayfasının kısayolu var', () => {
    for (const a of areas) for (const l of areaLinks(a)) expect(RELATED_PAGE_MAP[l.to]?.length ?? 0, l.to).toBeGreaterThan(0)
  })
})

