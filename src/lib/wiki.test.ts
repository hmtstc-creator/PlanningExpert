import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// docs/wiki bütünlüğü: dizin her sayfayı listeler, bütün göreli bağlantılar çalışır,
// her sayfada "Son güncelleme" satırı vardır. Wiki, yeni sohbet açılmadığı için
// programın kalıcı hafızasıdır (docs/wiki/README.md).

const WIKI = join(process.cwd(), 'docs/wiki')
const pages = readdirSync(WIKI).filter((f) => f.endsWith('.md'))
const index = readFileSync(join(WIKI, 'README.md'), 'utf8')

describe('docs/wiki', () => {
  it('has an index and chapters', () => {
    expect(pages).toContain('README.md')
    expect(pages.length).toBeGreaterThanOrEqual(11)
  })

  it.each(pages.filter((p) => p !== 'README.md'))('%s is listed in the index', (page) => {
    expect(index).toContain(`(${page})`)
  })

  it.each(pages)('%s has a "Son güncelleme" line', (page) => {
    expect(readFileSync(join(WIKI, page), 'utf8')).toMatch(/Son güncelleme: \d{4}-\d{2}-\d{2}/)
  })

  it.each(pages)('%s: every relative link points to an existing file', (page) => {
    const text = readFileSync(join(WIKI, page), 'utf8')
    const broken: string[] = []
    for (const m of text.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
      const target = m[1]
      if (/^(https?:|mailto:)/.test(target)) continue
      if (!existsSync(resolve(dirname(join(WIKI, page)), target))) broken.push(target)
    }
    expect(broken).toEqual([])
  })
})
