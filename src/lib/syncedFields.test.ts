import { describe, expect, it } from 'vitest'

import { changedFields } from './syncedFields'

describe('changedFields', () => {
  it('ilk yüklemede tüm alanları değişmiş sayar', () => {
    expect(changedFields(null, { a: 1, b: 'x' })).toEqual(['a', 'b'])
  })

  it('aynı veri tekrar geldiğinde hiçbir alanı değişmiş saymaz', () => {
    // Asıl hata buydu: sorgu tazelenince form sunucudaki eski değere dönüyordu.
    const prev = { shiftStartMinute: 480, planningHorizonWeeks: 4 }
    const next = { shiftStartMinute: 480, planningHorizonWeeks: 4 }
    expect(changedFields(prev, next)).toEqual([])
  })

  it('yalnızca sunucuda değişen alanı bildirir', () => {
    const prev = { shiftStartMinute: 480, planningHorizonWeeks: 4, country: 'TR' }
    const next = { shiftStartMinute: 480, planningHorizonWeeks: 12, country: 'TR' }
    expect(changedFields(prev, next)).toEqual(['planningHorizonWeeks'])
  })

  it('sıfıra ve boş metne dönen değerleri de yakalar', () => {
    expect(changedFields({ breakMinutesPerShift: 30 }, { breakMinutesPerShift: 0 })).toEqual([
      'breakMinutesPerShift',
    ])
    expect(changedFields({ country: 'TR' }, { country: '' })).toEqual(['country'])
  })
})
