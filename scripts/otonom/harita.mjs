#!/usr/bin/env node
// Sayfa ilişki haritası (wiki 13, T2): her rota dosyası için okunan Convex
// sorguları / mutasyonları, verdiği bağlantılar ve kullandığı bileşenler.
// Toplantı 1300 satırlık sayfa kodu yerine bu ~100 satırı okur.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const KOK = 'src/routes'
const dosyalar = []
const gez = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) gez(p)
    else if (/\.tsx$/.test(f) && !/\.test\./.test(f)) dosyalar.push(p)
  }
}
gez(KOK)
const tekil = (re, s) => [...new Set([...s.matchAll(re)].map((m) => m[1]))].sort()
const satirlar = [
  '# Sayfa ilişki haritası',
  '',
  '> Üreten: `scripts/otonom/harita.mjs` (elle düzenlenmez)',
  '',
  '| Rota | Satır | Okur (query) | Yazar (mutation) | Bağlantı | Bileşen |',
  '|---|---|---|---|---|---|',
]
for (const p of dosyalar.sort()) {
  const s = readFileSync(p, 'utf8')
  const rota = (s.match(/createFileRoute\('([^']+)'\)/) || [])[1] || relative(KOK, p)
  const q = tekil(/useQuery\(\s*api\.([\w.]+)/g, s)
  const m = tekil(/use(?:Mutation|Action)\(\s*api\.([\w.]+)/g, s)
  const l = tekil(/to[=:]\s*\{?['"](\/[\w\-/$.]*)['"]/g, s)
  const b = tekil(/from '\.\.\/(?:\.\.\/)?components\/([\w/]+)'/g, s)
  satirlar.push(`| ${rota} | ${s.split('\n').length} | ${q.join(', ')} | ${m.join(', ')} | ${l.join(', ')} | ${b.join(', ')} |`)
}
process.stdout.write(satirlar.join('\n') + '\n')
