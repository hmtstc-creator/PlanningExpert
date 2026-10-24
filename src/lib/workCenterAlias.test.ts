import { describe, expect, it } from 'vitest'

import { nextAliases, renameTopicKey, resolveCode } from './workCenterAlias'

describe('work center kod eşlemesi (K5)', () => {
  it('PRS-106 → PRS-206: eski kodla gelen satır yeni koda gider', () => {
    const list = nextAliases([], 'PRS-106', 'PRS-206')
    expect(list).toEqual([{ from: 'PRS-106', to: 'PRS-206' }])
    const map = new Map(list.map((a) => [a.from, a.to]))
    expect(resolveCode(map, 'PRS-106')).toBe('PRS-206')
    expect(resolveCode(map, 'PRS-107')).toBe('PRS-107')
  })

  it('zincir kısalır: A → B, sonra B → C ise A da C olur', () => {
    const list = nextAliases(nextAliases([], 'A', 'B'), 'B', 'C')
    expect(list).toEqual([
      { from: 'A', to: 'C' },
      { from: 'B', to: 'C' },
    ])
  })

  it('geri dönüş: A → B, sonra B → A ise A gerçek kod olur, eşleme kalmaz döngü olmaz', () => {
    const list = nextAliases(nextAliases([], 'A', 'B'), 'B', 'A')
    expect(list).toEqual([{ from: 'B', to: 'A' }])
    const map = new Map(list.map((a) => [a.from, a.to]))
    expect(resolveCode(map, 'A')).toBe('A')
    expect(resolveCode(map, 'B')).toBe('A')
  })

  it('bozuk döngüde bile durur', () => {
    const map = new Map([
      ['A', 'B'],
      ['B', 'A'],
    ])
    expect(['A', 'B']).toContain(resolveCode(map, 'A'))
  })

  it('açık konu anahtarında yalnız iş yeri kısmı değişir', () => {
    expect(renameTopicKey('4711|PRS-106|setup', 'PRS-106', 'PRS-206')).toBe('4711|PRS-206|setup')
    expect(renameTopicKey('PRS-106|PRS-107|setup', 'PRS-106', 'PRS-206')).toBe('PRS-106|PRS-107|setup')
  })
})
