import { describe, expect, it } from 'vitest'

import { computeRunPlan, splitByMoldLimit } from './planning'
import {
  CYCLE_STORE_DECIMALS,
  cavitiesOf,
  cycleMinutesFromSeconds,
  formatCycleInput,
  formatCycleMinutes,
  hasCycleTime,
  minutesPerPiece,
  minutesPerStroke,
  piecesPerHour,
  roundCycleMinutes,
  runMinutesFor,
} from './rateModel'

describe('üretim hızı: tek dil dakika / adet', () => {
  it('çevrim süresi varsa o; saatte 60 ÷ çevrim', () => {
    expect(minutesPerPiece({ cycleMinutes: 0.75 })).toBe(0.75)
    expect(piecesPerHour({ cycleMinutes: 0.75 })).toBe(80)
    // Çevrim süresi eski SPM / gözden önce gelir.
    expect(minutesPerPiece({ cycleMinutes: 0.5, spm: 60, moldCavities: 2 })).toBe(0.5)
    expect(hasCycleTime({ cycleMinutes: 0.5 })).toBe(true)
    expect(hasCycleTime({ spm: 20 })).toBe(false)
  })

  it('geri uyum: çevrim süresi yoksa 1 ÷ (SPM × göz); göz yoksa 1', () => {
    // 18 SPM, 2 göz → dakikada 36, saatte 2160 adet; adet başına 1/36 dk.
    expect(minutesPerPiece({ spm: 18, moldCavities: 2 })).toBeCloseTo(1 / 36, 12)
    expect(piecesPerHour({ spm: 18, moldCavities: 2 })).toBeCloseTo(2160, 9)
    expect(piecesPerHour({ spm: 20 })).toBeCloseTo(1200, 9)
    expect(minutesPerStroke({ spm: 20, moldCavities: 4 })).toBe(1 / 20)
    expect(cavitiesOf({})).toBe(1)
  })

  it('süre tanımsız: 0 (sıfıra bölme yok)', () => {
    expect(minutesPerPiece({})).toBe(0)
    expect(piecesPerHour({})).toBe(0)
    expect(runMinutesFor({}, 100)).toBe(0)
  })

  it('kayıt 5 hane, gösterim 3 hane', () => {
    expect(roundCycleMinutes(0.123456789)).toBe(0.12346)
    expect(roundCycleMinutes(1.000005)).toBe(1.00001)
    // Gösterim 3 hanede kalır: ekranda okunan sayı değişmedi.
    expect(formatCycleMinutes(0.5)).toBe('0.500')
    expect(formatCycleMinutes(0.12346)).toBe('0.123')
    expect(formatCycleMinutes(0)).toBe('')
  })
})

describe('computeRunPlan: süre = adet × dakika / adet', () => {
  it('yalnız çevrim süreli parça (nut welding): 1200 adet × 0,25 dk = 300 dk, vuruş = adet', () => {
    const run = computeRunPlan({ code: 'APR-601', cycleMinutes: 0.25 }, 1200)
    expect(run.theoreticalRunMinutes).toBe(300)
    expect(run.runMinutes).toBe(300)
    expect(run.shots).toBe(1200)
    expect(run.coilsNeeded).toBe(0)
    // Planning Logic örneği: %60 Accepted OEE ile iş 300 ÷ 0,6 = 500 dk.
    const withOee = computeRunPlan({ code: 'APR-601', cycleMinutes: 0.25, performanceFactor: 0.6 }, 1200)
    expect(Math.round(withOee.totalMinutes)).toBe(500)
  })

  it('eski parça (çevrim süresi yok, SPM + göz var): süre eskisiyle bit bit aynı (vuruş ÷ SPM)', () => {
    const old = (q: number, spm: number, cav: number) => Math.ceil(q / cav) / spm
    for (const [q, spm, cav] of [
      [1200, 18, 2],
      [1001, 16, 4],
      [7, 13, 3],
      [5000, 22, 1],
    ]) {
      const run = computeRunPlan({ code: 'P', spm, moldCavities: cav }, q)
      expect(run.theoreticalRunMinutes).toBe(old(q, spm, cav))
      expect(run.shots).toBe(Math.ceil(q / cav))
    }
    // Çarpan ve setup ile tam pencere de aynı: 2000 adet, 2 göz, 1000 vuruş ÷ 20 SPM
    // = 50 dk; %50 OEE → pencere 100 dk, 30 dk setup düşülünce üretim 70 dk.
    const run = computeRunPlan({ code: 'P', spm: 20, moldCavities: 2, performanceFactor: 0.5, setupMinutes: 30 }, 2000)
    expect(run.theoreticalRunMinutes).toBe(50)
    expect(run.runMinutes).toBe(70)
    expect(run.totalMinutes).toBe(100)
  })

  it('göz silinince vuruş = adet; göz varsa vuruş = ⌈adet ÷ göz⌉ (kalıp ömrü için)', () => {
    expect(computeRunPlan({ code: 'P', cycleMinutes: 0.1 }, 900).shots).toBe(900)
    expect(computeRunPlan({ code: 'P', cycleMinutes: 0.1, moldCavities: 4 }, 900).shots).toBe(225)
    // Kalıp limiti adet = vuruş üzerinden bölünür.
    const parts = splitByMoldLimit({ code: 'P', cycleMinutes: 0.1, maxShots: 400 }, 900)
    expect(parts.map((r) => r.quantity)).toEqual([400, 400, 100])
  })

  it('eş ürün aynı vuruştan kendi göz sayısı kadar çıkar', () => {
    // 1200 adet A, 4 göz → 300 vuruş; eşi 2 gözlü → 600 adet.
    expect(computeRunPlan({ code: 'A', coProduct: 'B', moldCavities: 4, spm: 10 }, 1200, 2).coProductQuantity).toBe(600)
    // Eşin gözü bilinmiyorsa asılınki.
    expect(computeRunPlan({ code: 'A', coProduct: 'B', moldCavities: 4, spm: 10 }, 1200).coProductQuantity).toBe(1200)
  })

  it('saniye sütunu dakika / adete çevrilir (punta "Saturasyon"); boş ve 0 süre tanımsızdır', () => {
    // 8.22 sn → 0.137 dk/adet; saatte 60 ÷ 0.137 ≈ 437 adet.
    expect(cycleMinutesFromSeconds(8.22)).toBe(0.137)
    expect(cycleMinutesFromSeconds(23.04)).toBe(0.384)
    expect(cycleMinutesFromSeconds(undefined)).toBeUndefined()
    expect(cycleMinutesFromSeconds(0)).toBeUndefined()
    expect(cycleMinutesFromSeconds(-5)).toBeUndefined()
  })

  it('kayıt 5 hane: saniyenin altında çalışan pres parçası yuvarlamada kaybolmaz', () => {
    expect(CYCLE_STORE_DECIMALS).toBe(5)
    // 1.1111 sn: 3 haneye yuvarlanmış 0.019 dk %2.6 fazla süre demekti.
    expect(cycleMinutesFromSeconds(1.1111111111111112)).toBe(0.01852)
    expect(cycleMinutesFromSeconds(0.8571428571428571)).toBe(0.01429)
    expect(cycleMinutesFromSeconds(3.5294117647058822)).toBe(0.05882)
    // 10.000 adetlik iş: 5 haneyle 185.2 dk, 3 haneyle 190 dk olurdu.
    expect(10_000 * cycleMinutesFromSeconds(1.1111111111111112)!).toBeCloseTo(185.2, 1)
  })

  it('kutuda görünen süre: olağan değer 3 hane, ince değer kendi hali', () => {
    expect(formatCycleInput(0.75)).toBe('0.750')
    expect(formatCycleInput(0.137)).toBe('0.137')
    expect(formatCycleInput(0.01852)).toBe('0.01852')
    expect(formatCycleInput(0.0143)).toBe('0.0143')
    expect(formatCycleInput(1)).toBe('1.000')
    expect(formatCycleInput(0)).toBe('')
    expect(formatCycleInput(undefined)).toBe('')
  })
})
