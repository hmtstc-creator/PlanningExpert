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

/**
 * Kaydın hassasiyeti (dakika, virgülden sonra 5 hane) — kullanıcı kararı
 * 2026-10-29. Gösterimden daha ince, çünkü pres parçaları saniyenin altında
 * çalışır: 1.111 sn = 0.01852 dk/adet; 3 haneye yuvarlanmış 0.019 dk %2.6
 * fazla süre demek olur ve doğrudan iş süresine, kapasiteye yansır. Ekranda
 * süre yine 3 haneyle görünür (`CYCLE_DECIMALS`).
 */
export const CYCLE_STORE_DECIMALS = 5

/** Dakikayı kayıt hassasiyetine (5 hane) yuvarlar — saklanan tek biçim. */
export function roundCycleMinutes(minutes: number): number {
  const f = 10 ** CYCLE_STORE_DECIMALS
  return Math.round(minutes * f) / f
}

export function formatCycleMinutes(minutes: number | null | undefined): string {
  return minutes && minutes > 0 ? minutes.toFixed(CYCLE_DECIMALS) : ''
}

/**
 * Düzenlenebilir kutuda görünen süre: olağan değerler 3 haneyle (0.75 →
 * "0.750"), 3 haneye sığmayan ince değerler kendi haliyle ("0.01852").
 * Kutu kaydın değerini olduğu gibi göstermeli; 0.01852 yerine 0.019 yazmak
 * kullanıcıya yanlış sayı gösterir ve kutuya dokunulunca onu kaydeder.
 */
export function formatCycleInput(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return ''
  const full = minutes.toFixed(CYCLE_STORE_DECIMALS)
  const trimmed = full.replace(/0+$/, '')
  const [int, dec = ''] = trimmed.split('.')
  return dec.length >= CYCLE_DECIMALS ? trimmed : `${int}.${dec.padEnd(CYCLE_DECIMALS, '0')}`
}

/**
 * Saniye cinsinden verilen çevrim süresini dakika / adete çevirir (kayıt
 * hassasiyeti 5 hane).
 *
 * Punta, montaj ve pres hatlarının süreleri sahada saniye olarak ölçülür ve
 * Excel'e saniye yazılır ("Saturasyon", "Birim süre saniye"). Motorun tek dili
 * dakika / adet olduğu için çevrim yüklemede burada yapılır; başka yerde
 * kopyalanmaz. 0 ya da negatif değer "süre tanımsız" demektir (undefined
 * döner, elle girilen değer korunur).
 */
export function cycleMinutesFromSeconds(seconds: number | undefined): number | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return undefined
  return roundCycleMinutes(seconds / 60)
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
