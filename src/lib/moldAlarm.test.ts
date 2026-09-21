import { describe, expect, it } from 'vitest'

import { alarmedMaterials, planAlarms, type MoldShotState } from './moldAlarm'

const over: MoldShotState = { material: 'A', cumulativeShots: 520_000, maxShots: 500_000 }
const under: MoldShotState = { material: 'A', cumulativeShots: 120_000, maxShots: 500_000 }

describe('kalıp ömrü alarmı', () => {
  it('limit aşılınca alarm doğar', () => {
    const plan = planAlarms([over], [])
    expect(plan.toOpen).toEqual([{ material: 'A', shots: 520_000, limit: 500_000 }])
    expect(plan.toClear).toEqual([])
  })

  it('limite tam değmek de aşmaktır', () => {
    const plan = planAlarms([{ material: 'A', cumulativeShots: 500_000, maxShots: 500_000 }], [])
    expect(plan.toOpen).toHaveLength(1)
  })

  it('limitin altındayken alarm doğmaz', () => {
    expect(planAlarms([under], []).toOpen).toEqual([])
  })

  it('açık alarm tekrar tekrar açılmaz', () => {
    const plan = planAlarms([over], [{ material: 'A', status: 'open' }])
    expect(plan.toOpen).toEqual([])
    expect(plan.toClear).toEqual([])
  })

  it('elle kapatılan alarm hemen yeniden açılmaz', () => {
    // Kapatma bilinçli bir karar; eşiğin üstünde olduğu için anında
    // yeniden açmak kapatma tuşunu işlevsiz kılardı.
    const plan = planAlarms([over], [{ material: 'A', status: 'closed' }])
    expect(plan.toOpen).toEqual([])
    expect(plan.toClear).toEqual([])
  })

  it('sayaç sıfırlanınca kayıt düşer', () => {
    // Periyodik bakım kaydedildi, vuruş limitin altına indi.
    for (const status of ['open', 'closed']) {
      expect(planAlarms([under], [{ material: 'A', status }]).toClear).toEqual(['A'])
    }
  })

  it('sayaç sıfırlandıktan sonra limit yeniden aşılırsa yeni alarm doğar', () => {
    // Kayıt düştükten sonra elde alarm kalmaz; sonraki aşım yenisini açar.
    const cleared = planAlarms([under], [{ material: 'A', status: 'closed' }])
    expect(cleared.toClear).toEqual(['A'])
    expect(planAlarms([over], []).toOpen).toHaveLength(1)
  })

  it('limiti olmayan kalıp için alarm uydurulmaz', () => {
    const plan = planAlarms(
      [{ material: 'B', cumulativeShots: 9_000_000, maxShots: null }],
      [],
    )
    expect(plan.toOpen).toEqual([])
  })

  it('limit silinirse mevcut alarm düşer', () => {
    const plan = planAlarms(
      [{ material: 'B', cumulativeShots: 9_000_000, maxShots: null }],
      [{ material: 'B', status: 'open' }],
    )
    expect(plan.toClear).toEqual(['B'])
  })

  it('vuruş verisi kalmayan malzemenin alarmı düşer', () => {
    const plan = planAlarms([], [{ material: 'C', status: 'open' }])
    expect(plan.toClear).toEqual(['C'])
  })

  it('aynı malzeme iki kere temizlenmeye çalışılmaz', () => {
    const plan = planAlarms([under], [{ material: 'A', status: 'open' }])
    expect(plan.toClear).toEqual(['A'])
  })

  it('plana alınmayacaklar yalnızca açık alarmlardır', () => {
    expect(
      alarmedMaterials([
        { material: 'A', status: 'open' },
        { material: 'B', status: 'closed' },
      ]),
    ).toEqual(['A'])
  })
})
