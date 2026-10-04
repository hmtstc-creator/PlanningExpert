import { describe, expect, it } from 'vitest'

import { computeRunPlan, lotRuleOf } from './planning'
import { modelOfPart, piecesPerHour, planSpec, rateModelOf } from './rateModel'

const presses = new Map([
  ['PRS-1', { rateModel: undefined }],
  ['ROB-1', { rateModel: 'cycle' }],
])

describe('üretim modeli', () => {
  it('parça ana makinesinin modelini alır; tanımsız = pres', () => {
    expect(modelOfPart({ mainMachine: 'ROB-1' }, presses)).toBe('cycle')
    expect(modelOfPart({ mainMachine: 'PRS-1' }, presses)).toBe('stroke')
    expect(modelOfPart({ mainMachine: 'X' }, presses)).toBe('stroke')
    expect(rateModelOf({ rateModel: 'cycle' })).toBe('cycle')
  })

  it('pres parçası olduğu gibi kalır (çevrim alanları yok sayılır)', () => {
    const p = { code: 'A', spm: 20, moldCavities: 2, coilWeight: 5000, grossWeight: 1, stopEveryPcs: 100, rawMaterialCode: 'STEEL' }
    const s = planSpec(p, 'stroke')
    expect(s.spm).toBe(20)
    expect(s.coilWeight).toBe(5000)
    expect(s.stopEveryPcs).toBeUndefined()
    // 5000 kg ÷ 1 kg = 5000 adet/rulo: 12000 adet 3 rulo, 2 rulo değişimi.
    const run = computeRunPlan(s, 12000)
    expect(run.coilsNeeded).toBe(3)
    expect(run.coilChanges).toBe(2)
  })

  it('çevrim hattı: çevrim süresinden hız, rulo yok, lot ihtiyaç kadar, duruş her N adette', () => {
    // 45 sn çevrim, çevrimde 2 parça → saatte 160 adet.
    const raw = { code: 'B', moldCavities: 2, cycleTimeSeconds: 45, coilWeight: 8000, grossWeight: 2, rawMaterialCode: 'WIRE', stopEveryPcs: 500, coilSetupMinutes: 12 }
    const s = planSpec(raw, 'cycle')
    expect(s.spm).toBeCloseTo(60 / 45)
    expect(s.coilWeight).toBe(0)
    expect(s.rawMaterialCode).toBe('')
    expect(lotRuleOf(s)).toBe('need')
    expect(piecesPerHour(raw, 'cycle')).toBeCloseTo(160)
    const run = computeRunPlan(s, 1200)
    // 1200 adet = 600 çevrim × 45 sn = 450 dk; 500'de bir duruş → 3 parça, 2 duruş.
    expect(run.theoreticalRunMinutes).toBeCloseTo(450)
    expect(run.coilsNeeded).toBe(0)
    expect(run.coilChanges).toBe(2)
    expect(run.coilSetupMinutes).toBe(24)
    expect(run.coilRunMinutes).toHaveLength(3)
    // Duruşsuz çevrim hattı: tek parça.
    expect(computeRunPlan(planSpec({ ...raw, stopEveryPcs: undefined }, 'cycle'), 1200).coilChanges).toBe(0)
  })

  it('çevrim hattında Min. lot yine geçerli', () => {
    expect(lotRuleOf(planSpec({ code: 'C', cycleTimeSeconds: 30, minLotQty: 400 }, 'cycle'))).toBe('minLot')
  })
})
