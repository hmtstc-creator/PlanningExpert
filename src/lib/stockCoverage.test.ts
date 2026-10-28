import { describe, expect, it } from 'vitest'
import { stockCoverage } from './stockCoverage'

describe('stockCoverage', () => {
  it('stok birikimli ihtiyacı karşıladığı dönemler kapsanır', () => {
    expect(stockCoverage(30196, 0, [0, -6174, -3000, -6750, 0, -3000, -12000])).toEqual([
      true, true, true, true, true, true, false,
    ])
  })
  it('gecikmiş ihtiyaç önce stoktan düşer', () => {
    expect(stockCoverage(3280, -2096, [0, -1000, 0])).toEqual([true, true, true])
    expect(stockCoverage(3280, -2096, [0, -1300, 0])).toEqual([true, false, false])
  })
  it('stok yoksa hiçbir dönem kapsanmaz', () => {
    expect(stockCoverage(0, 0, [0, 0])).toEqual([false, false])
  })
  it('pozitif değerler ihtiyaç değildir', () => {
    expect(stockCoverage(10, 0, [50, -10])).toEqual([true, true])
  })
})
