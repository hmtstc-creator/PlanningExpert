import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Yetki denetiminin kaynak düzeyinde korunması.
 *
 * Tek bir korumasız işlev, girişin tamamını anlamsız kılar — ve bu sessiz
 * bir hatadır: uygulama çalışmaya devam eder. Bu yüzden "hangi işlev
 * korumasız" sorusu koda bakılarak cevaplanıyor.
 */
const OPEN_BY_DESIGN: Record<string, string[]> = {
  // Girerken elde jeton olmaz.
  'auth.ts': ['login', 'seedAdmin', 'logout'],
  // Jetonun kime ait olduğunu söyleyen sorgu; denetim onun işi.
  'authInternal.ts': ['me'],
}

const SKIP = new Set(['schema.ts', 'authGuard.ts', 'guarded.ts', 'uploadFilter.ts'])

function convexFiles(): { name: string; source: string }[] {
  return readdirSync('convex')
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !SKIP.has(name))
    .map((name) => ({ name, source: readFileSync(join('convex', name), 'utf-8') }))
}

/** `export const x = query({` / `mutation({` biçimindeki tanımlar. */
function rawExports(source: string): { name: string; kind: string }[] {
  const out: { name: string; kind: string }[] = []
  const pattern = /^export const (\w+) = (query|mutation)\(\{/gm
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    out.push({ name: match[1], kind: match[2] })
  }
  return out
}

describe('sunucu tarafı yetki denetimi', () => {
  it('korumasız kalan tek işlev, bilerek muaf tutulanlardır', () => {
    const unguarded: string[] = []
    for (const { name, source } of convexFiles()) {
      const allowed = OPEN_BY_DESIGN[name] ?? []
      for (const fn of rawExports(source)) {
        if (!allowed.includes(fn.name)) unguarded.push(`${name}:${fn.name} (${fn.kind})`)
      }
    }
    expect(unguarded).toEqual([])
  })

  it('muaf tutulanlar gerçekten var — liste eskimesin', () => {
    // Muaf listesi, silinmiş bir işlevi göstermeye devam ederse kimse fark
    // etmez ve koruma boşluğu o adla geri gelebilir.
    for (const [file, names] of Object.entries(OPEN_BY_DESIGN)) {
      const source = readFileSync(join('convex', file), 'utf-8')
      for (const name of names) {
        expect(source, `${file}:${name}`).toMatch(
          new RegExp(`export const ${name} = (query|mutation|action)\\(`),
        )
      }
    }
  })

  it('muaf işlevler de jeton alanını tanımlar', () => {
    // Taşıma katmanı her çağrıya jeton ekliyor; tanımlamayan işlev
    // "bilinmeyen alan" hatası verir ve giriş tümden çalışmaz.
    for (const [file, names] of Object.entries(OPEN_BY_DESIGN)) {
      const source = readFileSync(join('convex', file), 'utf-8')
      for (const name of names) {
        const start = source.indexOf(`export const ${name} =`)
        const body = source.slice(start, start + 600)
        expect(body, `${file}:${name} jeton alanını tanımlamalı`).toContain('token:')
      }
    }
  })

  it('kullanıcı ve liste yönetimi yalnızca yöneticide', () => {
    const users = readFileSync('convex/users.ts', 'utf-8')
    for (const fn of ['add', 'update', 'remove']) {
      expect(users).toContain(`export const ${fn} = adminMutation({`)
    }
    const lookups = readFileSync('convex/lookups.ts', 'utf-8')
    for (const fn of ['add', 'remove', 'seedDefaults']) {
      expect(lookups).toContain(`export const ${fn} = adminMutation({`)
    }
  })

  it('her koruma sarmalayıcısı içe aktarılmış', () => {
    // `guardedQuery(` yazıp import etmemek çalışma anında patlardı.
    for (const { name, source } of convexFiles()) {
      for (const wrapper of ['guardedQuery', 'guardedMutation', 'adminMutation']) {
        if (source.includes(`= ${wrapper}({`)) {
          expect(source, `${name} ${wrapper} import etmeli`).toMatch(
            new RegExp(`import \\{[^}]*${wrapper}[^}]*\\} from './guarded'`),
          )
        }
      }
    }
  })
})
