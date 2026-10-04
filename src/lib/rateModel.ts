// Üretim modeli: work center parçayı neyle ölçer.
//
// Pres hattı ile robot / montaj / kataforez hattı aynı şeyi üretmez:
//
//   Stroke (pres)   hız = SPM × göz; lot = tam rulo ya da Min. lot; malzeme
//                   rulodan kg (brüt ağırlık); frekansiyel duruş her rulo.
//   Cycle (hat)     hız = çevrim başına adet ÷ çevrim süresi (sn); lot = Min.
//                   lot ya da tam ihtiyaç; rulo ve kg yok; frekansiyel duruş
//                   "her N adette bir" (fikstür, elektrot, askı …).
//
// Model work center'ın tanımıdır (Work Center Definitions); parça ana
// makinesinin modelini alır. Plan motoru tek bir dili konuşur (vuruş, göz,
// parça aralığı): parça motora girmeden önce buradaki `planSpec` ile o dile
// çevrilir. Böylece motorun kuralları (vinç, setup, vardiya, geç iş) iki
// modelde de aynen çalışır.

import type { ProductSpec } from './planning'

export type RateModel = 'stroke' | 'cycle'

export const RATE_MODELS: Record<RateModel, { label: string; short: string; hint: string }> = {
  stroke: {
    label: 'Stroke — press',
    short: 'Press',
    hint: 'Strokes per minute × cavities; whole coils or Min. lot; steel in kg from the coil',
  },
  cycle: {
    label: 'Cycle — robot, assembly, line',
    short: 'Cycle',
    hint: 'Pieces per cycle ÷ cycle time; Min. lot or the exact need; no coil, no kg',
  },
}

export function rateModelOf(press: { rateModel?: string | null } | undefined): RateModel {
  return press?.rateModel === 'cycle' ? 'cycle' : 'stroke'
}

/** Parçanın modeli: ana makinesinin modeli (tanımsız makine: pres). */
export function modelOfPart(product: { mainMachine?: string | null }, presses: Map<string, { rateModel?: string | null }>): RateModel {
  return rateModelOf(presses.get(product.mainMachine?.trim() ?? ''))
}

/** Çevrim hattı parçasının ek alanları (products). */
export interface CycleFields {
  cycleTimeSeconds?: number | null
  /** Frekansiyel duruşlar arası adet (fikstür setup'ı … her N adette bir). */
  stopEveryPcs?: number | null
}

/**
 * Parçayı plan motorunun diline çevirir.
 * - Pres: olduğu gibi (çevrim alanları yok sayılır).
 * - Çevrim: SPM = 60 ÷ çevrim süresi, göz = çevrim başına adet; rulo yok
 *   (lot Min. lot ya da tam ihtiyaç); hammadde kg hesabına girmez;
 *   frekansiyel duruş aralığı `stopEveryPcs`.
 */
export function planSpec<T extends ProductSpec & CycleFields & { rawMaterialCode?: string }>(product: T, model: RateModel): T & ProductSpec {
  if (model === 'stroke') {
    const { stopEveryPcs: _s, ...rest } = product
    return { ...rest, stopEveryPcs: undefined } as T
  }
  const cycle = product.cycleTimeSeconds ?? 0
  return {
    ...product,
    spm: cycle > 0 ? 60 / cycle : 0,
    coilWeight: 0,
    rawMaterialCode: '',
    stopEveryPcs: (product.stopEveryPcs ?? 0) > 0 ? product.stopEveryPcs ?? undefined : undefined,
    lotByNeed: true,
  }
}

/** Parçanın saatlik adedi (ekran için): model hangisiyse ondan. */
export function piecesPerHour(product: ProductSpec & CycleFields, model: RateModel): number {
  const perCycle = product.moldCavities && product.moldCavities > 0 ? product.moldCavities : 1
  if (model === 'cycle') {
    const c = product.cycleTimeSeconds ?? 0
    return c > 0 ? (3600 / c) * perCycle : 0
  }
  return (product.spm ?? 0) * 60 * perCycle
}
