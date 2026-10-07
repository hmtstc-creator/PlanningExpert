import { describe, expect, it } from 'vitest'

import { sameStored } from './oeeStore'

describe('değişmeyen satır yeniden yazılmaz', () => {
  const doc = {
    date: '2026-09-21',
    workCenter: 'PRS-106',
    good: 10,
    events: [['6597582', '', 1.5]],
    codes: { 'UNSCD_DOWN|ARZ': [75.4, 12] },
  }

  it('sistem alanları dışında aynıysa aynı', () => {
    expect(sameStored({ _id: 'x', _creationTime: 1, plantId: 'p', ...doc }, { ...doc })).toBe(true)
    // Anahtar sırası ve tanımsız alan fark etmez.
    expect(
      sameStored(
        { _id: 'x', good: 10, date: '2026-09-21', workCenter: 'PRS-106', events: doc.events, codes: doc.codes },
        { ...doc, sheet: undefined },
      ),
    ).toBe(true)
  })

  it('bir değer, bir dizi öğesi ya da fazla / eksik alan farklıysa yazılır', () => {
    const stored = { _id: 'x', plantId: 'p', ...doc }
    expect(sameStored(stored, { ...doc, good: 11 })).toBe(false)
    expect(sameStored(stored, { ...doc, events: [['6597582', '', 1.6]] })).toBe(false)
    expect(sameStored(stored, { ...doc, codes: { 'UNSCD_DOWN|ARZ': [75.4, 12], 'UNSCD_DOWN|KLP': [1, 1] } })).toBe(false)
    expect(sameStored({ ...stored, responsible: '601' }, doc)).toBe(false)
    expect(sameStored(stored, { ...doc, shiftGroup: 'UB64' })).toBe(false)
  })
})
