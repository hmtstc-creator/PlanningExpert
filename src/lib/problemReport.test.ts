import { describe, expect, it } from 'vitest'

import {
  byMold,
  byOperation,
  byProblemType,
  crossTab,
  inRange,
  pareto,
  type ProblemRow,
} from './problemReport'

const rows: ProblemRow[] = [
  { material: 'A', operation: 'OP10', problemType: 'Burr', occurredAt: '2026-09-01', status: 'solved', downtimeMinutes: 30 },
  { material: 'A', operation: 'OP20', problemType: 'Burr', occurredAt: '2026-09-10', status: 'open', downtimeMinutes: 45 },
  { material: 'B', operation: 'OP10', problemType: 'Punch breakage', occurredAt: '2026-09-05', status: 'open' },
]

describe('problem raporu', () => {
  it('kalıba göre gruplar, en çok tekrarlayan başta', () => {
    const groups = byMold(rows)
    expect(groups.map((g) => g.key)).toEqual(['A', 'B'])
    expect(groups[0].count).toBe(2)
    expect(groups[0].open).toBe(1)
    expect(groups[0].downtimeMinutes).toBe(75)
    expect(groups[0].lastSeen).toBe('2026-09-10')
  })

  it('problem tipine ve operasyona göre de gruplar', () => {
    expect(byProblemType(rows)[0]).toMatchObject({ key: 'Burr', count: 2 })
    expect(byOperation(rows)[0]).toMatchObject({ key: 'OP10', count: 2 })
  })

  it('süre girilmemiş kayıt toplamı bozmaz', () => {
    // B'nin duruş süresi yok; sıfır sayılır, uydurulmaz.
    expect(byMold(rows).find((g) => g.key === 'B')!.downtimeMinutes).toBe(0)
  })

  it('tarih aralığı iki ucu da içerir', () => {
    expect(inRange(rows, '2026-09-05', '2026-09-10')).toHaveLength(2)
    expect(inRange(rows, '2026-09-01', '2026-09-01')).toHaveLength(1)
  })

  it('boş sınır o ucu serbest bırakır', () => {
    expect(inRange(rows, '', '2026-09-05')).toHaveLength(2)
    expect(inRange(rows, '2026-09-05', '')).toHaveLength(2)
    expect(inRange(rows, '', '')).toHaveLength(3)
  })

  it('ters aralık hiçbir şey döndürmez', () => {
    // Uydurma sonuç vermektense boş dönmek doğru.
    expect(inRange(rows, '2026-09-10', '2026-09-01')).toEqual([])
  })

  it('boş liste boş rapor verir', () => {
    expect(byMold([])).toEqual([])
  })
})

describe('pareto', () => {
  it('sorts by value and marks the bars that make up the first 80%', () => {
    const bars = pareto([
      { key: 'Burr', value: 50 },
      { key: 'Tear', value: 30 },
      { key: 'Scratch', value: 15 },
      { key: 'Misfeed', value: 5 },
      { key: 'Zero', value: 0 },
    ])
    expect(bars.map((b) => b.key)).toEqual(['Burr', 'Tear', 'Scratch', 'Misfeed'])
    expect(bars.map((b) => Math.round(b.cumulative))).toEqual([50, 80, 95, 100])
    // Burr + Tear = %80: ikisi önemli azınlık, gerisi değil.
    expect(bars.map((b) => b.vital)).toEqual([true, true, false, false])
  })

  it('counts each die against each problem type', () => {
    const tab = crossTab(rows, (r) => r.material, (r) => r.problemType)
    expect(tab.rows).toEqual(['A', 'B'])
    expect(tab.cols).toEqual(['Burr', 'Punch breakage'])
    expect(tab.count('A', 'Burr')).toBe(2)
    expect(tab.count('B', 'Burr')).toBe(0)
    expect(tab.rowTotal('A')).toBe(2)
  })
})

