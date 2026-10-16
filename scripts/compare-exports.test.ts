import { deflateRawSync, crc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { compare, readZip, summarize } from './compare-exports.mjs'

/** Küçük zip yazıcı (yalnızca test): `deflate` ile sıkıştırılmış ya da sıkıştırmasız girdiler. */
function makeZip(entries: Record<string, string>, deflate = true): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text)
    const data = deflate ? deflateRawSync(raw) : raw
    const nameBuf = Buffer.from(name)
    const crc = crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(deflate ? 8 : 0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(deflate ? 8 : 0, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, data)
    centrals.push(central, nameBuf)
    offset += local.length + nameBuf.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(Object.keys(entries).length, 8)
  eocd.writeUInt16LE(Object.keys(entries).length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

const jsonl = (...ids: string[]) => ids.map((id) => JSON.stringify({ _id: id, _creationTime: 1, x: 'ğüşİ' })).join('\n') + '\n'

describe('dışa aktarım karşılaştırması (taşımada veri kaybı yok mu)', () => {
  const source = makeZip({
    'presses/documents.jsonl': jsonl('a1', 'a2', 'a3'),
    'presses/generated_schema.jsonl': '{}\n',
    'oeeDays/documents.jsonl': jsonl('d1'),
    '_storage/documents.jsonl': jsonl('s1', 's2'),
    '_storage/s1.blob': 'photo',
  })

  it('zip okunur, her tablonun kimlikleri çıkar (sıkıştırmalı ve sıkıştırmasız)', () => {
    for (const z of [source, makeZip({ 't/documents.jsonl': jsonl('x') }, false)]) {
      const s = summarize(readZip(z))
      expect(s.size).toBeGreaterThan(0)
    }
    const s = summarize(readZip(source))
    expect(s.get('presses')).toEqual(['a1', 'a2', 'a3'])
    expect(s.get('_storage')).toEqual(['s1', 's2'])
  })

  it('aynı içerik: tamam', () => {
    const r = compare(summarize(readZip(source)), summarize(readZip(source)))
    expect(r.ok).toBe(true)
    expect(r.problems).toEqual([])
  })

  it('eksik belge, eksik tablo ve eksik dosya yakalanır', () => {
    const target = makeZip({
      'presses/documents.jsonl': jsonl('a1', 'a3'),
      '_storage/documents.jsonl': jsonl('s1'),
    })
    const r = compare(summarize(readZip(source)), summarize(readZip(target)))
    expect(r.ok).toBe(false)
    expect(r.problems.join('\n')).toContain('presses: 1 document(s) missing in target, e.g. a2')
    expect(r.problems.join('\n')).toContain('oeeDays: missing in target')
    expect(r.problems.join('\n')).toContain('_storage: 1 document(s) missing')
  })

  it('hedefte fazladan belge: sayı farkı olarak bildirilir', () => {
    const target = makeZip({
      'presses/documents.jsonl': jsonl('a1', 'a2', 'a3', 'a4'),
      'oeeDays/documents.jsonl': jsonl('d1'),
      '_storage/documents.jsonl': jsonl('s1', 's2'),
    })
    const r = compare(summarize(readZip(source)), summarize(readZip(target)))
    expect(r.ok).toBe(false)
    expect(r.problems).toEqual(['presses: 3 in source, 4 in target'])
  })

  it('bileşen tabloları ayrı sayılır', () => {
    const s = summarize(readZip(makeZip({ 'auth/sessions/documents.jsonl': jsonl('x', 'y') })))
    expect(s.get('auth/sessions')).toEqual(['x', 'y'])
  })
})
