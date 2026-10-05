import { describe, expect, it } from 'vitest'

import { formatCycleMinutes, minutesPerPiece, modelOfPart, piecesPerHour, pressPlanScope, rateModelOf, roundCycleMinutes } from './rateModel'

const presses = new Map([
  ['PRS-1', { rateModel: undefined }],
  ['PNT-1', { rateModel: 'cycle' }],
])

describe('üretim modeli', () => {
  it('parça ana makinesinin modelini alır; tanımsız = pres', () => {
    expect(modelOfPart({ mainMachine: 'PNT-1' }, presses)).toBe('cycle')
    expect(modelOfPart({ mainMachine: 'PRS-1' }, presses)).toBe('stroke')
    expect(modelOfPart({ mainMachine: 'X' }, presses)).toBe('stroke')
    expect(rateModelOf({ rateModel: 'cycle' })).toBe('cycle')
  })

  it('pres: saatte SPM × 60 × göz; adet başına dakika bunun tersi', () => {
    // 18 SPM, 2 göz → dakikada 36, saatte 2160 adet; adet başına 1/36 dk.
    const p = { spm: 18, moldCavities: 2 }
    expect(piecesPerHour(p, 'stroke')).toBe(2160)
    expect(minutesPerPiece(p, 'stroke')).toBeCloseTo(1 / 36, 10)
    // Göz yazılmamış: 1.
    expect(piecesPerHour({ spm: 20 }, 'stroke')).toBe(1200)
  })

  it('çevrim: dakika / adet, 3 hane; saatte 60 ÷ çevrim', () => {
    expect(piecesPerHour({ cycleMinutes: 0.75 }, 'cycle')).toBe(80)
    expect(minutesPerPiece({ cycleMinutes: 0.75 }, 'cycle')).toBeCloseTo(0.75, 10)
    expect(roundCycleMinutes(0.12345)).toBe(0.123)
    expect(roundCycleMinutes(1.0005)).toBe(1.001)
    expect(formatCycleMinutes(0.5)).toBe('0.500')
    expect(formatCycleMinutes(0)).toBe('')
    // Çevrim süresi yoksa hız yok (sıfıra bölme yok).
    expect(piecesPerHour({}, 'cycle')).toBe(0)
  })

  it('pres planı yalnızca pres hatlarını ve onların parçalarını içerir', () => {
    const scope = pressPlanScope(
      [{ name: 'PRS-1' }, { name: 'PNT-1', rateModel: 'cycle' }],
      [
        { code: 'A', mainMachine: 'PRS-1' },
        { code: 'B', mainMachine: 'PNT-1' },
        { code: 'C', mainMachine: '' },
      ],
    )
    expect(scope.presses.map((p) => p.name)).toEqual(['PRS-1'])
    expect(scope.products.map((p) => p.code)).toEqual(['A', 'C'])
    expect([...scope.excludedParts]).toEqual(['B'])
    expect(scope.cycleLines).toEqual(['PNT-1'])
  })
})

describe('eş ürün adedi (computeRunPlan)', () => {
  it('eş ürün aynı vuruştan kendi göz sayısı kadar çıkar', async () => {
    const { computeRunPlan } = await import('./planning')
    // 1200 adet A, 4 göz → 300 vuruş; eşi 2 gözlü → 600 adet.
    expect(computeRunPlan({ code: 'A', coProduct: 'B', moldCavities: 4, spm: 10 }, 1200, 2).coProductQuantity).toBe(600)
    // Eşin gözü bilinmiyorsa asılınki.
    expect(computeRunPlan({ code: 'A', coProduct: 'B', moldCavities: 4, spm: 10 }, 1200).coProductQuantity).toBe(1200)
  })
})
