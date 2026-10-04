import { describe, expect, it } from 'vitest'

import { craneHall, withCraneHall } from './hall'

describe('craneHall', () => {
  it('tanımlı hol aynen kalır', () => {
    expect(craneHall({ name: 'PRS-1', hall: ' Hol 1 ' })).toBe('Hol 1')
  })
  it('holsüz work center kimseyle vinç paylaşmaz', () => {
    const a = craneHall({ name: 'PRS-1', hall: '' })
    const b = craneHall({ name: 'PRS-2', hall: '  ' })
    expect(a).not.toBe(b)
    expect(a).toContain('PRS-1')
  })
  it('kaydın diğer alanları korunur', () => {
    expect(withCraneHall({ name: 'X', hall: '', category: 'Transfer' })).toEqual({ name: 'X', hall: 'X (no hall)', category: 'Transfer' })
  })
})
