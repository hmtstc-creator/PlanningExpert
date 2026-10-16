#!/usr/bin/env node
// İki Convex dışa aktarımını (zip) karşılaştırır: taşımada veri kaybı yok mu?
//
//   node scripts/compare-exports.mjs <kaynak.zip> <hedef.zip>
//
// Kaynak: geri yüklenen yedek (ör. backups/daily-….zip). Hedef: o yedek bir
// Convex'e yüklendikten sonra oradan YENİDEN alınan yedek. Her tablo için belge
// sayısı ve kimlikler (_id) birebir aynı olmalı, dosya deposundaki (fotoğraflar)
// dosyalar da. Fark varsa çıkış kodu 1 (deploy/README.md → Geri yükleme provası).
//
// Bağımlılık yok: zip'in içindekiler dizini Node'un zlib'iyle okunur.

import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'

/** Zip'teki dosyalar: ad → içerik okuyucu (yalnızca istenince açılır). */
export function readZip(buf) {
  // Dizin sonu kaydı (End of Central Directory) sondan aranır.
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end of central directory)')
  let count = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  // Zip64 (büyük yedek): gerçek sayı ve konum Zip64 kaydında.
  if (count === 0xffff || offset === 0xffffffff) {
    const loc = eocd - 20
    if (loc >= 0 && buf.readUInt32LE(loc) === 0x07064b50) {
      const z64 = Number(buf.readBigUInt64LE(loc + 8))
      count = Number(buf.readBigUInt64LE(z64 + 32))
      offset = Number(buf.readBigUInt64LE(z64 + 48))
    }
  }
  const files = new Map()
  let p = offset
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Broken zip central directory')
    const method = buf.readUInt16LE(p + 10)
    let compressed = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    let local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    // Zip64 ek alanı: 0xffffffff olan değerler sırayla burada.
    let e = p + 46 + nameLen
    const end = e + extraLen
    while (e + 4 <= end) {
      const id = buf.readUInt16LE(e)
      const size = buf.readUInt16LE(e + 2)
      if (id === 0x0001) {
        let q = e + 4
        if (buf.readUInt32LE(p + 24) === 0xffffffff) q += 8
        if (compressed === 0xffffffff) {
          compressed = Number(buf.readBigUInt64LE(q))
          q += 8
        }
        if (local === 0xffffffff) local = Number(buf.readBigUInt64LE(q))
      }
      e += 4 + size
    }
    files.set(name, () => {
      const lnName = buf.readUInt16LE(local + 26)
      const lnExtra = buf.readUInt16LE(local + 28)
      const start = local + 30 + lnName + lnExtra
      const data = buf.subarray(start, start + compressed)
      if (method === 0) return data
      if (method === 8) return inflateRawSync(data)
      throw new Error(`Unsupported zip compression ${method} in ${name}`)
    })
    p = end + commentLen
  }
  return files
}

/**
 * Dışa aktarımın özeti: tablo → kimlik listesi; `_storage` (dosya deposu)
 * dahil. Convex dışa aktarımında her tablo `<tablo>/documents.jsonl`.
 */
export function summarize(files) {
  const tables = new Map()
  for (const [name, open] of files) {
    const m = /^(?:(.+)\/)?([^/]+)\/documents\.jsonl$/.exec(name)
    if (!m) continue
    // Bileşen (component) tabloları "<bileşen>/<tablo>/documents.jsonl".
    const table = m[1] ? `${m[1]}/${m[2]}` : m[2]
    const ids = []
    for (const line of open().toString('utf8').split('\n')) {
      if (!line.trim()) continue
      const doc = JSON.parse(line)
      ids.push(String(doc._id ?? ''))
    }
    tables.set(table, ids)
  }
  return tables
}

/** Farklar: eksik tablo, sayı farkı, kaynakta olup hedefte olmayan kimlikler. */
export function compare(source, target) {
  const problems = []
  const rows = []
  for (const [table, ids] of [...source].sort((a, b) => a[0].localeCompare(b[0]))) {
    const other = target.get(table)
    if (!other) {
      if (ids.length) problems.push(`${table}: missing in target (${ids.length} documents in source)`)
      rows.push([table, ids.length, '—'])
      continue
    }
    rows.push([table, ids.length, other.length])
    const have = new Set(other)
    const missing = ids.filter((id) => !have.has(id))
    if (missing.length) problems.push(`${table}: ${missing.length} document(s) missing in target, e.g. ${missing.slice(0, 3).join(', ')}`)
    else if (other.length !== ids.length) problems.push(`${table}: ${ids.length} in source, ${other.length} in target`)
  }
  for (const [table, ids] of target) if (!source.has(table) && ids.length) rows.push([table, '—', ids.length])
  return { ok: problems.length === 0, problems, rows }
}

function main(argv) {
  const [a, b] = argv
  if (!a || !b) {
    console.error('Usage: node scripts/compare-exports.mjs <source.zip> <target.zip>')
    return 2
  }
  const source = summarize(readZip(readFileSync(a)))
  const target = summarize(readZip(readFileSync(b)))
  const { ok, problems, rows } = compare(source, target)
  const w = Math.max(5, ...rows.map((r) => String(r[0]).length))
  console.log(`${'Table'.padEnd(w)}  ${'source'.padStart(8)}  ${'target'.padStart(8)}`)
  for (const [t, s, d] of rows) console.log(`${String(t).padEnd(w)}  ${String(s).padStart(8)}  ${String(d).padStart(8)}`)
  const total = (m) => [...m.values()].reduce((x, ids) => x + ids.length, 0)
  console.log(`\n${source.size} tables, ${total(source)} documents in source; ${target.size} tables, ${total(target)} in target.`)
  if (ok) {
    console.log('OK — every document of the source is in the target.')
    return 0
  }
  console.error(`\nNOT OK — ${problems.length} problem(s):`)
  for (const p of problems) console.error(`  - ${p}`)
  return 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main(process.argv.slice(2)))
