import { describe, expect, it } from 'vitest'

import { sideOf, toValues } from './kpiForm'

describe('KPI giriş metni', () => {
  it('yüzde ekranda sayı, kayıtta kesir; boş girilmedi', () => {
    expect(toValues({ absenteeism: '3,5', operators: '24', volume: '', productivity: 'x' })).toEqual({ absenteeism: 0.035, operators: 24 })
    expect(sideOf({ absenteeism: 0.035, oee: 0.78, operators: 24 })).toMatchObject({
      absenteeism: '3.5',
      oee: '78',
      operators: '24',
      volume: '',
    })
  })
})
