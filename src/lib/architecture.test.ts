import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Mimari değişmezler (docs/wiki/01-sistem-haritasi.md, docs/architecture.md §1):
//   src/lib (saf hesap)  ←  convex (sunucu)  ←  src/routes + src/components (arayüz)
// Bir bağımlılık yönü bozulursa bu test kırılır; kural ihlali "geçici" diye
// listeye eklenmez — önce wiki/07'deki mimari etki kontrolü yapılır.

const ROOT = process.cwd()
const files = (dir: string, ext: RegExp) =>
  readdirSync(join(ROOT, dir)).filter((f) => ext.test(f) && !/\.test\.tsx?$/.test(f))

/** Dosyanın içe aktarma yolları ve `import type` olup olmadığı. */
function importsOf(path: string): { from: string; typeOnly: boolean }[] {
  const text = readFileSync(join(ROOT, path), 'utf8')
  const out: { from: string; typeOnly: boolean }[] = []
  for (const m of text.matchAll(/^import\s+(type\s+)?[\s\S]*?\sfrom\s+'([^']+)'/gm)) out.push({ from: m[2], typeOnly: !!m[1] })
  // Yalnızca yan etkili içe aktarma: import 'react'
  for (const m of text.matchAll(/^import\s+'([^']+)'/gm)) out.push({ from: m[1], typeOnly: false })
  // Dinamik içe aktarma: import('react')
  for (const m of text.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)) out.push({ from: m[1], typeOnly: false })
  return out
}

const UI = /^(react|react-dom|@tanstack\/[\w-]+|convex\/react)(\/|$)/
const UI_PATH = /(^|\/)(routes|components)(\/|$)/
const CONVEX_PATH = /(^|\/)convex(\/|$)/

// Tarayıcıya / React'e bağlı kalan eski yardımcılar (hook değiller). Yeni dosya
// eklenmez; mümkün olunca `use*.ts` hook'u ya da `.tsx` yapılır.
const REACT_BOUND_DEBT = new Set(['oeeFilters.ts', 'serverReachability.ts', 'shortcuts.ts'])

describe('architecture: src/lib is the pure calculation layer', () => {
  const pure = files('src/lib', /\.ts$/).filter((f) => !f.startsWith('use') && !REACT_BOUND_DEBT.has(f))

  it('has pure files to check', () => {
    expect(pure.length).toBeGreaterThan(50)
  })

  it.each(pure)('%s does not import React, TanStack, Convex client, pages, components or convex/', (file) => {
    const bad = importsOf(`src/lib/${file}`).filter(
      (i) => UI.test(i.from) || UI_PATH.test(i.from) || CONVEX_PATH.test(i.from),
    )
    expect(bad.map((i) => i.from)).toEqual([])
  })

  it('the React-bound debt list only shrinks (every entry still exists and still needs React)', () => {
    for (const f of REACT_BOUND_DEBT) {
      const bound = importsOf(`src/lib/${f}`).some((i) => UI.test(i.from) || UI_PATH.test(i.from) || CONVEX_PATH.test(i.from))
      expect(bound, `${f} is pure now — remove it from REACT_BOUND_DEBT`).toBe(true)
    }
  })
})

describe('architecture: server and UI layers', () => {
  it('convex/ never imports pages or components', () => {
    const bad = files('convex', /\.ts$/).flatMap((f) =>
      importsOf(`convex/${f}`)
        .filter((i) => UI_PATH.test(i.from))
        .map((i) => `${f} → ${i.from}`),
    )
    expect(bad).toEqual([])
  })

  it('Convex hooks only via convexTransport (it adds the session token)', () => {
    // convex/react'tan doğrudan useQuery / useMutation jetonsuz çağırır: sunucu
    // oturumu bulamaz, sayfa "Server Error" verir (2026-10-28, dayShifts:list).
    const walk = (dir: string): string[] =>
      readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(`${dir}/${d.name}`) : /\.tsx?$/.test(d.name) && !/\.test\./.test(d.name) ? [`${dir}/${d.name}`] : [],
      )
    const allowed = new Set(['src/lib/convexTransport.tsx', 'src/components/convex-client-provider.tsx'])
    const bad = walk('src')
      .filter((f) => !allowed.has(f))
      .filter((f) => /import\s*\{[^}]*\b(useQuery|useMutation|useAction)\b[^}]*\}\s*from\s*'convex\/react'/.test(readFileSync(join(ROOT, f), 'utf8')))
    expect(bad).toEqual([])
  })

  it('components never import pages (routes)', () => {
    const walk = (dir: string): string[] =>
      readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(`${dir}/${d.name}`) : /\.tsx?$/.test(d.name) && !/\.test\./.test(d.name) ? [`${dir}/${d.name}`] : [],
      )
    const bad = walk('src/components').flatMap((f) =>
      importsOf(f)
        .filter((i) => /(^|\/)routes(\/|$)/.test(i.from))
        .map((i) => `${f} → ${i.from}`),
    )
    expect(bad).toEqual([])
  })
})

describe('architecture: the independent validator stays independent', () => {
  it('planValidator.ts takes only types from the engine; runtime imports are limited', () => {
    const runtime = importsOf('src/lib/planValidator.ts')
      .filter((i) => !i.typeOnly)
      .map((i) => i.from)
      .sort()
    // Depo matrisi ve ayar varsayılanları tek kaynaktır (paylaşılması istenen); hesap kodu paylaşılmaz.
    expect(runtime).toEqual(['./settingsDefaults', './stockLocations'])
  })

  it('the engine core does not import the validator at run time (only planPipeline orchestrates it)', () => {
    const users = ['scheduler.ts', 'planning.ts', 'rawMrp.ts', 'capacityModel.ts', 'pressCalendar.ts', 'shiftTimeline.ts'].filter((f) =>
      importsOf(`src/lib/${f}`).some((i) => /planValidator/.test(i.from)),
    )
    expect(users).toEqual([])
  })

  it('the scheduler depends only on planning, dates and shift helpers (no pipeline, no validator)', () => {
    const froms = importsOf('src/lib/scheduler.ts').map((i) => i.from)
    expect(froms.filter((f) => /planPipeline|planValidator/.test(f))).toEqual([])
  })
})
