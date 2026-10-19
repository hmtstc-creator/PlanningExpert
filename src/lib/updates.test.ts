import { describe, expect, it } from 'vitest'

import { TODAY_DEFAULTS } from './settingsDefaults'
import { buildFeed, buildFreshness, countNew, parseLastSeen, type TopicRecord, type UpdatesInput } from './updates'

const H = 3_600_000
const now = Date.UTC(2026, 9, 19, 9)

const topic = (over: Partial<TopicRecord> = {}): TopicRecord => ({
  id: 't1',
  subject: '4711 OP20',
  problemType: 'Burr',
  reportedAt: now - 2 * H,
  reportedBy: 'Ayse',
  status: 'open',
  ...over,
})

describe('Updates — Latest data', () => {
  it('izni olmayan modülün satırı yok', () => {
    expect(buildFreshness({ now }, TODAY_DEFAULTS)).toEqual([])
    const rows = buildFreshness({ now, oee: { imports: [], dataTo: null } }, TODAY_DEFAULTS)
    expect(rows.map((r) => r.key)).toEqual(['oee'])
  })

  it('plan: hesaptan sonra veri değiştiyse ya da eşikten eskiyse eski', () => {
    const fresh = buildFreshness({ now, plan: { computedAt: now - H, dataChangedAt: now - 2 * H } }, TODAY_DEFAULTS)[0]
    expect(fresh.state).toBe('fresh')
    const changed = buildFreshness({ now, plan: { computedAt: now - 2 * H, dataChangedAt: now - H } }, TODAY_DEFAULTS)[0]
    expect(changed.state).toBe('stale')
    expect(changed.detail).toContain('after the calculation')
    const old = buildFreshness({ now, plan: { computedAt: now - 30 * H, dataChangedAt: null } }, TODAY_DEFAULTS)[0]
    expect(old.state).toBe('stale')
    const none = buildFreshness({ now, plan: { computedAt: null, dataChangedAt: null } }, TODAY_DEFAULTS)[0]
    expect(none.state).toBe('missing')
  })

  it('plan onayı varsa ayrı satır, kişisiyle', () => {
    const rows = buildFreshness({ now, plan: { computedAt: now - H, dataChangedAt: null, approvedAt: now - 3 * H, approvedBy: 'Mehmet' } }, TODAY_DEFAULTS)
    expect(rows[1]).toMatchObject({ key: 'planApproved', by: 'Mehmet', state: 'info' })
  })

  it('SAP: ZPP ve MB52 her zaman, Today eşiğiyle; diğerleri yalnızca yüklendiyse', () => {
    const rows = buildFreshness(
      {
        now,
        sap: [
          { key: 'weeklyDemand', uploadedAt: now - 40 * H, fileName: 'zpp.xlsx', coversFrom: '2026-W42', coversTo: '2026-W60' },
          { key: 'actuals', uploadedAt: now - 100 * H, uploadedBy: 'Ali' },
        ],
      },
      TODAY_DEFAULTS,
    )
    expect(rows.map((r) => [r.key, r.state])).toEqual([
      ['sap.weeklyDemand', 'stale'],
      ['sap.stock', 'missing'],
      ['sap.actuals', 'info'],
    ])
    expect(rows[0].detail).toBe('zpp.xlsx · covers 2026-W42 → 2026-W60')
    expect(rows[1].detail).toBe('Never uploaded')
  })

  it('OEE: son yükleme ve verinin son günü', () => {
    const [row] = buildFreshness({ now, oee: { imports: [{ fileName: 'oee.xlsx', uploadedAt: now - H, uploadedBy: 'Ece' }], dataTo: '2026-10-18' } }, TODAY_DEFAULTS)
    expect(row).toMatchObject({ at: now - H, by: 'Ece', state: 'info', detail: 'data through 2026-10-18 · oee.xlsx' })
  })
})

describe('Updates — What’s new', () => {
  it('Die konusu: açılış ve çözüm iki olay; Loss Bridge konusunda pres ve aksiyon', () => {
    const feed = buildFeed({
      now,
      dieTopics: [topic({ press: 'P1', action: 'Grind punch', status: 'solved', solvedAt: now - H, solvedBy: 'Can', solution: 'Punch replaced' })],
    })
    expect(feed.map((f) => f.title)).toEqual(['Die topic solved — 4711 OP20', 'New die topic — 4711 OP20'])
    expect(feed[1].detail).toBe('Burr on P1 · Action: Grind punch')
    expect(feed[0]).toMatchObject({ by: 'Can', detail: 'Burr · Punch replaced', to: '/die-followup/problems' })
  })

  it('arıza: pres duruyorsa söylenir', () => {
    const [b] = buildFeed({ now, breakdowns: [topic({ subject: 'P3', problemType: 'Hydraulic', stopsPress: true })] })
    expect(b).toMatchObject({ module: 'machine', title: 'Breakdown — P3', detail: 'Hydraulic · work center stopped' })
  })

  it('pencere dışı ve eski (legacy) yükleme akışa girmez; yeniden eskiye, en çok limit', () => {
    const feed = buildFeed(
      {
        now,
        plan: { computedAt: now - 3 * H, dataChangedAt: null },
        sap: [
          { key: 'stock', uploadedAt: now - 8 * 24 * H },
          { key: 'weeklyDemand', uploadedAt: now - H, legacy: true },
          { key: 'actuals', uploadedAt: now - 5 * H, rowsImported: 12000, fileName: 'mb51.xlsx' },
        ],
        oee: { imports: [{ fileName: 'oee.xlsx', uploadedAt: now - 4 * H }], dataTo: null },
      },
      7,
      2,
    )
    expect(feed.map((f) => f.key)).toEqual(['plan.calculated', 'oee.' + (now - 4 * H) + '.0'])
    const all = buildFeed({ now, sap: [{ key: 'actuals', uploadedAt: now - 5 * H, rowsImported: 12000, fileName: 'mb51.xlsx' }] })
    expect(all[0].detail).toBe('mb51.xlsx · 12,000 rows')
  })

  it('son ziyaretten beri yeni: ilk ziyarette hiçbiri', () => {
    const items = [{ at: now - H }, { at: now - 5 * H }]
    expect(countNew(items, null)).toBe(0)
    expect(countNew(items, now - 2 * H)).toBe(1)
    expect(parseLastSeen('abc')).toBeNull()
    expect(parseLastSeen(null)).toBeNull()
    expect(parseLastSeen(String(now))).toBe(now)
  })
})
