import { describe, expect, it } from 'vitest'

import fixture from './oee.fixture.json'
import {
  daysFromShifts,
  inScope,
  lossDayOf,
  parseOeeWorkbook,
  ratios,
  sumTimes,
  type DayRow,
  type LossDay,
  type OeeConfig,
  type SheetRows,
} from './oee'
import {
  NOT_EXPLAINED,
  OVER_RECORDED,
  SPEED_GAIN,
  buildBridge,
  calendarInfo,
  level3,
  level3Views,
  matchedLossDays,
  topN,
  type Bridge,
} from './oeeBridge'

// Gerçek kesit (ASAKAI dosyası): Progressive 21 Eylül vardiyaları ve duruşları, Transfer 39. hafta.
const parsed = parseOeeWorkbook(fixture as unknown as Record<string, SheetRows>)
const allDays = daysFromShifts(parsed.shifts)
const allLoss = parsed.downtimes.map(lossDayOf)

const plant: OeeConfig = {
  areas: [{ name: 'PRS', pick: 'costCenter' }],
  costCenters: [
    { code: '51010171', name: 'Transfer', area: 'PRS' },
    { code: '51010173', name: 'Progressive', area: 'PRS' },
  ],
  shifts: [],
  lossReasonCodes: ['UNSCD_DOWN', '#'],
  breakReasonCodes: ['SCHED_DOWN'],
  lossGroups: [
    { code: 'KLP', label: 'Die breakdown', chart: 'Die', breakdown: true },
    { code: 'STP', label: 'Setup', chart: 'Setup', breakdown: false },
    { code: 'ARZ', label: 'Machine breakdown', chart: 'Machine', breakdown: true },
    { code: 'KSD', label: 'Short stoppages', chart: 'Short', breakdown: false },
    { code: 'KON', label: 'Quality', chart: 'Others', breakdown: false },
    { code: 'OFC', label: 'Logistic', chart: 'Others', breakdown: false },
    { code: 'YNT', label: 'Management', chart: 'Others', breakdown: false },
    { code: 'UTS', label: 'Breaks', chart: 'Others', breakdown: false },
    { code: '#', label: 'Undefined', chart: 'Undefined', breakdown: false, hidden: true },
  ],
  setupTexts: [],
  startupRunMin: 60,
  trendWeeks: 10,
  topN: 10,
}
const progressive = { area: 'PRS', key: '51010173' }
const day = '2026-09-21'
const pDays = allDays.filter((d) => d.date === day && inScope(d, progressive, plant))
const pLoss = allLoss.filter((l) => l.date === day && inScope(l, progressive, plant))

/** Köprü kapanır: her toplam = önceki toplam − aradaki kayıplar. */
function expectCloses(b: Bridge) {
  let run: number | null = null
  for (const s of b.steps) {
    if (s.kind === 'total') {
      if (run !== null) expect(s.minutes, s.label).toBeCloseTo(run, 6)
      run = s.minutes
    } else run = (run ?? 0) - s.minutes
  }
}

describe('OEE köprüsü', () => {
  it('Loading tabanı: OEE Dashboard ile aynı, köprü kapanır, Level 1 = %100', () => {
    const b = buildBridge(pDays, pLoss, plant, 'loading')
    expectCloses(b)
    expect(b.oee).toBeCloseTo(ratios(sumTimes(pDays)).oee!, 9)
    expect(b.mesOee).toBeCloseTo(b.oee!, 9)
    const l1 = b.level1!
    expect(l1.oee + l1.availability + l1.performance + l1.quality).toBeCloseTo(1, 9)
    // Denetçinin bulgusu: L − P = 1397,3; kayıtlı duruşlar daha fazla — işaretli adım, dağıtılmaz.
    expect(b.totals.loading - b.totals.production).toBeCloseTo(1397.3, 0)
    expect(b.notExplained).toBeLessThan(0)
    expect(b.steps.find((s) => s.key === 'av:unexplained')?.label).toBe(OVER_RECORDED)
  })

  it('vardiya tabanı (TPM): planlı duruşlar OEE içinde — OEE düşer, E aynı', () => {
    const l = buildBridge(pDays, pLoss, plant, 'loading')
    const s = buildBridge(pDays, pLoss, plant, 'shift')
    expectCloses(s)
    expect(s.totals.effective).toBeCloseTo(l.totals.effective, 9)
    expect(s.oee!).toBeLessThan(l.oee!)
    expect(s.baseMinutes).toBeCloseTo(l.totals.shift, 9)
    expect(s.items.some((i) => i.family === 'planned')).toBe(true)
    expect(l.items.some((i) => i.family === 'planned')).toBe(false)
    expect(l.outside.length).toBeGreaterThan(0)
    // Planlı duruş TPM tabanında da öncelik olmaz.
    expect(s.items.find((i) => i.priority)?.family).not.toBe('planned')
  })

  it('takvim: TEEP = E / A, planlanmamış süre kapanır', () => {
    const cal = calendarInfo(pDays, ['PRS-999'], day, day, [])
    expect(cal.machines).toBe(new Set([...pDays.map((d) => d.workCenter), 'PRS-999']).size)
    const b = buildBridge(pDays, pLoss, plant, 'loading', cal)
    expectCloses(b)
    expect(b.teep).toBeCloseTo(b.totals.effective / cal.minutes, 9)
    // Tatil ve boş gün: hiç vardiyası olmayan günler.
    const two = calendarInfo(pDays, [], '2026-09-20', day, ['2026-09-20'])
    expect(two.holidayMin).toBe(1440 * two.machines)
    expect(two.idleDayMin).toBe(0)
  })

  it('kayıp grubu performans ailesine alınınca OEE değişmez, A ve P payı değişir', () => {
    const moved = { ...plant, lossGroups: plant.lossGroups.map((g) => (g.code === 'KSD' ? { ...g, family: 'performance' as const } : g)) }
    const a = buildBridge(pDays, pLoss, plant, 'loading')
    const b = buildBridge(pDays, pLoss, moved, 'loading')
    expectCloses(b)
    expect(b.oee).toBeCloseTo(a.oee!, 9)
    expect(b.level1!.performance).toBeGreaterThan(a.level1!.performance)
    expect(b.items.find((i) => i.label === 'Short')?.family).toBe('performance')
  })

  it('performans %100 üstü: hız kaybı negatif adım, kırpılmaz', () => {
    const fast: DayRow[] = [
      {
        date: day,
        plantKey: '',
        responsible: '',
        costCenter: '51010173',
        workCenter: 'X',
        source: 'shiftly',
        good: 10,
        scrap: 0,
        reject: 0,
        scheduledMin: 30,
        unscheduledMin: 50,
        operatingMin: 420,
        productionMin: 400,
        loadingMin: 450,
      },
    ]
    const b = buildBridge(fast, [], plant, 'loading')
    expectCloses(b)
    expect(b.speed).toBe(-20)
    expect(b.steps.find((s) => s.key === 'pf:speed')?.label).toBe(SPEED_GAIN)
    expect(b.items.find((i) => i.key === 'pf:speed')?.rankable).toBe(false)
    // Duruş kaydı yok: Loading − Production tamamen açıklanmayan, öncelik olamaz.
    expect(b.items.find((i) => i.key === 'av:unexplained')).toMatchObject({ label: NOT_EXPLAINED, minutes: 50, rankable: false })
    expect(b.coverage.withoutDowntimes).toEqual([`${day}|X`])
  })

  it('kalite: hurda ve ret adetle süreye çevrilir, köprü kapanır', () => {
    const q: DayRow[] = [
      {
        date: day,
        plantKey: '',
        responsible: '',
        costCenter: '51010173',
        workCenter: 'X',
        source: 'shiftly',
        good: 90,
        scrap: 6,
        reject: 4,
        scheduledMin: 0,
        unscheduledMin: 0,
        operatingMin: 400,
        productionMin: 400,
        loadingMin: 400,
      },
    ]
    const b = buildBridge(q, [], plant, 'loading')
    expectCloses(b)
    expect(b.quality).toBeCloseTo(0.9, 9)
    expect(b.items.find((i) => i.key === 'q:scrap')?.minutes).toBeCloseTo(24, 9)
    expect(b.items.find((i) => i.key === 'q:reject')?.minutes).toBeCloseTo(16, 9)
    expect(b.oee).toBeCloseTo(ratios(sumTimes(q)).oee!, 9)
  })

  it('öncelik: en çok dakikalı sayılabilir kayıp; açıklanmayan, tanımsız ve gizli olamaz', () => {
    const b = buildBridge(pDays, pLoss, plant, 'loading')
    const pr = b.items.filter((i) => i.priority)
    expect(pr).toHaveLength(1)
    const best = Math.max(...b.items.filter((i) => i.rankable).map((i) => i.minutes))
    expect(pr[0].minutes).toBe(best)
    // Gizli grup ("#") kendi kalemi, öncelik olamaz; açıklanmayana karışmaz.
    expect(b.items.find((i) => i.label === 'Undefined')).toMatchObject({ rankable: false })
  })

  it('vardiyası olmayan gün × makinenin duruşu köprüye girmez', () => {
    const extra: LossDay = { date: day, costCenter: '51010173', workCenter: 'NO-SHIFT', codes: { 'UNSCD_DOWN|ARZ': [100, 1] }, reasons: {} }
    const b = buildBridge(pDays, [...pLoss, extra], plant, 'loading')
    expect(b).toMatchObject({ notExplained: buildBridge(pDays, pLoss, plant, 'loading').notExplained })
    expect(b.coverage.downtimesWithoutShift).toEqual([`${day}|NO-SHIFT`])
    expect(matchedLossDays(pDays, [...pLoss, extra])).toHaveLength(pLoss.length)
  })

  it('Level 3: nedene ve makineye göre; önceki dönem; ilk 5 + diğerleri', () => {
    const b = buildBridge(pDays, pLoss, plant, 'loading')
    const setup = b.items.find((i) => i.label === 'Setup')!
    expect(level3Views(setup)).toEqual(['reason', 'machine'])
    const cur = { days: pDays, lossDays: pLoss, orders: [] }
    const rows = level3(setup, 'reason', plant, cur, { days: [], lossDays: [], orders: [] })
    expect(rows.reduce((a, r) => a + r.minutes, 0)).toBeCloseTo(setup.minutes, 6)
    expect(rows[0].mttr).toBeCloseTo(rows[0].minutes / rows[0].count, 9)
    const byMachine = level3(setup, 'machine', plant, cur, cur)
    expect(byMachine.reduce((a, r) => a + r.previous, 0)).toBeCloseTo(setup.minutes, 6)
    const many = Array.from({ length: 8 }, (_, i) => ({ key: `k${i}`, label: `k${i}`, minutes: 8 - i, count: 1, mttr: null, previous: 0 }))
    const t = topN(many, 5)
    expect(t).toHaveLength(6)
    expect(t[5]).toMatchObject({ label: 'Others (3)', minutes: 6 })
    // Açıklanmayan: makine başına işaretli fark; toplamı köprüdeki adımla aynı.
    const un = b.items.find((i) => i.key === 'av:unexplained')!
    const perMachine = level3(un, 'machine', plant, cur, { days: [], lossDays: [], orders: [] })
    expect(perMachine.reduce((a, r) => a + r.minutes, 0)).toBeCloseTo(b.notExplained, 6)
    expect(perMachine.some((r) => r.minutes < 0)).toBe(true)
  })
})

describe('köprü dönemi', () => {
  it('hazır dönemler (bugün 2026-10-06 Salı)', async () => {
    const { periodRange } = await import('./oeeBridge')
    const t = '2026-10-06'
    expect(periodRange('yesterday', t)).toEqual({ from: '2026-10-05', to: '2026-10-05' })
    expect(periodRange('thisWeek', t)).toEqual({ from: '2026-10-05', to: '2026-10-05' })
    expect(periodRange('lastWeek', t)).toEqual({ from: '2026-09-28', to: '2026-10-04' })
    expect(periodRange('thisMonth', t)).toEqual({ from: '2026-10-01', to: '2026-10-05' })
    expect(periodRange('lastMonth', t)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(periodRange('custom', t, { from: '2026-08-01', to: '2026-09-30' })).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(periodRange('lastMonth', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    // Pazartesi "this week" ve ayın 1'i "this month": veri dünle biter — önceki hafta / ay.
    expect(periodRange('thisWeek', '2026-10-05')).toEqual({ from: '2026-09-28', to: '2026-10-04' })
    expect(periodRange('thisMonth', '2026-10-01')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
  })

  it('önceki eşit dönem ve veriye kırpma', async () => {
    const { previousRange, clipToData } = await import('./oeeBridge')
    expect(previousRange({ from: '2026-09-28', to: '2026-10-04' })).toEqual({ from: '2026-09-21', to: '2026-09-27' })
    // Ay: önceki takvim ayı (Eylül ↔ Ağustos tamamı, Ekim 1–5 ↔ Eylül 1–5, Mart ↔ Şubat tamamı).
    expect(previousRange({ from: '2026-09-01', to: '2026-09-30' }, true)).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(previousRange({ from: '2026-10-01', to: '2026-10-05' }, true)).toEqual({ from: '2026-09-01', to: '2026-09-05' })
    expect(previousRange({ from: '2026-03-01', to: '2026-03-31' }, true)).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(clipToData({ from: '2026-10-01', to: '2026-10-05' }, '2026-10-03')).toEqual({
      from: '2026-10-01',
      to: '2026-10-03',
      clipped: true,
    })
    expect(clipToData({ from: '2026-10-04', to: '2026-10-05' }, '2026-10-03')).toBeNull()
    expect(clipToData({ from: '2026-10-01', to: '2026-10-02' }, null)).toBeNull()
  })
})

describe('denetçi bulguları (2026-10-06)', () => {
  const sumRows = (rows: { minutes: number }[]) => rows.reduce((a, r) => a + r.minutes, 0)
  const none = { days: [], lossDays: [], orders: [] }

  it('çalışılmamış vardiyanın "scheduled downtime" kaydı planlı duruş değil, planlanmamış süredir', () => {
    const cal = calendarInfo(pDays, [], day, day, [])
    const b = buildBridge(pDays, pLoss, plant, 'loading', cal)
    expectCloses(b)
    expect(b.steps.find((s) => s.key === 'ns:unworked')?.minutes).toBeCloseTo(480, 0)
    // Planlı gruplar vardiyaların planlı süresini geçmez: eksi "fazla kayıt" adımı kalmaz.
    expect(b.steps.find((s) => s.key === 'pl:other')?.minutes ?? 0).toBeGreaterThanOrEqual(0)
    const plannedSum = b.outside.filter((i) => i.key !== 'pl:other').reduce((a, i) => a + i.minutes, 0)
    expect(plannedSum).toBeLessThanOrEqual(b.totals.shift - b.totals.loading + 1e-6)
  })

  it('her Level 3 kırılımı Level 2 kalemine eşit', () => {
    const b = buildBridge(pDays, pLoss, plant, 'shift')
    const cur = { days: pDays, lossDays: matchedLossDays(pDays, pLoss), orders: [] }
    for (const it of b.items) {
      for (const v of level3Views(it)) {
        const rows = level3(it, v, plant, cur, none)
        expect(sumRows(rows), `${it.label} / ${v}`).toBeCloseTo(it.minutes, 4)
      }
    }
  })

  it('kalite: süre adede göre dağılır; sipariş verisi olmayan kısım ayrı satır', () => {
    const d = (wc: string, scrap: number, reject: number): DayRow => ({
      date: day,
      plantKey: '',
      responsible: '',
      costCenter: '51010173',
      workCenter: wc,
      source: 'shiftly',
      good: 90,
      scrap,
      reject,
      scheduledMin: 0,
      unscheduledMin: 0,
      operatingMin: 400,
      productionMin: 400,
      loadingMin: 400,
    })
    const days = [d('X', 6, 4), d('Y', 2, 0)]
    const b = buildBridge(days, [], plant, 'loading')
    const scrap = b.items.find((i) => i.key === 'q:scrap')!
    const order = {
      date: day,
      plant: '',
      plantName: '',
      workCenter: 'X',
      shift: '',
      order: '1',
      equipment: 'D-1',
      material: '',
      good: 90,
      scrap: 6,
      reject: 4,
      scheduledMin: 0,
      unscheduledMin: 0,
      operatingMin: 400,
      productionMin: 400,
      loadingMin: 400,
      availability: 0,
      quality: 0,
      performance: 0,
      oee: 0,
    }
    const rows = level3(scrap, 'die', plant, { days, lossDays: [], orders: [order] }, none)
    expect(sumRows(rows)).toBeCloseTo(scrap.minutes, 9)
    expect(rows.map((r) => r.label)).toEqual(['D-1', 'Not in order data'])
    expect(rows[0].count).toBe(6)
    const speedRows = level3(
      b.items.find((i) => i.key === 'pf:speed') ?? { ...scrap, key: 'pf:speed', family: 'performance', minutes: 0 },
      'die',
      plant,
      { days, lossDays: [], orders: [order] },
      none,
    )
    expect(sumRows(speedRows)).toBeCloseTo(0, 9)
  })

  it('gizlenmemiş "#" grubu da öncelik olamaz', () => {
    const open = { ...plant, lossGroups: plant.lossGroups.map((g) => (g.code === '#' ? { ...g, hidden: false } : g)) }
    const b = buildBridge(pDays, pLoss, open, 'loading')
    expect(b.items.find((i) => i.label === 'Undefined')?.rankable).toBe(false)
  })

  it('takvim makine × gün: biri çalışırken boş duran makine "vardiyasız gün"dür', () => {
    const one: DayRow[] = [
      {
        date: day,
        plantKey: '',
        responsible: '',
        costCenter: 'C',
        workCenter: 'M1',
        source: 'shiftly',
        good: 0,
        scrap: 0,
        reject: 0,
        scheduledMin: 60,
        unscheduledMin: 0,
        operatingMin: 400,
        productionMin: 400,
        loadingMin: 420,
      },
    ]
    const cal = calendarInfo(one, ['M1', 'M2'], day, day, [])
    expect(cal).toMatchObject({ machines: 2, days: 1, idleDayMin: 1440, holidayMin: 0 })
    const hol = calendarInfo(one, ['M1', 'M2'], day, day, [day])
    expect(hol).toMatchObject({ idleDayMin: 0, holidayMin: 1440 })
  })
})
