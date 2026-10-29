// Üretim hızı: bütün parçalar ve bütün iş yerleri için TEK dil — çevrim
// süresi (dakika / adet). Kullanıcı kararı 2026-10-29.
//
// Eskiden pres hatları SPM × göz ile, punta / robot / montaj (cycle) hatları
// çevrim süresiyle ölçülür ve cycle hatları pres planına girmezdi. Artık
// motor her iş yerini planlar; parçanın süresi yalnız buradan okunur:
//
//   1) `cycleMinutes > 0`  → o (dakika / adet).
//   2) yoksa geri uyum     → 1 ÷ (SPM × göz)   (göz yoksa 1).
//   3) ikisi de yok        → 0 = süre tanımsız (doğrulayıcı uyarır).
//
// Göz (moldCavities) artık süreyi değil yalnız vuruş sayısını belirler:
// vuruş = ⌈adet ÷ göz⌉ (kalıp ömrü, rulo başına vuruş, maks. baskı). Göz
// silinince vuruş = adet. `presses.rateModel` şemada eski kayıtlar için
// durur; motor onu okumaz.

/** Çevrim süresinin gösterim hassasiyeti (dakika, virgülden sonra 3 hane). */
export const CYCLE_DECIMALS = 3

/** Dakikayı 3 haneye yuvarlar (kayıt ve gösterim aynı değeri kullanır). */
export function roundCycleMinutes(minutes: number): number {
  const f = 10 ** CYCLE_DECIMALS
  return Math.round(minutes * f) / f
}

export function formatCycleMinutes(minutes: number | null | undefined): string {
  return minutes && minutes > 0 ? minutes.toFixed(CYCLE_DECIMALS) : ''
}

export interface RateFields {
  spm?: number | null
  moldCavities?: number | null
  cycleMinutes?: number | null
}

/**
 * Çevrim süresi tanımlı parça (nut welding, punta, montaj …): rulo / sac
 * verisi beklenmez; Min. lot yoksa tam ihtiyaç kadar planlanması uyarı değildir.
 */
export function hasCycleTime(product: RateFields | undefined): boolean {
  return (product?.cycleMinutes ?? 0) > 0
}

/** Kalıp gözü (tanımsız ya da 0 ise 1): bir vuruşta çıkan adet. */
export function cavitiesOf(product: RateFields | undefined): number {
  const c = product?.moldCavities
  return c && c > 0 ? c : 1
}

/**
 * Bir vuruşun dakikası. Çevrim süreli parçada vuruş × göz × dk/adet; eski
 * (yalnız SPM'li) parçada 1 ÷ SPM — böylece eski parçaların süresi
 * (vuruş ÷ SPM) bit bit aynı kalır. 0 = süre tanımsız.
 */
export function minutesPerStroke(product: RateFields | undefined): number {
  const cycle = product?.cycleMinutes ?? 0
  if (cycle > 0) return cycle * cavitiesOf(product)
  const spm = product?.spm ?? 0
  return spm > 0 ? 1 / spm : 0
}

/** Bir adedin dakikası — TEK kaynak. 0 = süre tanımsız. */
export function minutesPerPiece(product: RateFields | undefined): number {
  const cycle = product?.cycleMinutes ?? 0
  if (cycle > 0) return cycle
  const spm = product?.spm ?? 0
  return spm > 0 ? 1 / (spm * cavitiesOf(product)) : 0
}

/** Saatlik adet (ekran için): 60 ÷ dk/adet; süre tanımsızsa 0. */
export function piecesPerHour(product: RateFields | undefined): number {
  const m = minutesPerPiece(product)
  return m > 0 ? 60 / m : 0
}

/**
 * Bir işin ideal hızda üretim süresi (dk): vuruş × dk/vuruş. Göz yoksa
 * vuruş = adet, yani adet × dk/adet.
 */
export function runMinutesFor(product: RateFields | undefined, quantity: number): number {
  if (quantity <= 0) return 0
  const strokes = Math.ceil(quantity / cavitiesOf(product))
  const cycle = product?.cycleMinutes ?? 0
  if (cycle > 0) return strokes * cavitiesOf(product) * cycle
  // Geri uyum: eski formül harfiyen (vuruş ÷ SPM), yuvarlama farkı olmasın.
  const spm = product?.spm ?? 0
  return spm > 0 ? strokes / spm : 0
}
