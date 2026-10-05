// Master data tablosundaki bir satırın düzenlenebilir hâli.
//
// Tüm alanlar metin olarak tutulur: boş kutu "tanımsız" demektir ve bu
// sıfırdan farklıdır. Kayıt alan alan yazıldığı için (`products.updateField`)
// kısmi kayıt riski yok; buradaki amaç kullanıcının neyi kaydetmediğini
// görebilmesi.

export interface ProductField {
  name: keyof ProductDraft
  numeric: boolean
}

export interface ProductDraft {
  code: string
  coProduct: string
  moldCavities: string
  spm: string
  rawMaterialCode: string
  coilWeight: string
  grossWeight: string
  minLotQty: string
  setupMinutes: string
  coilSetupMinutes: string
  mainMachine: string
  altMachine1: string
  altMachine2: string
  altMachine3: string
  altMachine4: string
  /** 'yes' ya da '' — işaretliyse alternatif presler kullanılabilir. */
  flexiblePress: string
  maxShots: string
  qualityApprovalMinutes: string
  performanceFactor: string
  /** Çevrim hattı (src/lib/rateModel.ts): çevrim süresi, dakika / adet (3 hane). */
  cycleMinutes: string
  /** Çevrim hattı: frekansiyel duruşlar arası adet. */
  stopEveryPcs: string
}

export const PRODUCT_FIELDS: ProductField[] = [
  { name: 'code', numeric: false },
  { name: 'coProduct', numeric: false },
  { name: 'moldCavities', numeric: true },
  { name: 'spm', numeric: true },
  { name: 'rawMaterialCode', numeric: false },
  { name: 'coilWeight', numeric: true },
  { name: 'grossWeight', numeric: true },
  { name: 'minLotQty', numeric: true },
  { name: 'setupMinutes', numeric: true },
  { name: 'coilSetupMinutes', numeric: true },
  { name: 'mainMachine', numeric: false },
  { name: 'altMachine1', numeric: false },
  { name: 'altMachine2', numeric: false },
  { name: 'altMachine3', numeric: false },
  { name: 'altMachine4', numeric: false },
  { name: 'flexiblePress', numeric: false },
  { name: 'maxShots', numeric: true },
  { name: 'qualityApprovalMinutes', numeric: true },
  { name: 'performanceFactor', numeric: true },
  { name: 'cycleMinutes', numeric: true },
  { name: 'stopEveryPcs', numeric: true },
]

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

export function productDraftOf(product: Record<string, unknown>): ProductDraft {
  const draft = {} as ProductDraft
  for (const field of PRODUCT_FIELDS) draft[field.name] = text(product[field.name])
  draft.flexiblePress = product.flexiblePress ? 'yes' : ''
  // Çevrim süresi her zaman 3 haneyle görünür (0.750).
  const cycle = product.cycleMinutes
  draft.cycleMinutes = typeof cycle === 'number' && cycle > 0 ? cycle.toFixed(3) : ''
  return draft
}

/**
 * İki kutu değeri aynı mı? Çevrim süresi 3 haneyle saklanır: "0.75" ile
 * "0.750" aynıdır (yazım farkı değişiklik sayılmaz).
 */
export function sameFieldValue(name: keyof ProductDraft, a: string, b: string): boolean {
  if (a === b) return true
  if (name !== 'cycleMinutes') return false
  const x = Number(a.trim().replace(',', '.'))
  const y = Number(b.trim().replace(',', '.'))
  return a.trim() !== '' && b.trim() !== '' && Number.isFinite(x) && Number.isFinite(y) && Math.round(x * 1000) === Math.round(y * 1000)
}

export function sameProductDraft(a: ProductDraft, b: ProductDraft): boolean {
  return PRODUCT_FIELDS.every((field) => sameFieldValue(field.name, a[field.name], b[field.name]))
}

/** Sunucuya yazılması gereken alanlar. */
export function changedProductFields(
  draft: ProductDraft,
  server: ProductDraft,
): ProductField[] {
  return PRODUCT_FIELDS.filter((field) => !sameFieldValue(field.name, draft[field.name], server[field.name]))
}
