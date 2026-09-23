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
}

export const PRODUCT_FIELDS: ProductField[] = [
  { name: 'code', numeric: false },
  { name: 'coProduct', numeric: false },
  { name: 'moldCavities', numeric: true },
  { name: 'spm', numeric: true },
  { name: 'rawMaterialCode', numeric: false },
  { name: 'coilWeight', numeric: true },
  { name: 'grossWeight', numeric: true },
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
]

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

export function productDraftOf(product: Record<string, unknown>): ProductDraft {
  const draft = {} as ProductDraft
  for (const field of PRODUCT_FIELDS) draft[field.name] = text(product[field.name])
  draft.flexiblePress = product.flexiblePress ? 'yes' : ''
  return draft
}

export function sameProductDraft(a: ProductDraft, b: ProductDraft): boolean {
  return PRODUCT_FIELDS.every((field) => a[field.name] === b[field.name])
}

/** Sunucuya yazılması gereken alanlar. */
export function changedProductFields(
  draft: ProductDraft,
  server: ProductDraft,
): ProductField[] {
  return PRODUCT_FIELDS.filter((field) => draft[field.name] !== server[field.name])
}
