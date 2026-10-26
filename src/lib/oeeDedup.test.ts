import { describe, expect, it } from 'vitest'

import type { DowntimeEvent } from './oee'
import { downtimeKey, dropKeys, mergeDowntimes, planDowntimeDedup, planShiftDedup, summarizeFindings } from './oeeDedup'

const ev = (over: Partial<DowntimeEvent> = {}): DowntimeEvent => ({
  order: '1001',
  material: 'M1',
  mold: '',
  shiftGroup: '2',
  shiftDefinition: '',
  rc1: 'UPL',
  rc2: 'KLP',
  rc3: '',
  rc4: '',
  rc5: '',
  textEn: 'Mold change',
  textTr: '',
  seconds: 6900,
  minutes: 115,
  startDate: '2026-10-23',
  startTime: '16:10:00',
  endDate: '2026-10-23',
  endTime: '18:05:00',
  ...over,
})

describe('OEE duplicate rows (2026-10-26)', () => {
  it('the same work center, start and end uploaded 3 times is one 115 min row; the last one wins', () => {
    const three = [ev({ order: '1001' }), ev({ order: '1002' }), ev({ order: '1003', textEn: 'Mold change (fixed)' })]
    const once = mergeDowntimes([], three)
    expect(once).toHaveLength(1)
    expect(once[0].minutes).toBe(115)
    expect(once[0].textEn).toBe('Mold change (fixed)')
  })

  it('a different start or end is a different downtime; rows without times are never merged', () => {
    const list = [ev(), ev({ startTime: '16:11:00' }), ev({ endTime: '18:06:00' }), ev({ startTime: '', endTime: '' }), ev({ startTime: '', endTime: '' })]
    expect(mergeDowntimes([], list)).toHaveLength(5)
    expect(downtimeKey(ev({ startTime: '' }))).toBeNull()
    expect(dropKeys(list, new Set([downtimeKey(ev())!]))).toHaveLength(4)
  })

  it('stored records: one record per day × work center and one copy per downtime', () => {
    const docs = [
      // 22.10 kaydında aynı duruş (eski dosya başka güne yazmış): sonraki gün geçerli.
      { id: 'a', date: '2026-10-22', workCenter: 'PRS-110', events: [ev(), ev({ startTime: '06:00:00', endTime: '06:30:00', minutes: 30 })] },
      { id: 'b', date: '2026-10-23', workCenter: 'PRS-110', events: [ev(), ev()] },
      // Aynı gün × makinenin ikinci kaydı: bütünüyle silinir.
      { id: 'c', date: '2026-10-23', workCenter: 'PRS-110', events: [ev()] },
      // Başka makine: dokunulmaz.
      { id: 'd', date: '2026-10-23', workCenter: 'PRS-111', events: [ev()] },
    ]
    const plan = planDowntimeDedup(docs)
    expect(plan.remove).toEqual(['c'])
    const byId = Object.fromEntries(plan.rewrite.map((r) => [r.id, r.events]))
    expect(byId.b).toHaveLength(1)
    expect(byId.b[0].minutes).toBe(115)
    expect(byId.a.map((e) => e.minutes)).toEqual([30])
    expect(byId.d).toBeUndefined()
    // Silinen: 22.10'da 1 satır (115), 23.10'da fazla kayıt (115) + aynı kayıtta tekrar (115).
    expect(summarizeFindings(plan.findings)).toEqual({ rows: 3, minutes: 345, places: 2 })
  })

  it('page by page: duplicates only on the previous day are counted there, not again', () => {
    const docs = [
      { id: 'a', date: '2026-10-22', workCenter: 'PRS-110', events: [ev({ startDate: '2026-10-22', endDate: '2026-10-22' }), ev({ startDate: '2026-10-22', endDate: '2026-10-22' })] },
      { id: 'b', date: '2026-10-23', workCenter: 'PRS-110', events: [ev()] },
    ]
    const plan = planDowntimeDedup(docs, (d) => d === '2026-10-23')
    expect(plan.rewrite).toEqual([])
    expect(plan.findings).toEqual([])
  })

  it('shift rows: same day + shift + work center keeps the first (the one every upload updates)', () => {
    const rows = [
      { id: 1, date: '2026-10-23', workCenter: 'PRS-110', shiftGroup: '2', loadingMin: 400 },
      { id: 2, date: '2026-10-23', workCenter: 'PRS-110', shiftGroup: '2', loadingMin: 395 },
      { id: 3, date: '2026-10-23', workCenter: 'PRS-110', shiftGroup: '3', loadingMin: 410 },
      { id: 4, date: '2026-10-23', workCenter: 'PRS-111', shiftGroup: '2', loadingMin: 400 },
    ]
    const plan = planShiftDedup(rows)
    expect(plan.remove).toEqual([2])
    expect(plan.findings).toEqual([{ date: '2026-10-23', workCenter: 'PRS-110', shiftGroup: '2', rows: 1, minutes: 395 }])
  })
})
