import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { sha256Hex } from './sha256'

describe('sha256Hex', () => {
  it('bilinen değerler (FIPS 180-4)', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  })

  it('Node kriptosuyla aynı (rastgele jetonlar, blok sınırları, UTF-8)', () => {
    for (let n = 0; n < 200; n++) {
      const s = randomBytes(n).toString('hex')
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s).digest('hex'))
    }
    expect(sha256Hex('çğıöşü — İstanbul')).toBe(createHash('sha256').update('çğıöşü — İstanbul').digest('hex'))
  })
})
