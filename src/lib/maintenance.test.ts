import { describe, expect, it } from 'vitest'

import {
  maintenanceDates,
  maintenancePerformance,
  moldBlackouts,
  pressMaintenanceBlock,
  type PressMaintenanceRow,
} from './maintenance'
import { buildDayTimeline } from './shiftTimeline'

// 07:00 başlayan, 3 vardiyalı bir gün; 07:00'de 15 dk devir, 12:00'de 30 dk
// yemek.
const timeline = buildDayTimeline(420, 480, 3, [
  { shiftIndex: 1, name: 'Handover', kind: 'handover', startMinute: 420, durationMinutes: 15 },
  { shiftIndex: 1, name: 'Meal', kind: 'meal', startMinute: 720, durationMinutes: 30 },
])

const base: PressMaintenanceRow = {
  press: 'PRS-108',
  date: '2026-09-21',
  startMinute: 8 * 60,
  endMinute: 12 * 60,
  reason: 'Hydraulic service',
  status: 'planned',
}

describe('pres bakımı bloğu', () => {
  it('saat aralığını net üretim dakikasına çevirir', () => {
    const block = pressMaintenanceBlock(base, timeline)!
    // 07:00–07:15 devir toplantısı üretim değil; 08:00 net 45. dakikadır.
    expect(block.start).toBe(45)
    // 12:00'ye kadar 07:15–12:00 = 285 dk üretim.
    expect(block.end).toBe(285)
    expect(block.press).toBe('PRS-108')
    expect(block.label).toBe('Hydraulic service')
  })

  it('iptal edilen bakım plana girmez', () => {
    expect(pressMaintenanceBlock({ ...base, status: 'cancelled' }, timeline)).toBeNull()
  })

  it('tümüyle molaya denk gelen bakım blok üretmez', () => {
    // 12:00–12:30 zaten yemek molası; üretimden ikinci kez düşülmemeli.
    const block = pressMaintenanceBlock(
      { ...base, startMinute: 720, endMinute: 750 },
      timeline,
    )
    expect(block).toBeNull()
  })

  it('ters girilen saatleri düzeltir', () => {
    const block = pressMaintenanceBlock(
      { ...base, startMinute: 12 * 60, endMinute: 8 * 60 },
      timeline,
    )!
    expect(block.start).toBe(45)
    expect(block.end).toBe(285)
  })
})

describe('kalıp bakım günleri', () => {
  it('tek günlük bakım tek gündür', () => {
    expect(maintenanceDates({ material: 'A', date: '2026-09-21' })).toEqual(['2026-09-21'])
  })

  it('aralık her günü kapsar', () => {
    expect(
      maintenanceDates({ material: 'A', date: '2026-09-21', dateTo: '2026-09-24' }),
    ).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'])
  })

  it('geriye dönük aralık tek güne düşer', () => {
    expect(
      maintenanceDates({ material: 'A', date: '2026-09-24', dateTo: '2026-09-21' }),
    ).toEqual(['2026-09-24'])
  })
})

describe('kalıp müsaitliği', () => {
  const horizon = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24']

  it('bakım aralığı yasak günlere dönüşür', () => {
    const { blackouts } = moldBlackouts(
      [{ material: 'A', date: '2026-09-22', dateTo: '2026-09-23' }],
      [],
      horizon,
    )
    expect(blackouts).toEqual([
      { material: 'A', date: '2026-09-22' },
      { material: 'A', date: '2026-09-23' },
    ])
  })

  it('hazır olmayan kalıp hazır tarihine kadar kapalıdır', () => {
    const { blackouts, unavailable } = moldBlackouts(
      [],
      [{ material: 'B', ready: false, readyDate: '2026-09-23' }],
      horizon,
    )
    expect(blackouts.map((b) => b.date)).toEqual(['2026-09-21', '2026-09-22'])
    // Hazır olduğu gün çalışabilir.
    expect(blackouts.some((b) => b.date === '2026-09-23')).toBe(false)
    expect(unavailable).toEqual([])
  })

  it('tarihsiz "hazır değil" süresiz kapalıdır ve ayrıca bildirilir', () => {
    // Gün listesiyle ifade edilemez: ufkun ötesinde de kapalı.
    const { blackouts, unavailable } = moldBlackouts(
      [],
      [{ material: 'C', ready: false }],
      horizon,
    )
    expect(blackouts).toEqual([])
    expect(unavailable).toEqual(['C'])
  })

  it('hazır kalıp hiçbir şeyi kapatmaz', () => {
    const { blackouts, unavailable } = moldBlackouts(
      [],
      [{ material: 'D', ready: true, readyDate: '2026-09-30' }],
      horizon,
    )
    expect(blackouts).toEqual([])
    expect(unavailable).toEqual([])
  })
})

describe('bakım performansı', () => {
  const rows: PressMaintenanceRow[] = [
    // Planlanan 240, gerçekleşen 300 → aşım.
    { ...base, status: 'done', actualDate: '2026-09-21', actualStartMinute: 480, actualEndMinute: 780 },
    // Planlanan 120, gerçekleşen 90.
    { ...base, startMinute: 600, endMinute: 720, status: 'done', actualStartMinute: 600, actualEndMinute: 690 },
    // Henüz yapılmadı.
    { ...base, status: 'planned' },
    // İptal — hiçbir sayıya girmez.
    { ...base, status: 'cancelled', actualStartMinute: 0, actualEndMinute: 999 },
  ]

  it('yalnızca ölçülen bakımlar oranı belirler', () => {
    const p = maintenancePerformance(rows)
    expect(p.measured).toBe(2)
    expect(p.plannedMinutes).toBe(360)
    expect(p.actualMinutes).toBe(390)
    expect(p.ratio).toBeCloseTo(390 / 360, 5)
    expect(p.overran).toBe(1)
  })

  it('iptaller sayılmaz, planlananlar sayılır', () => {
    const p = maintenancePerformance(rows)
    expect(p.planned).toBe(3)
    expect(p.completed).toBe(2)
  })

  it('hiç ölçüm yoksa oran uydurulmaz', () => {
    const p = maintenancePerformance([{ ...base, status: 'planned' }])
    expect(p.ratio).toBeNull()
    expect(p.measured).toBe(0)
  })
})

describe('ömür alarmı olan kalıplar', () => {
  const horizon = ['2026-09-21', '2026-09-22']

  it('alarmı açık kalıp plana hiç alınmaz', () => {
    const { blackouts, unavailable } = moldBlackouts([], [], horizon, ['A'])
    // Süresiz kapalılık: gün listesiyle ifade edilemez, ayrıca bildirilir.
    expect(blackouts).toEqual([])
    expect(unavailable).toEqual(['A'])
  })

  it('hem alarmlı hem tarihsiz tutulan kalıp iki kere sayılmaz', () => {
    const { unavailable } = moldBlackouts(
      [],
      [{ material: 'A', ready: false }],
      horizon,
      ['A'],
    )
    expect(unavailable).toEqual(['A'])
  })

  it('alarm listesi boşken davranış değişmez', () => {
    const { blackouts, unavailable } = moldBlackouts(
      [{ material: 'B', date: '2026-09-21' }],
      [],
      horizon,
    )
    expect(blackouts).toEqual([{ material: 'B', date: '2026-09-21' }])
    expect(unavailable).toEqual([])
  })
})
