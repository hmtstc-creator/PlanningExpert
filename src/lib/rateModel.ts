// Üretim modeli: work center'ın plan yapısı.
//
// Her hattın plan yapısı farklıdır; birleştirilmez:
//
//   Stroke (pres)   PlanningExpert'in planı: SPM × göz, tam rulo ya da Min.
//                   lot, sac kg, vinç, kalıp setup'ı. Pres motoru yalnızca
//                   bu work center'ları ve ana makinesi bunlardan biri olan
//                   parçaları planlar.
//   Cycle (hat)     Punta, robot, montaj, kataforez: parçanın çevrim süresi
//                   (dakika / adet). Pres planına GİRMEZ — ayrıca planlanır;
//                   pres parçasıyla bağı (punta hattına giden pres parçası)
//                   bugün kurulmaz.
//
// Model work center'ın tanımıdır (Work Center Definitions); parça ana
// makinesinin modelini alır.

export type RateModel = 'stroke' | 'cycle'

export const RATE_MODELS: Record<RateModel, { label: string; short: string; hint: string }> = {
  stroke: {
    label: 'Stroke — press',
    short: 'Press',
    hint: 'Strokes per minute × cavities, whole coils or Min. lot, steel in kg — planned by PlanningExpert',
  },
  cycle: {
    label: 'Cycle — spot welding, robot, assembly, line',
    short: 'Cycle',
    hint: 'Cycle time in minutes per piece — not part of the press plan, planned separately',
  },
}

/** Çevrim süresinin gösterim hassasiyeti (dakika, virgülden sonra 3 hane). */
export const CYCLE_DECIMALS = 3

export function rateModelOf(press: { rateModel?: string | null } | undefined): RateModel {
  return press?.rateModel === 'cycle' ? 'cycle' : 'stroke'
}

/** Parçanın modeli: ana makinesinin modeli (tanımsız makine: pres). */
export function modelOfPart(product: { mainMachine?: string | null }, presses: Map<string, { rateModel?: string | null }>): RateModel {
  return rateModelOf(presses.get(product.mainMachine?.trim() ?? ''))
}

/** Dakikayı 3 haneye yuvarlar (kayıt ve gösterim aynı değeri kullanır). */
export function roundCycleMinutes(minutes: number): number {
  const f = 10 ** CYCLE_DECIMALS
  return Math.round(minutes * f) / f
}

export function formatCycleMinutes(minutes: number | null | undefined): string {
  return minutes && minutes > 0 ? minutes.toFixed(CYCLE_DECIMALS) : ''
}

/**
 * Parçanın saatlik adedi (ekran için).
 * - Pres: SPM × 60 × göz (bir vuruşta göz kadar parça).
 * - Çevrim: 60 ÷ çevrim süresi (dakika / adet).
 */
export function piecesPerHour(
  product: { spm?: number | null; moldCavities?: number | null; cycleMinutes?: number | null },
  model: RateModel,
): number {
  if (model === 'cycle') {
    const c = product.cycleMinutes ?? 0
    return c > 0 ? 60 / c : 0
  }
  const cavities = product.moldCavities && product.moldCavities > 0 ? product.moldCavities : 1
  return (product.spm ?? 0) * 60 * cavities
}

/** Bir adedin dakikası (iki model için de aynı dil: dakika / adet). */
export function minutesPerPiece(
  product: { spm?: number | null; moldCavities?: number | null; cycleMinutes?: number | null },
  model: RateModel,
): number {
  const pph = piecesPerHour(product, model)
  return pph > 0 ? 60 / pph : 0
}

/**
 * Pres planının girdisi: çevrim hatlarını ve ana makinesi çevrim hattı olan
 * parçaları (talepleri, stokları, takvimleri ile) dışarıda bırakır.
 * `excluded` ekranda "pres planında değil" diye söylenir.
 */
export function pressPlanScope<P extends { name: string; rateModel?: string | null }, Q extends { code: string; mainMachine?: string | null }>(
  presses: P[],
  products: Q[],
): { presses: P[]; products: Q[]; excludedParts: Set<string>; cycleLines: string[] } {
  const byName = new Map(presses.map((p) => [p.name, p]))
  const cycleLines = presses.filter((p) => rateModelOf(p) === 'cycle').map((p) => p.name)
  const excludedParts = new Set(products.filter((p) => modelOfPart(p, byName) === 'cycle').map((p) => p.code))
  return {
    presses: presses.filter((p) => rateModelOf(p) === 'stroke'),
    products: products.filter((p) => !excludedParts.has(p.code)),
    excludedParts,
    cycleLines,
  }
}
