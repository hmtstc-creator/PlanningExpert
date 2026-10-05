import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { pwnedCount, pwnedMessage, splitSha1 } from './pwned'

describe('sızmış parola', () => {
  it('servise yalnızca 5 hane gider', () => {
    const hex = createHash('sha1').update('password1').digest('hex')
    const { prefix, suffix } = splitSha1(hex)
    expect(prefix).toHaveLength(5)
    expect(suffix).toHaveLength(35)
    expect(prefix + suffix).toBe(hex.toUpperCase())
  })

  it('cevapta sonu arar; dolgu satırı (0) sayılmaz', () => {
    const body = [
      '0018A45C4D1DEF81644B54AB7F969B88D65:3',
      'E38AD214943DAAD1D64C102FAEC29DE4AFE9DA3D:0',
      '00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2',
    ].join('\r\n')
    expect(pwnedCount(body, '00d4f6e8fa6eecad2a3aa415eec418d38ec')).toBe(2)
    expect(pwnedCount(body, 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')).toBe(0)
    expect(pwnedCount('ABC:0', 'ABC')).toBe(0)
  })

  it('mesaj sayıyı söyler', () => {
    expect(pwnedMessage(12345)).toContain('12,345 times')
  })
})
