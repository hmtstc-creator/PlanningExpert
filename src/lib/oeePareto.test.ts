import { describe, expect, it } from 'vitest'

import { EMPTY_CONFIG, type LossDay, type OeeConfig } from './oee'
import { columnMinutes, machineMinutes, paretoView, subLossMachines, subLossMinutes, topMaterials } from './oeePareto'

const cfg: OeeConfig = {
  ...EMPTY_CONFIG,
  lossReasonCodes: ['UNSCD_DOWN'],
  breakReasonCodes: ['SCHED_DOWN'],
  lossGroups: [{ code: 'STP', label: 'Setup', chart: 'STP', breakdown: false }],
}

const day = (workCenter: string, codes: LossDay['codes'], reasons: LossDay['reasons']): LossDay => ({
  date: '2026-10-26',
  costCenter: 'C',
  workCenter,
  codes,
  reasons,
})

describe('paretoView', () => {
  it('büyükten küçüğe sıralar, kümülatif % son çubukta 100 olur', () => {
    const v = paretoView([
      { key: 'A', value: 10 },
      { key: 'B', value: 30 },
      { key: 'C', value: 60 },
    ])
    expect(v.bars.map((b) => b.key)).toEqual(['C', 'B', 'A'])
    expect(v.total).toBe(100)
    expect(v.bars[0].cumulative).toBeCloseTo(60)
    expect(v.bars[2].cumulative).toBeCloseTo(100)
    expect(v.otherKey).toBeUndefined()
  })

  it('en çok 8 çubuk; fazlası Other çubuğunda toplanır, toplam değişmez', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ key: `K${i}`, value: 10 - i }))
    const v = paretoView(items, 8)
    expect(v.bars).toHaveLength(9)
    expect(v.otherKey).toBe('Other (2)')
    expect(v.bars[8].value).toBe(2 + 1)
    expect(v.bars[8].cumulative).toBe(100)
    expect(v.total).toBe(55)
  })
})

describe('makine dağılımı', () => {
  const days = [
    day('W1', { 'UNSCD_DOWN|STP': [30, 1] }, { 'UNSCD_DOWN|STP|DIE SETUP': [30, 1] }),
    day('W2', { 'UNSCD_DOWN|STP': [10, 1] }, { 'UNSCD_DOWN|STP|GRIPPER SETUP': [10, 1] }),
  ]

  it('bir duruşun makine toplamları, duruş sütununa eşit', () => {
    const cols = columnMinutes(days, cfg)
    const stp = cols.find((c) => c.key === 'STP')?.value
    const perMachine = machineMinutes(days, cfg, 'STP')
    expect(stp).toBe(40)
    expect(perMachine.reduce((s, r) => s + r.value, 0)).toBe(40)
    expect(perMachine.find((r) => r.key === 'W1')?.value).toBe(30)
  })

  it('alt duruşun makinelere dağılımı ve alt duruş listesi', () => {
    expect(subLossMinutes(days, cfg, 'STP').map((r) => r.key).sort()).toEqual(['DIE SETUP', 'GRIPPER SETUP'])
    expect(subLossMachines(days, cfg, 'STP', 'DIE SETUP')).toEqual([{ key: 'W1', value: 30 }])
    expect(subLossMachines(days, cfg, 'STP', 'GRIPPER SETUP')).toEqual([{ key: 'W2', value: 10 }])
  })
})

describe('topMaterials', () => {
  it('malzemeleri dakikaya göre sıralar, her malzemenin en büyük duruş sütununu verir', () => {
    const d: LossDay = {
      date: '2026-10-26',
      costCenter: 'C',
      workCenter: 'W1',
      codes: {},
      reasons: {},
      parts: {
        'UNSCD_DOWN|STP|MAT-A': [30, 1],
        'UNSCD_DOWN|STP|MAT-B': [10, 1],
        'UNSCD_DOWN|STP|MAT-A|X': [5, 1],
      },
    }
    const rows = topMaterials([d], cfg)
    expect(rows.map((r) => r.material)).toEqual(['MAT-A', 'MAT-B', 'MAT-A|X'])
    expect(rows[0]).toMatchObject({ material: 'MAT-A', minutes: 30, loss: 'STP' })
    expect(rows[0].lossShare).toBeCloseTo(1)
  })

  it('parça kırılımı yoksa boş döner', () => {
    expect(topMaterials([day('W1', { 'UNSCD_DOWN|STP': [10, 1] }, {})], cfg)).toEqual([])
  })
})
